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
    {"op": "sweep", "scope": "ui|logic|all"}   -> {"ok": true, "deleted": [...], "restored": [...], "photos": [...], "friend_rows": n}
        (scope default "ui": `uic<digits>` throwaways + the testuser3 family <-> testuser2; "logic": `lgc<digits>`
        throwaways + testuser4/5/6 and testuser4 <-> testuser5; "all": both)
    {"op": "forget_age", "users": [...]}   -> {"ok": true}   (the legacy age columns cleared: "age unknown", both age sets left)
    {"op": "legacy_teen", "users": [...]}   -> {"ok": true}   (the legacy age columns of an earlier 14-year-old: "teen")
        (no age rules since 2026-10-26.2, the columns stay: Logic Check seeds a "teen" to prove nothing reads them)
    {"op": "promote_admin", "users": [...]}   -> {"ok": true, "users": {"testuser6": {"is_staff": true}}}
        (the app's own `manage.py promote_admin <email>` command, on test accounts of this database only)

Accounts are created the way users.views.signup_view does it (consent stamped as an email
sign-up, leaderboard row recorded) and created on demand by "mint" too. Tokens are minted the way
login does it (users.tokens.issue_session_tokens: the `auth_time` claim and an OutstandingToken
row), so the app's refresh path (users.tokens.SessionRefreshSerializer) accepts them. Minting
directly sidesteps the per-IP signup/login throttles and refresh-rotation races between parallel
browser contexts: every context gets its own pair.

Refuses to run against anything but the local sqlite database.
"""
import json
import os
import re
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
        try:
            stamp_consent(user, "signup_text")
        except TypeError:  # a backend from before 2026-10-26.2 (main until it is promoted) also takes the age group
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


SWEEP_SCOPES = {
    # scope: (throwaway prefixes, persistent family regex, the partner the family is cleared against)
    "ui": (("uic",), r"testuser3(w\d{1,2})?", "testuser2"),
    "logic": (("lgc",), r"testuser[456]", None),
}


def sweep(scope="ui"):
    """Leftovers of a checker's account work (scope ui, logic or all):
    - delete `uic<digits>` (ui) / `lgc<digits>` (logic) throwaways;
    - ui: clear testuser3-family <-> testuser2 friendships / requests / blocks, put testuser3-family usernames back and
      drop their photos;
    - logic: put testuser4/5/6 usernames back, drop their photos, reset their age to unknown, clear every friendship / request / block among them."""
    from django.db.models import Q
    from users.account_data import delete_account, remove_photo
    from users.models import BlockedUser, FriendRequest, Friendship
    if scope not in ("ui", "logic", "all"):
        raise ValueError(f"sweep scope must be ui, logic or all (got {scope!r})")
    scopes = ["ui", "logic"] if scope == "all" else [scope]
    out = {"deleted": [], "restored": [], "photos": [], "friend_rows": 0}
    prefixes = tuple(p for s in scopes for p in SWEEP_SCOPES[s][0])
    throwaway = re.compile(r"(%s)\d{4,17}" % "|".join(prefixes))
    for u in list(User.objects.filter(email__iendswith=EMAIL_DOMAIN)):
        if throwaway.fullmatch(u.username) and u.email.lower() == u.username.lower() + EMAIL_DOMAIN:
            delete_account(u)
            out["deleted"].append(u.username)

    def clear(a, b):
        lo, hi = sorted([a.pk, b.pk])
        n = FriendRequest.objects.filter(Q(sender=a, receiver=b) | Q(sender=b, receiver=a)).delete()[0]
        n += Friendship.objects.filter(user_low_id=lo, user_high_id=hi).delete()[0]
        n += BlockedUser.objects.filter(Q(blocker=a, blocked=b) | Q(blocker=b, blocked=a)).delete()[0]
        return n

    for s in scopes:
        _, fam_re, partner = SWEEP_SCOPES[s]
        fam = [u for u in User.objects.filter(email__iendswith=EMAIL_DOMAIN) if re.fullmatch(fam_re, u.email.split("@")[0])]
        for u in fam:
            want = u.email.split("@")[0]
            if u.username != want:
                u.username = want
                u.save(update_fields=["username"])
                out["restored"].append(want)
            if u.profile_photo_version:
                remove_photo(u)
                out["photos"].append(want)
            if s == "logic" and (u.age_group or getattr(u, "age_sets", 0)):
                # Logic's checks seed testuser4/5 as legacy teens (legacy_teen); minted accounts start with no age.
                unset_age(u)
                out.setdefault("ages", []).append(want)
        if partner:
            other = User.objects.filter(email__iexact=partner + EMAIL_DOMAIN).first()
            if other:
                for u in fam:
                    out["friend_rows"] += clear(u, other)
        else:
            for i, a in enumerate(fam):
                for b in fam[i + 1:]:
                    out["friend_rows"] += clear(a, b)
    return {"ok": True, **out}


def unset_age(user):
    """Back to "age unknown", with both age sets left (users.consent.MAX_AGE_SETS): resetting only age_group left the
    count behind, so after two runs every POST /account/age/ answered 409 and the photo flow could never finish."""
    fields = ["age_group"]
    user.age_group = ""
    for name, value in (("birth_month", None), ("birth_year", None), ("age_sets", 0)):
        if hasattr(user, name):
            setattr(user, name, value)
            fields.append(name)
    user.save(update_fields=fields)


def set_legacy_teen(user):
    """The age columns an account of an earlier 14-year-old still carries: "teen", born 14 years ago this month, one
    age set used. The age rules are gone (users.consent, 2026-10-26.2), so nothing may read them: such an account
    uploads a photo, is listed and found by name, and the relay shows its name (Logic Check proves each)."""
    from datetime import date
    today = date.today()
    fields = ["age_group"]
    user.age_group = "teen"
    for name, value in (("birth_month", today.month), ("birth_year", today.year - 14), ("age_sets", 1)):
        if hasattr(user, name):
            setattr(user, name, value)
            fields.append(name)
    user.save(update_fields=fields)


def promote_admin(spec, password):
    """Admin rights for a test account through the app's own management command (local sqlite: guard() ran)."""
    from io import StringIO
    from django.core.management import call_command
    user, _ = account(spec, password)
    call_command("promote_admin", user.email, stdout=StringIO())
    user.refresh_from_db()
    return {"is_staff": user.is_staff, "is_superuser": user.is_superuser}


def handle(req, password):
    if req.get("op") == "sweep":
        return sweep(req.get("scope") or "ui")
    users = req.get("users", [])
    if req.get("op") == "ensure":
        out = {}
        for spec in users:
            user, created = account(spec, password)
            out[spec["username"]] = {"created": created, "id": user.public_id}
        return {"ok": True, "users": out}
    if req.get("op") == "mint":
        return {"ok": True, "tokens": {spec["username"]: mint(spec, password) for spec in users}}
    if req.get("op") == "forget_age":
        # Back to "age unknown" (the legacy columns cleared): the state that once made a photo upload ask for an age.
        for spec in users:
            user, _ = account(spec, password)
            unset_age(user)
        return {"ok": True}
    if req.get("op") == "legacy_teen":
        for spec in users:
            user, _ = account(spec, password)
            set_legacy_teen(user)
        return {"ok": True}
    if req.get("op") == "promote_admin":
        return {"ok": True, "users": {spec["username"]: promote_admin(spec, password) for spec in users}}
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
