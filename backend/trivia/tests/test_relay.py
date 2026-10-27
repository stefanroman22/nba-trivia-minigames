"""nba_api goes through the Cloudflare relay when NBA_RELAY_BASE/KEY are set.

The fake sits at requests.Session.get, the call that receives nba_api's final
URL and headers, so a real endpoint class is exercised end to end.
"""

import json
import os
from unittest import mock

import requests
from django.test import SimpleTestCase
from nba_api.stats.endpoints import commonplayerinfo
from nba_api.stats.library.http import NBAStatsHTTP

from trivia.data_pipeline import relay, sources

BASE = "https://relay.example.workers.dev"
KEY = "test-relay-key"
DIRECT = "https://stats.nba.com/stats/commonplayerinfo"
BODY = json.dumps({"resultSets": [
    {"name": name, "headers": [], "rowSet": []}
    for name in ("CommonPlayerInfo", "PlayerHeadlineStats", "AvailableSeasons")
]})


def _env(**values):
    """os.environ with both relay variables removed, then `values` applied."""
    env = {k: v for k, v in os.environ.items() if k not in ("NBA_RELAY_BASE", "NBA_RELAY_KEY")}
    env.update(values)
    return mock.patch.dict(os.environ, env, clear=True)


class RelayTestCase(SimpleTestCase):
    def setUp(self):
        relay.reset()
        self.addCleanup(relay.reset)

    def _request(self):
        """One real CommonPlayerInfo call; returns the kwargs Session.get saw."""
        fake = mock.Mock(url="", status_code=200, text=BODY)
        with mock.patch.object(requests.Session, "get", autospec=True, return_value=fake) as get:
            commonplayerinfo.CommonPlayerInfo(player_id=2544, timeout=5)
        self.assertEqual(get.call_count, 1)
        return get.call_args.kwargs


class ConfiguredTests(RelayTestCase):
    def test_request_goes_to_the_relay_with_the_key_and_without_host(self):
        browser_headers = {k: v for k, v in NBAStatsHTTP.headers.items() if k.lower() != "host"}
        with _env(NBA_RELAY_BASE=BASE + "/", NBA_RELAY_KEY=KEY):
            self.assertTrue(relay.configure())
        sent = self._request()
        self.assertEqual(sent["url"], f"{BASE}/stats/commonplayerinfo")
        self.assertEqual(sent["headers"]["X-Relay-Key"], KEY)
        self.assertNotIn("host", {name.lower() for name in sent["headers"]})
        # nba_api's browser headers still travel; the relay forwards them upstream.
        # Compared against nba_api's own set, since its header names change between releases.
        self.assertTrue(browser_headers)
        self.assertEqual({k: sent["headers"].get(k) for k in browser_headers}, browser_headers)

    def test_configure_logs_the_base_never_the_key(self):
        with _env(NBA_RELAY_BASE=BASE, NBA_RELAY_KEY=KEY), \
                self.assertLogs("trivia.data_pipeline.relay", level="INFO") as logs:
            relay.configure()
        self.assertEqual(logs.output, [f"INFO:trivia.data_pipeline.relay:nba_api routed through relay {BASE}"])
        self.assertNotIn(KEY, "".join(logs.output))

    def test_idempotent(self):
        with _env(NBA_RELAY_BASE=BASE, NBA_RELAY_KEY=KEY):
            self.assertTrue(relay.configure())
            headers = NBAStatsHTTP.headers
            with self.assertNoLogs("trivia.data_pipeline.relay", level="INFO"):
                self.assertTrue(relay.configure())
        self.assertIs(NBAStatsHTTP.headers, headers)
        self.assertEqual(NBAStatsHTTP.base_url, f"{BASE}/stats/{{endpoint}}")
        self.assertEqual(self._request()["url"], f"{BASE}/stats/commonplayerinfo")

    def test_reset_restores_the_direct_call(self):
        original_url, original_headers = NBAStatsHTTP.base_url, NBAStatsHTTP.headers
        with _env(NBA_RELAY_BASE=BASE, NBA_RELAY_KEY=KEY):
            relay.configure()
        relay.reset()
        self.assertEqual(NBAStatsHTTP.base_url, original_url)
        self.assertIs(NBAStatsHTTP.headers, original_headers)
        self.assertNotIn("X-Relay-Key", original_headers)  # the original dict was never touched
        self.assertEqual(original_headers["Host"], "stats.nba.com")
        self.assertEqual(self._request()["url"], DIRECT)


class UnconfiguredTests(RelayTestCase):
    def test_unset_leaves_nba_api_direct(self):
        with _env():
            self.assertFalse(relay.configure())
        sent = self._request()
        self.assertEqual(sent["url"], DIRECT)
        self.assertNotIn("X-Relay-Key", sent["headers"])
        self.assertEqual(sent["headers"]["Host"], "stats.nba.com")

    def test_half_config_fails_loud(self):
        for given, missing in ((dict(NBA_RELAY_BASE=BASE), "NBA_RELAY_KEY"),
                               (dict(NBA_RELAY_KEY=KEY), "NBA_RELAY_BASE")):
            with self.subTest(missing=missing), _env(**given):
                with self.assertRaisesRegex(RuntimeError, missing):
                    relay.configure()
                self.assertEqual(self._request()["url"], DIRECT)  # nothing half-installed


class _Stop(Exception):
    pass


class SourcesHookTests(SimpleTestCase):
    """Every network fetch configures the relay first, so a half config stops it
    before any request (fetch_players' static fallback must not swallow it)."""

    def setUp(self):
        relay.reset()
        self.addCleanup(relay.reset)
        patcher = mock.patch.object(sources, "_RELAY_CONFIGURED", False)
        patcher.start()
        self.addCleanup(patcher.stop)

    def test_every_fetch_calls_ensure_relay_first(self):
        calls = {
            "fetch_players": lambda: sources.fetch_players(season="2024-25"),
            "fetch_playoff_series": lambda: sources.fetch_playoff_series(["2024-25"], pause=0),
            "fetch_starting_five": lambda: sources.fetch_starting_five(["2024-25"], pause=0),
            "fetch_draft_history": sources.fetch_draft_history,
            "fetch_franchise_history": sources.fetch_franchise_history,
            "fetch_player_profile": lambda: sources.fetch_player_profile(2544, pause=0),
        }
        for name, call in calls.items():
            with self.subTest(name), \
                    mock.patch.object(sources, "_ensure_relay", side_effect=_Stop), \
                    mock.patch.object(requests.Session, "get", side_effect=AssertionError("network")):
                with self.assertRaises(_Stop):
                    call()

    def test_ensure_relay_configures_once(self):
        with mock.patch.object(relay, "configure", return_value=True) as configure:
            sources._ensure_relay()
            sources._ensure_relay()
        configure.assert_called_once_with()

    def test_half_config_raises_from_a_fetch(self):
        with _env(NBA_RELAY_BASE=BASE), \
                mock.patch.object(requests.Session, "get", side_effect=AssertionError("network")):
            with self.assertRaisesRegex(RuntimeError, "NBA_RELAY_KEY"):
                sources.fetch_draft_history()
