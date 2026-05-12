import asyncio
import os
from contextlib import asynccontextmanager
from datetime import datetime

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, Response
from fastapi.staticfiles import StaticFiles
from sqlalchemy import func, select, text
from sqlalchemy.dialects.postgresql import insert as pg_insert

from app.config import settings as app_settings
from app.database import AsyncSessionLocal, Base, engine
from app.models.contract import Contract, ContractCategory, ContractRarity, IntelDrop, VoidAttempt, VoidClaim  # noqa: F401
from app.models.event import Event, EventStatus  # noqa: F401 — registers table with Base
from app.models.settings import PlatformSettings
from app.models.team import Team, TeamMembership, ContractAssignment  # noqa: F401
from app.models.transmission import NetworkTransmission
from app.models.request import OperatorRequest, RequestType, RequestStatus  # noqa: F401
from app.models.notification import Notification  # noqa: F401
from app.models.registration_request import RegistrationRequest, RegRequestStatus  # noqa: F401
from app.models.corrupted_contract import CorruptedContract, CorruptedClaim, CorruptedAttempt, CCStatus  # noqa: F401
from app.models.event_registration import EventRegistration, EventRemoval  # noqa: F401
from app.models.organization import Organization  # noqa: F401 — registers table with Base
from app.models.major_event import MajorEventPartner, MajorEventContractor  # noqa: F401
from app.models.contract_org_flag import ContractOrgFlag  # noqa: F401
from app.models.user import User, UserRole
from app.utils.security import hash_password

_MOCK_CONTRACTS = [
    {
        "title": "HTTP Handshake",
        "description": (
            "## Briefing\n\nA rogue server is broadcasting a handshake beacon "
            "on a legacy HTTP endpoint. Intercept the response headers and extract "
            "the embedded token.\n\n"
            "**Target:** `http://challenge.deadnet.local/handshake`\n\n"
            "> *\"The network whispers to those who listen.\"*"
        ),
        "category": ContractCategory.WEB,
        "rarity": ContractRarity.COMMON,
        "base_bc_value": 75,
        "flag": "DEADNET{welcome_to_the_grid}",
        "intel": [
            ("Check the response headers carefully — not just the body.", 25),
            ("The token is base64 encoded in a custom X- header.", 40),
        ],
    },
    {
        "title": "Signal Lost",
        "description": (
            "## Briefing\n\nA corrupted data packet was recovered from "
            "a dead drop node. Reconstruct the original message.\n\n"
            "Attached file contains the raw packet capture.\n\n"
            "> *\"In the noise, there is signal.\"*"
        ),
        "category": ContractCategory.MISC,
        "rarity": ContractRarity.COMMON,
        "base_bc_value": 50,
        "flag": "DEADNET{static_noise_detected}",
        "intel": [
            ("Look for repeating byte patterns — this is a simple substitution.", 20),
        ],
    },
    {
        "title": "Cipher Protocol",
        "description": (
            "## Briefing\n\nA team courier was intercepted. "
            "Their encrypted message uses a proprietary XOR cipher scheme. "
            "The key rotates every 8 bytes.\n\n"
            "```\nCiphertext (hex):\n1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d\n```\n\n"
            "> *\"Encryption is only as strong as its key.\"*"
        ),
        "category": ContractCategory.CRYPTOGRAPHY,
        "rarity": ContractRarity.RARE,
        "base_bc_value": 200,
        "flag": "DEADNET{xor_the_darkness}",
        "intel": [
            ("The key is exactly 8 bytes. Look for repeating plaintext patterns.", 50),
            ("Known plaintext: the message starts with 'DEADNET'.", 75),
        ],
    },
    {
        "title": "Digital Remains",
        "description": (
            "## Briefing\n\nA ghost operative left behind a forensic image "
            "of a compromised terminal. Recover the deleted mission file.\n\n"
            "The file system is ext4. The file was deleted 3 hours ago.\n\n"
            "> *\"Deleted is not destroyed.\"*"
        ),
        "category": ContractCategory.FORENSICS,
        "rarity": ContractRarity.RARE,
        "base_bc_value": 250,
        "flag": "DEADNET{echo_from_the_void}",
        "intel": [
            ("Use a file carving tool — the inode is still intact.", 60),
            ("The file magic bytes are: 89 50 4E 47 (PNG header).", 80),
        ],
    },
    {
        "title": "Root Access",
        "description": (
            "## Briefing\n\nA hardened netbox is running a vulnerable "
            "service on port 4444. Exploit the stack overflow, gain root, "
            "and read `/root/flag.txt`.\n\n"
            "**Binary protections:** NX enabled, no ASLR, no canary.\n\n"
            "> *\"Every system has a crack. Find it.\"*"
        ),
        "category": ContractCategory.PWN,
        "rarity": ContractRarity.CLASSIFIED,
        "base_bc_value": 500,
        "flag": "DEADNET{ghost_in_the_shell_777}",
        "intel": [
            ("The overflow happens in `parse_input()` at offset 72.", 100),
            ("ROP gadget at 0x08048430: `pop eax; ret`.", 120),
            ("Use ret2libc — system() and /bin/sh are at predictable offsets.", 150),
        ],
    },
    {
        "title": "Ghost Signal",
        "description": (
            "## Briefing\n\nA DEADNET operative has gone dark. "
            "Their last known digital footprint points to a pseudonymous "
            "online presence. Unmask them.\n\n"
            "Starting clue: username `n3cr0_ph4ntom` on public forums.\n\n"
            "> *\"Everyone leaves a shadow on the net.\"*"
        ),
        "category": ContractCategory.OSINT,
        "rarity": ContractRarity.CLASSIFIED,
        "base_bc_value": 450,
        "flag": "DEADNET{your_digital_shadow_knows}",
        "intel": [
            ("Check GitHub commits — the username is reused with slight variations.", 80),
            ("Cross-reference the email from the commit metadata.", 100),
        ],
    },
]


