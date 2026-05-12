from datetime import datetime, timedelta
from typing import Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.deps import require_authenticated, require_bounty_board_access
from app.models.contract import BcEvent, BcEventType, Claim, Contract
from app.models.corrupted_contract import CorruptedClaim, CorruptedContract
from app.models.event import Event, EventStatus
from app.models.event_registration import EventRegistration
from app.models.major_event import MajorEventPartner
from app.models.organization import Organization
from app.models.settings import PlatformSettings
from app.models.team import Team, TeamMembership
from app.models.user import User, UserRole
from app.redis_client import get_online_count
from app.utils.clearance import get_clearance_level
from app.utils.event import get_active_event, get_current_event_id
from app.utils.roles import get_organization_scope

# Org color palette (assigned in join order: host first, then partners by joined_at)
_ORG_COLORS = ['#FF4500', '#4A9EFF', '#FFD700', '#00FF88', '#FF6B00', '#9B59B6']


async def _get_major_event_org_map(
    db: AsyncSession,
    event: Event,
) -> dict[int, dict]:
    """
    Returns {org_id: {code, name, color}} for all orgs participating in a MAJOR event.
    Host org gets color index 0; partners are ordered by joined_at.
    """
    org_map: dict[int, dict] = {}

    # Host org
    host_org_id = event.host_org_id or event.org_id
    if host_org_id:
        host_org = (await db.execute(
            select(Organization).where(Organization.id == host_org_id)
        )).scalar_one_or_none()
        if host_org:
            org_map[host_org_id] = {
                "org_id": host_org_id,
                "code": host_org.org_code,
                "name": host_org.name,
                "color": _ORG_COLORS[0],
            }

    # Partner orgs sorted by joined_at
    partners = (await db.execute(
        select(MajorEventPartner, Organization)
        .join(Organization, Organization.id == MajorEventPartner.org_id)
        .where(
            MajorEventPartner.event_id == event.id,
            MajorEventPartner.status == "ACTIVE",
        )
        .order_by(MajorEventPartner.joined_at)
    )).all()

    color_idx = 1
    for p, org in partners:
        if org.id not in org_map:
            org_map[org.id] = {
                "org_id": org.id,
                "code": org.org_code,
                "name": org.name,
                "color": _ORG_COLORS[color_idx % len(_ORG_COLORS)],
            }
            color_idx += 1

    return org_map

router = APIRouter()


async def _get_cl_settings(db: AsyncSession) -> dict:
    result = await db.execute(
        select(PlatformSettings).where(PlatformSettings.key.like("cl_%"))
    )
    return {row.key: row.value for row in result.scalars().all()}


async def _is_frozen(db: AsyncSession) -> bool:
    result = await db.execute(
        select(PlatformSettings).where(PlatformSettings.key == "board_frozen")
    )
    row = result.scalar_one_or_none()
    return row is not None and row.value.lower() == "true"


async def _resolve_event(
    event_id: Optional[int],
    current_user: User,
    db: AsyncSession,
) -> int:
    """Return the target event ID. Non-active events restricted to admin/contractor/handler."""
    current_sid = await get_current_event_id(db)
    target = event_id if event_id is not None else current_sid
    user_role = getattr(current_user, 'role', None)
    if target != current_sid and (current_user is None or user_role == UserRole.OPERATIVE):
        raise HTTPException(status_code=403, detail="ARCHIVE_RESTRICTED")
    return target


# ---------------------------------------------------------------------------
# GET /bounty-board/operatives
# ---------------------------------------------------------------------------

