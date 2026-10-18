"""Check that every player photo fits every game frame it can appear in — without a browser.

    python scripts/player-photos/check_fit.py            # summary; exit 1 on any major issue
    python scripts/player-photos/check_fit.py --list     # every issue, one line each

The frame of each game x ui-check viewport was measured once in the real app (frames.json). This
reproduces how the photo is drawn there — the game's CSS fit for cdn.nba.com headshots (one uniform
studio crop, NBA_FACE below), utils/playerPhotos placePhoto for Commons photos with the face box from
faces.json — and checks the face: fully visible, centred, big enough, not upscaled. Pure Python, no
dependencies; it reads the answer players of the question games from the public data host.

Major (exit 1): HEAD_CUT through the face or mouth, FACE_TOO_SMALL, NO_FACE. Minor (reported):
trimmed hair, OFF_CENTRE, BLURRY, LETTERBOX. Thresholds come from the 2026-10-17 photo-fit audit,
calibrated on ~200 hand-checked examples.
"""
import argparse, json, os, re, sys, urllib.request
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
DATA = "https://nba-minigames-data.vercel.app/"
UA = {"User-Agent": "SwishQuest-photo-check/1.0 (https://swishquest.com)"}

# The face box (brows to chin) in a cdn.nba.com headshot, as fractions of the image: the median of
# 1,701 headshots (every era uses the same template).
NBA_FACE = (0.3657, 0.1289, 0.261, 0.4838)
NBA_ASPECT = 760 / 1040
NBA_SRC_W = {"lg": 1040, "sm": 260}
BUCKETS = [120, 250, 330, 500, 960, 1280]  # utils/playerPhotos COMMONS_BUCKETS

# utils/playerPhotos placePhoto constants
FACE_SHARE = {"avatar": 0.42, "card": 0.30, "strip": 0.42}
STRIP_MIN_COVERAGE = 0.55
MAX_ZOOM = {"avatar": 4.5, "card": 3, "strip": 3}

T = dict(head_out=0.15, face_out=0.05, major_head=0.30, major_face=0.20, off_centre=0.20, small_large=0.15,
         small_small=0.25, small_frame_px=70, min_face_px=12, blur=1.5, letterbox=0.45)


def clamp(v, lo, hi):
    return min(hi, max(lo, v))


def place_photo(W, H, aspect, face, frame):
    """utils/playerPhotos placePhoto, line for line. face = (cx, cy, fw, fh) fractions or None."""
    if frame == "strip":
        cw = min(W, H / aspect)
        ch = cw * aspect
        if (cw * ch) / (W * H) >= STRIP_MIN_COVERAGE or not face:
            return cw, ch, (W - cw) / 2, (H - ch) / 2
    cover = max(W, H / aspect)
    w = cover
    if face and face[2] and face[3]:
        want = FACE_SHARE[frame] * H / (face[3] * aspect)
        head_fits = min(0.92 * H / (face[3] * 1.5 * aspect), 0.95 * W / (face[2] * 1.24))
        least = cover if head_fits >= cover else max(head_fits, min(W, H / aspect))
        w = clamp(min(want, head_fits), least, cover * MAX_ZOOM[frame])
    h = w * aspect
    x = (W - w) / 2
    y = 0 if frame == "avatar" else -(h - H) * 0.05
    if face:
        x = W / 2 - face[0] * w
        if face[3]:
            top = (face[1] - 0.95 * face[3]) * h
            bottom = (face[1] + 0.55 * face[3]) * h
            y = H * (0.5 if frame == "avatar" else 0.47) - (top + bottom) / 2
        else:
            y = H * 0.42 - face[1] * h
    return w, h, clamp(x, min(0, W - w), max(0, W - w)), clamp(y, min(0, H - h), max(0, H - h))


def place_css(W, H, aspect, fit, pos):
    """object-fit cover/contain + object-position, as the browser draws an <img>."""
    s = max(W, H / aspect) if fit == "cover" else min(W, H / aspect)
    w, h = s, s * aspect
    return w, h, (W - w) * pos[0] / 100, (H - h) * pos[1] / 100


