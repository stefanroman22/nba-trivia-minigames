"""Pool rules for the Starting-Five game.

The board is a fixed 2-guard / 2-forward / 1-center layout
(``src/Game Renderers/StartingFive.tsx``) and every guess is typed through the
all-players autocomplete, so two rules decide whether a game from the box-score
feed is actually winnable:

  * ``playable_lineups`` drops games whose starting five isn't 2-2-1. The feed
    regularly reports three guards or no center at all, and such a lineup has
    no winning assignment on the board — there is no third guard card.
  * ``canonical_lineup_names`` rewrites lineup names to the spelling the
    autocomplete offers, so every answer can be typed.

Both are applied by everything that publishes or serves the pool
(``build_pools_from_db``, ``refresh_game_data``, ``trivia.views``), so a
regenerated feed is re-cleaned automatically rather than needing the bad rows
deleted by hand.
"""

import unicodedata

# The only lineup shape the board can represent.
LINEUP_SHAPE = {"G": 2, "F": 2, "C": 1}

# Box-score spellings the player index writes differently beyond accents, so
# accent-folding alone can never reach them.
NAME_ALIASES = {
    "nene hilario": "Nene",
    "jianlian yi": "Yi Jianlian",
}


def _slot(position):
    """Map a START_POSITION to the board's guard/forward/center family."""
    p = (position or "").strip().upper()
    if p in ("PG", "SG", "G"):
        return "G"
    if p in ("PF", "SF", "F"):
        return "F"
    if p == "C":
        return "C"
    return None


def _fold(name):
    """Lower-case, accent-stripped key (mirrors the UI's diacritic-safe match)."""
    decomposed = unicodedata.normalize("NFD", name or "")
    return "".join(c for c in decomposed if unicodedata.category(c) != "Mn").strip().lower()


def is_playable_lineup(lineup):
    """True when a starting five fits the board's 2-guard/2-forward/1-center shape."""
    if not isinstance(lineup, list) or len(lineup) != 5:
        return False
    counts = {"G": 0, "F": 0, "C": 0}
    for player in lineup:
        if not isinstance(player, dict) or not player.get("name"):
            return False
        slot = _slot(player.get("position"))
        if slot is None:
            return False
        counts[slot] += 1
    return counts == LINEUP_SHAPE


def playable_lineups(rows):
    """Drop the games whose lineup the 2-2-1 board cannot represent."""
    return [g for g in rows if isinstance(g, dict) and is_playable_lineup(g.get("starting_5"))]


def canonical_lineup_names(rows, player_names):
    """Rewrite lineup names in place to their all-players spelling; return rows.

    Accent variants resolve through the folded index; the handful that differ
    by more than accents go through NAME_ALIASES. A name that is already in the
    index, or that we can't place at all, is left exactly as it is — guessing at
    it would be worse than leaving it typeable as spelled.
    """
    known = set(player_names or [])
    index = {_fold(n): n for n in known}
    for game in rows:
        if not isinstance(game, dict):
            continue
        for player in game.get("starting_5") or []:
            if not isinstance(player, dict) or player.get("name") in known:
                continue
            key = _fold(player.get("name"))
            alias = NAME_ALIASES.get(key)
            if alias:
                canonical = index.get(_fold(alias), alias)
            else:
                canonical = index.get(key)
            if canonical:
                player["name"] = canonical
    return rows