async def _seed():
    """Idempotent seed: events + admin + settings + mock contracts."""
    async with AsyncSessionLocal() as db:
        # Event 1 — must exist before any contract/claim rows are created
        event_check = await db.execute(select(Event).where(Event.id == 1))
        if not event_check.scalar_one_or_none():
            db.add(Event(id=1, name="Event 1", status=EventStatus.ACTIVE.value, registration_open=True))
            await db.flush()
            print("[DEADNET] Seeded Event 1")

        # Admin + platform settings — only if no admin exists
        admin_check = await db.execute(select(User).where(User.role == UserRole.ADMIN))
        if not admin_check.scalars().first():
            db.add(User(
                username=app_settings.ADMIN_USERNAME,
                email=app_settings.ADMIN_EMAIL,
                hashed_password=hash_password(app_settings.ADMIN_PASSWORD),
                role=UserRole.ADMIN,
                is_verified=True,
            ))
            defaults = {
                "registration_open": "true",
                "team_registration_open": "true",
                "allow_solo": "true",
                "competition_name": "DEADNET",
                "competition_start": "",
                "competition_end": "",
                "competition_timezone": "Asia/Manila",
                "competition_format": "local",
                "show_section_in_name": "true",
                "max_team_size": "4",
                "max_flag_attempts": "0",
                "decay_mode": "TIME_BASED",
                "decay_tier_1_hours": "1.0",
                "decay_tier_1_percent": "90",
                "decay_tier_2_hours": "2.0",
                "decay_tier_2_percent": "75",
                "decay_tier_3_hours": "3.0",
                "decay_tier_3_percent": "60",
                "decay_floor_percent": "50",
                "cl_ghost": "501",
                "cl_phantom": "1501",
                "cl_specter": "3001",
                "cl_legend": "6001",
                "board_frozen": "false",
                "solve_feed_delay_seconds": "30",
                # Feature flags
                "void_mode_enabled": "true",
                "bounty_board_public": "false",
                "maintenance_mode": "false",
                # Platform identity
                "term_operator": "Operative",
                "term_team": "Team",
                "term_handler": "Handler",
                "term_contractor": "Contractor",
                # Org caps (0 = unlimited)
                "max_organizations": "0",
                "max_events_per_org": "0",
                "max_operators_per_org": "0",
                # Registration gateway
                "platform_registration_locked": "false",
                # File limits
                "max_upload_mb": "50",
                "allowed_file_types": "zip,pdf,txt,png,jpg,bin",
            }
            settings_list = [{"key": k, "value": v} for k, v in defaults.items()]
            await db.execute(
                pg_insert(PlatformSettings).values(settings_list).on_conflict_do_nothing(index_elements=["key"])
            )
            await db.flush()
            print(f"[DEADNET] Seeded admin: {app_settings.ADMIN_USERNAME}")

        # Mock contracts — only if none exist yet
        contract_check = await db.execute(select(Contract).limit(1))
        if not contract_check.scalar_one_or_none():
            _seed_ev = (await db.execute(
                select(Event.id).where(Event.status == EventStatus.ACTIVE.value).order_by(Event.id.desc()).limit(1)
            )).scalar_one_or_none() or 1
            for mc in _MOCK_CONTRACTS:
                c = Contract(
                    title=mc["title"],
                    description=mc["description"],
                    category=mc["category"],
                    rarity=mc["rarity"],
                    base_bc_value=mc["base_bc_value"],
                    flag=mc["flag"],
                    is_published=True,
                    attachments=[],
                    event_id=_seed_ev,
                )
                db.add(c)
                await db.flush()
                for i, (content, cost) in enumerate(mc.get("intel", [])):
                    db.add(IntelDrop(
                        contract_id=c.id,
                        content=content,
                        cost_bc=cost,
                        order_index=i,
                    ))
            await db.flush()
            print(f"[DEADNET] Seeded {len(_MOCK_CONTRACTS)} mock contracts")

        # VO1D contracts — seeded once, never wiped by event resets
        void_check = await db.execute(select(Contract).where(Contract.is_void.is_(True)).limit(1))
        if not void_check.scalar_one_or_none():
            _void_contracts = [
                {
                    "title": "SHELL IN THE GHOST",
                    "description": (
                        "The architect leaves traces in the wire.\n"
                        "Every response tells a story.\n"
                        "Listen to the headers.\n"
                        "The flag is hiding in plain sight —\n"
                        "encoded, waiting, patient.\n"
                        "You already walked past it a hundred times."
                    ),
                    "category": ContractCategory.CRYPTOGRAPHY,
                    "flag": "V01D{s0L_h34d3r_w4s_h3r3}",
                },
                {
                    "title": "DEAD MEN TELL NO TALE",
                    "description": (
                        "Something is buried where you least expect it.\n"
                        "The platform has eyes — and one of them\n"
                        "is hiding something.\n"
                        "Not everything is what it appears to be."
                    ),
                    "category": ContractCategory.FORENSICS,
                    "flag": "V01D{pr3tty_b4s1c_f0r_a_d3ad_m4n}",
                },
                {
                    "title": "DEADN3T",
                    "description": (
                        "s0L built this place.\n"
                        "s0L left marks.\n"
                        "Five signatures. Five fragments.\n"
                        "Find them all. Combine them in order.\n"
                        "The flag is the sum of what was left behind."
                    ),
                    "category": ContractCategory.WEB,
                    "flag": "V01D{y0u_f0und_4ll_my_tr4c3s_L0L}",
                },
                {
                    "title": "I AM NULL",
                    "description": (
                        "There is a door that doesn't exist.\n"
                        "Behind it is a room with no walls.\n"
                        "I am in the room.\n"
                        "Find the door first."
                    ),
                    "category": ContractCategory.MISC,
                    "flag": "V01D{1ve_b3c0m3_s0_null}",
                },
            ]
            for vc in _void_contracts:
                db.add(Contract(
                    title=vc["title"],
                    description=vc["description"],
                    category=vc["category"],
                    rarity=ContractRarity.CLASSIFIED,
                    base_bc_value=500,
                    flag=vc["flag"],
                    is_published=True,
                    is_void=True,
                    attachments=[],
                    tags=[],
                    event_id=None,  # VO1D contracts are cross-event
                ))
            await db.flush()
            print("[DEADNET] Seeded 4 VO1D contracts")

        # Backfill NULL event_ids with the current active event (fallback: 1)
        _active_ev = (await db.execute(
            select(Event.id).where(Event.status == EventStatus.ACTIVE.value).order_by(Event.id.desc()).limit(1)
        )).scalar_one_or_none()
        _backfill_eid = _active_ev or 1
        for tbl in ("contracts", "claims", "intel_purchases", "bc_events", "teams", "team_memberships"):
            await db.execute(text(f"UPDATE {tbl} SET event_id = :eid WHERE event_id IS NULL"), {"eid": _backfill_eid})

        # Always migrate non-void contracts that are not on the active event.
        # Handles switching from Event 1 → Event 2 regardless of whether a
        # draft contract was already created on the new event.
        if _active_ev:
            _r = await db.execute(text(
                "UPDATE contracts SET event_id = :aid WHERE event_id != :aid AND is_void = false"
            ), {"aid": _active_ev})
            if _r.rowcount:
                print(f"[DEADNET] Migrated {_r.rowcount} contract(s) to active event {_active_ev}")

        # Clean up ghost team memberships: members with no EventRegistration
        # for that event are pre-registration-system data (old event backfill).
        # Also clean up ARCHIVED-event memberships, then orphaned teams.
        await db.execute(text("""
            DELETE FROM team_memberships sm
            WHERE NOT EXISTS (
                SELECT 1 FROM event_registrations er
                WHERE er.user_id = sm.operative_id
                  AND er.event_id = sm.event_id
                  AND er.status = 'ACTIVE'
            )
        """))
        await db.execute(text("""
            DELETE FROM teams s
            WHERE NOT EXISTS (
                SELECT 1 FROM team_memberships sm WHERE sm.team_id = s.id
            )
        """))

        # ── Session 16: Organization foundation ────────────────────────────────
        # Seed default organization (idempotent)
        from app.models.organization import Organization
        univ_row = (await db.execute(
            select(Organization).where(Organization.name == "LSPU Siniloan")
        )).scalar_one_or_none()
        if not univ_row:
            univ_row = Organization(
                name="LSPU Siniloan",
                org_code="LSPU",
                created_by="s0L",
            )
            db.add(univ_row)
            await db.flush()
            print("[DEADNET] Seeded default organization: LSPU Siniloan")

        default_uid = univ_row.id

        # Backfill org_id on all existing rows (safe to run multiple times)
        for tbl in ("events", "contracts", "teams",
                    "operator_requests", "registration_requests",
                    "corrupted_contracts", "bc_events", "transmissions"):
            await db.execute(text(
                f"UPDATE {tbl} SET org_id = :uid WHERE org_id IS NULL"
            ), {"uid": default_uid})

        # Users: Architect has no DB row, so all users rows are non-Architect
        await db.execute(text(
            "UPDATE users SET org_id = :uid WHERE org_id IS NULL"
        ), {"uid": default_uid})

        await db.commit()


