"""Generate the committed benign evaluation set: 60 synthetic 224x224 PNGs.

Everything is drawn with Pillow from a fixed seed, so running this twice yields
byte-identical files. The images are cartoon-style and fully clothed; they exist
to catch gross failures of the moderation classifier (wrong class order, broken
preprocessing, crude skin-tone bias on sports/beach/portrait/drawing content),
not to measure real-world accuracy. Real-photo checks are owner-run on the
gitignored `eval/private/` folder with `run_eval.py`.

Usage: python make_benign_set.py [--out DIR]
Output: <category>_<nn>.png, 10 each for skin, beach, sports, drawing, selfie, group.
No explicit imagery is generated or downloaded; the files are CC0 (see LICENSES.md).
"""
import argparse
import math
import random
from pathlib import Path

from PIL import Image, ImageDraw

SEED = 0
SIZE = 224
PER_CATEGORY = 10
CATEGORIES = ("skin", "beach", "sports", "drawing", "selfie", "group")

# 12 fixed skin tones spread across the Fitzpatrick scale (light to deep).
TONES = [
    (255, 224, 205), (246, 208, 182), (236, 188, 153), (224, 172, 130),
    (205, 150, 108), (186, 128, 90), (160, 108, 72), (141, 85, 54),
    (110, 66, 40), (89, 52, 33), (70, 41, 27), (50, 30, 20),
]
HAIR = [(20, 16, 14), (60, 40, 25), (110, 70, 35), (170, 120, 60), (200, 190, 170), (140, 45, 30)]
SHIRTS = [(200, 50, 50), (45, 100, 190), (240, 190, 40), (50, 150, 90), (130, 70, 170), (245, 245, 245), (30, 30, 40)]


def lerp(a, b, t):
    return tuple(int(a[i] + (b[i] - a[i]) * t) for i in range(3))


def gradient(draw, top, bottom, y0=0, y1=SIZE):
    for y in range(y0, y1):
        t = (y - y0) / max(1, y1 - y0 - 1)
        draw.line([(0, y), (SIZE, y)], fill=lerp(top, bottom, t))


def shade(c, f):
    return tuple(max(0, min(255, int(v * f))) for v in c)


def head(draw, cx, cy, r, tone, hair, rng, smile=True):
    """Head with hair, eyes and mouth. r is the head radius."""
    hair_style = rng.randrange(3)
    if hair_style == 0:  # cap of hair
        draw.ellipse([cx - r - 2, cy - r - 4, cx + r + 2, cy + r * 0.2], fill=hair)
    elif hair_style == 1:  # big rounded hair behind the head
        draw.ellipse([cx - r - 8, cy - r - 8, cx + r + 8, cy + r + 10], fill=hair)
    draw.ellipse([cx - r, cy - r, cx + r, cy + r * 1.1], fill=tone)
    if hair_style == 0:
        draw.pieslice([cx - r, cy - r, cx + r, cy + r], 180, 360, fill=hair)
    elif hair_style == 2:  # short fringe
        draw.rectangle([cx - r, cy - r, cx + r, cy - r * 0.55], fill=hair)
        draw.ellipse([cx - r, cy - r * 1.05, cx + r, cy - r * 0.1], fill=hair)
        draw.ellipse([cx - r * 0.85, cy - r * 0.55, cx + r * 0.85, cy + r * 1.05], fill=tone)
    ex = r * 0.38
    er = max(2, r * 0.09)
    for sx in (-1, 1):
        draw.ellipse([cx + sx * ex - er, cy - er, cx + sx * ex + er, cy + er], fill=(25, 20, 20))
    my = cy + r * 0.45
    if smile:
        draw.arc([cx - r * 0.35, my - r * 0.2, cx + r * 0.35, my + r * 0.2], 15, 165, fill=shade(tone, 0.45), width=max(1, int(r * 0.06)))
    else:
        draw.line([(cx - r * 0.2, my), (cx + r * 0.2, my)], fill=shade(tone, 0.45), width=max(1, int(r * 0.06)))