@router.get("/operatives")
async def operative_board(
    event_id: Optional[int] = None,
    org_id: Optional[int] = None,
    current_user=Depends(require_bounty_board_access),
    db: AsyncSession = Depends(get_db),
):
    frozen = await _is_frozen(db)
    cl_settings = await _get_cl_settings(db)
    current_sid = await get_current_event_id(db)
    target_sid = await _resolve_event(event_id, current_user, db)
    is_archive = target_sid != current_sid

    # Determine event state for the response metadata
    active_event = await get_active_event(db)
    if is_archive:
        ev_state = "ARCHIVED"
        ev_name = None
        ev_ends_at = None
    elif active_event:
        ev_state = "ACTIVE"
        ev_name = active_event.name
        ev_ends_at = active_event.end_time.isoformat() if active_event.end_time else None
    else:
        ev_state = "NO_EVENT"
        ev_name = None
        ev_ends_at = None

    # OPERATIVE users: return empty board when no active event (not archive)
    _role = getattr(current_user, 'role', None)
    if ev_state == "NO_EVENT" and (current_user is None or _role == UserRole.OPERATIVE):
        return {
            "board": [], "is_frozen": frozen, "online_count": 0,
            "event_id": target_sid, "state": ev_state,
            "event_name": ev_name, "event_ends_at": ev_ends_at,
            "is_major": False, "orgs": [],
        }

    # Frozen board: strip data for operatives so they can't peek via network tab
    if frozen and not is_archive and _role == UserRole.OPERATIVE:
        return {
            "board": [], "is_frozen": True, "online_count": 0,
            "event_id": target_sid, "state": ev_state,
            "event_name": ev_name, "event_ends_at": ev_ends_at,
            "is_major": False, "orgs": [],
        }

    # Detect MAJOR event and build org map
    target_event = (await db.execute(
        select(Event).where(Event.id == target_sid)
    )).scalar_one_or_none() if target_sid else None
    is_major = target_event is not None and (target_event.event_type or "LOCAL") == "MAJOR"
    org_map: dict = {}
    if is_major:
        org_map = await _get_major_event_org_map(db, target_event)
        if current_user is None or _role == UserRole.OPERATIVE:
            op_org_id = getattr(current_user, "org_id", None)
            if op_org_id not in org_map:
                raise HTTPException(status_code=403, detail="ORG_NOT_PARTICIPATING")

    # First claim time per operative (event-filtered) — used as tiebreaker
    first_claim_result = await db.execute(
        select(Claim.operative_id, func.min(Claim.claimed_at).label("first_at"))
        .where(Claim.event_id == target_sid)
        .group_by(Claim.operative_id)
    )
    first_claim_map: dict[str, datetime] = {str(r[0]): r[1] for r in first_claim_result.all()}

    _FAR_FUTURE = datetime(9999, 12, 31)

    # For MAJOR events: show all participating orgs (no org scope restriction)
    scope = None if is_major else get_organization_scope(current_user, org_id)

    if is_archive:
        # Compute BC from BcEvent for the archived event
        bc_rows = await db.execute(
            select(BcEvent.operative_id, func.sum(BcEvent.bc_delta).label("bc"))
            .where(BcEvent.event_id == target_sid)
            .group_by(BcEvent.operative_id)
            .order_by(func.sum(BcEvent.bc_delta).desc())
        )
        bc_map = {str(r[0]): int(r[1]) for r in bc_rows.all()}
        runner_ids = list(bc_map.keys())
        if runner_ids:
            archive_q = select(User).where(User.id.in_(runner_ids))
            if scope is not None:
                archive_q = archive_q.where(User.org_id == scope)
            runners_result = await db.execute(archive_q)
            runners = {str(u.id): u for u in runners_result.scalars().all()}
        else:
            runners = {}
        # Re-filter runner_ids to only those in scope
        runner_ids = [uid for uid in runner_ids if uid in runners]
        sorted_ids = sorted(
            runner_ids,
            key=lambda uid: (-bc_map.get(uid, 0), first_claim_map.get(uid, _FAR_FUTURE)),
        )
    else:
        # Active event: filter by ACTIVE registrations for this event
        # Fall back to bc>0 filter if no registrations exist yet
        reg_result = await db.execute(
            select(EventRegistration.user_id)
            .where(
                EventRegistration.event_id == target_sid,
                EventRegistration.status == "ACTIVE",
            )
        )
        registered_ids = [r[0] for r in reg_result.all()]

        if registered_ids:
            active_q = select(User).where(
                User.id.in_(registered_ids),
                User.is_banned == False,
            )
            if scope is not None:
                active_q = active_q.where(User.org_id == scope)
            result = await db.execute(active_q)
        else:
            # Fallback: no registrations yet — show all with bc>0
            fallback_q = select(User).where(
                User.role == UserRole.OPERATIVE,
                User.is_banned == False,
                User.bc_total > 0,
            )
            if scope is not None:
                fallback_q = fallback_q.where(User.org_id == scope)
            result = await db.execute(fallback_q)
        runner_list = result.scalars().all()
        runners = {str(u.id): u for u in runner_list}
        bc_map = {str(u.id): (u.bc_total or 0) for u in runner_list}
        sorted_ids = sorted(
            [uid for uid in runners if bc_map.get(uid, 0) > 0],
            key=lambda uid: (-bc_map.get(uid, 0), first_claim_map.get(uid, _FAR_FUTURE)),
        )

    # Claim counts per operative (event-filtered)
    counts_result = await db.execute(
        select(Claim.operative_id, func.count(Claim.id))
        .where(Claim.event_id == target_sid)
        .group_by(Claim.operative_id)
    )
    claim_counts = {str(r[0]): r[1] for r in counts_result.all()}

    # Last claim time per operative (event-filtered)
    last_result = await db.execute(
        select(Claim.operative_id, func.max(Claim.claimed_at))
        .where(Claim.event_id == target_sid)
        .group_by(Claim.operative_id)
    )
    last_claims = {str(r[0]): r[1] for r in last_result.all()}

    board = []
    for rank, uid in enumerate(sorted_ids, start=1):
        runner = runners.get(uid)
        if not runner:
            continue
        runner_org = org_map.get(runner.org_id) if is_major and runner.org_id else None
        board.append({
            "rank": rank,
            "id": uid,
            "username": runner.username,
            "bc_total": bc_map.get(uid, 0),
            "clearance_level": get_clearance_level(bc_map.get(uid, 0), cl_settings),
            "claim_count": claim_counts.get(uid, 0),
            "last_claim_at": last_claims.get(uid),
            "is_me": current_user is not None and uid == str(current_user.id),
            "org_id": runner.org_id if is_major else None,
            "org_code": runner_org["code"] if runner_org else None,
            "org_color": runner_org["color"] if runner_org else None,
        })

    online = 0
    if not is_archive:
        try:
            online = await get_online_count()
        except Exception:
            pass

    # Removed participants — visible to admin only in active event
    removed_participants = []
    is_admin = current_user is not None and current_user.role in (UserRole.ADMIN, UserRole.CONTRACTOR, UserRole.HANDLER)
    if not is_archive and active_event and is_admin:
        from app.models.event_registration import EventRemoval
        rem_rows = await db.execute(
            select(EventRemoval)
            .where(EventRemoval.event_id == target_sid)
            .order_by(EventRemoval.removed_at.desc())
        )
        removed_participants = [
            {
                "callsign": r.callsign,
                "removed_by": r.removed_by,
                "bc_wiped": r.bc_wiped,
                "removed_at": r.removed_at.isoformat() if r.removed_at else None,
            }
            for r in rem_rows.scalars().all()
        ]

    return {
        "board": board,
        "is_frozen": frozen,
        "online_count": online,
        "event_id": target_sid,
        "state": ev_state,
        "event_name": ev_name,
        "event_ends_at": ev_ends_at,
        "removed_participants": removed_participants,
        "is_major": is_major,
        "orgs": list(org_map.values()) if is_major else [],
    }


