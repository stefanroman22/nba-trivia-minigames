"""Rate limits for the endpoints worth abusing.

Project-level rather than per-app because the policy spans both `users/` (sign-in)
and `trivia/` (score submission), and the limits only make sense read together.

All four subclass `UserRateThrottle`, which keys by account when the caller is
authenticated and by IP when it isn't — so an unauthenticated brute-force is
bounded per source, while a signed-in abuser is bounded per account no matter how
many addresses they come from.

The rates live in `settings.REST_FRAMEWORK["DEFAULT_THROTTLE_RATES"]`, keyed by the
`scope` strings below. Counters are stored in Django's cache; see the CACHES block
in settings.py for why that must not be LocMemCache in production.
"""
from rest_framework.throttling import UserRateThrottle


class LoginRateThrottle(UserRateThrottle):
    """Sign-in attempts. Bounds password guessing, which was previously unlimited."""
    scope = "auth-login"


class SignupRateThrottle(UserRateThrottle):
    """Account creation. Bounds automated signup floods."""
    scope = "auth-signup"


class RefreshRateThrottle(UserRateThrottle):
    """Token refresh. A real client needs ~4/hour (15-minute access tokens); the
    limit leaves room for several devices and tabs while capping churn, since each
    refresh writes a blacklist row."""
    scope = "auth-refresh"


class ScoreSubmitRateThrottle(UserRateThrottle):
    """Finished-game submissions — the points award path. A game takes minutes, so
    the limit is far above real play and exists to bound scripted score farming."""
    scope = "score-submit"
