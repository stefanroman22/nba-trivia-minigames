"""Difficulty, interest and coverage scores, and over-generate-and-select (question factory §4.3, phase 2)."""
import datetime
import random
from collections import Counter
from unittest import mock

from django.test import SimpleTestCase, TestCase

from trivia.models import Question
from trivia.questions import fame, quality, runner, specs
from trivia.questions.games import GAME_MODULES, career_path, contexto, tictactoe, who_are_ya
from trivia.questions.journal import Journal
from trivia.tests.questions_fixture import fixture_dataset

SCORED = ("career-path", "who-are-ya", "tictactoe", "contexto")


def _candidates(slug, ds, n=500, seed=3):
    mod = GAME_MODULES[slug]
    return [(d, mod.materialize(d, ds)) for d in mod.generate(ds, set(), random.Random(seed), n)]


class FeatureTests(SimpleTestCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.ds = fixture_dataset()

    def test_every_feature_is_normalized_and_every_score_is_complete(self):
        for slug in SCORED:
            mod, spec = GAME_MODULES[slug], specs.load(slug)
            for d, m in _candidates(slug, self.ds, n=20 if slug == "tictactoe" else 500):
                with self.subTest(slug=slug, definition=d):
                    for name, value in mod.features(m, self.ds).items():
                        self.assertTrue(0 <= value <= 1, f"{name}={value}")
                    s = quality.score(mod, m, self.ds, spec, d)
                    self.assertEqual(set(s), {"difficulty", "band", "interest", "coverage", "dup_key"})
                    self.assertIn(s["band"], quality.LEVELS)
                    self.assertEqual(set(s["coverage"]), set(spec["coverage"]["axes"]))
                    self.assertTrue(0 <= s["difficulty"] <= 1 and 0 <= s["interest"] <= 1)

    def test_career_path_features_of_a_known_journeyman(self):
        payton = self.ds.by_id[56]  # 5 stints: Sonics (All-Star level), Bucks, Lakers, Celtics, Heat (2006 ring)
        f = career_path.features({"player": payton}, self.ds)
        self.assertEqual(f["stint_count"], 0.5)  # (7 - 5) / (7 - 3)
        self.assertEqual((f["memorable_stop"], f["memorable"]), (0, 1.0))
        self.assertEqual(career_path.coverage({"player": payton}), {"decade": "1990s", "team": "OKC", "position": "G"})
        self.assertEqual(career_path.dup_key({"person_id": 56}, {"player": payton}), "56")

    def test_memorable_stop(self):
        row = {"awards": {"rings": [2006], "allstar_count": 0}}
        self.assertTrue(quality.memorable_stint({"abbr": "TOR", "start_year": 2005, "end_year": 2007}, row))
        self.assertFalse(quality.memorable_stint({"abbr": "TOR", "start_year": 2006, "end_year": 2008}, row))
        self.assertTrue(quality.memorable_stint({"abbr": "NYK", "start_year": 2010, "end_year": 2011}, row))
        allstar = {"awards": {"allstar_count": 1}}
        self.assertTrue(quality.memorable_stint({"abbr": "TOR", "start_year": 2000, "end_year": 2001, "ppg": 15}, allstar))
        self.assertFalse(quality.memorable_stint({"abbr": "TOR", "start_year": 2000, "end_year": 2001, "ppg": 14.9}, allstar))

    def test_a_more_famous_player_is_easier(self):
        # Band first (a fame_tier floor lifts a player's band), then score inside the band.
        rows = sorted(self.ds.playable, key=lambda r: (-fame.fame_band(r), fame.fame_score(r)))
        hardness = [quality.fame_hardness(r) for r in rows]
        self.assertEqual(hardness, sorted(hardness, reverse=True))
        self.assertEqual(quality.fame_hardness(max(rows, key=fame.fame_score), fame.KNOWN), 0)

    def test_distinct_clues_skip_the_pool_mode(self):
        modes = quality.clue_modes(self.ds)
        row = {"position": modes["position"], "birth_year": None, "jersey": -1, "draft": None, "teams": []}
        self.assertEqual(quality.distinct_clues(row, self.ds), 1)  # only the jersey

    def test_tictactoe_dup_key_ignores_order(self):
        d, m = _candidates("tictactoe", self.ds, n=1)[0]
        shuffled = {**m, "rows": list(reversed(m["rows"])), "cols": list(reversed(m["cols"]))}
        self.assertEqual(tictactoe.dup_key(d, m), tictactoe.dup_key(d, shuffled))
        self.assertEqual(len(tictactoe.coverage(m, self.ds)["team"]), 3)
        self.assertEqual(tictactoe.featured(d, m), [])  # boards are not about one player

    def test_calibration_on_the_fixture(self):
        """interest.min is reachable and difficulty spreads over the bands."""
        for slug in ("career-path", "who-are-ya"):
            mod, spec = GAME_MODULES[slug], specs.load(slug)
            scores = [quality.score(mod, m, self.ds, spec, d) for d, m in _candidates(slug, self.ds)]
            with self.subTest(slug=slug):
                passing = sum(1 for s in scores if s["interest"] >= spec["interest"]["min"])
                self.assertGreaterEqual(passing / len(scores), 0.6)
                self.assertGreater(len({s["band"] for s in scores}), 1)

    def test_contexto_place_closes_the_holes(self):
        ds = fixture_dataset()
        ds.extra = {"contexto_existing": [], "contexto_taken": [{"day": "2026-09-13"}]}
        defs = [{"secret_person_id": 1, "day": "2026-09-20"}, {"secret_person_id": 2, "day": "2026-09-25"}]
        placed = contexto.place(defs, ds, today=datetime.date(2026, 9, 12))
        self.assertEqual([d["day"] for d in placed], ["2026-09-12", "2026-09-14"])
        self.assertEqual([d["secret_person_id"] for d in placed], [1, 2])


def _cand(band, cells=None, players=(), interest=0.5, key=None):
    return {"scores": {"band": band, "interest": interest, "coverage": cells or {}, "dup_key": key or band},
            "featured": list(players)}


class SelectTests(SimpleTestCase):
    spec = specs.load("career-path")

    def test_the_band_furthest_below_its_share_goes_first(self):
        state = quality.new_state()
        for _ in range(10):
            quality.add(state, {"band": "easy", "coverage": {}}, [])
        pool = [_cand("easy"), _cand("hard"), _cand("easy")]
        picked, refused = quality.select(pool, 1, state, self.spec)
        self.assertEqual([c["scores"]["band"] for c in picked], ["hard"])  # medium is missing, hard is next
        self.assertEqual(refused, [])
        self.assertEqual(len(pool), 2)

    def test_an_empty_mix_follows_the_spec(self):
        pool = [_cand(b, key=f"{b}{i}") for i in range(10) for b in ("easy", "medium", "hard")]
        picked, _ = quality.select(pool, 10, quality.new_state(), self.spec)
        self.assertEqual(Counter(c["scores"]["band"] for c in picked), {"easy": 4, "medium": 4, "hard": 2})

    def test_an_empty_coverage_cell_goes_first(self):
        state = quality.new_state()
        quality.add(state, {"band": "easy", "coverage": {"decade": "1990s"}}, [])
        pool = [_cand("medium", {"decade": "1990s"}, interest=1.0), _cand("medium", {"decade": "1960s"})]
        picked, _ = quality.select(pool, 1, state, self.spec)
        self.assertEqual(picked[0]["scores"]["coverage"], {"decade": "1960s"})

    def test_max_player_share_is_enforced(self):
        state = quality.new_state()
        for _ in range(3):
            quality.add(state, {"band": "easy", "coverage": {}}, [7])  # 3 questions on player 7
        pool = [_cand("medium", players=[7]), _cand("medium", players=[8])]
        picked, refused = quality.select(pool, 2, state, self.spec)
        self.assertEqual([c["featured"] for c in picked], [[8]])
        self.assertEqual(refused[0]["over"], [7])
        # The limit grows with the pool: 2% of 300 questions is 6.
        state["n"] = 300
        picked, _ = quality.select([_cand("hard", players=[7])], 1, state, self.spec)
        self.assertEqual(len(picked), 1)

    def test_gap_report(self):
        state = quality.new_state()
        quality.add(state, {"band": "easy", "coverage": {"decade": "1990s", "team": "LAL"}}, [])
        report = quality.gap_report(state, {"decade:1990s", "decade:1960s", "team:LAL"}, self.spec)
        self.assertEqual(report["empty_cells"], ["decade:1960s"])
        self.assertEqual((report["decades"], report["min_decades"]), (1, 4))
        self.assertEqual(report["mix"], {"easy": 1.0, "medium": 0.0, "hard": 0.0})


class RunnerSelectionTests(TestCase):
    """runner._process_game over-generates, gates and selects (staged games)."""

    def setUp(self):
        self.ds = fixture_dataset("ds-1")
        self.rng = random.Random(7)
        for p in (mock.patch("trivia.questions.games.career_path.TARGET", 5),
                  mock.patch("trivia.questions.games.career_path.MINIMUM", 0)):
            p.start()
            self.addCleanup(p.stop)

    def _maintain(self, games=("career-path",)):
        journal = Journal("supply")
        runner.maintain(list(games), self.ds, self.rng, out=lambda *_: None, journal=journal, stage=True)
        return journal

    def _events(self, journal, action, reason=None):
        return [e for e in journal.events if e["action"] == action and reason in (None, e["reason"])]

    def test_saved_questions_carry_their_scores_and_keep_the_payload_sha(self):
        journal = self._maintain()
        rows = list(Question.objects.filter(game="career-path"))
        self.assertEqual(len(rows), 5)
        for r in rows:
            for key in ("difficulty", "band", "interest", "coverage", "dup_key", "payload_sha"):
                self.assertIn(key, r.quality)
            self.assertEqual(r.quality["dup_key"], str(r.definition["person_id"]))
        self.assertEqual(len(self._events(journal, "generated")), 5)

    def test_an_existing_question_is_scored_and_keeps_its_check(self):
        self._maintain()
        row = Question.objects.filter(game="career-path").first()
        row.quality = {"payload_sha": row.quality["payload_sha"], "checked": {"verdict": "valid"}}
        row.save()
        self._maintain()
        row.refresh_from_db()
        self.assertEqual(row.quality["checked"], {"verdict": "valid"})
        self.assertIn(row.quality["band"], quality.LEVELS)

    def test_a_low_interest_candidate_is_rejected_and_not_saved(self):
        real = career_path.features

        def dull_when_even(m, dataset=None):
            f = real(m, dataset)
            return {**f, "memorable": 0.0} if m["player"]["person_id"] % 2 == 0 else f

        with mock.patch.object(career_path, "features", dull_when_even):
            journal = self._maintain()
        saved = [q.definition["person_id"] for q in Question.objects.filter(game="career-path")]
        self.assertEqual(len(saved), 5)
        self.assertTrue(all(pid % 2 for pid in saved))
        rejected = self._events(journal, "rejected", "low_interest")
        self.assertTrue(rejected)
        self.assertTrue(any(int(e["detail"]["dup_key"]) % 2 == 0 for e in rejected))
        self.assertTrue(all(e["detail"]["interest"] < 0.3 for e in rejected))
        self.assertEqual(Question.objects.count(), 5)  # rejected candidates are not rows

    def test_two_candidates_with_one_dup_key_keep_one(self):
        with mock.patch.object(career_path, "dup_key", lambda d, m: "same"):
            journal = self._maintain()
        self.assertEqual(Question.objects.filter(game="career-path").count(), 1)
        self.assertTrue(self._events(journal, "rejected", "duplicate"))
        with mock.patch.object(career_path, "dup_key", lambda d, m: "same"):
            journal = self._maintain()  # the existing question's key blocks every new candidate
        self.assertEqual(Question.objects.filter(game="career-path").count(), 1)
        self.assertTrue(self._events(journal, "rejected", "duplicate"))

    def test_a_rejected_candidate_can_be_proposed_again_next_run(self):
        with mock.patch.object(career_path, "dup_key", lambda d, m: "same"):
            journal = self._maintain()
        rejected = {e["detail"]["dup_key"] for e in self._events(journal, "rejected", "duplicate")}
        self.assertTrue(rejected)
        hashes = set(Question.objects.values_list("content_hash", flat=True))
        self.assertEqual(len(hashes), 1)

    def test_the_consistency_gate_rejects_an_overused_player(self):
        with mock.patch.object(career_path, "players_referenced", lambda d, m, ds=None: [1]):
            journal = self._maintain()
        self.assertEqual(Question.objects.filter(game="career-path").count(), quality.MIN_PLAYER_LIMIT)
        refused = self._events(journal, "rejected", "consistency")
        self.assertTrue(refused)
        self.assertEqual(refused[0]["detail"]["players"], [1])

    def test_new_questions_per_run_are_capped(self):
        real = specs.load

        def small_cap(slug):
            spec = real(slug)
            spec["refill"]["max_new_per_run"] = 3
            return spec

        with mock.patch.object(runner.specs, "load", small_cap):
            journal = self._maintain()
        self.assertEqual(Question.objects.filter(game="career-path").count(), 3)
        self.assertEqual(len(self._events(journal, "gap_report")), 1)

    def test_a_gap_report_per_game(self):
        with mock.patch("trivia.questions.games.tictactoe.TARGET", 2), \
             mock.patch("trivia.questions.games.tictactoe.MINIMUM", 0):
            journal = self._maintain(("career-path", "tictactoe"))
        reports = self._events(journal, "gap_report")
        self.assertEqual([e["game"] for e in reports], ["career-path", "tictactoe"])
        detail = reports[0]["detail"]
        self.assertEqual(sum(round(v * 5) for v in detail["mix"].values()), 5)
        self.assertEqual(detail["questions"], 5)
        self.assertIn("empty_cells", detail)

    def test_selection_fills_the_under_target_band(self):
        with mock.patch("trivia.questions.games.career_path.TARGET", 10):
            self._maintain()
        bands = Counter(q.quality["band"] for q in Question.objects.filter(game="career-path"))
        self.assertEqual(bands, {"easy": 4, "medium": 4, "hard": 2})

    def test_contexto_days_stay_consecutive(self):
        with mock.patch("trivia.questions.games.contexto.TARGET", 5), \
             mock.patch("trivia.questions.games.contexto.MINIMUM", 0):
            journal = self._maintain(("contexto",))
        days = sorted(q.definition["day"] for q in Question.objects.filter(game="contexto"))
        first = datetime.date.fromisoformat(days[0])
        self.assertEqual(days, [(first + datetime.timedelta(days=i)).isoformat() for i in range(5)])
        self.assertEqual(len(self._events(journal, "generated")), 5)

    def test_who_are_ya_gets_scores_too(self):
        with mock.patch("trivia.questions.games.who_are_ya.MINIMUM", 0):
            self._maintain(("who-are-ya",))
        rows = list(Question.objects.filter(game="who-are-ya"))
        self.assertTrue(rows)
        self.assertTrue(all("band" in r.quality for r in rows))
        self.assertEqual(len({r.quality["dup_key"] for r in rows}), len(rows))
        eligible = sum(1 for r in self.ds.playable if who_are_ya._eligible(r))
        self.assertLessEqual(len(rows), eligible)
