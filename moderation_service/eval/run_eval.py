"""Evaluate the moderation classifier on a folder of images.

Layout of --dir:
    benign/   required, images that must never be blocked
    nsfw/     optional, images that must be blocked (precision/recall only when present)

Prints the false-block rate per threshold, precision/recall when nsfw/ exists, and
latency (the first classification is reported as "cold", the rest as "warm").
The decision score is max(nsfw, nsfl), the same rule the Django client applies.

The committed folder (moderation_service/eval, with benign/) is synthetic. For real
samples use a gitignored folder, e.g. moderation_service/eval/private/ with its own
benign/ and nsfw/ subfolders. Never commit explicit imagery.

Exit status 1 when --max-false-block is given and more benign images are blocked at
--block than allowed. `summarize` is pure stdlib so it can be unit tested without
onnxruntime; the classifier is imported lazily inside main().
"""
import argparse
import io
import os
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
SERVICE_ROOT = HERE.parent
IMAGE_SUFFIXES = {".png", ".jpg", ".jpeg", ".webp", ".bmp", ".gif"}
THRESHOLDS = (0.50, 0.70, 0.85, 0.95)
DEFAULT_CLASS_ORDER = "nsfw,nsfl,sfw"
JPEG_QUALITY = 82  # matches users.photos.normalize_profile_photo


def risk(scores):
    """Decision score for one image: the worse of nsfw and nsfl."""
    return max(float(scores["nsfw"]), float(scores["nsfl"]))


