import random

from django.test import SimpleTestCase

from trivia.questions.games import GAME_MODULES, imposter
from trivia.tests.questions_fixture import fixture_dataset

REQUIRED = ("SLUG", "TARGET", "MINIMUM", "generate", "materialize", "validate", "index_item", "players_referenced", "qid_for")


class RegistryTests(SimpleTestCase):
    def test_every_module_has_the_interface(self):
        self.assertEqual(sorted(GAME_MODULES), ["career-path", "contexto", "imposter", "superdraft", "tictactoe", "who-are-ya"])
        for slug, mod in GAME_MODULES.items():
            self.assertEqual(mod.SLUG, slug)
            for name in REQUIRED:
                self.assertTrue(hasattr(mod, name), f"{slug} lacks {name}")


class ImposterTests(SimpleTestCase):
    def test_single_definition_and_names(self):
        ds = fixture_dataset()
        defs = imposter.generate(ds, set(), random.Random(0), 5)
        self.assertEqual(defs, [{"rule": "fame_tier<=2"}])
        m = imposter.materialize(defs[0], ds)
        self.assertTrue(all(ds.by_id[p]["full_name"] in m["names"] for p in imposter.players_referenced(defs[0], m, ds)))
        self.assertGreaterEqual(len(m["names"]), imposter.MINIMUM)
        self.assertEqual(imposter.validate(m), [])
        self.assertEqual(imposter.qid_for(defs[0], 0), "imposter-pool")