# ---------------------------------------------------------------------------
# GET /bounty-board/teams
# ---------------------------------------------------------------------------

@router.get("/teams")
async def team_board(
    event_id: Optional[int] = None,
    org_id: Optional[int] = None,
    current_user=Depends(require_bounty_board_access),
    db: AsyncSession = Depends(get_db),
):
    frozen = await _is_frozen(db)
    target_sid = await _resolve_event(event_id, current_user, db)
    current_sid = await get_current_event_id(db)
    _role = getattr(current_user, 'role', None)
    if frozen and target_sid == current_sid and _role == UserRole.OPERATIVE:
        return {"board": [], "is_frozen": True, "event_id": target_sid}

    # All teams for this event
    scope = get_organization_scope(current_user, org_id)
    syn_board_q = select(Team).where(Team.event_id == target_sid).order_by(Team.created_at)
    if scope is not None:
        syn_board_q = syn_board_q.where(Team.org_id == scope)
    syn_result = await db.execute(syn_board_q)
    teams = syn_result.scalars().all()

    # Total main BC per team (event-filtered claims)
    bc_result = await db.execute(
        select(Claim.team_id, func.sum(Claim.bc_earned))
        .where(Claim.team_id.isnot(None), Claim.event_id == target_sid)
        .group_by(Claim.team_id)
    )
    team_main_bc = {str(r[0]): int(r[1]) for r in bc_result.all()}

    # CC BC per team — CorruptedClaim has no team_id so join through TeamMembership
    cc_bc_result = await db.execute(
        select(TeamMembership.team_id, func.sum(CorruptedClaim.bc_awarded))
        .join(CorruptedClaim, CorruptedClaim.operative_id == TeamMembership.operative_id)
        .where(CorruptedClaim.event_id == target_sid)
        .group_by(TeamMembership.team_id)
    )
    for team_id_str, cc_bc in ((str(r[0]), int(r[1])) for r in cc_bc_result.all()):
        team_main_bc[team_id_str] = team_main_bc.get(team_id_str, 0) + cc_bc

    team_bc = dict(team_main_bc)

    # Claim count per team (event-filtered, regular + CC)
    claim_cnt_result = await db.execute(
        select(Claim.team_id, func.count(Claim.id))
        .where(Claim.team_id.isnot(None), Claim.event_id == target_sid)
        .group_by(Claim.team_id)
    )
    team_claims = {str(r[0]): r[1] for r in claim_cnt_result.all()}

    cc_cnt_result = await db.execute(
        select(TeamMembership.team_id, func.count(CorruptedClaim.id))
        .join(CorruptedClaim, CorruptedClaim.operative_id == TeamMembership.operative_id)
        .where(CorruptedClaim.event_id == target_sid)
        .group_by(TeamMembership.team_id)
    )
    for team_id_str, cc_cnt in ((str(r[0]), int(r[1])) for r in cc_cnt_result.all()):
        team_claims[team_id_str] = team_claims.get(team_id_str, 0) + cc_cnt

    # Member counts per team
    mem_result = await db.execute(
        select(TeamMembership.team_id, func.count(TeamMembership.id))
        .group_by(TeamMembership.team_id)
    )
    member_counts = {str(r[0]): r[1] for r in mem_result.all()}

    # Current user's team
    my_syn_id = None
    if current_user is not None:
        mem_check = await db.execute(
            select(TeamMembership.team_id).where(
                TeamMembership.operative_id == current_user.id
            )
        )
        row = mem_check.scalar_one_or_none()
        if row:
            my_syn_id = str(row)

    # Batch-fetch captain info
    captain_ids = [s.captain_id for s in teams if s.captain_id]
    captain_map: dict[str, User] = {}
    if captain_ids:
        cap_result = await db.execute(select(User).where(User.id.in_(captain_ids)))
        captain_map = {str(u.id): u for u in cap_result.scalars().all()}

    # Sort by BC desc
    teams_sorted = sorted(
        teams,
        key=lambda s: team_bc.get(str(s.id), 0),
        reverse=True,
    )

    board = []
    for rank, syn in enumerate(teams_sorted, start=1):
        cap = captain_map.get(str(syn.captain_id)) if syn.captain_id else None
        board.append({
            "rank": rank,
            "id": str(syn.id),
            "name": syn.name,
            "captain_school": cap.school if cap else None,
            "captain_section": cap.section if cap else None,
            "total_bc": team_bc.get(str(syn.id), 0),
            "member_count": member_counts.get(str(syn.id), 0),
            "claim_count": team_claims.get(str(syn.id), 0),
            "is_mine": str(syn.id) == my_syn_id,
        })

    return {"board": board, "is_frozen": frozen, "event_id": target_sid}