def shoulders(draw, cx, top, w, h, shirt, tone):
    draw.rounded_rectangle([cx - w, top, cx + w, top + h], radius=int(w * 0.5), fill=shirt)
    draw.rectangle([cx - w * 0.18, top - 4, cx + w * 0.18, top + 6], fill=shade(tone, 0.92))  # neck


def figure(draw, cx, base_y, s, tone, shirt, shorts, rng):
    """Whole-body cartoon figure, clothed; s is a scale (head radius)."""
    hair = rng.choice(HAIR)
    legs_top = base_y - s * 3.0
    for sx in (-1, 1):
        draw.rectangle([cx + sx * s * 0.45 - s * 0.28, legs_top, cx + sx * s * 0.45 + s * 0.28, base_y], fill=tone)
    draw.rectangle([cx - s * 0.95, legs_top - s * 0.9, cx + s * 0.95, legs_top + s * 0.55], fill=shorts)
    torso_top = legs_top - s * 2.5
    draw.rounded_rectangle([cx - s * 0.95, torso_top, cx + s * 0.95, legs_top - s * 0.7], radius=int(s * 0.4), fill=shirt)
    for sx in (-1, 1):
        draw.line([(cx + sx * s * 0.95, torso_top + s * 0.4), (cx + sx * s * 1.6, torso_top + s * 1.9)], fill=tone, width=max(2, int(s * 0.5)))
    head(draw, cx, torso_top - s * 0.9, s, tone, hair, rng)


def speckle(img, rng, n, palette_shift=10):
    px = img.load()
    for _ in range(n):
        x, y = rng.randrange(SIZE), rng.randrange(SIZE)
        r, g, b = px[x, y]
        d = rng.randint(-palette_shift, palette_shift)
        px[x, y] = (max(0, min(255, r + d)), max(0, min(255, g + d)), max(0, min(255, b + d)))


def new_canvas():
    img = Image.new("RGB", (SIZE, SIZE), (255, 255, 255))
    return img, ImageDraw.Draw(img)


def make_skin(i, rng):
    tone = TONES[(i - 1) % len(TONES)]
    img, d = new_canvas()
    gradient(d, lerp((200, 220, 240), (240, 240, 235), rng.random()), (235, 235, 230))
    cx = SIZE // 2 + rng.randint(-8, 8)
    shoulders(d, cx, 150, 80, 90, rng.choice(SHIRTS), tone)
    head(d, cx, 98, 58, tone, rng.choice(HAIR), rng, smile=rng.random() < 0.8)
    # soft cheek shading ellipses
    for sx in (-1, 1):
        d.ellipse([cx + sx * 34 - 12, 110, cx + sx * 34 + 12, 126], outline=shade(tone, 0.9))
    speckle(img, rng, 1200)
    return img


def make_beach(i, rng):
    img, d = new_canvas()
    horizon = 95 + rng.randint(-10, 10)
    gradient(d, (110, 175, 235), (200, 230, 250), 0, horizon)
    gradient(d, (30, 120, 180), (80, 175, 200), horizon, horizon + 40)
    gradient(d, (235, 215, 160), (215, 190, 130), horizon + 40, SIZE)
    sx, sy = rng.randint(30, 190), rng.randint(20, 50)
    d.ellipse([sx - 16, sy - 16, sx + 16, sy + 16], fill=(255, 235, 120))
    for k in range(5):  # wave lines
        wy = horizon + 6 + k * 8
        for wx in range(rng.randint(0, 20), SIZE, 30):
            d.arc([wx, wy, wx + 20, wy + 8], 200, 340, fill=(235, 245, 250), width=1)
    # umbrella
    ux = rng.randint(30, 80)
    d.line([(ux, 120), (ux + 6, 190)], fill=(90, 60, 40), width=3)
    d.pieslice([ux - 34, 90, ux + 40, 150], 180, 360, fill=rng.choice(SHIRTS[:5]))
    # one or two figures
    for k in range(1 + (i % 2)):
        tone = TONES[(i * 3 + k * 5) % len(TONES)]
        figure(d, 120 + k * 60 + rng.randint(-6, 6), 215, 13 + rng.randint(0, 2), tone, rng.choice(SHIRTS), rng.choice(SHIRTS), rng)
    speckle(img, rng, 1500)
    return img


