from django.db import IntegrityError
from django.test import TestCase

from trivia.models import Question
from trivia.questions.hashing import content_hash


class ContentHashTests(TestCase):
    def test_hash_is_order_independent_and_stable(self):
        a = content_hash({"rows": [1, 2], "cols": [3]})
        b = content_hash({"cols": [3], "rows": [1, 2]})
        self.assertEqual(a, b)
        self.assertEqual(len(a), 64)

    def test_hash_changes_with_content(self):
        self.assertNotEqual(content_hash({"person_id": 1}), content_hash({"person_id": 2}))


class QuestionModelTests(TestCase):
    def test_defaults_and_uniqueness(self):
        d = {"person_id": 2544}
        q = Question.objects.create(game="career-path", qid="cp-000001",
                                    definition=d, content_hash=content_hash(d))
        self.assertEqual(q.status, "active")
        self.assertEqual(q.players_referenced, [])
        self.assertEqual(q.created_by, "generator")
        with self.assertRaises(IntegrityError):
            Question.objects.create(game="career-path", qid="cp-000002",
                                    definition=d, content_hash=content_hash(d))
