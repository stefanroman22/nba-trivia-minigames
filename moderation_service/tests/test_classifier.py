"""Core tests with a fake onnxruntime session: no model file, no network.

Run: python -m unittest discover -s moderation_service/tests
"""
import hashlib
import io
import os
import sys
import tempfile
import unittest
from types import SimpleNamespace

import numpy as np
from PIL import Image

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import classifier  # noqa: E402


def jpeg(size=(300, 200), color=(30, 120, 200), fmt="JPEG"):
    out = io.BytesIO()
    Image.new("RGB", size, color).save(out, format=fmt)
    return out.getvalue()


class FakeSession:
    def __init__(self, shape, dtype, scores):
        self._input = SimpleNamespace(name="input", shape=shape, type=dtype)
        self._scores = np.asarray([scores], dtype=np.float32)
        self.fed = None

    def get_inputs(self):
        return [self._input]

    def get_outputs(self):
        return [SimpleNamespace(name="output", shape=[1, 3], type="tensor(float)")]

    def run(self, output_names, feeds):
        self.fed = feeds
        return [self._scores]


class VerifySha256Tests(unittest.TestCase):
    def setUp(self):
        fd, self.path = tempfile.mkstemp()
        with os.fdopen(fd, "wb") as fh:
            fh.write(b"not really a model")
        self.digest = hashlib.sha256(b"not really a model").hexdigest()

    def tearDown(self):
        os.remove(self.path)

    def test_match_returns_digest(self):
        self.assertEqual(classifier.verify_sha256(self.path, self.digest), self.digest)

    def test_sha256sum_line_and_whitespace_accepted(self):
        self.assertEqual(classifier.verify_sha256(self.path, f"{self.digest.upper()}  model.onnx\n"), self.digest)

    def test_mismatch_raises(self):
        with self.assertRaises(classifier.ModelUnavailable):
            classifier.verify_sha256(self.path, "0" * 64)

    def test_unpinned_raises(self):
        for pin in ("UNPINNED", "UNPINNED\n", "", None):
            with self.assertRaises(classifier.ModelUnavailable):
                classifier.verify_sha256(self.path, pin)

    def test_missing_file_raises(self):
        with self.assertRaises(classifier.ModelUnavailable):
            classifier.verify_sha256(self.path + ".missing", self.digest)

    def test_load_session_refuses_unpinned_before_importing_onnxruntime(self):
        with self.assertRaises(classifier.ModelUnavailable):
            classifier.load_session(self.path, "UNPINNED")


class PreprocessTests(unittest.TestCase):
    def test_uint8_nhwc(self):
        meta = SimpleNamespace(name="x", shape=["batch", 224, 224, 3], type="tensor(uint8)")
        arr = classifier.preprocess(jpeg(), meta)
        self.assertEqual(arr.shape, (1, 224, 224, 3))
        self.assertEqual(arr.dtype, np.uint8)

    def test_uint8_nchw(self):
        meta = SimpleNamespace(name="x", shape=[1, 3, 224, 224], type="tensor(uint8)")
        arr = classifier.preprocess(jpeg(), meta)
        self.assertEqual(arr.shape, (1, 3, 224, 224))
        self.assertEqual(arr.dtype, np.uint8)

    def test_float32_keeps_0_255_pixels(self):
        meta = SimpleNamespace(name="x", shape=[None, 3, 224, 224], type="tensor(float)")
        arr = classifier.preprocess(jpeg(color=(250, 10, 10), fmt="PNG"), meta)
        self.assertEqual(arr.shape, (1, 3, 224, 224))
        self.assertEqual(arr.dtype, np.float32)
        self.assertGreater(arr[0, 0].mean(), 200)  # red channel, not normalized to 0-1

    def test_tiny_image_rejected(self):
        meta = SimpleNamespace(name="x", shape=[1, 224, 224, 3], type="tensor(uint8)")
        with self.assertRaises(ValueError):
            classifier.preprocess(jpeg(size=(1, 1), fmt="PNG"), meta)

    def test_truncated_and_garbage_rejected(self):
        meta = SimpleNamespace(name="x", shape=[1, 224, 224, 3], type="tensor(uint8)")
        for data in (jpeg()[:200], b"definitely not an image", b""):
            with self.assertRaises(ValueError):
                classifier.preprocess(data, meta)


class PostprocessTests(unittest.TestCase):
    def test_probabilities_pass_through(self):
        out = classifier.postprocess([np.array([[0.1, 0.2, 0.7]])])
        self.assertAlmostEqual(out["nsfw"], 0.1, places=5)
        self.assertAlmostEqual(out["sfw"], 0.7, places=5)

    def test_logits_are_softmaxed(self):
        out = classifier.postprocess([np.array([[2.0, -1.0, 5.0]])])
        self.assertAlmostEqual(sum(out.values()), 1.0, places=6)
        self.assertEqual(max(out, key=out.get), "sfw")

    def test_class_order_env_value_is_honoured(self):
        order = classifier.parse_class_order("sfw, nsfw ,nsfl")
        out = classifier.postprocess([np.array([[0.7, 0.2, 0.1]])], order)
        self.assertAlmostEqual(out["sfw"], 0.7, places=5)
        self.assertAlmostEqual(out["nsfl"], 0.1, places=5)
        self.assertEqual(classifier.parse_class_order(None), ("nsfw", "nsfl", "sfw"))
        with self.assertRaises(ValueError):
            classifier.parse_class_order("nsfw,sfw")

    def test_wrong_score_count_raises(self):
        with self.assertRaises(ValueError):
            classifier.postprocess([np.array([[0.5, 0.5]])])


class ClassifyTests(unittest.TestCase):
    def test_full_pipeline_with_fake_session(self):
        session = FakeSession([1, 224, 224, 3], "tensor(uint8)", [0.05, 0.05, 0.9])
        out = classifier.classify(session, jpeg())
        self.assertEqual(set(out), {"nsfw", "nsfl", "sfw"})
        self.assertAlmostEqual(out["sfw"], 0.9, places=5)
        self.assertEqual(session.fed["input"].shape, (1, 224, 224, 3))


if __name__ == "__main__":
    unittest.main()
