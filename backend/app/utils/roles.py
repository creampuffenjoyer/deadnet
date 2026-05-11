"""Role hierarchy and organization scope utilities."""
from typing import Optional

ROLE_HIERARCHY: dict[str, int] = {
    "ARCHITECT":  99,
    "ADMIN":      50,
    "CONTRACTOR": 30,
    "HANDLER": 20,
    "OPERATIVE":  10,
}


def get_organization_scope(current_user, architect_override: Optional[int] = None) -> Optional[int]:
    """
    Return the org_id to filter queries by, or None for Architect (all data).

    Architect JWT produces an ArchitectUser sentinel (role.value == "ARCHITECT",
    no org_id).  All regular DB users carry org_id.

    Architect can optionally pass ``architect_override`` (from a ``?org_id=N``
    query param) to narrow results to a single organization without changing their
    global access level.  Non-Architect users always get their own org_id;
    ``architect_override`` is silently ignored for them.

    Usage::

        scope = get_organization_scope(current_user, org_id)
        if scope is not None:
            query = query.where(Model.org_id == scope)
        # scope is None → Architect with no override → sees everything
    """
    role_value = getattr(current_user, "role", None)
    if role_value is not None:
        rv = role_value.value if hasattr(role_value, "value") else str(role_value)
        if rv == "ARCHITECT":
            return architect_override  # None = no filter; int = narrow to one organization

    return getattr(current_user, "org_id", None)
