"""Shared truth for The Heatmap board geometry + player/criterion matching.

Mirrors src/utils/criteria.ts::playerMatches EXACTLY (client and server must
agree on solvability) and defines the fixed 28-hex honeycomb template used by
both the generator and the renderer (renderer derives on-screen positions from
ROW_WIDTHS; neighbour edges come from the seed, computed here).
"""
import json
import os
import re
from datetime import datetime, timezone

from django.conf import settings

# Row-major hex ids 0..27. Even rows flush, odd rows indented +0.5 (honeycomb).
ROW_WIDTHS = [4, 5, 5, 5, 5, 4]  # == 28 playable hexes

CURRENT_YEAR = datetime.now(timezone.utc).year


def _centers():
    """Yield (hex_id, row_index, x_centre) for every hex in the template."""
    out = []
    hid = 0
    for r, w in enumerate(ROW_WIDTHS):
        indent = 0.0 if r % 2 == 0 else 0.5
        for j in range(w):
            out.append((hid, r, j + indent))
            hid += 1
    return out


def compute_neighbors():
    """id -> sorted neighbour ids for the fixed template (offset honeycomb)."""
    centers = _centers()
    adj = {hid: set() for hid, _, _ in centers}
    for aid, ar, ax in centers:
        for bid, br, bx in centers:
            if aid == bid:
                continue
            same_row = (ar == br) and abs(round(ax - bx, 3)) == 1.0
            adj_row = (abs(ar - br) == 1) and abs(ax - bx) < 0.6
            if same_row or adj_row:
                adj[aid].add(bid)
    return {k: sorted(v) for k, v in adj.items()}


def _decade_start(value):
    """'1990s' or 'decade-1990s' -> 1990; else None."""
    m = re.search(r"(\d{4})s$", value)
    return int(m.group(1)) if m else None


def player_matches(p, c):
    """Does curated row `p` satisfy Criterion dict `c`? (Pure; mirrors criteria.ts.)"""
    t = c["type"]
    v = c["value"]
    if t == "team":
        return any(stint["abbr"] == v for stint in p["teams"])
    if t == "award":
        a = p["awards"]
        return {
            "mvp": len(a["mvp"]) > 0,
            "fmvp": len(a["fmvp"]) > 0,
            "dpoy": len(a["dpoy"]) > 0,
            "roty": a["roty"] is not None,
            "smoy": len(a["smoy"]) > 0,
            "ring": len(a["rings"]) > 0,
            "allstar5plus": a["allstar_count"] >= 5,
            "allnba": a["allnba_count"] > 0,
        }.get(v, False)
    if t == "country":
        if v == "USA":
            return p["country"] == "USA"
        if v == "INTL":
            return p["country"] != "USA"
        return p["country"] == v
    if t == "draft":
        d = p["draft"]
        if v == "undrafted":
            return d is None
        if d is None:
            return False
        if v == "top5":
            return d["pick"] <= 5
        if v == "lottery":
            return d["pick"] <= 14
        if v == "round2":
            return d["round"] == 2
        if v.startswith("decade-"):
            ds = _decade_start(v)
            return ds is not None and ds <= d["year"] <= ds + 9
        return False
    if t == "college":
        if v == "none":
            return p["college"] is None
        return p["college"] == v
    if t == "stat":
        cr = p["career"]
        return {
            "20kpts": cr["pts"] >= 20000,
            "25kpts": cr["pts"] >= 25000,
            "ppg20": cr["ppg"] >= 20,
            "rpg10": cr["rpg"] >= 10,
            "apg8": cr["apg"] >= 8,
            "seasons15plus": cr["seasons"] >= 15,
        }.get(v, False)
    if t == "era":
        ds = _decade_start(v)
        if ds is None:
            return False
        return any(
            s["start_year"] <= ds + 9 and (s["end_year"] or CURRENT_YEAR) >= ds
            for s in p["teams"]
        )
    return False


def load_curated():
    """Load the curated dataset (raises FileNotFoundError with a clear message).

    Honours the HEATMAP_CURATED env var (absolute path) so the generator /
    validator can be pointed at an alternate dataset for authoring; defaults to
    the foundation agent's trivia/data_static/players_curated.json.
    """
    override = os.environ.get("HEATMAP_CURATED")
    path = override or os.path.join(
        settings.BASE_DIR, "trivia", "data_static", "players_curated.json"
    )
    if not os.path.exists(path):
        raise FileNotFoundError(
            f"players_curated.json not found at {path} — the foundation agent must "
            f"publish the curated dataset before the heatmap seed can be built/validated "
            f"(or set HEATMAP_CURATED to an alternate dataset path)."
        )
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)
