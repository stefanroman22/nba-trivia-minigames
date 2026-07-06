import json

from django.test import RequestFactory, TestCase

from trivia.games import connections


class ConnectionsBackendTest(TestCase):
    def test_get_round_returns_one_board(self):
        resp = connections.get_round(RequestFactory().get("/"))
        self.assertEqual(resp.status_code, 200)
        payload = json.loads(resp.content)
        self.assertEqual(len(payload["series"]), 1)
        board = payload["series"][0]
        self.assertEqual(len(board["tiles"]), 16)
        self.assertEqual(len(board["groups"]), 4)

    def test_build_pool_nonempty_and_valid(self):
        pool = connections.build_pool()
        self.assertEqual(len(pool), 40)
        self.assertEqual(connections.validate_rows(pool), [])
