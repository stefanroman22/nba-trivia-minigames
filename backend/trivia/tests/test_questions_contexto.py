# backend/trivia/tests/test_questions_contexto.py
import datetime
import random

from django.test import SimpleTestCase

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
        self.assertTrue(all(ds.by_id[d["secret_person_id"]]["fame_tier"] in (1, 2) for d in defs))

    def test_generate_continues_after_existing_days(self):
        ds = fixture_dataset()
        ds.extra = {"contexto_existing": [{"secret_person_id": ds.playable[0]["person_id"], "day": "2026-09-14"}]}
        defs = ctx.generate(ds, set(), random.Random(5), 2, today=datetime.date(2026, 9, 12))
        self.assertEqual([d["day"] for d in defs], ["2026-09-15", "2026-09-16"])
        self.assertNotIn(ds.playable[0]["person_id"], [d["secret_person_id"] for d in defs])

    def test_materialize_ranking(self):
        ds = fixture_dataset()
        d = ctx.generate(ds, set(), random.Random(6), 1, today=datetime.date(2026, 9, 12))[0]
        m = ctx.materialize(d, ds)
        self.assertEqual(m["ranking"][0], [d["secret_person_id"], 1])
        self.assertEqual(len(m["ranking"]), len(ds.playable))
        self.assertEqual(ctx.validate(m), [])
        self.assertEqual(ctx.index_item(d, m), [None, d["day"]])
        self.assertEqual(ctx.qid_for(d, 0), "ctx-2026-09-12")
