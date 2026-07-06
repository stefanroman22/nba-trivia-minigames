"""Tests for the LeContexto backend module."""
import json
from django.test import TestCase

from trivia.games import contexto


class ContextoModuleTests(TestCase):
    def test_get_round_returns_int_secret(self):
        resp = contexto.get_round(request=None)
        self.assertEqual(resp.status_code, 200)
        body = json.loads(resp.content)
        self.assertIn("series", body)
        self.assertEqual(len(body["series"]), 1)
        self.assertIsInstance(body["series"][0]["secret"], int)

    def test_get_round_is_stable_within_a_day(self):
        a = json.loads(contexto.get_round(request=None).content)
        b = json.loads(contexto.get_round(request=None).content)
        self.assertEqual(a["series"][0]["secret"], b["series"][0]["secret"])

    def test_secret_comes_from_the_seed(self):
        ids = {r["person_id"] for r in contexto.build_pool()}
        secret = json.loads(contexto.get_round(request=None).content)["series"][0]["secret"]
        self.assertIn(secret, ids)

    def test_validate_rows_flags_bad_fame_tier(self):
        problems = contexto.validate_rows([{"person_id": 1, "full_name": "X", "fame_tier": 4}])
        self.assertTrue(problems)

    def test_validate_rows_accepts_good_rows(self):
        self.assertEqual(contexto.validate_rows(contexto.build_pool()), [])
