# Design — Photo moderation with a small open-source classifier: fail-closed, counts as a strike

Card `3ee2cfb1-c595-8117-8701-df3715f9fce2` · slug `photo-moderation-with-a-small` · 2026-10-07 · planner: Fable (design round).

## Decision summary
- **Precondition is met.** `backend/users/strikes.py` (`record_strike`, `log_event`, `ban_user`), the management
  command `scan_existing_users`, and `ModerationEvent` (kind choice `"photo"` already present) are on `origin/dev`
  and in this worktree. The full card is built; no stub integration point.
- **Architecture as researched:** a separate Vercel Python project under `moderation_service/` (onnxruntime +
  numpy + Pillow only), called server-to-server by Django from `update_profile` with a shared secret. The main
  Django `requirements.txt` is untouched, so the main bundle cannot change.
- **One model:** `OwenElliott/image-safety-classifier-xs` (MIT, ONNX, classes NSFW / NSFL / SFW). The second-opinion
  model is an env-only hook (`MODERATION_SECOND_MODEL_PATH`): read, logged as "not implemented", never loaded.
- **The model is NOT committed and cannot be downloaded in this run** (huggingface.co is denied by the sandbox
  proxy; PyPI and GitHub are reachable). The deploy workflow fetches it with `huggingface_hub.snapshot_download`
  (`allow_patterns=["*.onnx"]`), computes its SHA-256 and compares it with the committed
  `moderation_service/model/model.sha256`. That file ships as `UNPINNED`: the first workflow run prints the hash and
  fails before deploying; the owner commits it (owner step 0). The service verifies the same file at import time.
- **Decision policy:** `score = max(nsfw, nsfl)`; `score >= PHOTO_BLOCK_THRESHOLD (0.85)` → block + strike (422
  `photo_rejected`, nothing saved); `PHOTO_REVIEW_THRESHOLD (0.50) <= score < block` → allowed and logged as
  `ModerationEvent(kind="photo", tier="mild", reason="uncertain")`; below → allowed, no event.
- **Fail closed:** any transport error, timeout (4 s, one retry), non-200, malformed body, or "required but URL
  unset" → 503 `moderation_unavailable`, nothing saved. Skipping only happens when `MODERATION_REQUIRED` is false
  (default: `bool(DATABASE_URL)`) AND `IMAGE_MODERATION_URL` is unset, with a `logger.warning`.
- **Benign eval set is synthetic** (Pillow-drawn, seeded, 60 PNGs: 12 skin-tone portrait swatches, beach scenes with
  figures, court/pitch sports scenes, line drawings, "selfie" and "group" compositions). Real photos cannot be
  downloaded here; real-photo false-positive numbers and the NSFW recall check are owner-run with the same
  script on a gitignored folder. The doc says so plainly: the committed set catches gross failures (wrong class
  order, broken preprocessing, skin-tone bias of the crudest kind), not production accuracy.
- **Engine: mixed** — `[opus]` for the service inference core, the client/decision function and the view hook;
  `[sonnet]` for scaffold, harness, workflow, frontend, scan pass, docs.

## Interfaces

### Moderation service (`moderation_service/`, Vercel Python, default runtime Python 3.12)
`POST /api/classify` — body: raw JPEG bytes (`Content-Type: image/jpeg`), max 1 MiB.
Header `X-Moderation-Key: <MODERATION_SHARED_SECRET>` compared with `hmac.compare_digest`.
- 200 `{"nsfw": float, "nsfl": float, "sfw": float, "model": "OwenElliott/image-safety-classifier-xs", "version": "<sha256[:12]>"}` (probabilities, sum ≈ 1; softmax applied if the model emits logits)
- 401 `{"error": "unauthorized"}` (missing/wrong key, or secret unset in env — fail closed)
- 400 `{"error": "unreadable image"}`, 413 `{"error": "too large"}`, 405 for non-POST
- 500 `{"error": "model unavailable"}` when the model file is missing or its SHA-256 does not match
- `GET /api/classify` → 200 `{"ok": true, "model_loaded": bool, "version": ...}` (health; no secret) — used by the smoke test's first probe only.

