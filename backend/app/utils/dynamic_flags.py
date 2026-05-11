"""
Dynamic flag generation for Major Events.
Each participating org receives a unique flag variant per contract.
Variants are hashed (bcrypt) and stored in contract_org_flags.
Plain-text variants are returned ONCE at creation time.
"""
import secrets
from uuid import UUID

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.contract_org_flag import ContractOrgFlag
from app.models.major_event import MajorEventPartner
from app.models.organization import Organization
from app.utils.security import hash_password, verify_password


def _make_org_flag(base_flag: str) -> str:
    """Append a 6-char random hex suffix to the base flag."""
    return f"{base_flag}_{secrets.token_hex(3)}"


async def generate_org_variants(
    db: AsyncSession,
    contract_id: UUID,
    event_id: int,
    base_flag: str,
) -> list[dict]:
    """
    Generate a unique hashed flag variant for every ACTIVE partner org.
    Existing variants for this contract are deleted first (supports flag updates).

    Returns a list of dicts:
        [{"org_id": int, "org_code": str, "org_name": str, "flag": str (plain)}, ...]
    Plain flags are returned ONLY here — never stored unmasked.
    """
    # Wipe existing variants so flag updates produce a clean set
    await db.execute(
        delete(ContractOrgFlag).where(ContractOrgFlag.contract_id == contract_id)
    )

    # Fetch all ACTIVE partner orgs for this event
    rows = (await db.execute(
        select(MajorEventPartner, Organization)
        .join(Organization, Organization.id == MajorEventPartner.org_id)
        .where(
            MajorEventPartner.event_id == event_id,
            MajorEventPartner.status == "ACTIVE",
        )
    )).all()

    results = []
    for partner, org in rows:
        plain = _make_org_flag(base_flag)
        db.add(ContractOrgFlag(
            contract_id=contract_id,
            org_id=org.id,
            flag_hash=hash_password(plain),
        ))
        results.append({
            "org_id": org.id,
            "org_code": org.org_code or org.name,
            "org_name": org.name,
            "flag": plain,
        })

    return results


async def generate_variants_for_new_partner(
    db: AsyncSession,
    event_id: int,
    new_org_id: int,
    contracts: list,
) -> None:
    """
    Called when a new partner org joins a MAJOR event.
    Generates flag variants for all existing contracts that don't yet have one
    for this org.  Variants are stored silently — not shown to anyone.
    """
    # Check which contracts already have a variant for this org
    existing_ids = set(
        r[0] for r in (await db.execute(
            select(ContractOrgFlag.contract_id).where(
                ContractOrgFlag.org_id == new_org_id,
                ContractOrgFlag.contract_id.in_([c.id for c in contracts]),
            )
        )).all()
    )

    for contract in contracts:
        if contract.id in existing_ids:
            continue
        plain = _make_org_flag(contract.flag)
        db.add(ContractOrgFlag(
            contract_id=contract.id,
            org_id=new_org_id,
            flag_hash=hash_password(plain),
        ))


async def get_org_flag_hash(
    db: AsyncSession,
    contract_id: UUID,
    org_id: int,
) -> str | None:
    """Return the hashed flag variant for (contract, org), or None if not found."""
    row = (await db.execute(
        select(ContractOrgFlag.flag_hash).where(
            ContractOrgFlag.contract_id == contract_id,
            ContractOrgFlag.org_id == org_id,
        )
    )).scalar_one_or_none()
    return row


def verify_org_flag(submitted: str, flag_hash: str) -> bool:
    """Verify a submitted flag against a stored bcrypt hash."""
    return verify_password(submitted.strip(), flag_hash)
