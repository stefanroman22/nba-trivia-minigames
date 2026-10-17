"""The Checker's contract: what it is shown and what counts as a verdict.

Spec §4.12 of docs/superpowers/specs/2026-10-12-question-factory-design.md. The
Checker agent (a validity-only Claude session in .github/workflows/question-checker.yml)
sees each pending question as its module's checker_view(): exactly the facts a player
is shown, never how the question was made. payload_sha() of that view is stored on
the question, so a verdict applies only to the content that was checked, and a live
question whose view changes after a data refresh goes back to pending.

judge() is the code-side rule over the model's answer: a question is valid only when
every claim is confirmed by a page on an approved site, and invalid only when a claim
is contradicted by one. Anything else, including a malformed answer, is unsure.
"""
import hashlib
import json
from urllib.parse import urlparse

CHECKER_VERSION = 1
STAGED_GAMES = ("career-path", "who-are-ya", "tictactoe", "contexto", "fan-favorites", "who-would-win", "connections")
ALLOWED_SITES = ("www.basketball-reference.com", "www.nba.com", "en.wikipedia.org", "www.espn.com")
MAX_UNSURE = 2  # the second unsure verdict hands the question to the owner


def _span(stint):
    end = stint.get("end_year")
    return f"{stint.get('start_year')}-{end if end is not None else 'present'}"


def player_profile(row):
    """The facts about one player that the player-based games put on screen."""
    d = row.get("draft")
    return {
        "player": row.get("full_name"),
        "position": row.get("position"),
        "height_in": row.get("height_in"),
        "birth_year": row.get("birth_year"),
        "country": row.get("country"),
        "jersey": row.get("jersey"),
        "draft": f"{d.get('year')} round {d.get('round')} pick {d.get('pick')} by {d.get('team_abbr')}" if d else "undrafted",
        "teams": [f"{s.get('name')} {_span(s)}" for s in row.get("teams") or []],
    }


def payload_sha(view):
    return hashlib.sha256(json.dumps(view, sort_keys=True, ensure_ascii=False).encode("utf-8")).hexdigest()


def _allowed(url):
    if not isinstance(url, str):
        return False
    try:
        return urlparse(url).hostname in ALLOWED_SITES
    except ValueError:
        return False


def judge(verdict):
    """(outcome, reason) for one model verdict; outcome is valid | invalid | unsure."""
    if not isinstance(verdict, dict):
        return "unsure", "malformed"
    claims = verdict.get("claims")
    if not isinstance(claims, list) or not claims:
        return "unsure", "no_claims"
    checked = []
    for claim in claims:
        sources = claim.get("sources") if isinstance(claim, dict) else None
        if not isinstance(sources, list):
            return "unsure", "malformed"
        checked.append((claim.get("status"), any(_allowed(u) for u in sources)))
    if any(status == "contradicted" and backed for status, backed in checked):
        return "invalid", "contradicted"
    if verdict.get("verdict") == "valid" and all(status == "confirmed" and backed for status, backed in checked):
        return "valid", "all_confirmed"
    return "unsure", "unconfirmed"
