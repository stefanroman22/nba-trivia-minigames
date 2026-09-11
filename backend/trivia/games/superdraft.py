"""SuperDraft Five — draft-a-lineup game backend (frozen contract #4).

The draft is played against the players-index pool: one rotating daily
objective and five slots, each a pool constraint (a franchise / a country / a
draft decade) with at least MIN_ELIGIBLE eligible players. The objectives live
in the renderer (src/Game Renderers/SuperDraft.tsx); the pool lives on the CDN.

A round therefore carries CONFIG, not the pool:

    {"series": [{"pool": "players-index",
                 "day": "YYYY-MM-DD",
                 "slots": [{kind, value, label, sub} x 5]}]}

The slots are drawn HERE, once per round, so every player in a room drafts
under identical constraints — the renderer used to draw them client-locally,
which meant two players in the same match were scored against different
lineups. ``day`` pins the daily objective to the server's UTC date so clients
in different timezones can't land on different objectives either.

Shipping the pool itself instead (as this endpoint used to) is O(dataset) per
player per round — 160 KB at 159 rows, megabytes at the full dataset, re-emitted
on every reconnect. The renderer loads the same CDN-cached pool single-player
uses and resolves these constraints against it.
"""
import datetime
import random

from django.http import JsonResponse

from trivia.data_pipeline.live_pool import load_players

GAME_NAME = "SuperDraft Five"

POOL_KEY = "players-index"  # the CDN pool the renderer resolves the slots against
SLOT_COUNT = 5              # slots per draft (matches SLOT_COUNT in SuperDraft.tsx)
MIN_ELIGIBLE = 8            # a constraint must offer at least this many players


def _candidate_queues(rows):
    """Constraints with >= MIN_ELIGIBLE eligible players, grouped by kind.

    Mirrors buildCandidates() in src/Game Renderers/SuperDraft.tsx — same
    grouping, same labels — so the renderer resolves every slot we send back to
    exactly the players it would have found itself.
    """
    teams, countries, decades = {}, {}, {}
    for row in rows:
        if not isinstance(row, dict):
            continue
        seen_abbr = set()
        for stint in row.get("teams") or []:
            abbr = (stint or {}).get("abbr")
            if not abbr or abbr in seen_abbr:
                continue
            seen_abbr.add(abbr)
            entry = teams.setdefault(abbr, {"name": stint.get("name") or abbr, "count": 0})
            entry["count"] += 1
        country = row.get("country")
        if country:
            countries[country] = countries.get(country, 0) + 1
        draft = row.get("draft")
        if isinstance(draft, dict) and isinstance(draft.get("year"), int):
            decade = draft["year"] // 10 * 10
            decades[decade] = decades.get(decade, 0) + 1

    team_c = [
        {"kind": "team", "value": abbr, "label": e["name"], "sub": "Franchise"}
        for abbr, e in teams.items()
        if e["count"] >= MIN_ELIGIBLE
    ]
    draft_c = [
        {"kind": "draft", "value": str(d), "label": f"{d}s Draft", "sub": "Draft class"}
        for d, n in decades.items()
        if n >= MIN_ELIGIBLE
    ]
    country_c = [
        {"kind": "country", "value": c, "label": c, "sub": "Country"}
        for c, n in countries.items()
        if n >= MIN_ELIGIBLE
    ]
    # Round-robin order matches drawSlots() in the renderer: franchise, decade, country.
    return [team_c, draft_c, country_c]


def draw_slots(queues, rng=random):
    """Round-robin across the kinds so a draft mixes franchises / decades / countries."""
    queues = [rng.sample(q, len(q)) for q in queues]
    picked, used = [], set()
    q = 0
    guard = 0
    while len(picked) < SLOT_COUNT and guard < 200:
        guard += 1
        queue = queues[q % len(queues)]
        q += 1
        if not queue:
            continue
        nxt = queue.pop(0)
        key = f"{nxt['kind']}:{nxt['value']}"
        if key in used:
            continue
        used.add(key)
        picked.append(nxt)
    return picked


def get_round(request):
    """One room's draft configuration: the day plus its five slot constraints."""
    rows = load_players()
    if not rows:
        return JsonResponse({"error": "SuperDraft Five content not ready"}, status=503)
    slots = draw_slots(_candidate_queues(rows))
    if len(slots) < SLOT_COUNT:
        return JsonResponse({"error": "SuperDraft Five content not ready"}, status=503)
    return JsonResponse(
        {
            "series": [
                {
                    "pool": POOL_KEY,
                    "day": datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%d"),
                    "slots": slots,
                }
            ]
        }
    )