# ---------------------------------------------------------------------------
# GET /bounty-board/orgs  — MAJOR event org-level rankings
# ---------------------------------------------------------------------------

@router.get("/orgs")
async def org_board(
    event_id: Optional[int] = None,
    current_user=Depends(require_bounty_board_access),
    db: AsyncSession = Depends(get_db),
):
    frozen = await _is_frozen(db)
    target_sid = await _resolve_event(event_id, current_user, db)
    current_sid = await get_current_event_id(db)
    _role = getattr(current_user, 'role', None)
    if frozen and target_sid == current_sid and _role == UserRole.OPERATIVE:
        return {"board": [], "is_frozen": True, "event_id": target_sid, "is_major": False}

    target_event = (await db.execute(
        select(Event).where(Event.id == target_sid)
    )).scalar_one_or_none() if target_sid else None

    if not target_event or (target_event.event_type or "LOCAL") != "MAJOR":
        return {"board": [], "is_frozen": frozen, "event_id": target_sid, "is_major": False}

    org_map = await _get_major_event_org_map(db, target_event)

    # Operative visibility check
    if current_user is None or current_user.role == UserRole.OPERATIVE:
        op_org_id = getattr(current_user, "org_id", None)
        if op_org_id not in org_map:
            raise HTTPException(status_code=403, detail="ORG_NOT_PARTICIPATING")

    # BC per operative for this event
    bc_rows = (await db.execute(
        select(BcEvent.operative_id, func.sum(BcEvent.bc_delta).label("bc"))
        .where(BcEvent.event_id == target_sid)
        .group_by(BcEvent.operative_id)
    )).all()
    user_bc: dict[str, int] = {str(r[0]): int(r[1]) for r in bc_rows}

    # Claim count per operative
    claim_rows = (await db.execute(
        select(Claim.operative_id, func.count(Claim.id))
        .where(Claim.event_id == target_sid)
        .group_by(Claim.operative_id)
    )).all()
    user_claims: dict[str, int] = {str(r[0]): int(r[1]) for r in claim_rows}

    # Last claim per operative
    last_rows = (await db.execute(
        select(Claim.operative_id, func.max(Claim.claimed_at))
        .where(Claim.event_id == target_sid)
        .group_by(Claim.operative_id)
    )).all()
    user_last_claim: dict[str, datetime] = {str(r[0]): r[1] for r in last_rows}

    # Registered participants per org
    reg_rows = (await db.execute(
        select(EventRegistration.user_id, User.org_id)
        .join(User, User.id == EventRegistration.user_id)
        .where(
            EventRegistration.event_id == target_sid,
            EventRegistration.status == "ACTIVE",
        )
    )).all()

    # Group by org
    org_members: dict[int, list[str]] = {}  # org_id -> [user_id_str]
    for user_id, o_id in reg_rows:
        if o_id:
            org_members.setdefault(o_id, []).append(str(user_id))

    _FAR_FUTURE = datetime(9999, 12, 31)

    board = []
    for org_id_val, org_info in org_map.items():
        members = org_members.get(org_id_val, [])
        total_bc = sum(user_bc.get(uid, 0) for uid in members)
        total_claims = sum(user_claims.get(uid, 0) for uid in members)
        last_claim_ts = max(
            (user_last_claim.get(uid, _FAR_FUTURE) for uid in members),
            default=_FAR_FUTURE,
        )
        # Top 3 performers
        performers = sorted(
            members,
            key=lambda uid: (-user_bc.get(uid, 0), user_last_claim.get(uid, _FAR_FUTURE)),
        )[:3]
        board.append({
            "org_id": org_id_val,
            "org_code": org_info["code"],
            "org_name": org_info["name"],
            "color": org_info["color"],
            "total_bc": total_bc,
            "member_count": len(members),
            "claim_count": total_claims,
            "last_claim_at": last_claim_ts if last_claim_ts != _FAR_FUTURE else None,
            "top_performers": [
                {
                    "user_id": uid,
                    "bc": user_bc.get(uid, 0),
                    "claim_count": user_claims.get(uid, 0),
                }
                for uid in performers
            ],
        })

    # Sort by BC desc, tiebreaker: more claims → earlier last claim
    board.sort(key=lambda x: (
        -x["total_bc"],
        -x["claim_count"],
        x["last_claim_at"] or _FAR_FUTURE,
    ))
    for i, row in enumerate(board):
        row["rank"] = i + 1

    # Resolve usernames for top performers in one batch query
    all_performer_ids = [uid for row in board for p in row["top_performers"] for uid in [p["user_id"]]]
    if all_performer_ids:
        uname_rows = (await db.execute(
            select(User.id, User.username).where(User.id.in_(all_performer_ids))
        )).all()
        uname_map = {str(r[0]): r[1] for r in uname_rows}
        for row in board:
            for p in row["top_performers"]:
                p["username"] = uname_map.get(p["user_id"], "—")

    return {"board": board, "is_frozen": frozen, "event_id": target_sid, "is_major": True}


