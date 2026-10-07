"""Testable core of the image moderation service (no HTTP, no env reads at import).

The handler in api/classify.py wires these together; eval/run_eval.py reuses them so the eval
scores exactly what production scores. Nothing here logs or stores image bytes.
"""
import hashlib
import io

import numpy as np
from PIL import Image, ImageOps

MODEL_ID = "OwenElliott/image-safety-classifier-xs"
DEFAULT_CLASS_ORDER = ("nsfw", "nsfl", "sfw")
UNPINNED = "UNPINNED"
INPUT_SIZE = 224

# Mirrors the Django-side cap so a decompression bomb can't reach the model.
MAX_PIXELS = 40_000_000


class ModelUnavailable(Exception):
    """Model file missing, unpinned, or its SHA-256 does not match the pinned value."""


def verify_sha256(path, expected):
    """Hash `path` and compare with `expected`; return the hex digest. Refuses an unpinned model."""
    # A pin file may be `sha256sum` output ("<hex>  <name>"): the first token is the hash.
    tokens = (expected or "").split()
    expected = tokens[0].lower() if tokens else ""
    if not expected or expected == UNPINNED.lower():
        raise ModelUnavailable("model checksum is not pinned")
    h = hashlib.sha256()
    try:
        with open(path, "rb") as fh:
            for chunk in iter(lambda: fh.read(1 << 20), b""):
                h.update(chunk)
    except OSError as exc:
        raise ModelUnavailable(f"model file unreadable: {exc.__class__.__name__}") from None
    digest = h.hexdigest()
    if digest != expected:
        raise ModelUnavailable("model checksum mismatch")
    return digest


def load_session(path, expected_sha256):
    """Verify the file, then open an onnxruntime CPU session. Returns (session, sha256 hex)."""
    digest = verify_sha256(path, expected_sha256)
    import onnxruntime as ort  # heavy: only once the checksum passed

    opts = ort.SessionOptions()
    opts.intra_op_num_threads = 1
    session = ort.InferenceSession(path, sess_options=opts, providers=["CPUExecutionProvider"])
    return session, digest


def parse_class_order(value):
    """'nsfw,nsfl,sfw' -> ('nsfw', 'nsfl', 'sfw'); must name exactly those three classes."""
    if not value:
        return DEFAULT_CLASS_ORDER
    order = tuple(part.strip().lower() for part in value.split(",") if part.strip())
    if sorted(order) != sorted(DEFAULT_CLASS_ORDER):
        raise ValueError("class order must list nsfw, nsfl and sfw exactly once")
    return order


def _decode(image_bytes):
    if not image_bytes:
        raise ValueError("empty image")
    try:
        img = Image.open(io.BytesIO(image_bytes))
        if img.width * img.height > MAX_PIXELS:
            raise ValueError("image too large")
        img.load()
        img = ImageOps.exif_transpose(img)
    except ValueError:
        raise
    except Exception:
        raise ValueError("unreadable image") from None
    if img.width < 2 or img.height < 2:
        raise ValueError("image too small")
    return img.convert("RGB").resize((INPUT_SIZE, INPUT_SIZE), Image.BILINEAR)


def preprocess(image_bytes, input_meta):
    """Decode, resize to 224x224 RGB, and lay out as the session's first input declares.

    `input_meta` is `session.get_inputs()[0]` (`name`, `shape`, `type`). uint8 inputs get raw pixels;
    float inputs get the same pixels as float32 in 0-255 (normalization is baked into the model).
    NHWC when the last dim is 3, else NCHW. A dynamic/None batch dim becomes 1.
    """
    img = _decode(image_bytes)
    pixels = np.asarray(img, dtype=np.uint8)  # H, W, 3
    shape = list(getattr(input_meta, "shape", None) or [])
    channels_last = len(shape) == 4 and shape[-1] == 3
    arr = pixels if channels_last else pixels.transpose(2, 0, 1)
    arr = arr[np.newaxis, ...]
    in_type = str(getattr(input_meta, "type", "tensor(float)"))
    if in_type == "tensor(uint8)":
        return np.ascontiguousarray(arr, dtype=np.uint8)
    if in_type in ("tensor(float)", "tensor(float16)"):
        dtype = np.float16 if in_type == "tensor(float16)" else np.float32
        return np.ascontiguousarray(arr, dtype=dtype)
    raise ValueError(f"unsupported model input type {in_type}")


def postprocess(outputs, class_order=DEFAULT_CLASS_ORDER):
    """`session.run` outputs (batch of 1) -> {class: probability}. The first output is the scores;
    softmax is applied when they aren't already a probability distribution (i.e. logits)."""
    row = np.asarray(outputs[0], dtype=np.float64).reshape(-1)
    if row.size != len(class_order):
        raise ValueError(f"model returned {row.size} scores for {len(class_order)} classes")
    is_distribution = bool(np.all(row >= 0) and np.all(row <= 1) and abs(row.sum() - 1.0) < 1e-3)
    if not is_distribution:
        shifted = np.exp(row - row.max())
        row = shifted / shifted.sum()
    return {name: float(row[i]) for i, name in enumerate(class_order)}


def classify(session, image_bytes, class_order=DEFAULT_CLASS_ORDER):
    """Full pipeline for one image: preprocess -> run -> postprocess."""
    meta = session.get_inputs()[0]
    tensor = preprocess(image_bytes, meta)
    outputs = session.run(None, {meta.name: tensor})
    return postprocess(outputs, class_order)
