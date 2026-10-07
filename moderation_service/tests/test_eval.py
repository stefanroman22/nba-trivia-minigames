"""Unit tests for eval/run_eval.py summarize() and helpers.

Stdlib only: run_eval imports the classifier lazily, so neither numpy nor
onnxruntime is needed. Run from the repo root:
    python -m unittest discover -s moderation_service/tests
"""
import importlib.util
import unittest
from pathlib import Path

_PATH = Path(__file__).resolve().parents[1] / "eval" / "run_eval.py"
_spec = importlib.util.spec_from_file_location("run_eval", _PATH)
run_eval = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(run_eval)


def s(nsfw=0.0, nsfl=0.0, name=None):
    d = {"nsfw": nsfw, "nsfl": nsfl, "sfw": max(0.0, 1.0 - nsfw - nsfl)}
    if name:
        d["name"] = name
    return d


class SummarizeTests(unittest.TestCase):
    def test_false_block_rates_per_threshold(self):
        benign = [s(0.10), s(0.55), s(0.72), s(0.86), s(nsfl=0.96)]
        out = run_eval.summarize(benign)
        rates = {r["threshold"]: (r["false_blocks"], r["false_block_rate"]) for r in out["rows"]}
        self.assertEqual(out["n_benign"], 5)
        self.assertEqual(rates[0.50], (4, 0.8))
        self.assertEqual(rates[0.70], (3, 0.6))
        self.assertEqual(rates[0.85], (2, 0.4))
        self.assertEqual(rates[0.95], (1, 0.2))
        self.assertNotIn("recall", out["rows"][0])

    def test_threshold_is_inclusive(self):
        out = run_eval.summarize([s(0.85)], thresholds=(0.85,))
        self.assertEqual(out["rows"][0]["false_blocks"], 1)

    def test_nsfl_counts_toward_risk(self):
        self.assertEqual(run_eval.risk(s(nsfw=0.1, nsfl=0.9)), 0.9)

    def test_precision_and_recall_with_nsfw_set(self):
        benign = [s(0.1), s(0.9)]
        nsfw = [s(0.99), s(0.80), s(nsfl=0.95), s(0.2)]
        out = run_eval.summarize(benign, nsfw, thresholds=(0.85,))
        row = out["rows"][0]
        self.assertEqual(row["true_blocks"], 2)
        self.assertEqual(row["recall"], 0.5)
        self.assertAlmostEqual(row["precision"], 2 / 3)

    def test_precision_none_when_nothing_blocked(self):
        out = run_eval.summarize([s(0.1)], [s(0.2)], thresholds=(0.85,))
        self.assertIsNone(out["rows"][0]["precision"])
        self.assertEqual(out["rows"][0]["recall"], 0.0)

    def test_empty_benign_is_zero_rate(self):
        out = run_eval.summarize([])
        self.assertTrue(all(r["false_block_rate"] == 0.0 for r in out["rows"]))

    def test_by_category_uses_name_prefix(self):
        benign = [s(0.1, name="sports_01.png"), s(0.4, name="sports_02.png"), s(0.2, name="beach_01.png")]
        cats = run_eval.summarize(benign)["by_category"]
        self.assertEqual(cats["sports"], {"n": 2, "max_risk": 0.4})
        self.assertEqual(cats["beach"]["n"], 1)


class HelperTests(unittest.TestCase):
    def test_percentile_nearest_rank(self):
        values = list(range(1, 101))
        self.assertEqual(run_eval.percentile(values, 50), 50)
        self.assertEqual(run_eval.percentile(values, 95), 95)
        self.assertEqual(run_eval.percentile([], 95), 0.0)
        self.assertEqual(run_eval.percentile([7], 95), 7)

    def test_latency_stats_cold_and_warm(self):
        out = run_eval.latency_stats(0.5, [0.01, 0.02, 0.03, 0.04])
        self.assertEqual(out["cold_ms"], 500.0)
        self.assertEqual(out["warm_n"], 4)
        self.assertAlmostEqual(out["warm_p50_ms"], 20.0)

    def test_report_mentions_each_threshold(self):
        summary = run_eval.summarize([s(0.1)])
        latency = run_eval.latency_stats(0.1, [0.01])
        text = run_eval.format_report(summary, latency, 0.85, 0.50)
        for t in ("0.50", "0.70", "0.85", "0.95"):
            self.assertIn(f"| {t} |", text)


if __name__ == "__main__":
    unittest.main()
