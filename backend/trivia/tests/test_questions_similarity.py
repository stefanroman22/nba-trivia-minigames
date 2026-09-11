# backend/trivia/tests/test_questions_similarity.py
import json
import os

from django.test import SimpleTestCase

from trivia.questions.similarity import rank_pool, similarity
from trivia.tests.questions_fixture import fixture_dataset

GOLDEN = os.path.join(os.path.dirname(__file__), "fixtures", "contexto_golden.json")


class SimilarityTests(SimpleTestCase):
    def test_self_similarity_is_100(self):
        ds = fixture_dataset()
        p = ds.playable[0]
        self.assertAlmostEqual(similarity(p, p, 2026), 100.0, places=6)

    def test_ranking_matches_typescript_golden(self):
        with open(GOLDEN, encoding="utf-8") as f:
            golden = json.load(f)
        ds = fixture_dataset()
        secret = ds.by_id[golden["secret_person_id"]]
        ranking = rank_pool(secret, ds.playable, golden["current_year"])
        self.assertEqual(ranking[0], (secret["person_id"], 1))
        self.assertEqual([list(r) for r in ranking[:40]], golden["top"])
        self.assertEqual(len(ranking), len(ds.playable))
