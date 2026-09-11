"""SuperDraft Five — the round is CONFIG (the day + five slots), not the pool.

Two things used to be wrong at once. The round shipped the whole players-index
pool (O(dataset) per player per round, re-emitted on every reconnect), and the
renderer then drew its OWN slot constraints client-side — so two players in the
same online match drafted under different constraints and were scored against
each other anyway.

The slots are now drawn here, once per round, and the renderer resolves them
against the pool it already loads for single-player.
"""
import os
import random
import shutil
import subprocess
import unittest
from unittest import mock

from django.conf import settings
from django.test import TestCase
from django.urls import reverse

from trivia.games import players_index, superdraft

SUPERDRAFT_TSX = os.path.join(
    os.path.dirname(settings.BASE_DIR), "src", "Game Renderers", "SuperDraft.tsx"
)


def eligible_for(pool, slot):
    """The players a slot constraint offers — buildCandidates() in SuperDraft.tsx."""
    if slot["kind"] == "team":
        return [p for p in pool if any((t or {}).get("abbr") == slot["value"] for t in p.get("teams") or [])]
    if slot["kind"] == "country":
        return [p for p in pool if p.get("country") == slot["value"]]
    return [
        p for p in pool
        if isinstance(p.get("draft"), dict)
        and p["draft"].get("year") is not None
        and p["draft"]["year"] // 10 * 10 == int(slot["value"])
    ]


class SuperDraftRoundTests(TestCase):
    def round_payload(self):
        body = self.client.get(reverse("superdraft")).json()
        self.assertIn("series", body)
        self.assertTrue(body["series"])  # what index.js fetchRound extracts
        self.assertEqual(len(body["series"]), 1)
        return body["series"][0]

    def test_round_uses_the_standard_series_envelope(self):
        self.round_payload()

    def test_round_is_config_not_the_player_pool(self):
        payload = self.round_payload()
        self.assertEqual(payload["pool"], "players-index")
        self.assertEqual(sorted(payload), ["day", "pool", "slots"])
        # No player rows anywhere in it — that's the whole point.
        self.assertNotIn("person_id", self.client.get(reverse("superdraft")).content.decode())

    def test_payload_size_does_not_grow_with_the_dataset(self):
        """Defect A: the old payload was the pool, so it scaled with it."""
        rows = players_index.build_pool()
        small = len(self.client.get(reverse("superdraft")).content)
        with mock.patch.object(superdraft, "load_players", return_value=rows * 30):
            big = len(self.client.get(reverse("superdraft")).content)
        self.assertLess(small, 1500)
        self.assertLess(big, 1500)

    def test_round_carries_five_distinct_slot_constraints(self):
        slots = self.round_payload()["slots"]
        self.assertEqual(len(slots), superdraft.SLOT_COUNT)
        for slot in slots:
            self.assertEqual(sorted(slot), ["kind", "label", "sub", "value"])
            self.assertIn(slot["kind"], ("team", "country", "draft"))
            self.assertTrue(slot["label"])
            self.assertTrue(slot["sub"])
        self.assertEqual(
            len({(s["kind"], s["value"]) for s in slots}), superdraft.SLOT_COUNT
        )

    def test_every_slot_resolves_in_the_pool_the_renderer_loads(self):
        """resolveSlots() looks each slot up in buildCandidates(), which only
        keeps constraints with >= MIN_ELIGIBLE players — a slot the renderer
        can't find puts the game in its error state."""
        pool = players_index.build_pool()
        for slot in self.round_payload()["slots"]:
            self.assertGreaterEqual(
                len(eligible_for(pool, slot)), superdraft.MIN_ELIGIBLE, slot
            )

    def test_the_slots_are_drawn_per_round_not_fixed(self):
        """Rule-based randomness, server-side — not a hand-picked static set."""
        queues = superdraft._candidate_queues(players_index.build_pool())
        draws = {
            tuple((s["kind"], s["value"]) for s in superdraft.draw_slots(queues, random.Random(seed)))
            for seed in range(12)
        }
        self.assertGreater(len(draws), 1)

    def test_one_response_fully_determines_the_draft(self):
        """A room fetches ONE round and hands that same object to every member
        (dealRound in multiplayer_server/src/index.js), so the response has to
        settle the whole draft — nothing may be left for a client to draw."""
        payload = self.round_payload()
        self.assertTrue(payload["day"])
        self.assertTrue(all(s.get("kind") and s.get("value") for s in payload["slots"]))

    @unittest.skipIf(shutil.which("node") is None, "node not on PATH")
    def test_both_players_in_a_room_receive_the_same_slots(self):
        """Drives the real relay: two players queue, a room is created, and both
        emissions (plus a reconnect's resume snapshot) must carry byte-identical
        slot constraints. See multiplayer_server/scripts/sim_round_fanout.js."""
        sim = os.path.join(
            os.path.dirname(settings.BASE_DIR),
            "multiplayer_server", "scripts", "sim_round_fanout.js",
        )
        proc = subprocess.run(
            [shutil.which("node"), sim], capture_output=True, text=True, timeout=120
        )
        self.assertEqual(proc.returncode, 0, proc.stdout + proc.stderr)

    def test_renderer_plays_the_server_slots_and_never_redraws_online(self):
        """Guards defect B: drawSlots() must not run on the multiplayer path."""
        with open(SUPERDRAFT_TSX, "r", encoding="utf-8") as f:
            src = f.read()
        self.assertIn(
            "const drawn = multiplayer"
            " ? resolveSlots(candidates, round?.slots ?? []) : drawSlots(candidates);",
            src,
        )
        # The one re-roll would redraw the slots — it is single-player only.
        self.assertIn("if (multiplayer || rerollUsed || phase !== \"draft\") return;", src)
        self.assertIn("{drafting && !multiplayer && (", src)
        # The daily objective follows the round's day, not each client's clock.
        self.assertIn("dailyObjective(round?.day)", src)

    def test_empty_pool_returns_503(self):
        with mock.patch.object(superdraft, "load_players", return_value=[]):
            res = self.client.get(reverse("superdraft"))
        self.assertEqual(res.status_code, 503)

    def test_a_pool_with_no_usable_constraint_returns_503(self):
        thin = [{"person_id": 1, "teams": [{"abbr": "LAL", "name": "Lakers"}], "country": "USA"}]
        with mock.patch.object(superdraft, "load_players", return_value=thin):
            res = self.client.get(reverse("superdraft"))
        self.assertEqual(res.status_code, 503)

    def test_slot_constraints_are_not_usa_only(self):
        """Country slots must stay derivable from the data, never hard-coded."""
        countries = {r.get("country") for r in players_index.build_pool()}
        self.assertGreater(len({c for c in countries if c}), 1)

    def test_no_longer_publishes_a_static_pool(self):
        self.assertFalse(hasattr(superdraft, "build_pool"))
        self.assertFalse(hasattr(superdraft, "SEED_PATH"))