Env (service project): `MODERATION_SHARED_SECRET` (required), `MODERATION_MODEL_PATH` (default
`model/image-safety-classifier-xs.onnx`), `MODERATION_MODEL_SHA256` (optional; overrides `model/model.sha256`),
`MODERATION_CLASS_ORDER` (default `nsfw,nsfl,sfw`), `MODERATION_SECOND_MODEL_PATH` (optional, logged only).

Module layout: `moderation_service/classifier.py` holds the testable core (`load_session(path, expected_sha256)`,
`preprocess(jpeg_bytes, input_meta) -> np.ndarray`, `postprocess(outputs, class_order) -> dict`,
`verify_sha256(path, expected) -> str`); `moderation_service/api/classify.py` is the thin Vercel `handler`
(`BaseHTTPRequestHandler`) that adds the project root to `sys.path`, loads the session once per process at import,
and never logs or stores request bodies. `preprocess` reads the session's first input (`name`, `shape`, `type`):
`tensor(uint8)` → resized 224×224 RGB uint8 in the layout the shape implies (NHWC if the last dim is 3, else
NCHW); `tensor(float)` → the same pixels as float32 in 0–255 (preprocessing is baked into this model per the
research; the eval and smoke test are the check that this reading is right). Dynamic batch dim → 1.

### Django
Settings (`backend/backend/settings.py`, env via BE-14 helpers):
- `IMAGE_MODERATION_URL = os.environ.get("IMAGE_MODERATION_URL")` (full URL of `/api/classify`)
- `MODERATION_SHARED_SECRET = os.environ.get("MODERATION_SHARED_SECRET")`
- `MODERATION_REQUIRED = env_bool("MODERATION_REQUIRED", bool(DATABASE_URL))`
- `PHOTO_BLOCK_THRESHOLD = float(os.environ.get("PHOTO_BLOCK_THRESHOLD", "0.85"))`
- `PHOTO_REVIEW_THRESHOLD = float(os.environ.get("PHOTO_REVIEW_THRESHOLD", "0.50"))`

`backend/users/photo_moderation.py`:
```python
class ModerationUnavailable(Exception): ...
@dataclass(frozen=True)
class Scores: nsfw: float; nsfl: float; sfw: float; model: str; version: str
def classify_photo(jpeg: bytes) -> Scores            # lazy `import requests`; POST, timeout 4, one retry on
                                                     # Timeout/ConnectionError/5xx; any other failure -> ModerationUnavailable
def decide(scores: Scores) -> str                    # "block" | "review" | "allow" from settings thresholds
def moderate_photo(jpeg: bytes) -> str | None        # None = skipped (not required and URL unset, warning logged);
                                                     # raises ModerationUnavailable when required and URL/secret unset
MESSAGE_PHOTO_REJECTED = "That photo isn't allowed. Repeated attempts will lead to a ban ({n} of 3)."
MESSAGE_MODERATION_UNAVAILABLE = "Photo check is unavailable right now, try again later."
```
`backend/users/strikes.py`: add `BAN_REASON_PHOTO = "photo"`; `record_strike` passes
`BAN_REASON_PHOTO if kind == "photo" else BAN_REASON_NAME` to `ban_user` (AUTH-13 already lists `photo` as a reason code).

`update_profile` multipart branch, after `normalize_profile_photo` and before the version bump:
- block → `record_strike(user, "photo", strikes.client_ip_hash(request))`; if banned → 403 `strikes.ban_payload(user)`;
  else 422 `{"error": MESSAGE_PHOTO_REJECTED.format(n=count), "code": "photo_rejected", "strikes": count}`.
  `user.profile_photo_data` is reassigned only on the allowed path (keep the normalized bytes in a local first).
- unavailable → 503 `{"error": MESSAGE_MODERATION_UNAVAILABLE, "code": "moderation_unavailable"}`
- review → save as today, then `strikes.log_event(user, "photo", "mild", "uncertain", strikes.client_ip_hash(request))`
- allow / skipped → save as today.
Log lines carry scores and the user's pk only; never bytes, never the data URL.