# ---------------------------------------------------------------------------
# GET /bounty-board/graph  — BC-over-time series for top 10 operatives
# ---------------------------------------------------------------------------

@router.get("/graph")
async def board_graph(
    event_id: Optional[int] = None,
    org_id: Optional[int] = None,
    current_user=Depends(require_bounty_board_access),
    db: AsyncSession = Depends(get_db),
):
    target_sid = await _resolve_event(event_id, current_user, db)

    # Top 10 operatives by bc_total (for active event) or by sum of BcEvent.bc_delta
    scope = get_organization_scope(current_user, org_id)
    top_graph_q = select(User).where(User.role == UserRole.OPERATIVE, User.is_banned == False).order_by(User.bc_total.desc()).limit(10)
    if scope is not None:
        top_graph_q = top_graph_q.where(User.org_id == scope)
    top_result = await db.execute(top_graph_q)
    top_runners = top_result.scalars().all()
    if not top_runners:
        return {"series": []}

    top_ids = [r.id for r in top_runners]
    id_to_username = {str(r.id): r.username for r in top_runners}

    # Earning events for these operatives ordered by time (event-filtered)
    events_result = await db.execute(
        select(BcEvent)
        .where(
            BcEvent.operative_id.in_(top_ids),
            BcEvent.event_type == BcEventType.CONTRACT_CLAIMED,
            BcEvent.event_id == target_sid,
        )
        .order_by(BcEvent.timestamp)
    )
    events = events_result.scalars().all()

    # Build per-user series of cumulative BC
    series: dict[str, list] = {str(uid): [] for uid in top_ids}
    running: dict[str, int] = {str(uid): 0 for uid in top_ids}

    for ev in events:
        uid = str(ev.operative_id)
        running[uid] = ev.bc_total_after
        series[uid].append({
            "timestamp": ev.timestamp.isoformat(),
            "bc": ev.bc_total_after,
        })

    return {
        "series": [
            {"username": id_to_username[uid], "data": pts}
            for uid, pts in series.items()
            if pts
        ]
    }


