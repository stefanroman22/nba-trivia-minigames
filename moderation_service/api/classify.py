"""Vercel Python function: POST /api/classify — raw JPEG in, class probabilities out.

Auth: header `X-Moderation-Key` must equal env MODERATION_SHARED_SECRET (constant-time compare);
an unset secret refuses everything (fail closed). The model is checksum-verified and loaded once
per process at import; if that fails every request answers 500 "model unavailable".

Request bodies are never logged or stored — not on success, not on a block, not on an error.
"""
import hmac
import json
import logging
import os
import sys
from http.server import BaseHTTPRequestHandler

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)

import classifier  # noqa: E402

logger = logging.getLogger("moderation")

MAX_BODY_BYTES = 1 << 20  # 1 MiB; Django sends a ~20 KB 256x256 JPEG


def _model_path():
    path = os.environ.get("MODERATION_MODEL_PATH") or os.path.join("model", "image-safety-classifier-xs.onnx")
    return path if os.path.isabs(path) else os.path.join(ROOT, path)


def _expected_sha256():
    pinned = os.environ.get("MODERATION_MODEL_SHA256")
    if pinned:
        return pinned
    try:
        with open(os.path.join(ROOT, "model", "model.sha256"), encoding="utf-8") as fh:
            return fh.read()
    except OSError:
        return ""


def _load():
    if os.environ.get("MODERATION_SECOND_MODEL_PATH"):
        logger.warning("MODERATION_SECOND_MODEL_PATH is set but a second-opinion model is not implemented; ignored.")
    try:
        order = classifier.parse_class_order(os.environ.get("MODERATION_CLASS_ORDER"))
        session, digest = classifier.load_session(_model_path(), _expected_sha256())
        return session, digest, order
    except Exception as exc:  # any load failure -> 500 on every request, never a silent "allow"
        logger.error("moderation model failed to load: %s", exc.__class__.__name__)
        return None, None, classifier.DEFAULT_CLASS_ORDER


SESSION, SHA256, CLASS_ORDER = _load()
VERSION = SHA256[:12] if SHA256 else None


class handler(BaseHTTPRequestHandler):
    def _json(self, status, payload):
        body = json.dumps(payload).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, format, *args):  # noqa: A002 — keep request lines out of the logs
        return

    def do_GET(self):
        self._json(200, {"ok": True, "model_loaded": SESSION is not None, "version": VERSION})

    def do_POST(self):
        secret = os.environ.get("MODERATION_SHARED_SECRET") or ""
        given = self.headers.get("X-Moderation-Key") or ""
        if not secret or not hmac.compare_digest(given.encode(), secret.encode()):
            return self._json(401, {"error": "unauthorized"})
        try:
            length = int(self.headers.get("Content-Length") or 0)
        except ValueError:
            length = -1
        if length > MAX_BODY_BYTES:
            return self._json(413, {"error": "too large"})
        if length <= 0:
            return self._json(400, {"error": "unreadable image"})
        if SESSION is None:
            return self._json(500, {"error": "model unavailable"})
        data = self.rfile.read(length)
        try:
            scores = classifier.classify(SESSION, data, CLASS_ORDER)
        except ValueError:
            return self._json(400, {"error": "unreadable image"})
        except Exception as exc:
            logger.error("inference failed: %s", exc.__class__.__name__)
            return self._json(500, {"error": "model unavailable"})
        return self._json(200, {**scores, "model": classifier.MODEL_ID, "version": VERSION})

    def _not_allowed(self):
        self.send_response(405)
        self.send_header("Allow", "GET, POST")
        self.send_header("Content-Length", "0")
        self.end_headers()

    do_PUT = do_DELETE = do_PATCH = _not_allowed
