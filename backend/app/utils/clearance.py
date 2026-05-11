def get_clearance_level(bc_total: int, settings: dict) -> str:
    """Compute a Operative's clearance level from their BC total.

    Thresholds are read from platform_settings so Admin can tune them.
    """
    try:
        cl_ghost = int(settings.get("cl_ghost", 501))
        cl_phantom = int(settings.get("cl_phantom", 1501))
        cl_specter = int(settings.get("cl_specter", 3001))
        cl_legend = int(settings.get("cl_legend", 6001))
    except (ValueError, TypeError):
        cl_ghost, cl_phantom, cl_specter, cl_legend = 501, 1501, 3001, 6001

    if bc_total >= cl_legend:
        return "HACKER"
    if bc_total >= cl_specter:
        return "SPECTER"
    if bc_total >= cl_phantom:
        return "PHANTOM"
    if bc_total >= cl_ghost:
        return "GHOST"
    return "NOVICE"
