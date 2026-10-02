"""backend/scripts/vercel_usage_report.py against fixture responses (no network).

The deployments fixtures follow the documented GET /v7/deployments response
(https://vercel.com/docs/rest-api/deployments/list-deployments); the manifest
fixture is a trimmed copy of the live data host's manifest.
"""

import gzip
import importlib.util
import json
import os
import urllib.parse

from django.conf import settings
from django.test import SimpleTestCase

FIXTURES = os.path.join(os.path.dirname(__file__), "fixtures")
_spec = importlib.util.spec_from_file_location(
    "vercel_usage_report", os.path.join(settings.BASE_DIR, "scripts", "vercel_usage_report.py"))
usage = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(usage)

BASE = "https://data.example"
NOW_MS = 1791014400000 + 3600 * 1000  # an hour after the newest fixture deployment


def _fixture(name):
    with open(os.path.join(FIXTURES, name), "rb") as f:
        return f.read()


class FakeHost:
    """Routes GETs to fixture bytes and records every request."""

    def __init__(self, manifest_status=200, deployments_status=200):
        self.calls = []
        self.manifest_status = manifest_status
        self.deployments_status = deployments_status
        self.manifest = json.loads(_fixture("data_host_manifest.json"))

    def __call__(self, url, headers=None):
        self.calls.append((url, headers or {}))
        parsed = urllib.parse.urlparse(url)
        if parsed.netloc == "api.vercel.com":
            if self.deployments_status != 200:
                return self.deployments_status, {}, b'{"error":{"code":"forbidden"}}'
            query = urllib.parse.parse_qs(parsed.query)
            page = "vercel_deployments_page2.json" if "until" in query else "vercel_deployments_page1.json"
            return 200, {"Content-Type": "application/json"}, _fixture(page)
        if parsed.path == "/manifest.json":
            return self.manifest_status, {}, _fixture("data_host_manifest.json")
        # A data file: 1000 raw bytes, served gzip'd.
        raw = (parsed.path.encode() * 100)[:1000]
        return 200, {"Content-Encoding": "gzip"}, gzip.compress(raw)


class ManifestParsingTests(SimpleTestCase):
    def test_every_referenced_file_is_listed_per_game(self):
        files = usage.manifest_files(json.loads(_fixture("data_host_manifest.json")))
        self.assertEqual(sorted(files), ["all-players", "fan-favorites", "mvps", "playoff"])
        self.assertEqual(files["playoff"], ["playoff/c00.9f8e7d6c5b4a.json", "playoff/teams.1a2b3c4d5e6f.json"])
        self.assertEqual(files["all-players"], ["shared/players-names.5e6f7a8b9c0d.json"])
        self.assertEqual(sum(len(p) for p in files.values()), 6)

    def test_published_bytes_counts_raw_and_served(self):
        host = FakeHost()
        sizes = usage.published_bytes(BASE, host.manifest, host)
        self.assertEqual(sizes["files"], 6)
        self.assertEqual(sizes["raw"], 6000)
        self.assertGreater(sizes["served"], 0)
        self.assertLess(sizes["served"], sizes["raw"])
        self.assertEqual(sizes["games"]["playoff"]["raw"], 2000)
        self.assertEqual(sizes["failed"], [])
        self.assertTrue(all(h.get("Accept-Encoding") == "gzip" for _, h in host.calls))

    def test_a_missing_file_is_reported_not_fatal(self):
        def get(url, headers=None):
            if "mvps" in url:
                return 404, {}, b""
            return 200, {}, b"[1,2,3]"
        sizes = usage.published_bytes(BASE, json.loads(_fixture("data_host_manifest.json")), get)
        self.assertEqual(len(sizes["failed"]), 1)
        self.assertIn("HTTP 404", sizes["failed"][0])
        self.assertEqual(sizes["raw"], 7 * 5)


    def test_question_games_count_their_index_and_every_question_file(self):
        manifest = {"games": {"career-path": {"kind": "questions", "rows": 2,
                                              "index": "career-path/index.0a1b2c3d4e5f.json"}},
                    "question_names": "shared/question-names.111111111111.json"}
        index = {"game": "career-path", "items": [["cp-1", 1], ["cp-2", 3]],
                 "files": {"cp-1": "aaaaaaaaaaaa", "cp-2": "bbbbbbbbbbbb"}}
        seen = []

        def get(url, headers=None):
            seen.append(urllib.parse.urlparse(url).path)
            if "index." in url:
                return 200, {"Content-Encoding": "gzip"}, gzip.compress(json.dumps(index).encode())
            return 200, {}, b"x" * 10
        sizes = usage.published_bytes(BASE, manifest, get)
        self.assertEqual(sizes["games"]["career-path"]["files"], 3)
        self.assertEqual(sizes["games"]["question-names"]["files"], 1)
        self.assertIn("/career-path/cp-2.bbbbbbbbbbbb.json", seen)
        self.assertEqual(sizes["failed"], [])


