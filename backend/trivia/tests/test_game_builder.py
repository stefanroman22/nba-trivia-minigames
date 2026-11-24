"""AI game builder: spec validation, the round engine on the published datasets, the agent's tool loop against a
scripted model, and the staff-only API. No test calls the real Anthropic API."""
from types import SimpleNamespace
from unittest import mock

from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.test import SimpleTestCase, TestCase, override_settings
from rest_framework.test import APIClient

from trivia.game_builder import agent, engine
from trivia.game_builder.sources import SOURCES, catalog, describe, get_value, load_rows
from trivia.game_builder.spec import SpecError, validate
from trivia.models import CustomGame

User = get_user_model()
LOCMEM = {"default": {"BACKEND": "django.core.cache.backends.locmem.LocMemCache"}}

DRAFT_SPEC = {
    "title": "Draft Day",
    "description": "Name the team that drafted each All-Star.",
    "source": "players",
    "mode": "multiple_choice",
    "rounds": 8,
    "filters": [{"field": "awards.allstar_count", "op": "gte", "value": 3}],
    "prompt": "Which team drafted {full_name} in {draft.year}?",
    "answer_field": "draft.team_abbr",
    "options": 4,
    "reveal": "{full_name} went #{draft.pick} overall.",
}
MVP_SPEC = {
    "title": "MVP Roll Call",
    "description": "Type the MVP of each season.",
    "source": "mvps",
    "mode": "type_answer",
    "rounds": 5,
    "prompt": "Who was the MVP of the {season} season?",
    "answer_field": "mvp",
}
SCORERS_SPEC = {
    "title": "Bucket Getters",
    "description": "Pick the higher career scoring average.",
    "source": "players",
    "mode": "higher_lower",
    "rounds": 6,
    "filters": [{"field": "fame_tier", "op": "lte", "value": 3}],
    "prompt": "Who averaged more points per game?",
    "compare_field": "career.ppg",
    "label_field": "full_name",
}


class SpecTests(SimpleTestCase):
    def test_valid_spec_is_normalized(self):
        spec = validate(DRAFT_SPEC)
        self.assertEqual(spec["version"], 1)
        self.assertEqual(spec["points_per_correct"], 10)
        self.assertNotIn("compare_field", spec)

    def test_every_problem_is_reported_at_once(self):
        bad = {**DRAFT_SPEC, "rounds": 99, "prompt": "Who is {nickname}?", "filters": [{"field": "x", "op": "eq", "value": 1}]}
        with self.assertRaises(SpecError) as ctx:
            validate(bad)
        text = " ".join(ctx.exception.problems)
        for expected in ("rounds", "{nickname}", "filters[0]"):
            self.assertIn(expected, text)

    def test_prompt_may_not_show_the_answer(self):
        with self.assertRaises(SpecError) as ctx:
            validate({**MVP_SPEC, "prompt": "Was {mvp} the MVP of {season}?"})
        self.assertIn("is the answer", str(ctx.exception))

    def test_mode_specific_keys(self):
        with self.assertRaises(SpecError):
            validate({**SCORERS_SPEC, "prompt": "Does {full_name} score more?"})
        with self.assertRaises(SpecError):
            validate({**SCORERS_SPEC, "compare_field": "full_name"})
        with self.assertRaises(SpecError):
            validate({**MVP_SPEC, "options": 4})

    def test_filter_operand_types(self):
        for flt in (
            {"field": "full_name", "op": "gt", "value": 3},
            {"field": "career.ppg", "op": "gt", "value": "20"},
            {"field": "team_names", "op": "eq", "value": "Boston Celtics"},
            {"field": "position", "op": "in", "value": "G"},
            {"field": "college", "op": "exists", "value": "yes"},
        ):
            with self.assertRaises(SpecError, msg=flt):
                validate({**DRAFT_SPEC, "filters": [flt]})

    def test_unknown_source_mode_and_keys(self):
        for patch in ({"source": "referees"}, {"mode": "bingo"}, {"sql": "drop table"}):
            with self.assertRaises(SpecError, msg=patch):
                validate({**DRAFT_SPEC, **patch})


class SourceTests(SimpleTestCase):
    def test_every_listed_field_resolves_on_real_rows(self):
        for source in SOURCES.values():
            rows = load_rows(source.id)
            self.assertTrue(rows, source.id)
            for f in source.fields:
                self.assertTrue(
                    any(get_value(r, f.name) not in (None, "", []) for r in rows),
                    f"{source.id}.{f.name} is empty on every row",
                )

    def test_catalog_and_describe(self):
        self.assertEqual([s["id"] for s in catalog()], list(SOURCES))
        info = describe("players", ["career.ppg", "position"])
        ppg, position = (next(f for f in info["fields"] if f["name"] == n) for n in ("career.ppg", "position"))
        self.assertLess(ppg["min"], ppg["max"])
        self.assertIn("G", position["top"])
        self.assertEqual(set(info["samples"][0]), {"career.ppg", "position"})


