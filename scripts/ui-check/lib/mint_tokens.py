"""UI check accounts: create the persistent test accounts and mint session tokens.

Runs inside `manage.py shell` against the LOCAL sqlite database (lib/accounts.mjs starts it):

    python manage.py shell -c "import runpy; runpy.run_path(r'<this file>', run_name='uicheck')"

The shared account password comes in the UIC_MINT_PASSWORD env var. Requests are JSON lines on
stdin, one reply line per request on stdout as `UICHECK_JSON:<json>` (anything else on stdout is
Django noise). It ends at EOF, so one process serves a whole Playwright worker (Django takes
seconds to start here; a mint takes milliseconds).
    {"op": "ensure", "users": [{"username": "testuser1", "email": "testuser1@uicheck.test"}]}
        -> {"ok": true, "users": {"testuser1": {"created": false, "id": "K7F3QD"}}}
    {"op": "mint", "users": [{"username": "testuser3", "email": "testuser3@uicheck.test"}]}
        -> {"ok": true, "tokens": {"testuser3": {"access": "...", "refresh": "...", "user": {...}}}}

Accounts are created the way users.views.signup_view does it (consent stamped as a checkbox
sign-up, leaderboard row recorded) and created on demand by "mint" too. Tokens are minted the way
login does it (users.tokens.issue_session_tokens: the `auth_time` claim and an OutstandingToken
row), so the app's refresh path (users.tokens.SessionRefreshSerializer) accepts them. Minting
directly sidesteps the per-IP signup/login throttles and refresh-rotation races between parallel
browser contexts: every context gets its own pair.

Refuses to run against anything but the local sqlite database.
"""
import json
import os
import sys

from django.conf import settings
from django.contrib.auth import get_user_model
from django.contrib.auth.password_validation import validate_password

from users import leaderboard
from users.consent import CONSENT_FIELDS, stamp_consent
from users.tokens import issue_session_tokens
from users.views import USERNAME_RE, user_payload

MARK = "UICHECK_JSON:"
EMAIL_DOMAIN = "@uicheck.test"
User = get_user_model()


def reply(obj):
    sys.stdout.write(MARK + json.dumps(obj) + "\n")
    sys.stdout.flush()


def guard():
    engine = settings.DATABASES["default"]["ENGINE"]
    if not engine.endswith("sqlite3") or os.environ.get("DATABASE_URL"):
        raise SystemExit(f"mint_tokens: refusing to run against {engine} (DATABASE_URL set?) - local sqlite only")


def account(spec, password):
    """(user, created) for {username, email}; created, or its password/username restored, when needed."""
    username, email = spec["username"], spec["email"].lower()
    if not USERNAME_RE.match(username) or not email.endswith(EMAIL_DOMAIN):
        raise ValueError(f"not a ui-check account: {username} <{email}>")
    user = User.objects.filter(email__iexact=email).first()
    if user is None:
        validate_password(password, User(username=username, email=email))
        user = User.objects.create_user(username=username, email=email, password=password)
        stamp_consent(user, "", "signup_checkbox")
        user.save(update_fields=CONSENT_FIELDS)
        leaderboard.record_score(user)
        return user, True
    changed = []
    if not user.check_password(password):
        user.set_password(password)
        changed.append("password")
    if user.username != username:
        user.username = username
        changed.append("username")
    if changed:
        user.save(update_fields=changed)
    return user, False


def mint(spec, password):
    user, _ = account(spec, password)
    refresh = issue_session_tokens(user)
    return {"access": str(refresh.access_token), "refresh": str(refresh), "user": user_payload(None, user)}


def handle(req, password):
    users = req.get("users", [])
    if req.get("op") == "ensure":
        out = {}
        for spec in users:
            user, created = account(spec, password)
            out[spec["username"]] = {"created": created, "id": user.public_id}
        return {"ok": True, "users": out}
    if req.get("op") == "mint":
        return {"ok": True, "tokens": {spec["username"]: mint(spec, password) for spec in users}}
    return {"ok": False, "error": f"unknown op {req.get('op')!r}"}


def main():
    guard()
    password = os.environ.get("UIC_MINT_PASSWORD") or ""
    if not password:
        raise SystemExit("mint_tokens: UIC_MINT_PASSWORD is not set")
    reply({"ok": True, "ready": True})
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            reply(handle(json.loads(line), password))
        except Exception as e:  # one bad request must not end the server
            reply({"ok": False, "error": f"{type(e).__name__}: {e}"})


if __name__ in ("__main__", "uicheck"):
    main()