class DeploymentsTests(SimpleTestCase):
    def test_paginates_and_keeps_only_the_window(self):
        host = FakeHost()
        found = usage.deployments_since("tok", "prj_x", "team_abc", NOW_MS - 7 * usage.DAY_MS, host)
        self.assertEqual(len(found), 3)  # the 4th is older than 7 days
        self.assertEqual(usage.summarize_deployments(found),
                         {"total": 3, "ready": 2, "failed": 1, "production": 2})
        first, second = (urllib.parse.parse_qs(urllib.parse.urlparse(u).query) for u, _ in host.calls)
        self.assertEqual(first["teamId"], ["team_abc"])
        self.assertEqual(first["projectId"], ["prj_x"])
        self.assertNotIn("until", first)
        self.assertEqual(second["until"], ["1790949999999"])
        self.assertEqual(host.calls[0][1]["Authorization"], "Bearer tok")

    def test_personal_account_id_is_not_sent_as_team(self):
        host = FakeHost()
        usage.deployments_since("tok", "prj_x", "user123", NOW_MS - usage.DAY_MS, host)
        self.assertNotIn("teamId", urllib.parse.parse_qs(urllib.parse.urlparse(host.calls[0][0]).query))

    def test_api_error_raises(self):
        with self.assertRaises(OSError):
            usage.deployments_since("tok", "prj_x", "team_abc", 0, FakeHost(deployments_status=403))


class ReportTests(SimpleTestCase):
    def test_full_report(self):
        msg = usage.build_report(BASE, "tok", "prj_x", "team_abc", 7, NOW_MS, FakeHost())
        self.assertIn("Live data version 2026-10-02.1", msg)
        self.assertIn("6 files, 5.9 KB raw", msg)
        self.assertIn("last 7 days: 3 (2 ready, 1 failed/canceled)", msg)
        # Never a made-up percentage: bandwidth is stated as unavailable, with the dashboard link.
        self.assertNotRegex(msg, r"\d\s*%")
        self.assertIn("not available via API on the Hobby plan", msg)
        self.assertIn(usage.USAGE_DASHBOARD, msg)
        self.assertIn("100 GB", msg)

    def test_degrades_when_everything_is_down(self):
        msg = usage.build_report(BASE, "tok", "prj_x", "team_abc", 7, NOW_MS,
                                 FakeHost(manifest_status=503, deployments_status=403))
        self.assertIn("Live manifest unavailable: HTTP 503", msg)
        self.assertIn("Data deployments: unavailable (GET /v7/deployments: HTTP 403", msg)
        self.assertIn("Bandwidth used: not available", msg)

    def test_missing_token_is_noted(self):
        msg = usage.build_report(BASE, "", "", "", 7, NOW_MS, FakeHost())
        self.assertIn("VERCEL_TOKEN / VERCEL_DATA_PROJECT_ID not set", msg)