def visible(fr, px, py):
    W, H = fr["w"], fr["h"]
    if fr["shape"] == "circle":
        r = min(W, H) / 2
        return (px - W / 2) ** 2 + (py - H / 2) ** 2 <= r * r
    return 0 <= px <= W and 0 <= py <= H


def frac_out(fr, box, inside, n=20):
    """Share of the ellipse inscribed in box (css px) that is not visible."""
    x0, y0, x1, y1 = box
    cx, cy, a, b = (x0 + x1) / 2, (y0 + y1) / 2, (x1 - x0) / 2, (y1 - y0) / 2
    tot = out = 0
    for i in range(n):
        for j in range(n):
            u, v = (i + 0.5) / n * 2 - 1, (j + 0.5) / n * 2 - 1
            if u * u + v * v > 1:
                continue
            px, py = cx + u * a, cy + v * b
            tot += 1
            out += not (visible(fr, px, py) and inside(px, py))
    return out / tot if tot else 0.0


def check(fr, source, aspect, box, orig_w):
    """Issues of one photo in one frame: [(issue, severity, detail)]."""
    W, H = fr["w"], fr["h"]
    if source == "nba":
        w, h, ox, oy = place_css(W, H, aspect, fr["nba"]["fit"], fr["nba"]["pos"])
        served = NBA_SRC_W[fr["size"]]
    else:
        face = None if not box else (box[0] + box[2] / 2, box[1] + box[3] / 2, box[2], box[3])
        w, h, ox, oy = place_photo(W, H, aspect, face, fr["commons"])
        need = w * fr["dpr"]
        served = min(orig_w, next((b for b in BUCKETS if b >= need), BUCKETS[-1]))
    issues = []
    if w * fr["dpr"] / served > T["blur"]:
        issues.append(("BLURRY", "minor", f"upscaled {w * fr['dpr'] / served:.1f}x"))
    if source == "commons" and fr["commons"] == "strip" and (min(w, W) * min(h, H)) / (W * H) < T["letterbox"]:
        issues.append(("LETTERBOX", "minor", ""))
    if not box:
        return issues + [("NO_FACE", "major", "")]
    fx, fy, fw, fh = box
    to = lambda u, v: (ox + u * w, oy + v * h)
    inside = lambda px, py: ox - 0.01 <= px <= ox + w + 0.01 and oy - 0.01 <= py <= oy + h + 0.01
    head = (*to(max(0, fx - 0.12 * fw), max(0, fy - 0.45 * fh)), *to(min(1, fx + 1.12 * fw), min(1, fy + 1.05 * fh)))
    face_px = (*to(fx, fy), *to(fx + fw, fy + fh))
    ho, fo = frac_out(fr, head, inside), frac_out(fr, face_px, inside)
    if ho > T["head_out"] or fo > T["face_out"]:
        bottom = face_px[3] > H + 0.5
        major = ho >= T["major_head"] or fo >= T["major_face"] or (bottom and fo >= T["face_out"])
        if fr["shape"] == "circle" and fo < 0.30 and not (head[1] < -0.5 or head[0] < -0.5 or head[2] > W + 0.5):
            major = False  # a big face whose chin the avatar circle trims still reads fine
        issues.append(("HEAD_CUT", "major" if major else "minor", f"head {ho:.0%} / face {fo:.0%} out"))
    if abs((face_px[0] + face_px[2]) / 2 - W / 2) / W > T["off_centre"] and not (source == "commons" and fr["commons"] == "strip"):
        issues.append(("OFF_CENTRE", "minor", ""))
    fpx = face_px[3] - face_px[1]
    need = T["small_small"] if min(W, H) <= T["small_frame_px"] else T["small_large"]
    if fpx / H < need or fpx < T["min_face_px"]:
        issues.append(("FACE_TOO_SMALL", "major", f"face {fpx:.0f}px = {fpx / H:.0%} of the frame"))
    return issues