class EngineTests(SimpleTestCase):
    def test_multiple_choice_rounds_are_fair(self):
        spec = validate(DRAFT_SPEC)
        rounds = engine.build_rounds(spec, seed=1)
        self.assertEqual(len(rounds), 8)
        self.assertEqual([r["id"] for r in rounds], [f"r{i}" for i in range(1, 9)])
        for r in rounds:
            self.assertEqual(len(r["options"]), 4)
            self.assertEqual(len(set(r["options"])), 4)
            self.assertEqual(r["options"].count(r["answer"]), 1)
            self.assertNotIn("{", r["prompt"] + r.get("reveal", ""))

    def test_same_seed_same_game_and_new_seed_new_game(self):
        spec = validate(DRAFT_SPEC)
        self.assertEqual(engine.build_rounds(spec, seed=3), engine.build_rounds(spec, seed=3))
        self.assertNotEqual(engine.build_rounds(spec, seed=3), engine.build_rounds(spec, seed=4))

    def test_distractors_never_include_another_correct_answer(self):
        # "Name a player from this college" has many right answers per prompt: none may appear as a wrong option.
        spec = validate({
            "title": "College Roll", "description": "d", "source": "players", "mode": "multiple_choice",
            "rounds": 5, "options": 4, "prompt": "Which of these players went to {college}?",
            "answer_field": "full_name", "filters": [{"field": "awards.allstar_count", "op": "gte", "value": 1}],
        })
        college = {r["full_name"]: r["college"] for r in load_rows("players")}
        for r in engine.build_rounds(spec, seed=2):
            asked = college[r["answer"]]
            self.assertEqual([o for o in r["options"] if college[o] == asked], [r["answer"]])

    def test_numeric_distractors_stay_near_the_answer(self):
        spec = validate({
            "title": "Draft Class", "description": "d", "source": "players", "mode": "multiple_choice", "rounds": 5,
            "prompt": "In which year was {full_name} drafted?", "answer_field": "draft.year",
            "filters": [{"field": "fame_tier", "op": "lte", "value": 2}],
        })
        for r in engine.build_rounds(spec, seed=5):
            self.assertLessEqual(max(abs(int(o) - int(r["answer"])) for o in r["options"]), 8)

    def test_type_answer_accepts_aliases(self):
        rounds = engine.build_rounds(validate(MVP_SPEC), seed=1)
        self.assertTrue(all(r["answer"] in r["accepted"] for r in rounds))
        spec = validate({
            "title": "Spain", "description": "d", "source": "players", "mode": "type_answer", "rounds": 20,
            "prompt": "Which Spanish player was drafted #{draft.pick} in {draft.year}?", "answer_field": "full_name",
            "filters": [{"field": "country", "op": "eq", "value": "spain"}],
        })
        _, rounds = engine._generate(spec, seed=1)
        pau = next(r for r in rounds if r["answer"] == "Pau Gasol")
        self.assertIn("Pau Gasol Saez", pau["accepted"])

    def test_higher_lower_has_no_ties_and_the_right_side_wins(self):
        for r in engine.build_rounds(validate(SCORERS_SPEC), seed=9):
            self.assertNotEqual(r["left"]["value"], r["right"]["value"])
            higher = "left" if r["left"]["value"] > r["right"]["value"] else "right"
            self.assertEqual(r["answer"], higher)

    def test_too_small_a_pool_is_a_spec_error_with_a_reason(self):
        spec = validate({**DRAFT_SPEC, "filters": [{"field": "mvp_count", "op": "gte", "value": 5}]})
        result = engine.preview(spec)
        self.assertFalse(result["playable"])
        self.assertIn("Loosen a filter", result["warnings"][0])
        with self.assertRaises(SpecError):
            engine.build_rounds(spec, seed=1)

    def test_filters(self):
        spec = validate({**SCORERS_SPEC, "filters": [
            {"field": "team_names", "op": "contains", "value": "lakers"},
            {"field": "rings_count", "op": "gte", "value": 1},
            {"field": "college", "op": "exists", "value": True},
            {"field": "position", "op": "ne", "value": "C"},
        ], "rounds": 3})
        pool = engine._pool(spec)
        self.assertTrue(pool)
        for row in pool:
            self.assertTrue(any("Lakers" in t for t in row["team_names"]))
            self.assertGreaterEqual(row["rings_count"], 1)
            self.assertTrue(row["college"])
            self.assertNotEqual(row["position"], "C")


def _block(**kw):
    return SimpleNamespace(**kw)


def _reply(*blocks, stop="tool_use"):
    return SimpleNamespace(
        content=list(blocks), stop_reason=stop, model="claude-opus-5-5",
        usage=SimpleNamespace(input_tokens=100, output_tokens=40, cache_read_input_tokens=900, cache_creation_input_tokens=0),
    )


