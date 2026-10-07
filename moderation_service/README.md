# moderation_service

A tiny, separate Vercel Python project that scores profile photos with a small open-source ONNX
classifier (see `model/README.md`). Django (`backend/users/photo_moderation.py`) calls it
server-to-server from `update_profile`; it is never called by the browser. It is a separate project so
`onnxruntime` never enters the main Django bundle.

Dependencies: `onnxruntime`, `numpy`, `Pillow` only (`requirements.txt`).

## Endpoints
`POST /api/classify` — body: raw JPEG bytes (`Content-Type: image/jpeg`, max 1 MiB), header
`X-Moderation-Key: <MODERATION_SHARED_SECRET>` (constant-time compare).

| Status | Body |
|---|---|
| 200 | `{"nsfw", "nsfl", "sfw", "model", "version"}` — probabilities summing to about 1; `version` is the model SHA-256's first 12 hex chars |
| 401 | `{"error": "unauthorized"}` — wrong/missing key, or the secret is unset (fail closed) |
| 400 | `{"error": "unreadable image"}` |
| 413 | `{"error": "too large"}` |
| 500 | `{"error": "model unavailable"}` — model missing, unpinned or checksum mismatch |

`GET /api/classify` — `{"ok": true, "model_loaded": bool, "version"}` (health probe, no secret).

Request bodies are never logged or stored.

## Env (this project)
| Var | Default | |
|---|---|---|
| `MODERATION_SHARED_SECRET` | — | required; same value as on the `backend` project |
| `MODERATION_MODEL_PATH` | `model/image-safety-classifier-xs.onnx` | relative to this folder |
| `MODERATION_MODEL_SHA256` | contents of `model/model.sha256` | overrides the pin file |
| `MODERATION_CLASS_ORDER` | `nsfw,nsfl,sfw` | order of the model's output scores |
| `MODERATION_SECOND_MODEL_PATH` | unset | reserved hook; logged as not implemented, never loaded |

## Local
```
python -m venv .venv && .venv/bin/pip install -r moderation_service/requirements.txt
python -m unittest discover -s moderation_service/tests        # fake-session tests, no model needed
vercel dev moderation_service                                   # needs the .onnx in model/ and a pinned hash
```
Evaluation: `python moderation_service/eval/run_eval.py --dir <folder with benign/ and nsfw/>`.
Deploy: the manual `deploy-moderation-service` workflow (`docs/DEPLOYMENT.md`).
