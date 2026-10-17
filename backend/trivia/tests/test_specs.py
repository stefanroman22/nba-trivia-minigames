import copy
import json
import os
import tempfile
from unittest import mock

from django.test import SimpleTestCase

from trivia.questions import fame, specs
from trivia.questions.games import career_path, contexto, tictactoe, who_are_ya

SLUGS = ("career-path", "who-are-ya", "tictactoe", "contexto")


class SpecLoadTests(SimpleTestCase):
    def tearDown(self):
        specs.reload()

    def test_every_spec_loads(self):
        for slug in SLUGS:
            with self.subTest(slug=slug):
                spec = specs.load(slug)
                self.assertEqual(spec["slug"], slug)
                self.assertEqual(spec["difficulty"]["mix"], {"easy": 0.4, "medium": 0.4, "hard": 0.2})
                self.assertEqual(spec["interest"]["min"], 0.3)
                self.assertEqual(spec["refill"]["runway_days"], 90)
                self.assertEqual(spec["refill"]["max_new_per_run"], 200)
                self.assertEqual(spec["consistency"]["max_player_share"], 0.02)

    def test_difficulty_features_are_the_ones_task_10_computes(self):
        expected = {
            "career-path": {"fame_band", "stint_count", "memorable_stop"},
            "who-are-ya": {"fame_band", "era_age", "distinct_clues"},
            "tictactoe": {"mean_cell_size", "min_cell_size", "famous_per_cell"},
            "contexto": {"fame_band", "era_age"},
        }
        for slug, names in expected.items():
            with self.subTest(slug=slug):
                self.assertEqual(set(specs.load(slug)["difficulty"]["features"]), names)

    def test_coverage_axes(self):
        self.assertEqual(specs.load("career-path")["coverage"]["axes"], ["decade", "team", "position"])
        self.assertEqual(specs.load("who-are-ya")["coverage"]["axes"], ["decade", "team", "position"])
        self.assertEqual(specs.load("tictactoe")["coverage"]["axes"], ["decade", "team"])
        self.assertEqual(specs.load("contexto")["coverage"]["axes"], ["decade"])

    def test_load_is_cached_and_returns_a_copy(self):
        first = specs.load("career-path")
        first["refill"]["target"] = -1
        self.assertEqual(specs.load("career-path")["refill"]["target"], 500)

    def test_unknown_slug_raises_spec_error(self):
        with self.assertRaises(specs.SpecError):
            specs.load("no-such-game")


class SpecValidationTests(SimpleTestCase):
    def setUp(self):
        self.good = specs.load("career-path")
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        patcher = mock.patch.object(specs, "SPEC_DIR", self.tmp.name)
        patcher.start()
        self.addCleanup(patcher.stop)
        specs.reload()
        self.addCleanup(specs.reload)

    def _write(self, data, slug="career-path"):
        with open(os.path.join(self.tmp.name, f"{slug}.json"), "w", encoding="utf-8") as f:
            json.dump(data, f)

    def _assert_bad(self, field, mutate):
        data = copy.deepcopy(self.good)
        mutate(data)
        self._write(data)
        specs.reload()
        with self.assertRaises(specs.SpecError) as ctx:
            specs.load("career-path")
        self.assertIn(field, str(ctx.exception))

    def test_good_copy_loads(self):
        self._write(self.good)
        self.assertEqual(specs.load("career-path")["refill"]["target"], 500)

    def test_missing_section(self):
        self._assert_bad("refill", lambda d: d.pop("refill"))

    def test_missing_nested_key(self):
        self._assert_bad("refill.minimum", lambda d: d["refill"].pop("minimum"))

    def test_slug_mismatch(self):
        self._assert_bad("slug", lambda d: d.update(slug="tictactoe"))

    def test_mix_must_sum_to_one(self):
        self._assert_bad("difficulty.mix", lambda d: d["difficulty"]["mix"].update(hard=0.5))

    def test_bands_must_tile_zero_to_one(self):
        self._assert_bad("difficulty.bands", lambda d: d["difficulty"]["bands"].update(medium=[0.4, 0.65]))

    def test_feature_weights_must_sum_to_one(self):
        self._assert_bad("difficulty.features", lambda d: d["difficulty"]["features"].update(fame_band=0.9))

    def test_interest_min_in_range(self):
        self._assert_bad("interest.min", lambda d: d["interest"].update(min=1.5))

    def test_unknown_coverage_axis(self):
        self._assert_bad("coverage.axes", lambda d: d["coverage"].update(axes=["decade", "planet"]))

    def test_min_decades_type(self):
        self._assert_bad("coverage.min_decades", lambda d: d["coverage"].update(min_decades="4"))

    def test_target_below_minimum(self):
        self._assert_bad("refill.target", lambda d: d["refill"].update(target=10))

    def test_target_may_be_null(self):
        data = copy.deepcopy(self.good)
        data["refill"]["target"] = None
        self._write(data)
        self.assertIsNone(specs.load("career-path")["refill"]["target"])

    def test_bool_is_not_an_int(self):
        self._assert_bad("refill.runway_days", lambda d: d["refill"].update(runway_days=True))

    def test_max_player_share_range(self):
        self._assert_bad("consistency.max_player_share", lambda d: d["consistency"].update(max_player_share=0))

    def test_unknown_fame_band(self):
        self._assert_bad("eligibility.min_fame_band", lambda d: d["eligibility"].update(min_fame_band="LEGEND"))

    def test_eligibility_min_above_max(self):
        self._assert_bad("eligibility.min_stints", lambda d: d["eligibility"].update(min_stints=9))

    def test_invalid_json_names_the_file(self):
        with open(os.path.join(self.tmp.name, "career-path.json"), "w", encoding="utf-8") as f:
            f.write("{not json")
        with self.assertRaises(specs.SpecError) as ctx:
            specs.load("career-path")
        self.assertIn("career-path", str(ctx.exception))