@asynccontextmanager
async def lifespan(app: FastAPI):
    async with engine.begin() as conn:
        # Pre-create_all table renames — must run before SQLAlchemy inspects the
        # schema, otherwise create_all tries to CREATE tables that already exist
        # under their old names and crashes on duplicate constraint names.
        for _pre in [
            """DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='universities')
     AND NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='organizations')
  THEN ALTER TABLE universities RENAME TO organizations;
  END IF;
END $$""",
            """DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='syndicates')
     AND NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='teams')
  THEN ALTER TABLE syndicates RENAME TO teams;
  END IF;
END $$""",
            """DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='syndicate_memberships')
     AND NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='team_memberships')
  THEN ALTER TABLE syndicate_memberships RENAME TO team_memberships;
  END IF;
END $$""",
        ]:
            await conn.execute(text(_pre))
        await conn.run_sync(Base.metadata.create_all)
        # Idempotent column additions (no Alembic needed for local dev)
        for stmt in [
            "ALTER TABLE users ADD COLUMN IF NOT EXISTS bc_total INTEGER NOT NULL DEFAULT 0",
            "ALTER TABLE users ADD COLUMN IF NOT EXISTS school VARCHAR(100)",
            "ALTER TABLE users ADD COLUMN IF NOT EXISTS section VARCHAR(100)",
            "ALTER TABLE users ALTER COLUMN section TYPE VARCHAR(100)",
            "ALTER TABLE users ADD COLUMN IF NOT EXISTS last_login TIMESTAMP",
            "ALTER TABLE users ADD COLUMN IF NOT EXISTS last_ip VARCHAR(50)",
            "ALTER TABLE users ADD COLUMN IF NOT EXISTS full_name VARCHAR(100)",
            "ALTER TABLE users ADD COLUMN IF NOT EXISTS student_id VARCHAR(50)",
            "ALTER TABLE users ADD COLUMN IF NOT EXISTS year_level VARCHAR(20)",
            "ALTER TABLE users ADD COLUMN IF NOT EXISTS onboarding_complete BOOLEAN NOT NULL DEFAULT false",
            "ALTER TABLE contracts ADD COLUMN IF NOT EXISTS tags JSONB",
            "ALTER TABLE contracts ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES users(id) ON DELETE SET NULL",
            # ── Event migration: copy events→events data, rename event_id→event_id ──
            # Copy Event 1 into events table if events is currently empty and events exists
            """DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='events')
     AND NOT EXISTS (SELECT 1 FROM events LIMIT 1) THEN
    INSERT INTO events (id, name, status, registration_open, created_at, participant_count, export_generated)
    SELECT id, name,
      CASE WHEN status::text = 'ACTIVE' THEN 'ACTIVE'
           WHEN status::text = 'ARCHIVED' THEN 'CLOSED'
           ELSE 'UPCOMING' END,
      false, created_at, 0, false
    FROM events ON CONFLICT (id) DO NOTHING;
  END IF;
END $$""",
            # Rename event_id → event_id on tables that still have the old column name
            # These check for the OLD column name 'season_id' — already renamed to 'event_id' on existing DBs, so the condition is a no-op.
            """DO $$ BEGIN IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='contracts' AND column_name='season_id') THEN ALTER TABLE contracts RENAME COLUMN season_id TO event_id; END IF; END $$""",
            """DO $$ BEGIN IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='claims' AND column_name='season_id') THEN ALTER TABLE claims RENAME COLUMN season_id TO event_id; END IF; END $$""",
            """DO $$ BEGIN IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='intel_purchases' AND column_name='season_id') THEN ALTER TABLE intel_purchases RENAME COLUMN season_id TO event_id; END IF; END $$""",
            """DO $$ BEGIN IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='bc_events' AND column_name='season_id') THEN ALTER TABLE bc_events RENAME COLUMN season_id TO event_id; END IF; END $$""",
            """DO $$ BEGIN IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='teams' AND column_name='season_id') THEN ALTER TABLE teams RENAME COLUMN season_id TO event_id; END IF; END $$""",
            """DO $$ BEGIN IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='team_memberships' AND column_name='season_id') THEN ALTER TABLE team_memberships RENAME COLUMN season_id TO event_id; END IF; END $$""",
            """DO $$ BEGIN IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='operator_requests' AND column_name='season_id') THEN ALTER TABLE operator_requests RENAME COLUMN season_id TO event_id; END IF; END $$""",
            """DO $$ BEGIN IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='corrupted_contracts' AND column_name='season_id') THEN ALTER TABLE corrupted_contracts RENAME COLUMN season_id TO event_id; END IF; END $$""",
            """DO $$ BEGIN IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='corrupted_claims' AND column_name='season_id') THEN ALTER TABLE corrupted_claims RENAME COLUMN season_id TO event_id; END IF; END $$""",
            # Add event_id FK columns (no-op if already renamed above; needed for fresh deployments)
            "ALTER TABLE contracts ADD COLUMN IF NOT EXISTS event_id INTEGER REFERENCES events(id) ON DELETE SET NULL",
            "ALTER TABLE claims ADD COLUMN IF NOT EXISTS event_id INTEGER REFERENCES events(id) ON DELETE SET NULL",
            "ALTER TABLE intel_purchases ADD COLUMN IF NOT EXISTS event_id INTEGER REFERENCES events(id) ON DELETE SET NULL",
            "ALTER TABLE bc_events ADD COLUMN IF NOT EXISTS event_id INTEGER REFERENCES events(id) ON DELETE SET NULL",
            "ALTER TABLE teams ADD COLUMN IF NOT EXISTS event_id INTEGER REFERENCES events(id) ON DELETE SET NULL",
            "ALTER TABLE team_memberships ADD COLUMN IF NOT EXISTS event_id INTEGER REFERENCES events(id) ON DELETE SET NULL",
            "ALTER TABLE void_claims ADD COLUMN IF NOT EXISTS event_id INTEGER REFERENCES events(id) ON DELETE SET NULL",
            "ALTER TABLE registration_requests ADD COLUMN IF NOT EXISTS event_id INTEGER REFERENCES events(id) ON DELETE SET NULL",
            # New events table columns (add if not present — for existing deployments)
            "ALTER TABLE events ADD COLUMN IF NOT EXISTS registration_open BOOLEAN NOT NULL DEFAULT false",
            "ALTER TABLE events ADD COLUMN IF NOT EXISTS start_time TIMESTAMP",
            "ALTER TABLE events ADD COLUMN IF NOT EXISTS end_time TIMESTAMP",
            "ALTER TABLE events ADD COLUMN IF NOT EXISTS closed_at TIMESTAMP",
            "ALTER TABLE events ADD COLUMN IF NOT EXISTS archived_at TIMESTAMP",
            "ALTER TABLE events ADD COLUMN IF NOT EXISTS reset_level VARCHAR(10)",
            "ALTER TABLE events ADD COLUMN IF NOT EXISTS export_generated BOOLEAN NOT NULL DEFAULT false",
            "ALTER TABLE events ADD COLUMN IF NOT EXISTS participant_count INTEGER NOT NULL DEFAULT 0",
            "ALTER TABLE events ADD COLUMN IF NOT EXISTS description VARCHAR(300)",
            # event_registrations table (Session 14 — created for FK integrity, fully built in Session 15)
            """CREATE TABLE IF NOT EXISTS event_registrations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  registered_at TIMESTAMP NOT NULL DEFAULT NOW(),
  registered_by VARCHAR(10) NOT NULL DEFAULT 'SELF',
  CONSTRAINT uq_event_registration UNIQUE (event_id, user_id)
)""",
            "CREATE INDEX IF NOT EXISTS ix_event_registrations_event ON event_registrations(event_id)",
            "CREATE INDEX IF NOT EXISTS ix_event_registrations_user ON event_registrations(user_id)",
            # Session 15 — extend event_registrations
            "ALTER TABLE event_registrations ADD COLUMN IF NOT EXISTS status VARCHAR(10) NOT NULL DEFAULT 'ACTIVE'",
            "ALTER TABLE event_registrations ADD COLUMN IF NOT EXISTS removed_at TIMESTAMP",
            "ALTER TABLE event_registrations ADD COLUMN IF NOT EXISTS removed_by VARCHAR(100)",
            "ALTER TABLE event_registrations ADD COLUMN IF NOT EXISTS removal_reason VARCHAR(500)",
            # Session 15 — extend events table with registration key fields
            "ALTER TABLE events ADD COLUMN IF NOT EXISTS registration_key VARCHAR(20) UNIQUE",
            "ALTER TABLE events ADD COLUMN IF NOT EXISTS key_regenerated_at TIMESTAMP",
            "ALTER TABLE events ADD COLUMN IF NOT EXISTS email_domain_restriction VARCHAR(200)",
            # Session 15 — event_removals audit table
            """CREATE TABLE IF NOT EXISTS event_removals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  callsign VARCHAR(100) NOT NULL,
  removed_by VARCHAR(100) NOT NULL,
  removal_reason VARCHAR(500) NOT NULL,
  bc_wiped INTEGER NOT NULL DEFAULT 0,
  removed_at TIMESTAMP NOT NULL DEFAULT NOW()
)""",
            "CREATE INDEX IF NOT EXISTS ix_event_removals_event ON event_removals(event_id)",
            "CREATE INDEX IF NOT EXISTS ix_event_removals_user ON event_removals(user_id)",
            "CREATE TABLE IF NOT EXISTS contract_attempts ("
            "  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),"
            "  operative_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,"
            "  contract_id UUID NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,"
            "  attempt_count INTEGER NOT NULL DEFAULT 0,"
            "  last_attempt_at TIMESTAMP NOT NULL DEFAULT NOW(),"
            "  CONSTRAINT uq_attempt_operative_contract UNIQUE (operative_id, contract_id)"
            ")",
            # Email verification columns
            "ALTER TABLE users ADD COLUMN IF NOT EXISTS is_verified BOOLEAN NOT NULL DEFAULT false",
            "ALTER TABLE users ADD COLUMN IF NOT EXISTS verification_token VARCHAR(255)",
            "ALTER TABLE users ADD COLUMN IF NOT EXISTS verification_token_expires TIMESTAMP",
            "ALTER TABLE users ADD COLUMN IF NOT EXISTS password_reset_token VARCHAR(255)",
            "ALTER TABLE users ADD COLUMN IF NOT EXISTS password_reset_expires TIMESTAMP",
            "ALTER TABLE users ADD COLUMN IF NOT EXISTS password_reset_requested_at TIMESTAMP",
            # Backfill: all existing users (admin, etc.) are pre-verified
            "UPDATE users SET is_verified = TRUE WHERE is_verified = FALSE AND created_at < NOW()",
            # First blood operative FK
            "ALTER TABLE contracts ADD COLUMN IF NOT EXISTS first_blood_operative_id UUID REFERENCES users(id) ON DELETE SET NULL",
            # VO1D columns
            "ALTER TABLE contracts ADD COLUMN IF NOT EXISTS is_void BOOLEAN NOT NULL DEFAULT false",
            "ALTER TABLE users ADD COLUMN IF NOT EXISTS void_bc INTEGER NOT NULL DEFAULT 0",
            "ALTER TABLE users ADD COLUMN IF NOT EXISTS void_access BOOLEAN NOT NULL DEFAULT false",
            "ALTER TABLE teams ADD COLUMN IF NOT EXISTS void_bc INTEGER NOT NULL DEFAULT 0",
            "CREATE TABLE IF NOT EXISTS void_claims ("
            "  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),"
            "  contract_id UUID NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,"
            "  operative_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,"
            "  team_id UUID,"
            "  claimed_at TIMESTAMP NOT NULL DEFAULT NOW(),"
            "  CONSTRAINT uq_void_claim UNIQUE (contract_id, operative_id)"
            ")",
            "CREATE TABLE IF NOT EXISTS void_attempts ("
            "  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),"
            "  contract_id UUID NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,"
            "  operative_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,"
            "  attempts INTEGER NOT NULL DEFAULT 0,"
            "  created_at TIMESTAMP NOT NULL DEFAULT NOW(),"
            "  CONSTRAINT uq_void_attempt UNIQUE (contract_id, operative_id)"
            ")",
            # Operator requests table (Session 11)
            "CREATE TABLE IF NOT EXISTS operator_requests ("
            "  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),"
            "  sender_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,"
            "  sender_callsign VARCHAR(50) NOT NULL,"
            "  sender_role VARCHAR(20) NOT NULL,"
            "  request_type VARCHAR(20) NOT NULL,"
            "  requested_role VARCHAR(20),"
            "  reason VARCHAR(300) NOT NULL,"
            "  status VARCHAR(20) NOT NULL DEFAULT 'PENDING',"
            "  admin_response VARCHAR(300),"
            "  resolved_by VARCHAR(50),"
            "  resolved_at TIMESTAMP,"
            "  created_at TIMESTAMP NOT NULL DEFAULT NOW(),"
            "  event_id INTEGER REFERENCES events(id) ON DELETE SET NULL"
            ")",
            "CREATE INDEX IF NOT EXISTS ix_operator_requests_sender_id ON operator_requests(sender_id)",
            "CREATE INDEX IF NOT EXISTS ix_operator_requests_status ON operator_requests(status)",
            "CREATE INDEX IF NOT EXISTS ix_operator_requests_created_at ON operator_requests(created_at DESC)",
            # Notifications table (Session 11 Part F)
            "CREATE TABLE IF NOT EXISTS notifications ("
            "  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),"
            "  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,"
            "  message VARCHAR(500) NOT NULL,"
            "  read BOOLEAN NOT NULL DEFAULT false,"
            "  created_at TIMESTAMP NOT NULL DEFAULT NOW()"
            ")",
            "CREATE INDEX IF NOT EXISTS ix_notifications_user_id ON notifications(user_id)",
            "ALTER TABLE notifications ADD COLUMN IF NOT EXISTS from_callsign VARCHAR(50)",
            # Corrupted Contracts tables (Session 12)
            "CREATE TABLE IF NOT EXISTS corrupted_contracts ("
            "  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),"
            "  title VARCHAR(200) NOT NULL,"
            "  description TEXT DEFAULT '',"
            "  flag VARCHAR(500) NOT NULL,"
            "  category VARCHAR(50) NOT NULL,"
            "  duration_minutes INTEGER NOT NULL,"
            "  activated_at TIMESTAMP,"
            "  expires_at TIMESTAMP,"
            "  status VARCHAR(20) NOT NULL DEFAULT 'DRAFT',"
            "  created_by UUID REFERENCES users(id) ON DELETE SET NULL,"
            "  event_id INTEGER REFERENCES events(id) ON DELETE SET NULL,"
            "  created_at TIMESTAMP NOT NULL DEFAULT NOW(),"
            "  max_attempts INTEGER NOT NULL DEFAULT 5"
            ")",
            "CREATE TABLE IF NOT EXISTS corrupted_claims ("
            "  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),"
            "  contract_id UUID NOT NULL REFERENCES corrupted_contracts(id) ON DELETE CASCADE,"
            "  operative_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,"
            "  event_id INTEGER REFERENCES events(id) ON DELETE SET NULL,"
            "  claimed_at TIMESTAMP NOT NULL DEFAULT NOW(),"
            "  bc_awarded INTEGER NOT NULL"
            ")",
            "CREATE TABLE IF NOT EXISTS corrupted_attempts ("
            "  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),"
            "  contract_id UUID NOT NULL REFERENCES corrupted_contracts(id) ON DELETE CASCADE,"
            "  operative_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,"
            "  attempts INTEGER NOT NULL DEFAULT 0,"
            "  CONSTRAINT uq_cc_attempt UNIQUE (contract_id, operative_id)"
            ")",
            # Pass 1 — rename netrunner_id → operative_id and syndicate_id → team_id
            # across all tables that still have the old column names (idempotent).
            """DO $$ BEGIN IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='corrupted_claims' AND column_name='netrunner_id') THEN ALTER TABLE corrupted_claims RENAME COLUMN netrunner_id TO operative_id; END IF; END $$""",
            """DO $$ BEGIN IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='corrupted_attempts' AND column_name='netrunner_id') THEN ALTER TABLE corrupted_attempts RENAME COLUMN netrunner_id TO operative_id; END IF; END $$""",
            """DO $$ BEGIN IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='void_claims' AND column_name='netrunner_id') THEN ALTER TABLE void_claims RENAME COLUMN netrunner_id TO operative_id; END IF; END $$""",
            """DO $$ BEGIN IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='void_claims' AND column_name='syndicate_id') THEN ALTER TABLE void_claims RENAME COLUMN syndicate_id TO team_id; END IF; END $$""",
            """DO $$ BEGIN IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='void_attempts' AND column_name='netrunner_id') THEN ALTER TABLE void_attempts RENAME COLUMN netrunner_id TO operative_id; END IF; END $$""",
            """DO $$ BEGIN IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='bc_events' AND column_name='netrunner_id') THEN ALTER TABLE bc_events RENAME COLUMN netrunner_id TO operative_id; END IF; END $$""",
            """DO $$ BEGIN IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='bc_events' AND column_name='syndicate_id') THEN ALTER TABLE bc_events RENAME COLUMN syndicate_id TO team_id; END IF; END $$""",
            """DO $$ BEGIN IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='bc_events' AND column_name='university_id') THEN ALTER TABLE bc_events RENAME COLUMN university_id TO org_id; END IF; END $$""",
            """DO $$ BEGIN IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='claims' AND column_name='netrunner_id') THEN ALTER TABLE claims RENAME COLUMN netrunner_id TO operative_id; END IF; END $$""",
            """DO $$ BEGIN IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='claims' AND column_name='syndicate_id') THEN ALTER TABLE claims RENAME COLUMN syndicate_id TO team_id; END IF; END $$""",
            """DO $$ BEGIN IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='contract_attempts' AND column_name='netrunner_id') THEN ALTER TABLE contract_attempts RENAME COLUMN netrunner_id TO operative_id; END IF; END $$""",
            """DO $$ BEGIN IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uq_attempt_netrunner_contract') THEN ALTER TABLE contract_attempts RENAME CONSTRAINT uq_attempt_netrunner_contract TO uq_attempt_operative_contract; END IF; END $$""",
            """DO $$ BEGIN IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='team_memberships' AND column_name='netrunner_id') THEN ALTER TABLE team_memberships RENAME COLUMN netrunner_id TO operative_id; END IF; END $$""",
            """DO $$ BEGIN IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='team_memberships' AND column_name='syndicate_id') THEN ALTER TABLE team_memberships RENAME COLUMN syndicate_id TO team_id; END IF; END $$""",
            "CREATE INDEX IF NOT EXISTS ix_cc_claims_operative ON corrupted_claims(operative_id)",
            "CREATE INDEX IF NOT EXISTS ix_cc_claims_contract ON corrupted_claims(contract_id)",
            "CREATE INDEX IF NOT EXISTS ix_cc_attempts_contract ON corrupted_attempts(contract_id)",
            "CREATE INDEX IF NOT EXISTS ix_cc_attempts_operative ON corrupted_attempts(operative_id)",
            "ALTER TABLE corrupted_contracts ADD COLUMN IF NOT EXISTS bc_reward INTEGER NOT NULL DEFAULT 100",
            "ALTER TABLE corrupted_contracts ADD COLUMN IF NOT EXISTS has_attachment BOOLEAN NOT NULL DEFAULT false",
            "ALTER TABLE corrupted_contracts ADD COLUMN IF NOT EXISTS attachment_filename VARCHAR(255)",
            "ALTER TABLE corrupted_contracts ADD COLUMN IF NOT EXISTS attachment_path VARCHAR(500)",
            "ALTER TABLE corrupted_contracts ADD COLUMN IF NOT EXISTS attachment_size INTEGER",
            # Session 13 — account status + registration approval flow
            "ALTER TABLE users ADD COLUMN IF NOT EXISTS account_status VARCHAR(30) NOT NULL DEFAULT 'ACTIVE'",
            "ALTER TABLE users ADD COLUMN IF NOT EXISTS registration_reason VARCHAR(500)",
            "ALTER TABLE users ADD COLUMN IF NOT EXISTS denied_reason VARCHAR(500)",
            # Backfill: all pre-existing users → ACTIVE
            "UPDATE users SET account_status = 'ACTIVE' WHERE account_status IS NULL OR account_status = ''",
            "CREATE TABLE IF NOT EXISTS registration_requests ("
            "  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),"
            "  callsign VARCHAR(50) NOT NULL,"
            "  email VARCHAR(255) NOT NULL,"
            "  role_requested VARCHAR(20) NOT NULL,"
            "  reason VARCHAR(500) NOT NULL,"
            "  status VARCHAR(20) NOT NULL DEFAULT 'PENDING',"
            "  admin_callsign VARCHAR(50),"
            "  admin_reason VARCHAR(300),"
            "  requested_at TIMESTAMP NOT NULL DEFAULT NOW(),"
            "  resolved_at TIMESTAMP"
            ")",
            "CREATE INDEX IF NOT EXISTS ix_reg_requests_callsign ON registration_requests(callsign)",
            "CREATE INDEX IF NOT EXISTS ix_reg_requests_status ON registration_requests(status)",
            # Pass 1 — rename universities table → organizations (idempotent)
            """DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='universities')
     AND NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='organizations')
  THEN ALTER TABLE universities RENAME TO organizations;
  END IF;
END $$""",
            # Pass 1 — rename university_id → org_id on all affected tables (idempotent)
            """DO $$ BEGIN IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='users' AND column_name='university_id') THEN ALTER TABLE users RENAME COLUMN university_id TO org_id; END IF; END $$""",
            """DO $$ BEGIN IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='events' AND column_name='university_id') THEN ALTER TABLE events RENAME COLUMN university_id TO org_id; END IF; END $$""",
            """DO $$ BEGIN IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='contracts' AND column_name='university_id') THEN ALTER TABLE contracts RENAME COLUMN university_id TO org_id; END IF; END $$""",
            """DO $$ BEGIN IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='teams' AND column_name='university_id') THEN ALTER TABLE teams RENAME COLUMN university_id TO org_id; END IF; END $$""",
            """DO $$ BEGIN IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='operator_requests' AND column_name='university_id') THEN ALTER TABLE operator_requests RENAME COLUMN university_id TO org_id; END IF; END $$""",
            """DO $$ BEGIN IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='registration_requests' AND column_name='university_id') THEN ALTER TABLE registration_requests RENAME COLUMN university_id TO org_id; END IF; END $$""",
            """DO $$ BEGIN IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='corrupted_contracts' AND column_name='university_id') THEN ALTER TABLE corrupted_contracts RENAME COLUMN university_id TO org_id; END IF; END $$""",
            """DO $$ BEGIN IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='bc_events' AND column_name='university_id') THEN ALTER TABLE bc_events RENAME COLUMN university_id TO org_id; END IF; END $$""",
            """DO $$ BEGIN IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='architect_log' AND column_name='university_id') THEN ALTER TABLE architect_log RENAME COLUMN university_id TO org_id; END IF; END $$""",
            """DO $$ BEGIN IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='transmissions' AND column_name='university_id') THEN ALTER TABLE transmissions RENAME COLUMN university_id TO org_id; END IF; END $$""",
            # Pass 1 — rename short_name → org_code on organizations table (idempotent)
            """DO $$ BEGIN IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='organizations' AND column_name='short_name') THEN ALTER TABLE organizations RENAME COLUMN short_name TO org_code; END IF; END $$""",
            # Pass 1 — remove character limit on org_code (idempotent via ALTER TYPE)
            """DO $$ BEGIN IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='organizations' AND column_name='org_code') THEN ALTER TABLE organizations ALTER COLUMN org_code TYPE VARCHAR(200); END IF; END $$""",
            # Session 16 — org_id FK columns (all nullable; backfilled in _seed)
            "ALTER TABLE users ADD COLUMN IF NOT EXISTS org_id INTEGER REFERENCES organizations(id) ON DELETE SET NULL",
            "ALTER TABLE events ADD COLUMN IF NOT EXISTS org_id INTEGER REFERENCES organizations(id) ON DELETE SET NULL",
            "ALTER TABLE contracts ADD COLUMN IF NOT EXISTS org_id INTEGER REFERENCES organizations(id) ON DELETE SET NULL",
            "ALTER TABLE teams ADD COLUMN IF NOT EXISTS org_id INTEGER REFERENCES organizations(id) ON DELETE SET NULL",
            "ALTER TABLE operator_requests ADD COLUMN IF NOT EXISTS org_id INTEGER REFERENCES organizations(id) ON DELETE SET NULL",
            "ALTER TABLE registration_requests ADD COLUMN IF NOT EXISTS org_id INTEGER REFERENCES organizations(id) ON DELETE SET NULL",
            "ALTER TABLE corrupted_contracts ADD COLUMN IF NOT EXISTS org_id INTEGER REFERENCES organizations(id) ON DELETE SET NULL",
            "ALTER TABLE bc_events ADD COLUMN IF NOT EXISTS org_id INTEGER REFERENCES organizations(id) ON DELETE SET NULL",
            "ALTER TABLE architect_log ADD COLUMN IF NOT EXISTS org_id INTEGER REFERENCES organizations(id) ON DELETE SET NULL",
            "ALTER TABLE transmissions ADD COLUMN IF NOT EXISTS org_id INTEGER REFERENCES organizations(id) ON DELETE SET NULL",
            "ALTER TABLE transmissions ADD COLUMN IF NOT EXISTS recipient_id UUID REFERENCES users(id) ON DELETE SET NULL",
            "ALTER TABLE transmissions ADD COLUMN IF NOT EXISTS target_roles JSONB",
            "ALTER TABLE notifications ADD COLUMN IF NOT EXISTS kind VARCHAR(20)",
            # Pass 2 — per-event decay override columns
            "ALTER TABLE events ADD COLUMN IF NOT EXISTS decay_mode_override VARCHAR(20)",
            "ALTER TABLE events ADD COLUMN IF NOT EXISTS decay_tier_1_hours_override NUMERIC(5,2)",
            "ALTER TABLE events ADD COLUMN IF NOT EXISTS decay_tier_1_percent_override INTEGER",
            "ALTER TABLE events ADD COLUMN IF NOT EXISTS decay_tier_2_hours_override NUMERIC(5,2)",
            "ALTER TABLE events ADD COLUMN IF NOT EXISTS decay_tier_2_percent_override INTEGER",
            "ALTER TABLE events ADD COLUMN IF NOT EXISTS decay_tier_3_hours_override NUMERIC(5,2)",
            "ALTER TABLE events ADD COLUMN IF NOT EXISTS decay_tier_3_percent_override INTEGER",
            "ALTER TABLE events ADD COLUMN IF NOT EXISTS decay_floor_percent_override INTEGER",
            # Pass 2 — migrate platform_settings: remove old solve-count decay keys,
            # insert new time-based keys (INSERT ... ON CONFLICT DO NOTHING = idempotent)
            "DELETE FROM platform_settings WHERE key IN ('decay_1hr_pct','decay_3hr_pct','decay_after_pct','decay_floor_pct')",
            "INSERT INTO platform_settings (key, value) VALUES ('decay_mode','TIME_BASED') ON CONFLICT (key) DO NOTHING",
            "INSERT INTO platform_settings (key, value) VALUES ('decay_tier_1_hours','1.0') ON CONFLICT (key) DO NOTHING",
            "INSERT INTO platform_settings (key, value) VALUES ('decay_tier_1_percent','90') ON CONFLICT (key) DO NOTHING",
            "INSERT INTO platform_settings (key, value) VALUES ('decay_tier_2_hours','2.0') ON CONFLICT (key) DO NOTHING",
            "INSERT INTO platform_settings (key, value) VALUES ('decay_tier_2_percent','75') ON CONFLICT (key) DO NOTHING",
            "INSERT INTO platform_settings (key, value) VALUES ('decay_tier_3_hours','3.0') ON CONFLICT (key) DO NOTHING",
            "INSERT INTO platform_settings (key, value) VALUES ('decay_tier_3_percent','60') ON CONFLICT (key) DO NOTHING",
            "INSERT INTO platform_settings (key, value) VALUES ('decay_floor_percent','50') ON CONFLICT (key) DO NOTHING",
            # Architect-exclusive settings (idempotent inserts for existing deployments)
            "INSERT INTO platform_settings (key, value) VALUES ('void_mode_enabled','true') ON CONFLICT (key) DO NOTHING",
            "INSERT INTO platform_settings (key, value) VALUES ('bounty_board_public','false') ON CONFLICT (key) DO NOTHING",
            "INSERT INTO platform_settings (key, value) VALUES ('maintenance_mode','false') ON CONFLICT (key) DO NOTHING",
            "INSERT INTO platform_settings (key, value) VALUES ('term_operator','Operative') ON CONFLICT (key) DO NOTHING",
            "INSERT INTO platform_settings (key, value) VALUES ('term_team','Team') ON CONFLICT (key) DO NOTHING",
            "INSERT INTO platform_settings (key, value) VALUES ('term_handler','Handler') ON CONFLICT (key) DO NOTHING",
            "INSERT INTO platform_settings (key, value) VALUES ('term_contractor','Contractor') ON CONFLICT (key) DO NOTHING",
            "INSERT INTO platform_settings (key, value) VALUES ('max_organizations','0') ON CONFLICT (key) DO NOTHING",
            "INSERT INTO platform_settings (key, value) VALUES ('max_events_per_org','0') ON CONFLICT (key) DO NOTHING",
            "INSERT INTO platform_settings (key, value) VALUES ('max_operators_per_org','0') ON CONFLICT (key) DO NOTHING",
            "INSERT INTO platform_settings (key, value) VALUES ('platform_registration_locked','false') ON CONFLICT (key) DO NOTHING",
            "INSERT INTO platform_settings (key, value) VALUES ('max_upload_mb','50') ON CONFLICT (key) DO NOTHING",
            "INSERT INTO platform_settings (key, value) VALUES ('allowed_file_types','zip,pdf,txt,png,jpg,bin') ON CONFLICT (key) DO NOTHING",
            # Pass 1 — reroute season FK constraints to point at events table (idempotent)
            "ALTER TABLE bc_events           DROP CONSTRAINT IF EXISTS bc_events_season_id_fkey",
            "ALTER TABLE bc_events           DROP CONSTRAINT IF EXISTS bc_events_event_id_fkey",
            "ALTER TABLE bc_events           ADD CONSTRAINT bc_events_event_id_fkey           FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE SET NULL",
            "ALTER TABLE claims              DROP CONSTRAINT IF EXISTS claims_season_id_fkey",
            "ALTER TABLE claims              DROP CONSTRAINT IF EXISTS claims_event_id_fkey",
            "ALTER TABLE claims              ADD CONSTRAINT claims_event_id_fkey              FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE SET NULL",
            "ALTER TABLE contracts           DROP CONSTRAINT IF EXISTS contracts_season_id_fkey",
            "ALTER TABLE contracts           DROP CONSTRAINT IF EXISTS contracts_event_id_fkey",
            "ALTER TABLE contracts           ADD CONSTRAINT contracts_event_id_fkey           FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE SET NULL",
            "ALTER TABLE corrupted_claims    DROP CONSTRAINT IF EXISTS corrupted_claims_season_id_fkey",
            "ALTER TABLE corrupted_claims    DROP CONSTRAINT IF EXISTS corrupted_claims_event_id_fkey",
            "ALTER TABLE corrupted_claims    ADD CONSTRAINT corrupted_claims_event_id_fkey    FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE SET NULL",
            "ALTER TABLE corrupted_contracts DROP CONSTRAINT IF EXISTS corrupted_contracts_season_id_fkey",
            "ALTER TABLE corrupted_contracts DROP CONSTRAINT IF EXISTS corrupted_contracts_event_id_fkey",
            "ALTER TABLE corrupted_contracts ADD CONSTRAINT corrupted_contracts_event_id_fkey FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE SET NULL",
            "ALTER TABLE intel_purchases     DROP CONSTRAINT IF EXISTS intel_purchases_season_id_fkey",
            "ALTER TABLE intel_purchases     DROP CONSTRAINT IF EXISTS intel_purchases_event_id_fkey",
            "ALTER TABLE intel_purchases     ADD CONSTRAINT intel_purchases_event_id_fkey     FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE SET NULL",
            "ALTER TABLE operator_requests   DROP CONSTRAINT IF EXISTS operator_requests_season_id_fkey",
            "ALTER TABLE operator_requests   DROP CONSTRAINT IF EXISTS operator_requests_event_id_fkey",
            "ALTER TABLE operator_requests   ADD CONSTRAINT operator_requests_event_id_fkey   FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE SET NULL",
            "ALTER TABLE team_memberships    DROP CONSTRAINT IF EXISTS syndicate_memberships_season_id_fkey",
            "ALTER TABLE team_memberships    DROP CONSTRAINT IF EXISTS team_memberships_event_id_fkey",
            "ALTER TABLE team_memberships    ADD CONSTRAINT team_memberships_event_id_fkey    FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE SET NULL",
            "ALTER TABLE teams               DROP CONSTRAINT IF EXISTS syndicates_season_id_fkey",
            "ALTER TABLE teams               DROP CONSTRAINT IF EXISTS teams_event_id_fkey",
            "ALTER TABLE teams               ADD CONSTRAINT teams_event_id_fkey               FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE SET NULL",
            # Session 18 — Major Event schema
            "ALTER TABLE events ADD COLUMN IF NOT EXISTS event_type VARCHAR(10) NOT NULL DEFAULT 'LOCAL'",
            "ALTER TABLE events ADD COLUMN IF NOT EXISTS is_host BOOLEAN NOT NULL DEFAULT false",
            "ALTER TABLE events ADD COLUMN IF NOT EXISTS host_org_id INTEGER REFERENCES organizations(id) ON DELETE SET NULL",
            "ALTER TABLE events ADD COLUMN IF NOT EXISTS major_event_invite_code VARCHAR(20)",
            "ALTER TABLE events ADD COLUMN IF NOT EXISTS invite_code_regenerated_at TIMESTAMP",
            "CREATE UNIQUE INDEX IF NOT EXISTS uq_events_major_invite ON events(major_event_invite_code) WHERE major_event_invite_code IS NOT NULL",
            "ALTER TABLE contracts ADD COLUMN IF NOT EXISTS contributing_org_id INTEGER REFERENCES organizations(id) ON DELETE SET NULL",
            "ALTER TABLE contracts ADD COLUMN IF NOT EXISTS is_blocked_for_own_org BOOLEAN NOT NULL DEFAULT false",
            """CREATE TABLE IF NOT EXISTS major_event_partners (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  org_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  joined_at TIMESTAMP NOT NULL DEFAULT NOW(),
  joined_by VARCHAR(100),
  status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
  registration_key VARCHAR(20),
  CONSTRAINT uq_major_partner_event_org UNIQUE (event_id, org_id)
)""",
            """CREATE TABLE IF NOT EXISTS major_event_contractors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  contractor_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  org_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  added_at TIMESTAMP NOT NULL DEFAULT NOW(),
  added_by VARCHAR(100),
  status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
  CONSTRAINT uq_major_contractor_event_user UNIQUE (event_id, contractor_id)
)""",
            """CREATE TABLE IF NOT EXISTS contract_org_flags (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_id UUID NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
  org_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  flag_hash VARCHAR(500) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_contract_org_flag UNIQUE (contract_id, org_id)
)""",
            # Organization logo
            "ALTER TABLE organizations ADD COLUMN IF NOT EXISTS logo_url VARCHAR(500)",
            # allowed_categories for events
            "ALTER TABLE events ADD COLUMN IF NOT EXISTS allowed_categories JSONB",
            # Expand ContractCategory enum with new CTF categories (use Python enum names)
            "ALTER TYPE contractcategory ADD VALUE IF NOT EXISTS 'REVERSE_ENGINEERING'",
            "ALTER TYPE contractcategory ADD VALUE IF NOT EXISTS 'SQL_INJECTION'",
            "ALTER TYPE contractcategory ADD VALUE IF NOT EXISTS 'STEGANOGRAPHY'",
            "ALTER TYPE contractcategory ADD VALUE IF NOT EXISTS 'NETWORK'",
            "ALTER TYPE contractcategory ADD VALUE IF NOT EXISTS 'MOBILE'",
            "ALTER TYPE contractcategory ADD VALUE IF NOT EXISTS 'CLOUD'",
            "ALTER TYPE contractcategory ADD VALUE IF NOT EXISTS 'BLOCKCHAIN'",
            "ALTER TYPE contractcategory ADD VALUE IF NOT EXISTS 'HARDWARE'",
            "ALTER TYPE contractcategory ADD VALUE IF NOT EXISTS 'BINARY_EXPLOITATION'",
            "ALTER TYPE contractcategory ADD VALUE IF NOT EXISTS 'SOCIAL_ENGINEERING'",
            # Rename old display-name labels to Python names (skipped if target already exists)
            """DO $$ BEGIN IF EXISTS (SELECT 1 FROM pg_enum JOIN pg_type ON pg_enum.enumtypid=pg_type.oid WHERE pg_type.typname='contractcategory' AND enumlabel='Reverse Engineering') AND NOT EXISTS (SELECT 1 FROM pg_enum JOIN pg_type ON pg_enum.enumtypid=pg_type.oid WHERE pg_type.typname='contractcategory' AND enumlabel='REVERSE_ENGINEERING') THEN ALTER TYPE contractcategory RENAME VALUE 'Reverse Engineering' TO 'REVERSE_ENGINEERING'; END IF; END $$""",
            """DO $$ BEGIN IF EXISTS (SELECT 1 FROM pg_enum JOIN pg_type ON pg_enum.enumtypid=pg_type.oid WHERE pg_type.typname='contractcategory' AND enumlabel='SQL Injection') AND NOT EXISTS (SELECT 1 FROM pg_enum JOIN pg_type ON pg_enum.enumtypid=pg_type.oid WHERE pg_type.typname='contractcategory' AND enumlabel='SQL_INJECTION') THEN ALTER TYPE contractcategory RENAME VALUE 'SQL Injection' TO 'SQL_INJECTION'; END IF; END $$""",
            """DO $$ BEGIN IF EXISTS (SELECT 1 FROM pg_enum JOIN pg_type ON pg_enum.enumtypid=pg_type.oid WHERE pg_type.typname='contractcategory' AND enumlabel='Steganography') AND NOT EXISTS (SELECT 1 FROM pg_enum JOIN pg_type ON pg_enum.enumtypid=pg_type.oid WHERE pg_type.typname='contractcategory' AND enumlabel='STEGANOGRAPHY') THEN ALTER TYPE contractcategory RENAME VALUE 'Steganography' TO 'STEGANOGRAPHY'; END IF; END $$""",
            """DO $$ BEGIN IF EXISTS (SELECT 1 FROM pg_enum JOIN pg_type ON pg_enum.enumtypid=pg_type.oid WHERE pg_type.typname='contractcategory' AND enumlabel='Network') AND NOT EXISTS (SELECT 1 FROM pg_enum JOIN pg_type ON pg_enum.enumtypid=pg_type.oid WHERE pg_type.typname='contractcategory' AND enumlabel='NETWORK') THEN ALTER TYPE contractcategory RENAME VALUE 'Network' TO 'NETWORK'; END IF; END $$""",
            """DO $$ BEGIN IF EXISTS (SELECT 1 FROM pg_enum JOIN pg_type ON pg_enum.enumtypid=pg_type.oid WHERE pg_type.typname='contractcategory' AND enumlabel='Mobile') AND NOT EXISTS (SELECT 1 FROM pg_enum JOIN pg_type ON pg_enum.enumtypid=pg_type.oid WHERE pg_type.typname='contractcategory' AND enumlabel='MOBILE') THEN ALTER TYPE contractcategory RENAME VALUE 'Mobile' TO 'MOBILE'; END IF; END $$""",
            """DO $$ BEGIN IF EXISTS (SELECT 1 FROM pg_enum JOIN pg_type ON pg_enum.enumtypid=pg_type.oid WHERE pg_type.typname='contractcategory' AND enumlabel='Cloud') AND NOT EXISTS (SELECT 1 FROM pg_enum JOIN pg_type ON pg_enum.enumtypid=pg_type.oid WHERE pg_type.typname='contractcategory' AND enumlabel='CLOUD') THEN ALTER TYPE contractcategory RENAME VALUE 'Cloud' TO 'CLOUD'; END IF; END $$""",
            """DO $$ BEGIN IF EXISTS (SELECT 1 FROM pg_enum JOIN pg_type ON pg_enum.enumtypid=pg_type.oid WHERE pg_type.typname='contractcategory' AND enumlabel='Blockchain') AND NOT EXISTS (SELECT 1 FROM pg_enum JOIN pg_type ON pg_enum.enumtypid=pg_type.oid WHERE pg_type.typname='contractcategory' AND enumlabel='BLOCKCHAIN') THEN ALTER TYPE contractcategory RENAME VALUE 'Blockchain' TO 'BLOCKCHAIN'; END IF; END $$""",
            """DO $$ BEGIN IF EXISTS (SELECT 1 FROM pg_enum JOIN pg_type ON pg_enum.enumtypid=pg_type.oid WHERE pg_type.typname='contractcategory' AND enumlabel='Hardware') AND NOT EXISTS (SELECT 1 FROM pg_enum JOIN pg_type ON pg_enum.enumtypid=pg_type.oid WHERE pg_type.typname='contractcategory' AND enumlabel='HARDWARE') THEN ALTER TYPE contractcategory RENAME VALUE 'Hardware' TO 'HARDWARE'; END IF; END $$""",
            """DO $$ BEGIN IF EXISTS (SELECT 1 FROM pg_enum JOIN pg_type ON pg_enum.enumtypid=pg_type.oid WHERE pg_type.typname='contractcategory' AND enumlabel='Binary Exploitation') AND NOT EXISTS (SELECT 1 FROM pg_enum JOIN pg_type ON pg_enum.enumtypid=pg_type.oid WHERE pg_type.typname='contractcategory' AND enumlabel='BINARY_EXPLOITATION') THEN ALTER TYPE contractcategory RENAME VALUE 'Binary Exploitation' TO 'BINARY_EXPLOITATION'; END IF; END $$""",
            """DO $$ BEGIN IF EXISTS (SELECT 1 FROM pg_enum JOIN pg_type ON pg_enum.enumtypid=pg_type.oid WHERE pg_type.typname='contractcategory' AND enumlabel='Social Engineering') AND NOT EXISTS (SELECT 1 FROM pg_enum JOIN pg_type ON pg_enum.enumtypid=pg_type.oid WHERE pg_type.typname='contractcategory' AND enumlabel='SOCIAL_ENGINEERING') THEN ALTER TYPE contractcategory RENAME VALUE 'Social Engineering' TO 'SOCIAL_ENGINEERING'; END IF; END $$""",
            # Partner role distinction: PARTNER (selected at creation) vs PARTICIPANT (joined via key)
            "ALTER TABLE major_event_partners ADD COLUMN IF NOT EXISTS role VARCHAR(20) NOT NULL DEFAULT 'PARTNER'",
            # Pass 1 — add new role enum values then migrate rows (idempotent)
            "ALTER TYPE userrole ADD VALUE IF NOT EXISTS 'OPERATIVE'",
            "ALTER TYPE userrole ADD VALUE IF NOT EXISTS 'CONTRACTOR'",
            "ALTER TYPE userrole ADD VALUE IF NOT EXISTS 'HANDLER'",
            """DO $$ BEGIN UPDATE users SET role = 'OPERATIVE' WHERE role = 'NETRUNNER'; EXCEPTION WHEN invalid_text_representation THEN NULL; END $$""",
            """DO $$ BEGIN UPDATE users SET role = 'CONTRACTOR' WHERE role = 'SUPERVISOR'; EXCEPTION WHEN invalid_text_representation THEN NULL; END $$""",
            """DO $$ BEGIN UPDATE users SET role = 'HANDLER' WHERE role = 'INSTRUCTOR'; EXCEPTION WHEN invalid_text_representation THEN NULL; END $$""",
            """CREATE TABLE IF NOT EXISTS contract_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  contract_id UUID NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
  assigned_by_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  assigned_to_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  event_id INTEGER REFERENCES events(id) ON DELETE SET NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
)""",
        ]:
            await conn.execute(text(stmt))
    from app.utils.architect import validate_architect_passwords
    validate_architect_passwords()
    await _seed()
    task = asyncio.create_task(_cc_expiry_loop())
    cleanup_task = asyncio.create_task(_denied_cleanup_loop())
    event_task = asyncio.create_task(_event_lifecycle_loop())
    yield
    task.cancel()
    cleanup_task.cancel()
    event_task.cancel()
    for t in (task, cleanup_task, event_task):
        try:
            await t
        except asyncio.CancelledError:
            pass