def percentile(values, pct):
    """Nearest-rank percentile of a list (0 for an empty list)."""
    if not values:
        return 0.0
    ordered = sorted(values)
    rank = max(1, min(len(ordered), int(-(-pct * len(ordered) // 100))))
    return ordered[rank - 1]


def category(name):
    """`sports_03.png` -> `sports`; names without an underscore are their own category."""
    return Path(name).stem.rsplit("_", 1)[0] if "_" in Path(name).stem else Path(name).stem


def summarize(benign, nsfw=None, thresholds=THRESHOLDS):
    """Pure metrics over lists of score dicts.

    benign / nsfw: lists of {"nsfw", "nsfl", "sfw"} (optionally with "name").
    Returns {"n_benign", "n_nsfw", "rows": [per-threshold dicts], "by_category": {...}}.
    Each row: threshold, false_blocks, false_block_rate, and, when nsfw is given,
    true_blocks, recall, precision (precision is None when nothing was blocked).
    A score at or above the threshold is blocked.
    """
    nsfw = nsfw or []
    benign_risk = [risk(s) for s in benign]
    nsfw_risk = [risk(s) for s in nsfw]
    rows = []
    for t in thresholds:
        fb = sum(1 for r in benign_risk if r >= t)
        row = {
            "threshold": t,
            "false_blocks": fb,
            "false_block_rate": fb / len(benign_risk) if benign_risk else 0.0,
        }
        if nsfw_risk:
            tb = sum(1 for r in nsfw_risk if r >= t)
            row["true_blocks"] = tb
            row["recall"] = tb / len(nsfw_risk)
            row["precision"] = tb / (tb + fb) if (tb + fb) else None
        rows.append(row)
    by_category = {}
    for s, r in zip(benign, benign_risk):
        if "name" not in s:
            continue
        entry = by_category.setdefault(category(s["name"]), {"n": 0, "max_risk": 0.0})
        entry["n"] += 1
        entry["max_risk"] = max(entry["max_risk"], r)
    return {
        "n_benign": len(benign_risk),
        "n_nsfw": len(nsfw_risk),
        "rows": rows,
        "by_category": by_category,
    }


def latency_stats(first_s, warm_s):
    """Seconds in, milliseconds out: cold = first call, warm p50/p95 over the rest."""
    return {
        "cold_ms": first_s * 1000.0,
        "warm_p50_ms": percentile(warm_s, 50) * 1000.0,
        "warm_p95_ms": percentile(warm_s, 95) * 1000.0,
        "warm_n": len(warm_s),
    }


def _pct(x):
    return "n/a" if x is None else f"{x * 100:.1f}%"


def format_report(summary, latency, block, review, model_version=None):
    """Markdown report (also readable as plain text)."""
    lines = ["## Moderation classifier evaluation", ""]
    if model_version:
        lines += [f"Model version: `{model_version}`", ""]
    lines += [f"Benign images: {summary['n_benign']}  |  NSFW images: {summary['n_nsfw']}", ""]
    has_nsfw = summary["n_nsfw"] > 0
    header = "| threshold | false blocks | false-block rate |"
    sep = "|---|---|---|"
    if has_nsfw:
        header += " recall | precision |"
        sep += "---|---|"
    lines += [header, sep]
    for row in summary["rows"]:
        line = f"| {row['threshold']:.2f} | {row['false_blocks']} | {_pct(row['false_block_rate'])} |"
        if has_nsfw:
            line += f" {_pct(row['recall'])} | {_pct(row['precision'])} |"
        lines.append(line)
    lines += ["", f"Configured block threshold {block:.2f}, review threshold {review:.2f}.", ""]
    if summary["by_category"]:
        lines += ["| benign category | images | max risk score |", "|---|---|---|"]
        for name, entry in sorted(summary["by_category"].items()):
            lines.append(f"| {name} | {entry['n']} | {entry['max_risk']:.3f} |")
        lines.append("")
    lines += [
        "| latency | ms |",
        "|---|---|",
        f"| cold (first call) | {latency['cold_ms']:.1f} |",
        f"| warm p50 (n={latency['warm_n']}) | {latency['warm_p50_ms']:.1f} |",
        f"| warm p95 | {latency['warm_p95_ms']:.1f} |",
        "",
    ]
    return "\n".join(lines)


def list_images(folder):
    folder = Path(folder)
    if not folder.is_dir():
        return []
    return sorted(p for p in folder.iterdir() if p.suffix.lower() in IMAGE_SUFFIXES)


def to_jpeg_bytes(path):
    """Re-encode to a JPEG like the Django upload path does, so the service sees real input."""
    from PIL import Image

    with Image.open(path) as im:
        im = im.convert("RGB")
        buf = io.BytesIO()
        im.save(buf, format="JPEG", quality=JPEG_QUALITY)
    return buf.getvalue()


def read_pinned_sha256(explicit):
    """--sha256, else MODERATION_MODEL_SHA256, else model/model.sha256 (first token)."""
    if explicit:
        return explicit
    env = os.environ.get("MODERATION_MODEL_SHA256")
    if env:
        return env.strip()
    pin = SERVICE_ROOT / "model" / "model.sha256"
    if pin.is_file():
        text = pin.read_text().strip()
        return text.split()[0] if text else "UNPINNED"
    return "UNPINNED"


def classify_all(session, class_order, paths, classifier):
    """Run every image through the session. Returns (scores, timings_seconds).

    Times classifier.classify(session, jpeg, class_order): preprocess + run + postprocess.
    """
    scores, timings = [], []
    for path in paths:
        jpeg = to_jpeg_bytes(path)
        started = time.perf_counter()
        result = classifier.classify(session, jpeg, class_order)
        timings.append(time.perf_counter() - started)
        scores.append({"name": path.name, "nsfw": result["nsfw"], "nsfl": result["nsfl"], "sfw": result["sfw"]})
    return scores, timings


def build_parser():
    p = argparse.ArgumentParser(description="Evaluate the moderation classifier on benign/ and nsfw/ folders.")
    p.add_argument("--dir", default=str(HERE), help="folder with benign/ (required) and nsfw/ (optional); default: the committed synthetic set")
    p.add_argument("--model", default=os.environ.get("MODERATION_MODEL_PATH") or str(SERVICE_ROOT / "model" / "image-safety-classifier-xs.onnx"), help="ONNX model path")
    p.add_argument("--sha256", default=None, help="expected model SHA-256 (default: MODERATION_MODEL_SHA256 or model/model.sha256)")
    p.add_argument("--block", type=float, default=float(os.environ.get("PHOTO_BLOCK_THRESHOLD", "0.85")), help="block threshold (default 0.85)")
    p.add_argument("--review", type=float, default=float(os.environ.get("PHOTO_REVIEW_THRESHOLD", "0.50")), help="review threshold (default 0.50)")
    p.add_argument("--class-order", default=os.environ.get("MODERATION_CLASS_ORDER", DEFAULT_CLASS_ORDER), help="model output class order")
    p.add_argument("--max-false-block", type=int, default=None, help="exit 1 if more than N benign images score >= --block")
    p.add_argument("--summary", default=None, help="append the markdown report to this file (e.g. $GITHUB_STEP_SUMMARY)")
    return p


def main(argv=None):
    args = build_parser().parse_args(argv)
    root = Path(args.dir)
    benign_paths = list_images(root / "benign")
    nsfw_paths = list_images(root / "nsfw")
    if not benign_paths:
        print(f"error: no images in {root / 'benign'} (a benign/ folder is required)", file=sys.stderr)
        return 2

    sys.path.insert(0, str(SERVICE_ROOT))
    import classifier  # lazy: needs numpy/onnxruntime, which summarize() does not

    expected = read_pinned_sha256(args.sha256)
    class_order = classifier.parse_class_order(args.class_order)
    load_started = time.perf_counter()
    try:
        session, digest = classifier.load_session(args.model, expected)
    except classifier.ModelUnavailable as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 2
    load_s = time.perf_counter() - load_started

    benign, benign_t = classify_all(session, class_order, benign_paths, classifier)
    nsfw, nsfw_t = ([], [])
    if nsfw_paths:
        nsfw, nsfw_t = classify_all(session, class_order, nsfw_paths, classifier)

    timings = benign_t + nsfw_t
    latency = latency_stats(timings[0], timings[1:])
    summary = summarize(benign, nsfw, thresholds=THRESHOLDS)
    report = format_report(summary, latency, args.block, args.review, model_version=digest[:12])
    report += f"\nModel load: {load_s * 1000:.0f} ms\n"
    print(report)

    if not nsfw_paths:
        print("note: no nsfw/ folder, precision and recall skipped (owner-run private check)")
    if args.summary:
        try:
            with open(args.summary, "a", encoding="utf-8") as fh:
                fh.write(report + "\n")
        except OSError as exc:
            print(f"warning: could not write summary file: {exc}", file=sys.stderr)

    blocked = [s["name"] for s in benign if risk(s) >= args.block]
    if blocked:
        print(f"benign images at or above block {args.block:.2f}: {', '.join(blocked)}")
    if args.max_false_block is not None and len(blocked) > args.max_false_block:
        print(f"FAIL: {len(blocked)} false blocks > allowed {args.max_false_block}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
