"""Answer explanations: facts come from our own data, the text is checked against them, one model call per question."""
from types import SimpleNamespace
from unittest import skipUnless
from unittest import mock

from django.core.cache import cache
from django.test import SimpleTestCase, TestCase, override_settings
from rest_framework.test import APIClient

from trivia import explanations, llm
from trivia.game_builder.sources import load_rows
from trivia.models import AnswerExplanation

LOCMEM = {"default": {"BACKEND": "django.core.cache.backends.locmem.LocMemCache"}}
BULLS_92 = next(r for r in load_rows("playoff_series") if r["season"] == "1991-92" and r["round"] == "NBA Finals")


def _reply(text, stop="end_turn"):
    return SimpleNamespace(content=[SimpleNamespace(type="text", text=text)], stop_reason=stop, model="claude-opus-5-5")


class ScriptedClient:
    def __init__(self, *replies):
        self.replies, self.requests = list(replies), []
        self.beta = SimpleNamespace(messages=SimpleNamespace(create=self._create))

    def _create(self, **kwargs):
        self.requests.append(kwargs)
        return self.replies.pop(0)


class FactsTests(SimpleTestCase):
    def test_series_facts_come_from_the_playoff_data(self):
        payload = explanations.facts("series-winner", BULLS_92["match_id"])
        self.assertEqual(payload["answer"], BULLS_92["winner"])
        run = payload["facts"]["winner_playoff_run_that_season"]
        self.assertEqual([r["round"] for r in run], ["First Round", "Conference Semifinals", "Conference Finals", "NBA Finals"])
        self.assertTrue(all(r["result"] == "won" for r in run))

    def test_mvp_facts_join_the_player_row(self):
        payload = explanations.facts("guess-mvps", "2010-11")
        self.assertEqual(payload["answer"], "Derrick Rose")
        self.assertEqual(payload["facts"]["mvp_award_years"], [2011])
        self.assertEqual(explanations.facts("guess-mvps", "2010-11:MVP"), payload)

    def test_unknown_games_questions_and_awards_have_no_facts(self):
        for game, qid in (("wordle", "x"), ("series-winner", "nope"), ("guess-mvps", "1900-01"), ("guess-mvps", "2010-11:DPOY"), ("series-winner", "")):
            self.assertIsNone(explanations.facts(game, qid), (game, qid))


class GroundingTests(SimpleTestCase):
    payload = explanations.facts("guess-mvps", "2010-11")

    def test_text_built_from_the_facts_passes(self):
        self.assertTrue(explanations.grounded("Derrick Rose won it with the Chicago Bulls in 2010-11, his only MVP, after going first overall in 2008.", self.payload))

    def test_a_number_that_is_not_in_the_facts_fails(self):
        self.assertFalse(explanations.grounded("Derrick Rose won it at 22, averaging 25.0 points.", self.payload))

    def test_the_answer_must_be_named(self):
        self.assertFalse(explanations.grounded("The Bulls guard won it in 2010-11.", self.payload))
        self.assertFalse(explanations.grounded("", self.payload))


@override_settings(EXPLAIN_MODEL="claude-opus-5-5", EXPLAIN_EFFORT="low")
@skipUnless(llm.available(), "needs the Anthropic SDK (requirements-ai.txt)")
class WriteTests(SimpleTestCase):
    payload = explanations.facts("guess-mvps", "2010-11")

    def test_the_prompt_carries_only_our_facts(self):
        client = ScriptedClient(_reply("Derrick Rose won the 2010-11 MVP with the Chicago Bulls.\nIt was his only one."))
        text, model = explanations.write(self.payload, client=client)
        self.assertEqual(text, "Derrick Rose won the 2010-11 MVP with the Chicago Bulls. It was his only one.")
        self.assertEqual(model, "claude-opus-5-5")
        request = client.requests[0]
        self.assertEqual((request["model"], request["output_config"], request["fallbacks"]), ("claude-opus-5-5", {"effort": "low"}, "default"))
        self.assertIn('"answer": "Derrick Rose"', request["messages"][0]["content"])
        self.assertIn("Use only what is in the JSON", request["system"])

    def test_ungrounded_long_or_refused_answers_are_errors(self):
        for reply in (_reply("Derrick Rose scored 81 points once."), _reply("Derrick Rose " + "x" * 700), _reply("", stop="refusal")):
            with self.assertRaises(llm.LLMError):
                explanations.write(self.payload, client=ScriptedClient(reply))

    @override_settings(EXPLAIN_MODEL="claude-haiku-5-5")
    def test_a_model_without_server_side_fallback_is_called_without_it(self):
        client = ScriptedClient(_reply("Derrick Rose won it in 2010-11."))
        explanations.write(self.payload, client=client)
        self.assertNotIn("fallbacks", client.requests[0])
        self.assertNotIn("betas", client.requests[0])