`scan_existing_users --photos`: for each user with `profile_photo_data`, `classify_photo` + `decide`; prints
`public_id  photo  <decision>` for `block`/`review` rows and a total. Read-only; no strike, no event. Exits with a
notice (no scan) when `IMAGE_MODERATION_URL` is unset.

### Frontend (`src/components/UserProfile.tsx` `handlePhotoUpload`)
- 403 + `isBanPayload(data)` → return silently (apiFetch already reported the ban; same as the username path).
- `data.code === "photo_rejected"` → `showErrorAlert(data.error, "Photo not allowed")`
- `data.code === "moderation_unavailable"` → `showErrorAlert(data.error, "Try again later")`
- otherwise unchanged. The strike text "(n of 3)" comes from the backend string. SweetAlert via `Alerts.tsx` is the
  UI-9 shared piece for one-shot errors and already animates; no new motion code.

### Workflow `.github/workflows/deploy-moderation-service.yml`
`on: workflow_dispatch` (input `deploy: boolean`, default `false`) and `push` to `dev` filtered to
`moderation_service/**` (eval only). Steps: checkout → setup-python 3.12 → `pip install -r
moderation_service/requirements.txt huggingface_hub` → **Fetch model** (`snapshot_download(repo_id=..., allow_patterns=["*.onnx"])`,
copy the single `.onnx` to `moderation_service/model/image-safety-classifier-xs.onnx`, `sha256sum`, compare with
`model/model.sha256`; `UNPINNED` → print hash, `::error::` and exit 1) → **Eval** (`python moderation_service/eval/run_eval.py
--dir moderation_service/eval --max-false-block 0 --summary "$GITHUB_STEP_SUMMARY"`; prints false-block rate at
0.50/0.70/0.85/0.95, latency p50/p95 cold and warm, bundle size `du -sh` of site-packages + model) → if `inputs.deploy`:
check `VERCEL_TOKEN`/`VERCEL_ORG_ID`/`VERCEL_MODERATION_PROJECT_ID` → `npx --yes vercel@latest deploy moderation_service
--prod --yes --token` (`VERCEL_PROJECT_ID` = the moderation secret) → **Smoke** (`curl` POST
`eval/benign/sports_01.png` re-encoded as JPEG with the secret from `MODERATION_SHARED_SECRET`; assert `sfw >= 0.5` and
`max(nsfw, nsfl) < 0.85`).

