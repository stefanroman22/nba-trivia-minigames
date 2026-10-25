"""python -m unittest discover -s scripts/player-photos -p "test_*.py" -v"""
import json, os, sys, tempfile, unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from apply_review import apply  # noqa: E402

TODAY = "2026-10-26"


class ApplyReviewTest(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.mkdtemp()
        self.review = os.path.join(self.dir, "review")
        os.mkdir(self.review)
        self.extra = os.path.join(self.dir, "commons-extra.json")
        self.faces = os.path.join(self.dir, "faces.json")
        self.write(self.extra, {"2242": {"file": "Terence Morris.jpg", "face_x": 50, "face_y": 22}})
        self.write(self.faces, {
            "100": {"file": "C.jpg", "aspect": 1.2, "box": [0.1, 0.1, 0.1, 0.1]},
            "21": {"file": "B.jpg", "aspect": 1.5, "box": None},
            "2": {"file": "A.jpg", "aspect": 1.4, "box": [0.4, 0.05, 0.2, 0.2]},
        })

    def write(self, path, data):
        with open(path, "w", encoding="utf-8") as f:
            json.dump(data, f)

    def read(self, path):
        with open(path, encoding="utf-8") as f:
            return json.load(f)

    def sheet(self, name, exclude=None, box=None):
        self.write(os.path.join(self.review, name), {"sheet": name, "exclude": exclude or {}, "box": box or {}})

    def test_exclude_adds_entry_with_dated_reason(self):
        self.sheet("sheet-01.json", exclude={"21": "back view"})
        apply(self.review, self.extra, self.faces, TODAY)
        self.assertEqual(self.read(self.extra)["21"], {"exclude": True, "reason": "photo review 2026-10-26: back view"})

    def test_exclude_replaces_a_hand_find(self):
        self.sheet("sheet-01.json", exclude={"2242": "group shot"})
        apply(self.review, self.extra, self.faces, TODAY)
        self.assertEqual(self.read(self.extra)["2242"], {"exclude": True, "reason": "photo review 2026-10-26: group shot"})

    def test_box_sets_manual_and_keeps_file_and_aspect(self):
        self.sheet("sheet-01.json", box={"21": [0.4, 0.1, 0.2, 0.2]})
        apply(self.review, self.extra, self.faces, TODAY)
        self.assertEqual(self.read(self.faces)["21"], {"file": "B.jpg", "aspect": 1.5, "box": [0.4, 0.1, 0.2, 0.2], "manual": True})

    def test_box_for_unknown_pid_raises_and_writes_nothing(self):
        before_extra, before_faces = open(self.extra).read(), open(self.faces).read()
        self.sheet("sheet-01.json", exclude={"21": "back view"}, box={"999": [0.4, 0.1, 0.2, 0.2]})
        with self.assertRaises(ValueError) as cm:
            apply(self.review, self.extra, self.faces, TODAY)
        self.assertIn("999", str(cm.exception))
        self.assertEqual(open(self.extra).read(), before_extra)
        self.assertEqual(open(self.faces).read(), before_faces)

    def test_faces_sorted_numerically_extra_keeps_order_and_counts_returned(self):
        self.sheet("sheet-01.json", exclude={"100": "tiny face"}, box={"21": [0.4, 0.1, 0.2, 0.2]})
        self.sheet("sheet-02.json", exclude={"2": "jersey"})
        self.assertEqual(apply(self.review, self.extra, self.faces, TODAY), (2, 1))
        self.assertEqual(list(self.read(self.faces)), ["2", "21", "100"])
        self.assertEqual(list(self.read(self.extra)), ["2242", "100", "2"])


if __name__ == "__main__":
    unittest.main()
