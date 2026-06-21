from unittest.mock import patch

from django.test import TestCase

from backend.env_utils import env_bool, env_list


class EnvBoolTests(TestCase):
    def test_missing_returns_default(self):
        self.assertTrue(env_bool("X_NB_MISSING", True))
        self.assertFalse(env_bool("X_NB_MISSING", False))

    def test_truthy_and_falsey(self):
        for v in ["1", "true", "TRUE", "Yes", "on"]:
            with patch.dict("os.environ", {"X_NB": v}):
                self.assertTrue(env_bool("X_NB", False))
        for v in ["0", "false", "no", "off", ""]:
            with patch.dict("os.environ", {"X_NB": v}):
                self.assertFalse(env_bool("X_NB", True))


class EnvListTests(TestCase):
    def test_missing_returns_default_copy(self):
        default = ["a"]
        result = env_list("X_NL_MISSING", default)
        self.assertEqual(result, ["a"])
        result.append("b")
        self.assertEqual(default, ["a"])  # default not mutated

    def test_splits_and_trims(self):
        with patch.dict("os.environ", {"X_NL": "a, b ,c,"}):
            self.assertEqual(env_list("X_NL", []), ["a", "b", "c"])