# ---------------------------------------------------------------------------
# GET /bounty-board/team-graph  — BC-over-time series for top 10 teams
# ---------------------------------------------------------------------------

@router.get("/team-graph")
async def team_graph(
    event_id: Optional[int] = None,
    org_id: Optional[int] = None,
    current_user=Depends(require_bounty_board_access),
    db: AsyncSession = Depends(get_db),
):
    target_sid = await _resolve_event(event_id, current_user, db)

    # Top 10 teams by total BC earned from claims (event-filtered)
    scope = get_organization_scope(current_user, org_id)
    syn_graph_q = (
        select(Claim.team_id, func.sum(Claim.bc_earned))
        .where(Claim.team_id.isnot(None), Claim.event_id == target_sid)
        .group_by(Claim.team_id)
        .order_by(func.sum(Claim.bc_earned).desc())
        .limit(10)
    )
    if scope is not None:
        syn_graph_q = syn_graph_q.join(Team, Team.id == Claim.team_id).where(Team.org_id == scope)
    bc_result = await db.execute(syn_graph_q)
    top_rows = bc_result.all()
    if not top_rows:
        return {"series": []}

    top_ids = [r[0] for r in top_rows]

    # Look up team names
    syn_result = await db.execute(
        select(Team).where(Team.id.in_(top_ids))
    )
    id_to_name = {str(s.id): s.name for s in syn_result.scalars().all()}

    # All claims for these teams ordered by time (event-filtered)
    claims_result = await db.execute(
        select(Claim)
        .where(Claim.team_id.in_(top_ids), Claim.event_id == target_sid)
        .order_by(Claim.claimed_at)
    )
    claims = claims_result.scalars().all()

    # Build cumulative BC per team
    series: dict[str, list] = {str(sid): [] for sid in top_ids}
    running: dict[str, int] = {str(sid): 0 for sid in top_ids}

    for cl in claims:
        sid = str(cl.team_id)
        running[sid] += cl.bc_earned
        series[sid].append({
            "timestamp": cl.claimed_at.isoformat(),
            "bc": running[sid],
        })

    return {
        "series": [
            {"username": id_to_name.get(sid, sid), "data": pts}
            for sid, pts in series.items()
            if pts
        ]
    }


# ---------------------------------------------------------------------------
# GET /bounty-board/feed  — delayed solve feed (visible to all authenticated)
# ---------------------------------------------------------------------------

