import copy
import json

from django.test import RequestFactory, TestCase

from trivia.games import connections, connections_validate


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


class ConnectionsSeedValidatorTest(TestCase):
    """The standalone seed validator (structural + cross-group + own-label)."""

    def setUp(self):
        self.boards = connections_validate._load(connections_validate.SEED)
        self.curated = connections_validate._index_curated(
            connections_validate._load(connections_validate.CURATED)
        )

    def _board(self, qid):
        return copy.deepcopy(next(b for b in self.boards if b["qid"] == qid))

    @staticmethod
    def _swap(board, label, old, new):
        """Put `new` back where `old` used to be, in the tiles and the group."""
        group = next(g for g in board["groups"] if g["label"] == label)
        group["members"][group["members"].index(old)] = new
        board["tiles"][board["tiles"].index(old)] = new

    def test_every_shipped_board_is_valid(self):
        self.assertEqual(connections_validate.validate(self.boards, self.curated), [])

    def test_own_label_check_catches_wrong_draft_year(self):
        # Chris Paul was drafted in 2005. Before the own-label check the seed
        # shipped him in cn-032's "2003 Draft" group and the validator passed:
        # no OTHER group's member was a 2003 pick, and that was all it looked at.
        board = self._board("cn-032")
        next(g for g in board["groups"] if g["label"] == "Banana boat crew")["label"] = (
            "2003 Draft (banana boat era)"
        )
        problems = connections_validate.validate([board], self.curated)
        self.assertEqual(len(problems), 1)
        self.assertIn("Chris Paul", problems[0])
        self.assertIn("does not satisfy its own label [draft_year=2003]", problems[0])

    def test_own_label_check_catches_wrong_college(self):
        # Kemba Walker went to Connecticut, not Syracuse or Memphis.
        board = self._board("cn-010")
        self._swap(board, "Syracuse / Memphis stars", "Tyreke Evans", "Kemba Walker")
        problems = connections_validate.validate([board], self.curated)
        self.assertEqual(len(problems), 1)
        self.assertIn("Kemba Walker", problems[0])
        self.assertIn("does not satisfy its own label", problems[0])

    def test_own_label_check_catches_wrong_position(self):
        # Steve Nash is a guard, so he cannot be one of the "bigs".
        board = self._board("cn-023")
        self._swap(board, "International Hall-of-Fame bigs", "Dikembe Mutombo", "Steve Nash")
        problems = connections_validate.validate([board], self.curated)
        self.assertEqual(len(problems), 1)
        self.assertIn("Steve Nash", problems[0])
        self.assertIn("[position=FC]", problems[0])

    def test_own_label_check_catches_a_non_first_overall_pick(self):
        # cn-040's decade groups are all No. 1 picks; Kemba Walker went 9th.
        board = self._board("cn-040")
        self._swap(board, "No. 1 overall picks (2010s)", "Kyrie Irving", "Kemba Walker")
        problems = connections_validate.validate([board], self.curated)
        self.assertEqual(len(problems), 1)
        self.assertIn("Kemba Walker", problems[0])
        self.assertIn("[top_pick=2010]", problems[0])

    def test_own_label_check_catches_a_top_pick_from_the_wrong_decade(self):
        # Magic Johnson went first overall, but in 1979, not in the 1980s.
        board = self._board("cn-040")
        self._swap(board, "No. 1 overall picks (1980s)", "James Worthy", "Magic Johnson")
        problems = connections_validate.validate([board], self.curated)
        self.assertEqual(len(problems), 1)
        self.assertIn("Magic Johnson", problems[0])
        self.assertIn("[top_pick=1980]", problems[0])

    def test_never_a_number_one_pick_group_rejects_a_number_one_pick(self):
        board = self._board("cn-003")
        self._swap(board, "Never a No. 1 overall pick", "Bradley Beal", "Anthony Davis")
        problems = connections_validate.validate([board], self.curated)
        self.assertEqual(len(problems), 1)
        self.assertIn("Anthony Davis", problems[0])
        self.assertIn("[not_top_pick=True]", problems[0])

    def test_the_same_four_players_may_not_be_a_group_on_two_boards(self):
        # The seed shipped one nickname group verbatim on cn-006 and cn-037.
        first, second = self._board("cn-006"), self._board("cn-037")
        second["groups"][0]["members"] = list(first["groups"][0]["members"])
        second["tiles"] = [m for g in second["groups"] for m in g["members"]]
        problems = connections_validate.validate([first, second], self.curated)
        self.assertTrue(
            any("repeats cn-006's" in p for p in problems), problems)

    def test_national_team_label_is_not_read_as_a_birthplace(self):
        # "Spain national team" is a roster, not a birthplace: the own-label
        # check must stay quiet about Congo-born Serge Ibaka, who played for it.
        board = self._board("cn-036")
        self._swap(board, "Spain national team", "Jose Calderon", "Serge Ibaka")
        self.assertEqual(connections_validate.validate([board], self.curated), [])
