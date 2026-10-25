"""Merge the review verdicts on the faces-review sheets into commons-extra.json and faces.json.

    python scripts/player-photos/apply_review.py

Reads every review/*.json next to this script (git-ignored), one per reviewed sheet:
    {"sheet": "faces-review-03.png", "exclude": {"<pid>": "<reason>"}, "box": {"<pid>": [x, y, w, h]}}
An exclusion becomes {"exclude": true, "reason": "photo review <today>: <reason>"} in commons-extra.json
(replacing any hand find for that player); a box replaces the detector's in faces.json (fractions of the
image) and is marked "manual", so detect_faces.py never overwrites it. A box for a player faces.json
doesn't have is an error and nothing is written. Then run build.mjs again.
"""
import glob, json, os, sys
from datetime import date

HERE = os.path.dirname(os.path.abspath(__file__))


def _load(path):
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def _save(path, data, indent):
    tmp = path + ".tmp"  # write then swap, so a crash never leaves a truncated file
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=indent)
    os.replace(tmp, path)


def apply(review_dir, extra_path, faces_path, today):
    """Apply every review file in review_dir; returns (players excluded, boxes set)."""
    extra, faces = _load(extra_path), _load(faces_path)
    excluded = boxed = 0
    for path in sorted(glob.glob(os.path.join(review_dir, "*.json"))):
        review = _load(path)
        for pid, reason in review.get("exclude", {}).items():
            extra[pid] = {"exclude": True, "reason": f"photo review {today}: {reason}"}
            excluded += 1
        for pid, box in review.get("box", {}).items():
            if pid not in faces:
                raise ValueError(f"{os.path.basename(path)}: player {pid} has no faces.json entry to correct")
            faces[pid] = {**faces[pid], "box": [round(v, 4) for v in box], "manual": True}
            boxed += 1
    _save(extra_path, extra, 1)
    _save(faces_path, dict(sorted(faces.items(), key=lambda kv: int(kv[0]))), 0)
    return excluded, boxed


def main():
    excluded, boxed = apply(os.path.join(HERE, "review"), os.path.join(HERE, "commons-extra.json"),
                            os.path.join(HERE, "faces.json"), date.today().isoformat())
    print(f"applied: {excluded} excluded, {boxed} boxes set")


if __name__ == "__main__":
    sys.exit(main())