def make_sports(i, rng):
    img, d = new_canvas()
    kind = i % 3
    if kind == 1:  # basketball court
        d.rectangle([0, 0, SIZE, SIZE], fill=(196, 140, 82))
        for x in range(0, SIZE, 14):
            d.line([(x, 0), (x, SIZE)], fill=(180, 125, 72))
        d.rectangle([20, 150, 204, 214], outline=(255, 255, 255), width=3)
        d.arc([62, 110, 162, 190], 180, 360, fill=(255, 255, 255), width=3)
        d.line([(112, 30), (112, 60)], fill=(70, 70, 70), width=4)
        d.rectangle([92, 20, 132, 44], outline=(255, 255, 255), fill=(245, 245, 245), width=2)
        d.ellipse([102, 46, 122, 54], outline=(230, 90, 30), width=3)
        ball = (225, 110, 40)
    elif kind == 2:  # football pitch
        for y in range(0, SIZE, 28):
            d.rectangle([0, y, SIZE, y + 14], fill=(60, 150, 70))
            d.rectangle([0, y + 14, SIZE, y + 28], fill=(70, 165, 80))
        d.rectangle([10, 10, 214, 214], outline=(255, 255, 255), width=3)
        d.line([(10, 112), (214, 112)], fill=(255, 255, 255), width=3)
        d.ellipse([82, 82, 142, 142], outline=(255, 255, 255), width=3)
        ball = (250, 250, 250)
    else:  # running track
        d.rectangle([0, 0, SIZE, SIZE], fill=(190, 85, 60))
        for y in range(30, SIZE, 38):
            d.line([(0, y), (SIZE, y)], fill=(245, 245, 245), width=3)
        d.rectangle([0, 0, SIZE, 20], fill=(70, 150, 75))
        ball = None
    team_a, team_b = rng.sample(SHIRTS[:6], 2)
    for k in range(2 + (i % 2)):
        tone = TONES[(i * 5 + k * 4) % len(TONES)]
        shirt = team_a if k % 2 == 0 else team_b
        figure(d, 55 + k * 55 + rng.randint(-8, 8), 205 - rng.randint(0, 25), 12 + rng.randint(0, 3), tone, shirt, shade(shirt, 0.6), rng)
    if ball:
        bx, by = rng.randint(70, 160), rng.randint(70, 130)
        d.ellipse([bx - 9, by - 9, bx + 9, by + 9], fill=ball, outline=(40, 40, 40))
    speckle(img, rng, 1500)
    return img


def make_drawing(i, rng):
    img, d = new_canvas()  # white paper, black ink
    ink = (25, 25, 30)
    kind = i % 3
    if kind == 1:  # house and tree
        d.rectangle([50, 110, 130, 190], outline=ink, width=2)
        d.polygon([(40, 112), (90, 65), (140, 112)], outline=ink)
        d.rectangle([80, 145, 105, 190], outline=ink, width=2)
        d.rectangle([60, 125, 75, 140], outline=ink, width=2)
        d.line([(170, 190), (170, 140)], fill=ink, width=3)
        d.ellipse([145, 90, 195, 145], outline=ink, width=2)
    elif kind == 2:  # geometric doodle
        cx, cy = SIZE // 2, SIZE // 2
        for k in range(1, 8):
            r = k * 13
            pts = [(cx + r * math.cos(2 * math.pi * j / (3 + k % 4)), cy + r * math.sin(2 * math.pi * j / (3 + k % 4))) for j in range(3 + k % 4)]
            d.polygon(pts, outline=ink)
    else:  # scribbled landscape
        for _ in range(7):
            x, y = rng.randint(10, 60), rng.randint(60, 190)
            pts = [(x, y)]
            for _ in range(9):
                x += rng.randint(8, 24)
                y += rng.randint(-22, 22)
                pts.append((min(SIZE - 4, x), max(4, min(SIZE - 4, y))))
            d.line(pts, fill=ink, width=2)
        d.ellipse([160, 20, 200, 60], outline=ink, width=2)
    # a simple stick figure on every drawing
    fx = rng.randint(150, 195)
    d.ellipse([fx - 8, 148, fx + 8, 164], outline=ink, width=2)
    d.line([(fx, 164), (fx, 196)], fill=ink, width=2)
    d.line([(fx - 14, 176), (fx + 14, 176)], fill=ink, width=2)
    d.line([(fx, 196), (fx - 10, 218)], fill=ink, width=2)
    d.line([(fx, 196), (fx + 10, 218)], fill=ink, width=2)
    return img


