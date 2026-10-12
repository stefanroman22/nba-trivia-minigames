# backend/trivia/tests/test_questions_contexto.py
import datetime
import json
import os
import random

from django.test import SimpleTestCase

from trivia.data_pipeline.curated_players import playable_rows
from trivia.questions import fame
from trivia.questions.base import Invalid
from trivia.questions.games import contexto as ctx
from trivia.tests.questions_fixture import fixture_dataset


class ContextoQuestionTests(SimpleTestCase):
    def test_generate_schedules_consecutive_days_without_repeats(self):
        ds = fixture_dataset()
        today = datetime.date(2026, 9, 12)
        defs = ctx.generate(ds, set(), random.Random(5), 10, today=today)
        days = [d["day"] for d in defs]
        self.assertEqual(days[0], "2026-09-12")
        self.assertEqual(days[-1], "2026-09-21")
        self.assertEqual(len({d["secret_person_id"] for d in defs}), 10)
        self.assertTrue(all(fame.at_least(ds.by_id[d["secret_person_id"]], fame.KNOWN) for d in defs))

    def test_generate_fills_free_days_from_today_skipping_taken_ones(self):
        ds = fixture_dataset()
        ds.extra = {"contexto_existing": [{"secret_person_id": ds.playable[0]["person_id"], "day": "2026-09-13"}]}
        defs = ctx.generate(ds, set(), random.Random(5), 3, today=datetime.date(2026, 9, 12))
        self.assertEqual([d["day"] for d in defs], ["2026-09-12", "2026-09-14", "2026-09-15"])
        self.assertNotIn(ds.playable[0]["person_id"], [d["secret_person_id"] for d in defs])

    def test_a_quarantined_day_is_refilled_with_another_secret(self):
        ds = fixture_dataset()
        bad = {"secret_person_id": ds.playable[0]["person_id"], "day": "2026-09-12"}
        ds.extra = {"contexto_existing": [bad], "contexto_taken": []}
        defs = ctx.generate(ds, set(), random.Random(5), 1, today=datetime.date(2026, 9, 12))
        self.assertEqual(defs[0]["day"], "2026-09-12")
        self.assertNotEqual(defs[0]["secret_person_id"], bad["secret_person_id"])

    def test_materialize_ranking(self):
        ds = fixture_dataset()
        d = ctx.generate(ds, set(), random.Random(6), 1, today=datetime.date(2026, 9, 12))[0]
        m = ctx.materialize(d, ds)
        self.assertEqual(m["ranking"][0], [d["secret_person_id"], 1])
        self.assertEqual(len(m["ranking"]), len(ds.playable))
        self.assertEqual(ctx.validate(m), [])
        self.assertEqual(ctx.index_item(d, m), [None, d["day"]])
        self.assertEqual(ctx.qid_for(d, 0), "ctx-2026-09-12")

    def test_materialize_rejects_an_obscure_secret(self):
        ds = fixture_dataset()
        obscure = next(r for r in ds.playable if not fame.at_least(r, fame.KNOWN))
        with self.assertRaises(Invalid) as raised:
            ctx.materialize({"secret_person_id": obscure["person_id"], "day": "2026-09-12"}, ds)
        self.assertIn("fame band", str(raised.exception))

    def test_shipped_data_has_a_year_of_secrets(self):
        path = os.path.join(os.path.dirname(__file__), "..", "data_static", "players_curated.json")
        with open(path, encoding="utf-8") as f:
            rows = playable_rows(json.load(f))
        self.assertGreaterEqual(sum(1 for r in rows if fame.at_least(r, fame.KNOWN)), 365)