async def _cc_expiry_loop() -> None:
    """Background task: expire active Corrupted Contracts every 60 seconds."""
    while True:
        await asyncio.sleep(60)
        try:
            async with AsyncSessionLocal() as db:
                now = datetime.utcnow()
                res = await db.execute(
                    select(CorruptedContract).where(
                        CorruptedContract.status == CCStatus.ACTIVE,
                        CorruptedContract.expires_at <= now,
                    )
                )
                expired = res.scalars().all()
                for cc in expired:
                    cc.status = CCStatus.EXPIRED
                    claim_count_res = await db.execute(
                        select(func.count(CorruptedClaim.id)).where(
                            CorruptedClaim.contract_id == cc.id
                        )
                    )
                    n = claim_count_res.scalar() or 0
                    label = "OPERATIVE" if n == 1 else "OPERATIVES"
                    db.add(NetworkTransmission(
                        content=(
                            f"CORRUPTED CONTRACT {cc.title} — "
                            f"SIGNAL LOST. {n} {label} CLAIMED IT."
                        ),
                        author_id=None,
                    ))
                if expired:
                    await db.commit()
        except Exception:
            pass  # never crash the server loop


async def _event_lifecycle_loop() -> None:
    """Background task: auto-start UPCOMING events and auto-close ACTIVE events every 60s."""
    while True:
        await asyncio.sleep(60)
        try:
            from app.models.event import Event, EventStatus
            from app.models.settings import PlatformSettings
            async with AsyncSessionLocal() as db:
                now = datetime.utcnow()

                # Auto-start: UPCOMING events whose start_time has passed
                upcoming_res = await db.execute(
                    select(Event).where(
                        Event.status == EventStatus.UPCOMING.value,
                        Event.start_time.isnot(None),
                        Event.start_time <= now,
                    )
                )
                for e in upcoming_res.scalars().all():
                    # Only start if no other event is ACTIVE
                    active_check = await db.execute(
                        select(Event).where(
                            Event.status == EventStatus.ACTIVE.value,
                            Event.id != e.id,
                        ).limit(1)
                    )
                    if active_check.scalar_one_or_none():
                        continue
                    e.status = EventStatus.ACTIVE.value
                    # Unfreeze board
                    r = await db.execute(
                        select(PlatformSettings).where(PlatformSettings.key == "board_frozen")
                    )
                    row = r.scalar_one_or_none()
                    if row:
                        row.value = "false"
                    db.add(NetworkTransmission(
                        content=f"> {e.name.upper()} — COMPETITION ACTIVE\n> DEADNET IS NOW LIVE\n> GOOD LUCK, OPERATIVES",
                        author_id=None,
                    ))

                # Auto-close: ACTIVE events whose end_time has passed
                active_res = await db.execute(
                    select(Event).where(
                        Event.status == EventStatus.ACTIVE.value,
                        Event.end_time.isnot(None),
                        Event.end_time <= now,
                    )
                )
                for e in active_res.scalars().all():
                    e.status = EventStatus.CLOSED.value
                    e.closed_at = now
                    # Freeze board
                    r = await db.execute(
                        select(PlatformSettings).where(PlatformSettings.key == "board_frozen")
                    )
                    row = r.scalar_one_or_none()
                    if row:
                        row.value = "true"
                    db.add(NetworkTransmission(
                        content=f"> {e.name.upper()} — COMPETITION CLOSED\n> FINAL STANDINGS NOW LOCKED",
                        author_id=None,
                    ))

                await db.commit()
        except Exception:
            pass  # never crash the server loop


