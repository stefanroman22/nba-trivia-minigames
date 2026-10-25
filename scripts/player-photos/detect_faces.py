"""Detect the face in every Commons player photo that faces.json doesn't cover yet.

    py -3.11 scripts/player-photos/detect_faces.py [--per-sheet 48]   (needs: pip install opencv-python numpy)

Reads public/photos/player-photos.json (so run build.mjs first), downloads each new photo's 500px
thumbnail, finds the largest face with OpenCV's YuNet detector and adds it to faces.json as
{file, aspect, box: [x, y, w, h] | null} (fractions of the image). It also writes review sheets
faces-review-01.png, faces-review-02.png, ... next to this script, --per-sheet photos each: look at
every one, and for a wrong or missing box either set "box" by hand (and "manual": true) or exclude
the player in commons-extra.json (apply_review.py does both from review/*.json). Then run build.mjs
again. Entries marked "manual" are never overwritten.
"""
import argparse, json, os, sys, time, urllib.parse, urllib.request

import cv2
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
MAP = os.path.join(ROOT, "public", "photos", "player-photos.json")
FACES = os.path.join(HERE, "faces.json")
MODEL_URL = "https://github.com/opencv/opencv_zoo/raw/main/models/face_detection_yunet/face_detection_yunet_2023mar.onnx"
CACHE = os.path.join(os.path.expanduser("~"), ".cache", "swishquest-photos")
UA = {"User-Agent": "SwishQuest-photo-faces/1.0 (https://swishquest.com; stefanromanpers@gmail.com)"}


def fetch(url, tries=4):
    for i in range(tries):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=60) as r:
                return r.read()
        except Exception:
            if i == tries - 1:
                raise
            time.sleep(30)  # upload.wikimedia.org rate-limits bursts (HTTP 429)


def thumb_url(path, width):
    d, f = path.rsplit("/", 1)
    n = urllib.parse.quote(f)
    base = "https://upload.wikimedia.org/wikipedia/commons"
    return f"{base}/{d}/{n}" if width <= 500 else f"{base}/thumb/{d}/{n}/500px-{n}"


def detect(img, det, thr):
    """Largest face (x, y, w, h in px) at score >= thr; small images are upscaled 2x first."""
    h, w = img.shape[:2]
    for scale in ([2.0] if max(w, h) < 400 else [1.0, 2.0]):
        im = cv2.resize(img, None, fx=scale, fy=scale, interpolation=cv2.INTER_CUBIC) if scale != 1 else img
        det.setInputSize((im.shape[1], im.shape[0]))
        det.setScoreThreshold(thr)
        _, fs = det.detect(im)
        if fs is not None and len(fs):
            r = max(fs, key=lambda r: r[2] * r[3] * r[14])
            return [float(r[0]) / scale, float(r[1]) / scale, float(r[2]) / scale, float(r[3]) / scale]
    return None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--per-sheet", type=int, default=48, help="photos per review sheet (8 rows of 6)")
    per_sheet = ap.parse_args().per_sheet
    os.makedirs(CACHE, exist_ok=True)
    model = os.path.join(CACHE, "yunet.onnx")
    if not os.path.exists(model):
        open(model, "wb").write(fetch(MODEL_URL))
    det = cv2.FaceDetectorYN.create(model, "", (320, 320), 0.6, 0.3, 5000)
    pm = json.load(open(MAP, encoding="utf-8"))
    faces = json.load(open(FACES, encoding="utf-8")) if os.path.exists(FACES) else {}
    todo = []
    for pid, entry in pm["commons"].items():
        file = entry[0].rsplit("/", 1)[1]
        cur = faces.get(pid)
        if cur and (cur.get("manual") or cur.get("file") == file):
            continue
        todo.append((pid, entry, file))
    print(f"{len(todo)} photos to analyse")
    done = []
    for pid, entry, file in todo:
        data = fetch(thumb_url(entry[0], entry[1]))
        time.sleep(1)
        img = cv2.imdecode(np.frombuffer(data, np.uint8), cv2.IMREAD_COLOR)
        if img is None:
            print("  unreadable:", pid, file)
            continue
        h, w = img.shape[:2]
        box = detect(img, det, 0.6)
        if box is None:  # faint scans: retry with contrast boosted
            g = cv2.createCLAHE(2.0, (8, 8)).apply(cv2.cvtColor(img, cv2.COLOR_BGR2GRAY))
            box = detect(cv2.cvtColor(g, cv2.COLOR_GRAY2BGR), det, 0.4)
        faces[pid] = {"file": file, "aspect": round(h / w, 4),
                      "box": None if box is None else [round(box[0] / w, 4), round(box[1] / h, 4), round(box[2] / w, 4), round(box[3] / h, 4)]}
        done.append((pid, img, faces[pid]["box"]))
        print(f"  {pid} {file}: {'face' if box else 'NO FACE'}")
    tmp = FACES + ".tmp"  # write then swap, so a crash never leaves a truncated faces.json
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(dict(sorted(faces.items(), key=lambda kv: int(kv[0]))), f, ensure_ascii=False, indent=0)
    os.replace(tmp, FACES)
    # Review sheets: every new photo with its box (orange) — check each one.
    cw, ch, cols = 220, 240, 6
    groups = [done[i:i + per_sheet] for i in range(0, len(done), per_sheet)]
    if groups:
        print(f"review sheets: {len(groups)} files, {per_sheet} photos each")
    for n, group in enumerate(groups, 1):
        rows = (len(group) + cols - 1) // cols
        sheet = np.full((rows * ch, cols * cw, 3), 24, np.uint8)
        for i, (pid, img, box) in enumerate(group):
            s = min((cw - 10) / img.shape[1], (ch - 30) / img.shape[0])
            t = cv2.resize(img, None, fx=s, fy=s)
            x, y = (i % cols) * cw + 5, (i // cols) * ch + 5
            sheet[y:y + t.shape[0], x:x + t.shape[1]] = t
            if box:
                p0 = (int(x + box[0] * t.shape[1]), int(y + box[1] * t.shape[0]))
                p1 = (int(x + (box[0] + box[2]) * t.shape[1]), int(y + (box[1] + box[3]) * t.shape[0]))
                cv2.rectangle(sheet, p0, p1, (0, 140, 255), 2)
            cv2.putText(sheet, pid + ("" if box else " NO FACE"), (x, y + ch - 12), cv2.FONT_HERSHEY_SIMPLEX, 0.45, (230, 230, 230), 1)
        path = os.path.join(HERE, f"faces-review-{n:02d}.png")
        cv2.imwrite(path, sheet)
        print(" ", path)


if __name__ == "__main__":
    sys.exit(main())