def _tool(name, **args):
    return _block(type="tool_use", id=f"tu_{name}_{len(args)}", name=name, input=args)


class ScriptedClient:
    """Stands in for anthropic.Anthropic: returns the scripted replies in order and records each request."""

    def __init__(self, *replies):
        self.replies, self.requests = list(replies), []
        self.beta = SimpleNamespace(messages=SimpleNamespace(create=self._create))

    def _create(self, **kwargs):
        self.requests.append({**kwargs, "messages": list(kwargs["messages"])})
        return self.replies.pop(0)


@override_settings(GAME_BUILDER_MAX_TURNS=4)
class AgentTests(SimpleTestCase):
    def test_builds_after_inspecting_previewing_and_fixing_a_bad_spec(self):
        too_narrow = {**DRAFT_SPEC, "filters": [{"field": "mvp_count", "op": "gte", "value": 5}]}
        client = ScriptedClient(
            _reply(_tool("describe_source", source="players", fields=["awards.allstar_count"])),
            _reply(_tool("preview_game", spec=DRAFT_SPEC)),
            _reply(_tool("submit_game", spec=too_narrow, summary="first try")),
            _reply(_block(type="text", text="Fixing the filter."), _tool("submit_game", spec=DRAFT_SPEC, summary="Eight rounds on who drafted each All-Star.")),
        )
        result = agent.run("a game about who drafted the stars", client=client)

        self.assertEqual(result.spec, validate(DRAFT_SPEC))
        self.assertEqual(result.message, "Eight rounds on who drafted each All-Star.")
        self.assertEqual(result.usage, {"input_tokens": 4000, "output_tokens": 160, "turns": 4})
        self.assertTrue(result.preview["playable"])

        first = client.requests[0]
        self.assertEqual(first["model"], "claude-opus-5-5")
        self.assertEqual(first["fallbacks"], "default")
        self.assertEqual(first["system"][0]["cache_control"], {"type": "ephemeral"})
        self.assertIn('"id": "players"', first["system"][0]["text"])
        self.assertNotIn("thinking", first)
        self.assertNotIn("tool_choice", first)
        # Each tool result went back to the model: stats, a preview, then the rejected submit as an error.
        results = [m["content"][0] for m in client.requests[3]["messages"] if m["role"] == "user" and isinstance(m["content"], list)]
        self.assertIn('"filled"', results[0]["content"])
        self.assertIn('"pool_size"', results[1]["content"])
        self.assertTrue(results[2]["is_error"])
        self.assertIn("Loosen a filter", results[2]["content"])

    def test_refine_sends_the_current_spec(self):
        client = ScriptedClient(_reply(_tool("submit_game", spec={**DRAFT_SPEC, "rounds": 5}, summary="Now five rounds.")))
        result = agent.run("make it 5 rounds", current_spec=validate(DRAFT_SPEC), client=client)
        self.assertEqual(result.spec["rounds"], 5)
        self.assertIn('"title": "Draft Day"', client.requests[0]["messages"][0]["content"])

    def test_an_answer_in_words_changes_nothing(self):
        client = ScriptedClient(_reply(_block(type="text", text="There is no referee data."), stop="end_turn"))
        result = agent.run("a game about referees", client=client)
        self.assertIsNone(result.spec)
        self.assertEqual(result.message, "There is no referee data.")

    def test_refusal_and_running_out_of_turns_are_builder_errors(self):
        with self.assertRaises(agent.BuilderError):
            agent.run("x", client=ScriptedClient(_reply(stop="refusal")))
        loop = [_reply(_tool("preview_game", spec=DRAFT_SPEC)) for _ in range(4)]
        with self.assertRaisesMessage(agent.BuilderError, "4 steps"):
            agent.run("x", client=ScriptedClient(*loop))