## File plan
- `moderation_service/requirements.txt` — new: `onnxruntime>=1.19,<2`, `numpy>=1.26,<3`, `Pillow>=10`.
- `moderation_service/vercel.json` — new: `functions.api/classify.py` `memory 1024`, `maxDuration 30`, `regions ["fra1"]`.
- `moderation_service/.vercelignore` — new: `eval/`, `tests/`, `__pycache__/`.
- `moderation_service/classifier.py` — new: core (sha256, session load, pre/postprocess).
- `moderation_service/api/classify.py` — new: Vercel handler.
- `moderation_service/model/README.md` — new: source URL, MIT license text (verbatim from the model card; the owner confirms on first run), class order, how the checksum is pinned.
- `moderation_service/model/model.sha256` — new: `UNPINNED`.
- `moderation_service/model/.gitignore` — new: `*.onnx`.
- `moderation_service/eval/make_benign_set.py` — new: deterministic generator (seed 0) → `eval/benign/`.
- `moderation_service/eval/benign/*.png` (60) + `moderation_service/eval/LICENSES.md` — new: generated, CC0.
- `moderation_service/eval/run_eval.py` — new: metrics, thresholds sweep, latency, `--max-false-block`, `--summary`.
- `moderation_service/eval/.gitignore` — new: `private/` (owner's local `benign/` + `nsfw/` real samples).
- `moderation_service/tests/test_classifier.py` — new: core tests with a fake session (no model file needed).
- `moderation_service/README.md` — new: local run (`vercel dev` or `python -m moderation_service.eval.run_eval`), env, endpoints.
- `.github/workflows/deploy-moderation-service.yml` — new.
- `backend/backend/settings.py` — edit: five settings above.
- `backend/users/photo_moderation.py` — new.
- `backend/users/strikes.py` — edit: `BAN_REASON_PHOTO`, reason by kind in `record_strike`.
- `backend/users/views.py` — edit: multipart branch of `update_profile`.
- `backend/users/management/commands/scan_existing_users.py` — edit: `--photos`.
- `backend/users/test_photo_moderation.py` — new: client, decision, view hook, scan pass (classifier mocked).
- `backend/trivia/tests/test_startup.py` — edit: add `"onnxruntime"` to `HEAVY`.
- `backend/.env.example` — edit: the five variables with comments.
- `src/components/UserProfile.tsx` — edit: `handlePhotoUpload` branches.
- `docs/DEPLOYMENT.md` — edit: "Moderation service" section (service table row, env vars for both projects, owner steps 0–4, where measured numbers land, that `backend/requirements.txt` is unchanged).
- `docs/constraints/AUTH_CONSTRAINTS.md` — edit: AUTH-11 adds `users/photo_moderation.py`; AUTH-12 photo upload paragraph gains the moderation hook; AUTH-13 gains the photo strike/ban reason and the 422/503 contracts.
- `docs/team/DECISIONS.md` — appended by this design round (not by the engine).
- `.team/run/photo-moderation-with-a-small/build-report.json` — engine output.

## Risks
- **Model input contract unknown until the workflow runs** (nothing here can open the file). Mitigation: `preprocess`
  adapts from the session's declared input dtype/shape; `postprocess` softmaxes when outputs don't sum to ≈1; the eval
  and the smoke test fail loudly on a wrong class order (benign set must score `sfw` high). The class order is also
  an env override.
- **Checksum pinning needs one owner commit.** Mitigation: the first run fails with the hash printed; `UNPINNED` can
  never deploy (the service refuses to load an unpinned model: `verify_sha256` with expected `UNPINNED` raises).
- **Synthetic benign set is not real-world accuracy.** Mitigation: said plainly in DEPLOYMENT.md and the build report;
  owner step 4 runs the same harness on real benign and private NSFW samples; thresholds are env-tunable without a deploy.
- **Fail-closed means a service outage blocks photo changes.** Accepted by the spec. Default-skip only when not
  required (local sqlite) and no URL, with a warning; tests assert that `MODERATION_REQUIRED=True` + no URL → 503.
- **Bytes leaking into logs.** The view logs scores and pk only; the service handler never logs the body; `requests`
  exceptions are caught and re-raised as `ModerationUnavailable` without the payload. Test asserts the 422/503 bodies
  contain no image data and `profile_photo_data` / `profile_photo_version` are unchanged.
- **Main bundle growth.** Nothing new in `backend/requirements.txt`; `requests` is lazy-imported inside
  `classify_photo`; `test_startup.py` guards `onnxruntime`/`numpy` never load at startup.
- **Vercel Python bundling of `model/`.** Vercel Python includes project files next to `api/`; `.vercelignore` only drops
  `eval/` and `tests/`. The smoke test's `model_loaded: true` proves it; if false the deploy step fails.
- **Third strike ban reason.** `record_strike` currently hardcodes `name_severe`; the one-line change keeps AUTH-13's
  documented `photo` code and the existing name tests pass unchanged.

## Test plan
Gate 1 (unchanged commands): `DATABASE_URL="" python manage.py check && python manage.py test users trivia`
(≈369 existing + ~14 new); `npm run lint`; `npm run build`. Extra, run by the engine once:
`python -m unittest discover -s moderation_service/tests` inside a scratch venv built from
`moderation_service/requirements.txt` (PyPI is reachable), and `python moderation_service/eval/make_benign_set.py`
(must write exactly 60 files, deterministic — running it twice leaves `git status` clean).

New backend tests (`backend/users/test_photo_moderation.py`, classifier mocked with `patch("users.photo_moderation.classify_photo")`
or `patch("requests.post")`), all under `override_settings(MODERATION_REQUIRED=True, IMAGE_MODERATION_URL="http://mod.test/api/classify", MODERATION_SHARED_SECRET="k")`:
1. `classify_photo` sends `X-Moderation-Key`, `Content-Type: image/jpeg`, `timeout=4`; retries once on `Timeout`; raises `ModerationUnavailable` after the second failure, on 500, on 401, and on a body missing `nsfw`.
2. `decide`: 0.85 → block, 0.849 → review, 0.5 → review, 0.499 → allow; `nsfl` alone at 0.9 → block.
3. `moderate_photo` with `MODERATION_REQUIRED=False` and no URL → `None` + `assertLogs(level="WARNING")`; `MODERATION_REQUIRED=True` and no URL → `ModerationUnavailable`.
4. View, block: 422, `code == "photo_rejected"`, `strikes == 1`, `error` contains "(1 of 3)", `profile_photo_data` is unchanged (set a sentinel before), `profile_photo_version` unchanged, one `ModerationEvent(kind="photo", reason="strike")`.
5. View, third block: 403 with `ban_payload` shape, `ban_reason == "photo"`, `banned_at` set.
6. View, unavailable (`classify_photo` raises): 503, `code == "moderation_unavailable"`, nothing saved.
7. View, review band: 200, photo saved, version +1, `ModerationEvent(kind="photo", tier="mild", reason="uncertain")`.
8. View, allow: 200, saved, no event. View, skipped (not required, no URL): 200, saved, warning logged.
9. `scan_existing_users --photos`: one blocked, one allowed user → output lists only the blocked `public_id`; no event, no strike; with URL unset prints the notice.
10. `test_startup.py`: `onnxruntime` in `HEAVY` (existing fresh-interpreter test covers it).

Service tests (`moderation_service/tests/test_classifier.py`, fake session object with `get_inputs()`/`get_outputs()`/`run()`):
`verify_sha256` mismatch and `UNPINNED` raise; uint8 NHWC, uint8 NCHW and float32 inputs each produce the declared
shape/dtype; logits → softmax sums to 1; class order env is honoured; a 1×1 PNG and a truncated file → `ValueError`.

Gate 2 (QA assertions): none. The dev server has no `IMAGE_MODERATION_URL` and `MODERATION_REQUIRED` is false
there, so every upload is skipped-with-warning; a browser pass cannot exercise block/503 without the service. The
blocked/unavailable/ban paths are covered by the mocked view tests above. `## QA assertions` is `[]`.

## Implementation plan
1. `[opus]` **Service core + handler.** Create `moderation_service/classifier.py` (`verify_sha256`, `load_session`,
   `preprocess`, `postprocess` as specified), `moderation_service/api/classify.py` (handler: GET health, POST with
   constant-time key check, 1 MiB cap, no body logging, module-level session load guarded so a load failure answers
   500 on every request), `requirements.txt`, `vercel.json`, `.vercelignore`, `model/README.md`, `model/model.sha256`
   (`UNPINNED`), `model/.gitignore`, `moderation_service/README.md`. Done: `moderation_service/tests/test_classifier.py`
   (the fake-session tests in the Test plan) passes in a scratch venv from `moderation_service/requirements.txt`;
   `python -m py_compile moderation_service/api/classify.py` clean.
2. `[sonnet]` **Benign set + harness.** `eval/make_benign_set.py` (seed 0; 60 PNGs named `<category>_<nn>.png` over
   categories `skin`, `beach`, `sports`, `drawing`, `selfie`, `group`, 10 each; skin uses 12 fixed Fitzpatrick-spread
   RGB tones), `eval/LICENSES.md` ("all files generated by make_benign_set.py, CC0"), `eval/.gitignore` (`private/`),
   `eval/run_eval.py` (`--dir`, `--model`, `--sha256`, `--block`, `--review`, `--max-false-block`, `--summary`; loads via
   `classifier.py`; `benign/` required, `nsfw/` optional → precision/recall only when present; prints per-threshold
   false-block rate at 0.50/0.70/0.85/0.95, p50/p95 latency with the first call reported as "cold"). Done: generator
   produces 60 files and is idempotent (`git status` clean on a second run); `run_eval.py --help` works; a unit test in
   `tests/test_classifier.py` calls `run_eval.summarize(scores)` on a hand-built score list and checks the rates.
3. `[sonnet]` **Workflow.** `.github/workflows/deploy-moderation-service.yml` exactly as in Interfaces (fetch →
   pin check → eval → optional deploy → smoke; secrets check modelled on `publish-game-data.yml`; `concurrency` group
   `deploy-moderation-service`; `permissions: contents: read`). Done: `python -c "import yaml,sys; yaml.safe_load(open(...))"`
   parses; the `UNPINNED` branch exits 1 with `::error::` and the printed hash; no step echoes the secret.
4. `[opus]` **Django settings + client.** Add the five settings to `backend/backend/settings.py` next to
   `DATABASE_URL`; write `backend/users/photo_moderation.py` (`classify_photo` with lazy `requests`, `decide`,
   `moderate_photo`, the two messages). Done: tests 1–3 of the Test plan pass.
5. `[opus]` **View hook + photo ban reason.** `strikes.py`: `BAN_REASON_PHOTO = "photo"` and reason-by-kind in
   `record_strike`. `views.py` multipart branch: keep normalized bytes in a local, call `moderate_photo`, branch on
   block/unavailable/review/allow/None exactly as in Interfaces, assign and save only on the allowed paths. Done:
   tests 4–8 pass; `users.test_strikes` and `users.test_photos` still pass unchanged.
6. `[sonnet]` **Frontend.** `UserProfile.tsx` `handlePhotoUpload`: ban-payload early return, `photo_rejected` and
   `moderation_unavailable` titles, else existing. Done: `npm run lint` clean; no new imports beyond `isBanPayload`
   (already imported in the file for the username path — reuse it).
7. `[sonnet]` **Scan pass.** `scan_existing_users --photos` as in Interfaces (`add_arguments`; name scan unchanged by
   default). Done: test 9 passes.
8. `[sonnet]` **Startup guard + measurements.** Add `"onnxruntime"` to `HEAVY` in `trivia/tests/test_startup.py`;
   confirm `git diff --stat dev -- backend/requirements.txt` is empty and say so in the build report. Latency, service
   bundle size and false-block numbers are produced by the workflow's eval step (step 3) and cannot be measured in
   this sandbox; the build report's `assumed` states: "model not fetchable from this environment; numbers come from
   the first `deploy-moderation-service` run (job summary)". Done: `test_startup` passes; build report wording present.
9. `[sonnet]` **Docs.** `docs/DEPLOYMENT.md`: "Moderation service" section (what, where, env vars on `backend` and
   `nba-minigames-moderation`, owner steps 0 pin checksum / 1 create project / 2 secret / 3 env / 4 deploy + private
   recall check, the thresholds 0.85/0.50 as placeholders until owner step 4, a table for the measured numbers with
   "pending first workflow run"); `backend/.env.example`; `AUTH_CONSTRAINTS.md` AUTH-11/12/13 edits listed in the File
   plan. Done: every env var named in Interfaces appears in `DEPLOYMENT.md` and `.env.example` (`grep` each).
10. `[sonnet]` **Build report.** Write `.team/run/photo-moderation-with-a-small/build-report.json` with `did`, `assumed`
    (precondition met; model not fetched here; synthetic benign set; numbers pending), `touched`, `testsAdded`.
    Done: valid JSON listing every file from the File plan that was created or edited.

Self-review: every "What to build" item maps to a step (1→1, 2→3, 3→4, 4→5, 5→6, 6→2+3, 7→7, 8→8, 9→9 + the
DECISIONS entry written by this round). Ambiguities resolved: "severity `uncertain`" is stored as
`tier="mild", reason="uncertain"` (no choices migration); "the error message animates with the shared pieces" is the
existing SweetAlert path (UI-9), not a new inline slot; the second-opinion model is env-only; the benign set is
synthetic and labelled as such.