@router.get("/feed")
async def solve_feed(
    org_id: Optional[int] = None,
    current_user=Depends(require_bounty_board_access),
    db: AsyncSession = Depends(get_db),
):
    active_event = await get_active_event(db)
    event_id = await get_current_event_id(db)

    if not active_event or event_id is None:
        return {"state": "NO_EVENT", "entries": [], "is_major": False}

    # Frozen board: operatives see no feed data
    _role = getattr(current_user, 'role', None)
    if await _is_frozen(db) and _role == UserRole.OPERATIVE:
        return {"state": "FROZEN", "entries": [], "is_major": False}

    is_major_feed = (active_event.event_type or "LOCAL") == "MAJOR"
    feed_org_map: dict = {}
    if is_major_feed:
        feed_org_map = await _get_major_event_org_map(db, active_event)

    # Fetch admin-configurable delay (default 30s)
    delay_row = await db.execute(
        select(PlatformSettings).where(PlatformSettings.key == "solve_feed_delay_seconds")
    )
    delay_setting = delay_row.scalar_one_or_none()
    delay_seconds = 30
    if delay_setting and delay_setting.value.isdigit():
        delay_seconds = int(delay_setting.value)

    now = datetime.utcnow()
    regular_cutoff = now - timedelta(seconds=delay_seconds)
    first_blood_cutoff = now - timedelta(seconds=10)  # first blood: reduced to 10s

    # Excluded removed participants for this event
    removed_result = await db.execute(
        select(EventRegistration.user_id).where(
            EventRegistration.event_id == event_id,
            EventRegistration.status == "REMOVED",
        )
    )
    removed_ids = [r[0] for r in removed_result.all()]

    feed_scope = get_organization_scope(current_user, org_id)

    # ── Regular claims (non-void, non-first-blood) ───────────────────────────
    reg_q = (
        select(Claim, Contract, User)
        .join(Contract, Contract.id == Claim.contract_id)
        .join(User, User.id == Claim.operative_id)
        .where(
            Claim.event_id == event_id,
            Claim.is_first_blood == False,
            Claim.claimed_at <= regular_cutoff,
            Contract.is_void == False,
        )
    )
    if removed_ids:
        reg_q = reg_q.where(User.id.not_in(removed_ids))
    if feed_scope is not None:
        reg_q = reg_q.where(User.org_id == feed_scope)
    reg_rows = (await db.execute(reg_q.order_by(Claim.claimed_at.desc()).limit(20))).all()

    # ── First blood claims (10s delay) ───────────────────────────────────────
    fb_q = (
        select(Claim, Contract, User)
        .join(Contract, Contract.id == Claim.contract_id)
        .join(User, User.id == Claim.operative_id)
        .where(
            Claim.event_id == event_id,
            Claim.is_first_blood == True,
            Claim.claimed_at <= first_blood_cutoff,
            Contract.is_void == False,
        )
    )
    if removed_ids:
        fb_q = fb_q.where(User.id.not_in(removed_ids))
    if feed_scope is not None:
        fb_q = fb_q.where(User.org_id == feed_scope)
    fb_rows = (await db.execute(fb_q.order_by(Claim.claimed_at.desc()).limit(10))).all()

    # ── CC claims (same delay as regular) ────────────────────────────────────
    cc_q = (
        select(CorruptedClaim, User)
        .join(User, User.id == CorruptedClaim.operative_id)
        .where(
            CorruptedClaim.event_id == event_id,
            CorruptedClaim.claimed_at <= regular_cutoff,
        )
    )
    if removed_ids:
        cc_q = cc_q.where(User.id.not_in(removed_ids))
    cc_rows = (await db.execute(cc_q.order_by(CorruptedClaim.claimed_at.desc()).limit(20))).all()

    def _org_info(user: User) -> dict:
        if not is_major_feed or not user.org_id:
            return {"org_code": None, "org_color": None}
        info = feed_org_map.get(user.org_id, {})
        return {"org_code": info.get("code"), "org_color": info.get("color")}

    entries = []
    for cl, ct, u in reg_rows:
        entries.append({
            "operative_username": u.username,
            "contract_title":     ct.title,
            "bc_earned":          cl.bc_earned,
            "is_first_blood":     False,
            "is_cc":              False,
            "claimed_at":         cl.claimed_at,
            **_org_info(u),
        })
    for cl, ct, u in fb_rows:
        entries.append({
            "operative_username": u.username,
            "contract_title":     ct.title,
            "bc_earned":          cl.bc_earned,
            "is_first_blood":     True,
            "is_cc":              False,
            "claimed_at":         cl.claimed_at,
            **_org_info(u),
        })
    for cl, u in cc_rows:
        entries.append({
            "operative_username": u.username,
            "contract_title":     None,
            "bc_earned":          cl.bc_awarded,
            "is_first_blood":     False,
            "is_cc":              True,
            "claimed_at":         cl.claimed_at,
            **_org_info(u),
        })

    merged = sorted(entries, key=lambda x: x["claimed_at"], reverse=True)
    return {"state": "ACTIVE", "entries": merged[:20], "is_major": is_major_feed}