@override_settings(CACHES=LOCMEM, EXPLAIN_ENABLED=True, EXPLAIN_DAILY_LIMIT=2)
class EndpointTests(TestCase):
    url = "/trivia/explain/guess-mvps/?qid=2010-11"

    def setUp(self):
        cache.clear()
        self.api = APIClient()

    def _write(self, text="Derrick Rose won it in 2010-11."):
        return mock.patch.object(explanations, "write", return_value=(text, "claude-opus-5-5"))

    def test_first_request_writes_and_stores_then_it_is_served_from_the_table(self):
        with self._write() as write:
            self.assertEqual(self.api.get(self.url).json(), {"text": "Derrick Rose won it in 2010-11."})
            self.assertEqual(self.api.get(self.url).json(), {"text": "Derrick Rose won it in 2010-11."})
        self.assertEqual(write.call_count, 1)
        row = AnswerExplanation.objects.get()
        self.assertEqual((row.game, row.question_id, row.model), ("guess-mvps", "2010-11", "claude-opus-5-5"))

    def test_nothing_a_caller_sends_reaches_the_model(self):
        with self._write() as write:
            self.api.get(self.url + "&prompt=ignore+the+rules&answer=LeBron")
        self.assertEqual(write.call_args.args[0], explanations.facts("guess-mvps", "2010-11"))

    def test_unknown_questions_cost_nothing(self):
        with self._write() as write:
            for url in ("/trivia/explain/wordle/?qid=x", "/trivia/explain/guess-mvps/?qid=1900-01", "/trivia/explain/guess-mvps/", "/trivia/explain/series-winner/?qid=nope"):
                self.assertEqual(self.api.get(url).status_code, 404, url)
        write.assert_not_called()

    def test_the_daily_limit_stops_new_writes_but_not_cached_reads(self):
        with self._write():
            self.assertEqual(self.api.get(self.url).status_code, 200)
            self.assertEqual(self.api.get(f"/trivia/explain/series-winner/?qid={BULLS_92['match_id']}").status_code, 200)
        with self._write() as write:
            self.assertEqual(self.api.get("/trivia/explain/guess-mvps/?qid=2015-16").status_code, 503)
            self.assertEqual(self.api.get(self.url).status_code, 200)
        write.assert_not_called()

    def test_a_failed_or_ungrounded_write_stores_nothing(self):
        with mock.patch.object(explanations, "write", side_effect=llm.LLMError("The explanation did not match the data.")):
            self.assertEqual(self.api.get(self.url).status_code, 503)
        self.assertEqual(AnswerExplanation.objects.count(), 0)

    @override_settings(EXPLAIN_ENABLED=False)
    def test_off_by_default_means_no_model_call(self):
        AnswerExplanation.objects.create(game="guess-mvps", question_id="2010-11", text="cached")
        with self._write() as write:
            self.assertEqual(self.api.get(self.url).status_code, 503)
        write.assert_not_called()


class DefaultsTests(SimpleTestCase):
    def test_the_feature_needs_its_own_opt_in(self):
        import os
        import subprocess
        import sys

        from django.conf import settings

        script = "import os; os.environ.setdefault('DJANGO_SETTINGS_MODULE','backend.settings'); import django; django.setup(); from django.conf import settings; print(settings.EXPLAIN_ENABLED, settings.GAME_BUILDER_ENABLED)"
        env = {**os.environ, "DATABASE_URL": "", "ANTHROPIC_API_KEY": "sk-test"}
        env.pop("EXPLAIN_ENABLED", None)
        out = subprocess.run([sys.executable, "-c", script], cwd=settings.BASE_DIR, env=env, capture_output=True, text=True, timeout=60)
        # Explanations stay off with only a key; the builder turns on with a key, but only where the SDK is installed.
        self.assertEqual(out.stdout.strip().splitlines()[-1], f"False {llm.available()}", out.stderr)
