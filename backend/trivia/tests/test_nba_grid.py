"""NBA Grid backend: seed shape validation + rarity tally aggregation."""
from django.test import TestCase
from django.urls import reverse

from trivia.games.nba_grid import _load_seed, validate_rows
from trivia.models import GuessLog


class NbaGridSeedTests(TestCase):
    def test_bundled_seed_is_valid(self):
        seed = _load_seed()
        self.assertEqual(len(seed), 12)
        self.assertEqual(validate_rows(seed), [])

    def test_round_serves_one_config(self):
        res = self.client.get(reverse("nba-grid"))
        self.assertEqual(res.status_code, 200)
        series = res.json()["series"]
        self.assertEqual(len(series), 1)
        cfg = series[0]
        self.assertTrue(cfg["qid"])
        self.assertEqual(len(cfg["rows"]), 3)
        self.assertEqual(len(cfg["cols"]), 3)

    def test_validate_rows_flags_bad_shapes(self):
        bad = [{"qid": "x", "rows": [{"type": "team", "value": "LAL", "label": "L"}], "cols": []}]
        self.assertTrue(validate_rows(bad))
        dupe = _load_seed()[:1] + _load_seed()[:1]
        self.assertTrue(any("duplicate" in p for p in validate_rows(dupe)))


class NbaGridTallyTests(TestCase):
    def _log(self, question_id, answer, correct):
        GuessLog.objects.create(
            game="nba-grid", question_id=question_id, answer=answer, correct=correct
        )

    def test_tally_counts_only_correct_picks_per_cell(self):
        self._log("grid-001:r0c0", "LeBron James", True)
        self._log("grid-001:r0c0", "LeBron James", True)
        self._log("grid-001:r0c0", "Kobe Bryant", True)
        self._log("grid-001:r0c0", "Wrong Guy", False)  # ignored (not a pick)
        self._log("grid-001:r1c2", "Stephen Curry", True)
        self._log("grid-002:r0c0", "Tim Duncan", True)  # different grid, excluded

        res = self.client.get(reverse("nba-grid-tally"), {"qid": "grid-001"})
        self.assertEqual(res.status_code, 200)
        self.assertEqual(
            res.json(),
            {
                "r0c0": {"LeBron James": 2, "Kobe Bryant": 1},
                "r1c2": {"Stephen Curry": 1},
            },
        )

    def test_tally_requires_qid(self):
        res = self.client.get(reverse("nba-grid-tally"))
        self.assertEqual(res.status_code, 400)

    def test_tally_empty_when_no_guesses(self):
        res = self.client.get(reverse("nba-grid-tally"), {"qid": "grid-005"})
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.json(), {})
