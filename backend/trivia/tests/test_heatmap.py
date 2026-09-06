import copy

from django.test import TestCase
from django.urls import reverse

from trivia.games import heatmap_validate
from trivia.games.heatmap import build_pool, validate_rows
from trivia.games.heatmap_criteria import ROW_WIDTHS, load_curated


class HeatmapEndpointTests(TestCase):
    def test_get_round_serves_one_valid_board(self):
        res = self.client.get(reverse("heatmap"))
        self.assertEqual(res.status_code, 200)
        series = res.json()["series"]
        self.assertEqual(len(series), 1)
        board = series[0]
        self.assertTrue(board["qid"])
        self.assertEqual(len(board["hexes"]), sum(ROW_WIDTHS))

    def test_bundled_seed_passes_structural_validation(self):
        self.assertEqual(validate_rows(build_pool()), [])

    def test_seed_has_six_boards(self):
        self.assertEqual(len(build_pool()), 6)


class HeatmapSeedValidatorTests(TestCase):
    """The standalone seed validator (solvability + criteria variety)."""

    def setUp(self):
        self.boards = build_pool()
        self.players = load_curated()

    def test_every_shipped_board_is_solvable_and_varied(self):
        self.assertEqual(heatmap_validate.validate_seed(self.boards, self.players), [])

    def test_shipped_set_uses_team_hexes_so_the_logo_path_is_live(self):
        # The pre-2026-09-06 seeds used 4 criteria of 3 types and no team hexes,
        # which left the renderer's team-logo branch permanently unreachable.
        teams = [
            h["criterion"]["value"]
            for b in self.boards
            for h in b["hexes"]
            if h["criterion"]["type"] == "team"
        ]
        self.assertGreaterEqual(len(set(teams)), heatmap_validate.MIN_FRANCHISES_IN_SET)

    def test_variety_check_rejects_a_single_criterion_board_set(self):
        # Solvable (every hex the same criterion) but unplayable — the exact
        # failure mode the variety floors exist to catch.
        flat = copy.deepcopy(self.boards)
        crit = {"type": "country", "value": "USA", "label": "USA-born"}
        for b in flat:
            for h in b["hexes"]:
                h["criterion"] = dict(crit)
        problems = heatmap_validate.validate_seed(flat, self.players)
        self.assertTrue(problems)
        self.assertTrue(all("UNSOLVABLE" not in p for p in problems))
        self.assertTrue(any("team hexes" in p for p in problems))
