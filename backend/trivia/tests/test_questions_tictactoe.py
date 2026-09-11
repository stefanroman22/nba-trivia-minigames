import random

from django.test import SimpleTestCase

from trivia.questions.base import Invalid
from trivia.questions.games import tictactoe as ttt
from trivia.tests.questions_fixture import fixture_dataset


class TicTacToeQuestionTests(SimpleTestCase):
    def test_seed_boards_load(self):
        seeds = ttt.seed_definitions()
        self.assertGreaterEqual(len(seeds), 8)
        self.assertEqual(set(seeds[0]), {"rows", "cols"})

    def test_generate_produces_solvable_bounded_boards(self):
        ds = fixture_dataset()
        defs = ttt.generate(ds, set(), random.Random(3), 3)
        self.assertEqual(len(defs), 3)
        for d in defs:
            m = ttt.materialize(d, ds)
            self.assertEqual(len(m["valid"]), 9)
            for cell in m["valid"]:
                self.assertTrue(ttt.MIN_VALID <= len(cell) <= ttt.MAX_VALID, len(cell))
            self.assertEqual(ttt.validate(m), [])
            self.assertEqual(sorted(set(ttt.players_referenced(d, m))), sorted({pid for cell in m["valid"] for pid in cell}))

    def test_materialize_rejects_unsolvable_cell(self):
        ds = fixture_dataset()
        d = {"rows": [{"type": "team", "value": "ZZZ", "label": "Nobody"}] * 3,
             "cols": [{"type": "award", "value": "mvp", "label": "Won MVP"}] * 3}
        with self.assertRaises(Invalid):
            ttt.materialize(d, ds)

    def test_qid(self):
        self.assertEqual(ttt.qid_for({}, 42), "ttt-0042")
