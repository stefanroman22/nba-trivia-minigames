from django.test import TestCase
from django.urls import reverse

from trivia.games.heatmap import build_pool, validate_rows
from trivia.games.heatmap_criteria import ROW_WIDTHS


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
