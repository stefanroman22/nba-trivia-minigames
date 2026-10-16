"""Route nba_api through the Cloudflare relay (infra/nba-relay) when configured.

stats.nba.com refuses datacenter addresses, so a refresh on a GitHub-hosted
runner sets NBA_RELAY_BASE (the Worker URL) and NBA_RELAY_KEY (its secret).
configure() then points NBAStatsHTTP at `<base>/stats/{endpoint}` and sends the
key in X-Relay-Key. nba_api's `Host: stats.nba.com` header is dropped: Cloudflare
routes by Host and answers 403 before the Worker runs. With neither variable set
nba_api is left alone and calls stats.nba.com directly, as on a residential IP.
"""

import logging
import os

logger = logging.getLogger(__name__)

_ORIGINAL = None  # (base_url, headers) of NBAStatsHTTP before the relay was installed


def configure():
    """Install the relay from the environment. True when nba_api now uses it.

    Both variables or neither: one alone raises, so a half-configured run never
    falls back to a direct call that a runner cannot make. Idempotent.
    Once installed, later changes to the variables are ignored until reset().
    """
    global _ORIGINAL
    base = os.environ.get("NBA_RELAY_BASE", "").strip()
    key = os.environ.get("NBA_RELAY_KEY", "").strip()
    if not base and not key:
        return False
    if not base or not key:
        missing = "NBA_RELAY_KEY" if base else "NBA_RELAY_BASE"
        raise RuntimeError(f"nba_api relay is half configured: {missing} is not set")
    if _ORIGINAL is not None:
        return True
    from nba_api.stats.library.http import NBAStatsHTTP  # pipeline-only dependency

    _ORIGINAL = (NBAStatsHTTP.base_url, NBAStatsHTTP.headers)
    headers = {name: value for name, value in _ORIGINAL[1].items() if name.lower() != "host"}
    headers["X-Relay-Key"] = key
    base = base.rstrip("/")
    NBAStatsHTTP.base_url = f"{base}/stats/{{endpoint}}"
    NBAStatsHTTP.headers = headers
    logger.info("nba_api routed through relay %s", base)
    return True


def reset():
    """Restore nba_api's direct stats.nba.com settings (tests)."""
    global _ORIGINAL
    if _ORIGINAL is not None:
        from nba_api.stats.library.http import NBAStatsHTTP

        NBAStatsHTTP.base_url, NBAStatsHTTP.headers = _ORIGINAL
        _ORIGINAL = None
