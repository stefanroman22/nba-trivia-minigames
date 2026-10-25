"""Django settings of a check stack: the app's own backend.settings, plus sqlite options for parallel checks.

check-core/lib/stack.mjs (djangoEnv) and scripts/team/qa.mjs run Django with DJANGO_SETTINGS_MODULE=check_settings and
this directory on PYTHONPATH. The weekly run tests `main`, whose settings may predate the sqlite OPTIONS of
backend/backend/settings.py: without them a transaction that reads and then writes (trivia.awarding.award) deadlocks
against another one and answers "database is locked" (HTTP 500 on log-session) at once. IMMEDIATE takes the write
lock up front; the timeout lets a writer wait for it. Local sqlite only: a DATABASE_URL deploy is never touched.
"""
from backend.settings import *  # noqa: F401,F403
from backend.settings import DATABASES

if DATABASES["default"]["ENGINE"].endswith("sqlite3"):
    DATABASES["default"].setdefault("OPTIONS", {}).update({"transaction_mode": "IMMEDIATE", "timeout": 20})
