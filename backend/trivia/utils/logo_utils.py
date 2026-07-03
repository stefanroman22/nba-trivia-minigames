# The NBA CDN only hosts logos for the 30 current franchises, whose team IDs run
# 1610612737–1610612766. Defunct early-BAA teams (Anderson Packers, Chicago
# Stags, etc.) use IDs in the 1610610xxx range and have no logo asset — requesting
# one returns 403. Return None for those so callers can fall back gracefully
# instead of emitting a broken image URL.
FRANCHISE_ID_MIN = 1610612737
FRANCHISE_ID_MAX = 1610612766


def has_logo(team_id):
    """True if the NBA CDN hosts a logo for this team id (one of the 30 franchises)."""
    return bool(team_id) and FRANCHISE_ID_MIN <= int(team_id) <= FRANCHISE_ID_MAX


def logo(team_id):
    return (
        f"https://cdn.nba.com/logos/nba/{int(team_id)}/primary/L/logo.svg"
        if has_logo(team_id)
        else None
    )