async def _denied_cleanup_loop() -> None:
    """Background task: delete denied accounts 24h after denial (Redis TTL gate)."""
    while True:
        await asyncio.sleep(3600)  # check every hour
        try:
            from app.redis_client import check_deny_delete
            async with AsyncSessionLocal() as db:
                res = await db.execute(
                    select(User).where(User.account_status == "DENIED")
                )
                denied_users = res.scalars().all()
                for u in denied_users:
                    if not await check_deny_delete(str(u.id)):
                        await db.delete(u)
                if denied_users:
                    await db.commit()
        except Exception:
            pass  # never crash the server loop


app = FastAPI(title="DEADNET API", version="2.0.0", lifespan=lifespan)

_allowed_origins = list({
    "http://localhost:5173",
    "http://localhost:8000",
    app_settings.FRONTEND_URL.rstrip("/"),
})

app.add_middleware(
    CORSMiddleware,
    allow_origins=_allowed_origins,
    # Also accept any localhost or LAN IP (192.168.x.x / 10.x.x.x) on any port
    allow_origin_regex=r"http://(localhost|127\.0\.0\.1|192\.168\.\d+\.\d+|10\.\d+\.\d+\.\d+)(:\d+)?",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def security_headers(request: Request, call_next) -> Response:
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["X-XSS-Protection"] = "1; mode=block"
    response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    response.headers["Permissions-Policy"] = "geolocation=(), camera=(), microphone=()"
    response.headers["Content-Security-Policy"] = (
        "default-src 'self'; "
        "script-src 'self' 'unsafe-inline' 'unsafe-eval'; "
        "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; "
        "font-src 'self' https://fonts.gstatic.com; "
        "img-src 'self' data: blob:; "
        "connect-src 'self'; "
        "frame-ancestors 'none';"
    )
    # VO1D discovery headers — appear in network traffic / DevTools only
    response.headers["X-DEADNET"] = "are you in the right place?"
    response.headers["X-ARCHITECT"] = "s0L"
    response.headers["X-SIGNAL"] = "the void speaks in fragments - check the source"
    return response

from app.routers import auth, public, shared, admin, contractor, handler, operative  # noqa: E402
from app.routers import contracts, files, bounty_board, teams, operatives  # noqa: E402
from app.routers import transmissions, stats, void, requests as req_router, notifications as notif_router  # noqa: E402
from app.routers import corrupted_contracts as cc_router  # noqa: E402
from app.routers import events as events_router  # noqa: E402
from app.routers import organizations as org_router  # noqa: E402
from app.routers import architect as arch_router  # noqa: E402

app.include_router(auth.router,            prefix="/auth",           tags=["auth"])
app.include_router(public.router,          prefix="/public",         tags=["public"])
app.include_router(shared.router,          prefix="/shared",         tags=["shared"])
app.include_router(contracts.router,       prefix="/contracts",      tags=["contracts"])
app.include_router(files.router,           prefix="/files",          tags=["files"])
app.include_router(bounty_board.router,    prefix="/bounty-board",   tags=["bounty-board"])
app.include_router(teams.router,      prefix="/teams",     tags=["teams"])
app.include_router(operatives.router,      prefix="/operatives",     tags=["operatives"])
app.include_router(transmissions.router,   prefix="/transmissions",  tags=["transmissions"])
app.include_router(admin.router,           prefix="/admin",          tags=["admin"])
app.include_router(contractor.router,      prefix="/contractor",     tags=["contractor"])
app.include_router(handler.router,      prefix="/handler",     tags=["handler"])
app.include_router(operative.router,       prefix="/operative",      tags=["operative"])
app.include_router(req_router.router,     prefix="/requests",       tags=["requests"])
app.include_router(notif_router.router,   prefix="/notifications",  tags=["notifications"])
app.include_router(stats.router,           prefix="/stats",           tags=["stats"])
app.include_router(void.router,            prefix="/v01d",            tags=["v01d"])
app.include_router(cc_router.router,       prefix="/corrupted-contracts", tags=["corrupted-contracts"])
app.include_router(events_router.router,   prefix="/events",              tags=["events"])
app.include_router(org_router.router,     prefix="/organizations",        tags=["organizations"])
app.include_router(arch_router.router,     prefix="/architect",           tags=["architect"])


@app.get("/health")
async def health():
    return {"status": "online", "platform": "DEADNET"}


# ---------------------------------------------------------------------------
# Static frontend serving — production only (SERVE_STATIC=true)
# Dev: Vite runs on :5173 and this block is never active.
# Prod: backend serves the built React app from /app/frontend_dist.
# ---------------------------------------------------------------------------

if os.getenv("SERVE_STATIC") == "true":
    _FRONTEND_DIST = "/app/frontend_dist"

    if os.path.isdir(f"{_FRONTEND_DIST}/assets"):
        app.mount(
            "/assets",
            StaticFiles(directory=f"{_FRONTEND_DIST}/assets"),
            name="assets",
        )

    @app.get("/{full_path:path}", include_in_schema=False)
    async def serve_react(full_path: str):
        # Serve known static files (favicon, robots.txt, images, etc.) directly
        if full_path:
            candidate = os.path.join(_FRONTEND_DIST, full_path)
            if os.path.isfile(candidate):
                return FileResponse(candidate)
        # Everything else → React index.html (client-side routing handles it)
        return FileResponse(f"{_FRONTEND_DIST}/index.html")