class ModuleConstantsMatchSpecTests(SimpleTestCase):
    def test_career_path(self):
        spec = specs.load("career-path")
        self.assertEqual((career_path.TARGET, career_path.MINIMUM), (500, 50))
        self.assertEqual((career_path.TARGET, career_path.MINIMUM), (spec["refill"]["target"], spec["refill"]["minimum"]))
        self.assertEqual((career_path.MIN_STINTS, career_path.MAX_STINTS), (3, 7))
        self.assertEqual((career_path.MIN_STINTS, career_path.MAX_STINTS),
                         (spec["eligibility"]["min_stints"], spec["eligibility"]["max_stints"]))
        self.assertEqual(career_path.MIN_FAME_BAND, fame.DEEP)
        self.assertEqual(spec["eligibility"]["min_fame_band"], "DEEP")

    def test_who_are_ya(self):
        spec = specs.load("who-are-ya")
        self.assertIsNone(who_are_ya.TARGET)
        self.assertIsNone(spec["refill"]["target"])
        self.assertEqual(who_are_ya.MINIMUM, 30)
        self.assertEqual(who_are_ya.MINIMUM, spec["refill"]["minimum"])
        self.assertEqual(who_are_ya.MIN_FAME_BAND, fame.KNOWN)
        self.assertEqual(spec["eligibility"]["min_fame_band"], "KNOWN")

    def test_tictactoe(self):
        spec = specs.load("tictactoe")
        self.assertEqual((tictactoe.TARGET, tictactoe.MINIMUM), (120, 12))
        self.assertEqual((tictactoe.TARGET, tictactoe.MINIMUM), (spec["refill"]["target"], spec["refill"]["minimum"]))
        self.assertEqual((tictactoe.MIN_VALID, tictactoe.MAX_VALID), (3, 400))
        self.assertEqual((tictactoe.MIN_VALID, tictactoe.MAX_VALID),
                         (spec["eligibility"]["min_valid"], spec["eligibility"]["max_valid"]))

    def test_contexto(self):
        spec = specs.load("contexto")
        self.assertEqual((contexto.TARGET, contexto.MINIMUM), (60, 30))
        self.assertEqual((contexto.TARGET, contexto.MINIMUM), (spec["refill"]["target"], spec["refill"]["minimum"]))
        self.assertEqual(contexto.MIN_SECRET_BAND, fame.KNOWN)
        self.assertEqual(spec["eligibility"]["min_secret_band"], "KNOWN")
        self.assertEqual(contexto.NO_REPEAT_DAYS, 365)
        self.assertEqual(contexto.NO_REPEAT_DAYS, spec["eligibility"]["no_repeat_days"])