def get(url):
    with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=60) as r:
        return r.read().decode("utf8")


def players_per_game():
    """person_id -> games that can show it (see the photo-fit audit for the definitions)."""
    load = lambda p: json.load(open(os.path.join(ROOT, p), encoding="utf8"))
    pi, pm, ids, s5 = load("backend/trivia/data/players-index.json"), load("public/photos/player-photos.json"), \
        load("public/photos/player-ids.json"), load("backend/trivia/data/starting-five.json")
    games = defaultdict(set)
    man = json.loads(get(DATA + "manifest.json"))["games"]
    for g in ("who-are-ya", "career-path", "contexto"):
        files = json.loads(get(DATA + man[g]["index"]))["files"]
        with ThreadPoolExecutor(8) as ex:
            for txt in ex.map(get, [f"{DATA}{g}/{q}.{s}.json" for q, s in files.items()]):
                m = re.search(r'"person_id":\s*(\d+)', txt)
                if m:
                    games[int(m.group(1))] |= {g, f"{g}-review"} if g == "career-path" else {g}
    for game in s5:
        for p in game["starting_5"]:
            if p["name"] in ids:
                games[ids[p["name"]]] |= {"starting-five", "starting-five-review"}
    for p in pi:
        games[p["person_id"]] |= {"super-draft", "super-draft-review"}
        if p["fame_tier"] <= 3:
            games[p["person_id"]].add("bingo")
            c = p.get("career") or {}
            if all(isinstance(c.get(k), (int, float)) for k in ("ppg", "rpg", "apg")):
                games[p["person_id"]].add("pack-five")
    none = set(pm["none"])
    return {pid: g for pid, g in games.items() if pid not in none}, pm, {p["person_id"]: p["full_name"] for p in pi}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--list", action="store_true", help="print every issue")
    a = ap.parse_args()
    frames = json.load(open(os.path.join(HERE, "frames.json"), encoding="utf8"))["frames"]
    faces = json.load(open(os.path.join(HERE, "faces.json"), encoding="utf8"))
    shown, pm, names = players_per_game()
    by_type, by_game, players_major, players_any, rows = defaultdict(set), defaultdict(set), set(), set(), []
    for pid, games in shown.items():
        c = pm["commons"].get(str(pid))
        if c:
            source, orig_w, aspect = "commons", c[1], c[2] / c[1]
            if len(c) == 7:  # the face exactly as the browser reads it (rounded to 0.1% by build.mjs)
                cx, cy, fw, fh = (v / 100 for v in c[3:])
                box = (cx - fw / 2, cy - fh / 2, fw, fh)
            else:
                fc = faces.get(str(pid))
                box = fc["box"] if fc and fc.get("file") == c[0].rsplit("/", 1)[1] else None
        else:
            source, orig_w, aspect, box = "nba", 10 ** 6, NBA_ASPECT, NBA_FACE
        for g in sorted(games):
            for vp, fr in frames[g].items():
                for issue, sev, detail in check(fr, source, aspect, box, orig_w):
                    players_any.add(pid)
                    by_type[f"{issue} ({sev})"].add(pid)
                    if sev == "major":
                        players_major.add(pid)
                        by_game[g].add(pid)
                    rows.append((sev, g, vp, pid, names.get(pid, "?"), source, issue, detail))
    print(f"photos shown: {len(shown)}  with a major issue: {len(players_major)}  with any issue: {len(players_any)}")
    for k in sorted(by_type):
        print(f"  {k:28s} {len(by_type[k])}")
    for g in sorted(by_game):
        print(f"  major in {g:22s} {len(by_game[g])}")
    if a.list:
        for r in sorted(rows):
            print("  " + " | ".join(str(x) for x in r))
    return 1 if players_major else 0


if __name__ == "__main__":
    sys.exit(main())
