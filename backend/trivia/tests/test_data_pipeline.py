import json
import os
import tempfile
from django.test import TestCase
from trivia.data_pipeline.manifest import build_manifest, sha256_file
from trivia.data_pipeline.validate import validate_pool


class ManifestTests(TestCase):
    def test_build_manifest_lists_games_with_hash_and_count(self):
        with tempfile.TemporaryDirectory() as d:
            with open(os.path.join(d, "wordle.json"), "w", encoding="utf-8") as f:
                json.dump(["jones", "smith"], f)
            with open(os.path.join(d, "manifest.json"), "w", encoding="utf-8") as f:
                json.dump({"stale": True}, f)
            m = build_manifest(d, "2026-06-21")
            self.assertEqual(m["version"], "2026-06-21")
            self.assertIn("wordle", m["games"])
            self.assertEqual(m["games"]["wordle"]["count"], 2)
            self.assertEqual(m["games"]["wordle"]["file"], "wordle.json")
            self.assertEqual(len(m["games"]["wordle"]["sha256"]), 64)
            self.assertNotIn("manifest", m["games"])  # manifest.json excluded


class ValidateTests(TestCase):
    def test_empty_pool_is_a_problem(self):
        self.assertTrue(validate_pool("wordle", []))

    def test_non_list_is_a_problem(self):
        self.assertTrue(validate_pool("wordle", {"x": 1}))

    def test_starting_five_requires_keys(self):
        self.assertTrue(validate_pool("starting-five", [{"game_id": "1"}]))
        self.assertFalse(
            validate_pool("starting-five", [{"game_id": "1", "starting_5": []}])
        )

    def test_good_wordle_pool_has_no_problems(self):
        self.assertEqual(validate_pool("wordle", ["jones"]), [])


class ReconstructRoundsTests(TestCase):
    """Bracket reconstruction — trivia.data_pipeline.sources._reconstruct_rounds."""

    NYK, BOS, SYR = 1610612752, 1610612738, 1610612755
    MNL, ROC, FTW = 1610612747, 1610612758, 1610612765

    def _series(self, winner_id, loser_id, latest):
        return {"teams": frozenset((winner_id, loser_id)), "winner_id": winner_id,
                "loser_id": loser_id, "latest": latest}

    def _round_robin_1953_54(self):
        """The 1953-54 postseason as the playoff game log hands it to the fetcher.

        Each division's three qualifiers played a round robin and the two
        survivors then met in the division final, so matchups-by-team-pair give
        New York (0-4 in the East) and Ft. Wayne (0-4 in the West) two losses
        each. Only the ordering of `latest` matters to the algorithm.
        """
        return [
            self._series(self.BOS, self.NYK, "1954-03-20"),  # East round robin
            self._series(self.ROC, self.FTW, "1954-03-19"),  # West round robin
            self._series(self.SYR, self.BOS, "1954-03-24"),  # East round robin + division final
            self._series(self.MNL, self.ROC, "1954-03-23"),  # West round robin + division final
            self._series(self.MNL, self.FTW, "1954-03-21"),  # West round robin
            self._series(self.SYR, self.NYK, "1954-03-21"),  # East round robin
            self._series(self.MNL, self.SYR, "1954-04-12"),  # NBA Finals
        ]

    def _bracket(self, teams, day=0, per_round=15):
        """A single-elimination bracket over `teams` (a power of two); top seed wins."""
        out, alive = [], list(teams)
        while len(alive) > 1:
            half = len(alive) // 2
            for a, b in zip(alive[:half], reversed(alive[half:])):
                out.append(self._series(a, b, f"2024-{day // 30 + 4:02d}-{day % 30 + 1:02d}"))
            alive, day = alive[:half], day + per_round
        return out

    def test_1953_54_round_robin_is_not_labelled_a_knockout_round(self):
        from trivia.data_pipeline.sources import _reconstruct_rounds

        rounds = _reconstruct_rounds(self._round_robin_1953_54(), "1953-54")
        self.assertEqual(rounds[6], "NBA Finals")
        self.assertEqual(rounds[2], "Conference Finals")  # Syracuse over Boston
        self.assertEqual(rounds[3], "Conference Finals")  # Minneapolis over Rochester
        for i in (0, 1, 4, 5):
            self.assertEqual(rounds[i], "Division Round Robin")

    def test_1953_54_no_team_loses_twice_in_one_knockout_round(self):
        from trivia.data_pipeline.sources import _reconstruct_rounds

        s = self._round_robin_1953_54()
        rounds = _reconstruct_rounds(s, "1953-54")
        seen = set()
        for i, ser in enumerate(s):
            if rounds[i] == "Division Round Robin":
                continue  # a round robin is not single elimination — two losses are legal there
            key = (rounds[i], ser["loser_id"])
            self.assertNotIn(key, seen, f"{ser['loser_id']} loses twice in {rounds[i]}")
            seen.add(key)

    def test_modern_bracket_still_gets_the_four_standard_labels(self):
        from trivia.data_pipeline.sources import _reconstruct_rounds

        conference = ["First Round"] * 4 + ["Conference Semifinals"] * 2 + ["Conference Finals"]
        s = self._bracket(range(1, 9)) + self._bracket(range(9, 17))
        s.append(self._series(1, 9, "2024-06-17"))
        rounds = _reconstruct_rounds(s, "2023-24")
        self.assertEqual([rounds[i] for i in range(len(s))],
                         conference + conference + ["NBA Finals"])
