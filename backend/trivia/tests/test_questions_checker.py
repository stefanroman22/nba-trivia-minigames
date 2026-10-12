import datetime
import random

from django.test import SimpleTestCase

from trivia.questions import checker, fame
from trivia.questions.games import career_path, contexto, tictactoe, who_are_ya
from trivia.tests.questions_fixture import fixture_dataset

BREF = "https://www.basketball-reference.com/players/j/jamesle01.html"


def _claim(status="confirmed", sources=(BREF,)):
    return {"claim": "x", "status": status, "sources": list(sources)}


class PlayerProfileTests(SimpleTestCase):
    def test_profile_fields(self):
        row = {"full_name": "A B", "position": "G", "height_in": 75, "birth_year": 1990, "country": "USA",
               "jersey": 3, "draft": {"year": 2010, "round": 1, "pick": 1, "team_abbr": "WAS"},
               "teams": [{"name": "Washington Wizards", "start_year": 2010, "end_year": 2019},
                         {"name": "LA Clippers", "start_year": 2023, "end_year": None}]}
        p = checker.player_profile(row)
        self.assertEqual(p["draft"], "2010 round 1 pick 1 by WAS")
        self.assertEqual(p["teams"], ["Washington Wizards 2010-2019", "LA Clippers 2023-present"])
        self.assertEqual((p["player"], p["position"], p["height_in"], p["birth_year"], p["country"], p["jersey"]),
                         ("A B", "G", 75, 1990, "USA", 3))

    def test_undrafted(self):
        self.assertEqual(checker.player_profile({"full_name": "X", "draft": None})["draft"], "undrafted")

    def test_payload_sha_ignores_key_order(self):
        self.assertEqual(checker.payload_sha({"a": 1, "b": [1, 2]}), checker.payload_sha({"b": [1, 2], "a": 1}))
        self.assertNotEqual(checker.payload_sha({"a": 1}), checker.payload_sha({"a": 2}))


class CheckerViewTests(SimpleTestCase):
    def setUp(self):
        self.ds = fixture_dataset()

    def _materialized(self, mod, **kw):
        d = mod.generate(self.ds, set(), random.Random(2), 1, **kw)[0]
        return mod.materialize(d, self.ds)

    def test_who_are_ya_view_holds_the_shown_clues_only(self):
        m = self._materialized(who_are_ya)
        profile = checker.player_profile(m["player"])
        self.assertEqual(who_are_ya.checker_view(m, self.ds),
                         {"kind": "who-are-ya", **{k: profile[k] for k in
                                                   ("player", "position", "birth_year", "jersey", "draft", "teams")}})

    def test_career_path_view_holds_every_card_and_the_draft_line(self):
        m = self._materialized(career_path)
        p = m["player"]
        view = career_path.checker_view(m, self.ds)
        self.assertEqual(view["player"], p["full_name"])
        self.assertEqual(view["draft"], checker.player_profile(p)["draft"])
        s = p["teams"][0]
        end = s["end_year"] if s["end_year"] is not None else "present"
        self.assertEqual(view["teams"][0], f"{s['name']} {s['start_year']}-{end}, GP {s['gp']}, PPG {s['ppg']}")
        self.assertEqual(len(view["teams"]), len(p["teams"]))

    def test_contexto_view_leaves_out_day_and_ranking(self):
        m = self._materialized(contexto, today=datetime.date(2026, 9, 12))
        view = contexto.checker_view(m, self.ds)
        profile = checker.player_profile(m["secret"])
        self.assertEqual(view, {"kind": "contexto", **{k: profile[k] for k in ("player", "position", "draft", "teams")}})

    def test_tictactoe_cells_are_ordered_by_fame_and_the_view_samples_the_first_three(self):
        m = self._materialized(tictactoe)
        for cell in m["valid"]:
            self.assertEqual(cell, sorted(cell, key=lambda i: (-fame.fame_score(self.ds.by_id[i]), i)))
        view = tictactoe.checker_view(m, self.ds)
        self.assertEqual(view["rows"], [r["label"] for r in m["rows"]])
        self.assertEqual(view["cols"], [c["label"] for c in m["cols"]])
        self.assertEqual(len(view["cells"]), 9)
        self.assertEqual(view["cells"][0], {"row": m["rows"][0]["label"], "col": m["cols"][0]["label"],
                                            "sample": [self.ds.by_id[i]["full_name"] for i in m["valid"][0][:3]]})


class JudgeTests(SimpleTestCase):
    def test_all_confirmed_with_allowed_sources_is_valid(self):
        self.assertEqual(checker.judge({"verdict": "valid", "claims": [_claim(), _claim()]})[0], "valid")

    def test_confirmed_without_source_is_unsure(self):
        self.assertEqual(checker.judge({"verdict": "valid", "claims": [_claim(), _claim(sources=())]})[0], "unsure")

    def test_source_off_the_approved_sites_is_unsure(self):
        off = _claim(sources=("https://www.statmuse.com/nba",))
        self.assertEqual(checker.judge({"verdict": "valid", "claims": [off]})[0], "unsure")
        lookalike = _claim(sources=("https://www.basketball-reference.com.evil.io/x",))
        self.assertEqual(checker.judge({"verdict": "valid", "claims": [lookalike]})[0], "unsure")

    def test_backed_contradiction_is_invalid_whatever_the_model_said(self):
        verdict = {"verdict": "valid", "claims": [_claim(), _claim("contradicted")]}
        self.assertEqual(checker.judge(verdict)[0], "invalid")

    def test_unbacked_contradiction_is_unsure(self):
        verdict = {"verdict": "invalid", "claims": [_claim("contradicted", sources=())]}
        self.assertEqual(checker.judge(verdict)[0], "unsure")

    def test_model_caution_is_respected(self):
        self.assertEqual(checker.judge({"verdict": "unsure", "claims": [_claim()]})[0], "unsure")

    def test_empty_or_malformed_is_unsure(self):
        for bad in (None, "valid", {}, {"verdict": "valid", "claims": []}, {"verdict": "valid", "claims": ["x"]},
                    {"verdict": "valid", "claims": [{"status": "confirmed", "sources": "not-a-list"}]}):
            self.assertEqual(checker.judge(bad)[0], "unsure", bad)