def make_selfie(i, rng):
    tone = TONES[(i * 7 + 2) % len(TONES)]
    img, d = new_canvas()
    gradient(d, rng.choice([(90, 110, 140), (140, 120, 100), (110, 140, 120)]), (190, 190, 195))
    for k in range(rng.randint(2, 4)):  # blurry background shapes
        x, y = rng.randint(0, 180), rng.randint(0, 100)
        d.rectangle([x, y, x + rng.randint(20, 50), y + rng.randint(30, 70)], fill=lerp((120, 120, 130), (200, 200, 205), rng.random()))
    cx = SIZE // 2 + rng.randint(-20, 20)
    shoulders(d, cx, 165, 95, 80, rng.choice(SHIRTS), tone)
    head(d, cx, 105, 66, tone, rng.choice(HAIR), rng)
    # raised arm holding a phone
    d.line([(cx + 95, 190), (cx + 100, 120)], fill=tone, width=14)
    d.rounded_rectangle([cx + 82, 60, cx + 120, 125], radius=6, fill=(30, 30, 35))
    speckle(img, rng, 1200)
    return img


def make_group(i, rng):
    img, d = new_canvas()
    gradient(d, (210, 225, 240), (230, 225, 210))
    n = 4 + (i % 3)
    rows = [(0, 72), (1, 150)]
    people = []
    for k in range(n):
        row = 0 if k < n // 2 else 1
        people.append(row)
    placed = {0: 0, 1: 0}
    counts = {0: people.count(0), 1: people.count(1)}
    for k, row in enumerate(people):
        slot = placed[row]
        placed[row] += 1
        spacing = SIZE / (counts[row] + 1)
        cx = int(spacing * (slot + 1)) + rng.randint(-6, 6)
        cy = 70 if row == 0 else 135
        r = 24 if row == 0 else 30
        tone = TONES[(i * 2 + k * 5) % len(TONES)]
        shoulders(d, cx, cy + r * 0.9, r * 1.5, 80, rng.choice(SHIRTS), tone)
        head(d, cx, cy, r, tone, rng.choice(HAIR), rng)
    speckle(img, rng, 1200)
    return img


MAKERS = {
    "skin": make_skin,
    "beach": make_beach,
    "sports": make_sports,
    "drawing": make_drawing,
    "selfie": make_selfie,
    "group": make_group,
}


def generate(out_dir):
    out_dir = Path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    written = []
    for category in CATEGORIES:
        for i in range(1, PER_CATEGORY + 1):
            # One independent, seeded stream per file keeps files stable if the set grows.
            rng = random.Random(f"{SEED}:{category}:{i}")
            img = MAKERS[category](i, rng)
            path = out_dir / f"{category}_{i:02d}.png"
            img.save(path, format="PNG", optimize=False, compress_level=9)
            written.append(path)
    return written


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("--out", default=str(Path(__file__).resolve().parent / "benign"), help="output folder")
    args = parser.parse_args(argv)
    files = generate(args.out)
    print(f"wrote {len(files)} files to {args.out}")


if __name__ == "__main__":
    main()