@override_settings(CACHES=LOCMEM, GAME_BUILDER_ENABLED=True)
class ApiTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.admin = User.objects.create_user(username="admin", email="admin@test.dev", password="x", is_staff=True)
        cls.player = User.objects.create_user(username="player", email="player@test.dev", password="x")

    def setUp(self):
        cache.clear()
        self.api = APIClient()
        self.api.force_authenticate(self.admin)

    def _result(self, spec=DRAFT_SPEC, message="Built."):
        spec = validate(spec) if spec else None
        return agent.BuildResult(spec=spec, message=message, preview=spec and engine.preview(spec),
                                 model="claude-opus-5-5", usage={"input_tokens": 10, "output_tokens": 5, "turns": 2})

    def _build(self):
        with mock.patch.object(agent, "run", return_value=self._result()):
            return self.api.post("/api/admin/game-builder/", {"prompt": "who drafted the stars"}, format="json")

    def test_only_staff(self):
        for client in (APIClient(), None):
            api = client or APIClient()
            if client is None:
                api.force_authenticate(self.player)
            self.assertIn(api.get("/api/admin/game-builder/").status_code, (401, 403))
            self.assertIn(api.post("/api/admin/game-builder/", {"prompt": "x"}, format="json").status_code, (401, 403))

    def test_overview(self):
        data = self.api.get("/api/admin/game-builder/").json()
        self.assertTrue(data["enabled"])
        self.assertEqual(data["model"], "claude-opus-5-5")
        self.assertEqual([s["id"] for s in data["sources"]], list(SOURCES))
        self.assertEqual(data["games"], [])

    def test_build_refine_play_delete(self):
        res = self._build()
        self.assertEqual(res.status_code, 201, res.content)
        game = res.json()["game"]
        self.assertEqual((game["slug"], game["mode"], game["source"], game["status"]), ("draft-day", "multiple_choice", "players", "draft"))
        self.assertEqual([t["role"] for t in game["transcript"]], ["admin", "agent"])
        self.assertEqual(len(game["preview"]["rounds"]), 3)
        self.assertEqual(set(game["preview"]), {"pool_size", "answer_values", "rounds", "warnings"})
        self.assertEqual(CustomGame.objects.get().created_by, self.admin)

        refined = self._result({**DRAFT_SPEC, "title": "Draft Night", "rounds": 5}, "Renamed, five rounds.")
        with mock.patch.object(agent, "run", return_value=refined) as run:
            res = self.api.post(f"/api/admin/game-builder/{game['id']}/refine/", {"prompt": "5 rounds, rename"}, format="json")
        self.assertEqual(run.call_args.args[1]["title"], "Draft Day")  # the agent got the current spec
        game = res.json()["game"]
        self.assertEqual((game["title"], game["slug"], game["spec"]["rounds"]), ("Draft Night", "draft-night", 5))
        self.assertEqual(len(game["transcript"]), 4)
        self.assertEqual(game["usage"], {"input_tokens": 20, "output_tokens": 10, "turns": 4})

        played = self.api.get(f"/api/admin/game-builder/{game['id']}/play/?seed=4").json()
        self.assertEqual((len(played["rounds"]), played["points_per_correct"], played["max_points"]), (5, 10, 50))
        self.assertEqual(played, self.api.get(f"/api/admin/game-builder/{game['id']}/play/?seed=4").json())

        self.assertEqual(self.api.delete(f"/api/admin/game-builder/{game['id']}/").status_code, 204)
        self.assertEqual(self.api.get(f"/api/admin/game-builder/{game['id']}/").status_code, 404)

    def test_a_refine_answered_in_words_keeps_the_game(self):
        game = self._build().json()["game"]
        with mock.patch.object(agent, "run", return_value=self._result(None, "No referee data.")):
            res = self.api.post(f"/api/admin/game-builder/{game['id']}/refine/", {"prompt": "add referees"}, format="json")
        after = res.json()["game"]
        self.assertEqual(after["spec"], game["spec"])
        self.assertEqual(after["transcript"][-1]["text"], "No referee data.")

    def test_errors(self):
        self.assertEqual(self.api.post("/api/admin/game-builder/", {"prompt": "  "}, format="json").status_code, 400)
        self.assertEqual(self.api.post("/api/admin/game-builder/", {"prompt": "x" * 1001}, format="json").status_code, 400)
        with mock.patch.object(agent, "run", side_effect=agent.BuilderError("The AI service is rate limited right now.")):
            res = self.api.post("/api/admin/game-builder/", {"prompt": "x"}, format="json")
        self.assertEqual((res.status_code, res.json()["error"]), (502, "The AI service is rate limited right now."))
        with mock.patch.object(agent, "run", return_value=self._result(None, "No such data.")):
            res = self.api.post("/api/admin/game-builder/", {"prompt": "x"}, format="json")
        self.assertEqual((res.status_code, CustomGame.objects.count()), (502, 0))

    @override_settings(GAME_BUILDER_ENABLED=False)
    def test_without_a_key_nothing_calls_the_model_but_drafts_still_play(self):
        game = CustomGame.objects.create(slug="mvp", title="MVP Roll Call", spec=validate(MVP_SPEC))
        self.assertFalse(self.api.get("/api/admin/game-builder/").json()["enabled"])
        with mock.patch.object(agent, "run") as run:
            self.assertEqual(self.api.post("/api/admin/game-builder/", {"prompt": "x"}, format="json").status_code, 503)
            self.assertEqual(self.api.post(f"/api/admin/game-builder/{game.pk}/refine/", {"prompt": "x"}, format="json").status_code, 503)
        run.assert_not_called()
        self.assertEqual(len(self.api.get(f"/api/admin/game-builder/{game.pk}/play/").json()["rounds"]), 5)
