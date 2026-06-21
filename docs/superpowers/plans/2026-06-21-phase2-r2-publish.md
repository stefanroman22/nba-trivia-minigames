# Phase 2 — R2 / CDN Publishing

**Goal:** Publish the versioned game data (built in Phase 1) to Cloudflare R2 so web + mobile can read pools from the CDN edge instead of Django. Credential-ready and fully tested without a real bucket.

**Delivered (account-independent, tested):**
- `trivia/data_pipeline/publish.py`
  - `build_publish_plan(data_dir, version, public_base_url)` → versioned immutable pool keys (`v/<version>/<key>.json`, `Cache-Control: ...immutable`) + a `manifest.json` (60 s TTL) mapping each game to its public CDN URL.
  - `upload_plan(plan, client, bucket)` → uploads via any S3-compatible client (dependency-injected; R2 speaks the S3 API).
- `trivia/management/commands/publish_game_data.py` — `--dry-run` previews the plan with no credentials; real mode lazy-imports `boto3` and targets the R2 S3 endpoint from env vars.
- `requirements-publish.txt` (`boto3`) — home-only; **not** installed on Render.
- README: publish workflow + one-time R2 setup (bucket, S3 token, custom domain, env vars).

**Tests:** `trivia/tests/test_publish.py` — plan shape (versioned keys, immutable cache, manifest URLs), `upload_plan` against a fake S3 client (asserts every object + manifest uploaded with correct cache headers), and the `--dry-run` command end-to-end. 3 tests, all green; full backend suite stays green.

**Account step (you):** create an R2 bucket + S3 API token + custom domain; set `R2_ACCOUNT_ID`, `R2_BUCKET`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_PUBLIC_BASE_URL`; run `publish_game_data`.

**Deferred verification:** the real upload (`boto3` → R2) can only be confirmed after the bucket exists. The plan-building + upload-orchestration logic is fully unit-tested via an injected fake client, so only the boto3 wiring + network call are unverified until then.

**Out of scope (later phases):** pointing the frontend/mobile at these CDN URLs is Phase 3 (client-side randomization), which initially reads the Django `/trivia/pool/` endpoints and switches to the CDN manifest URLs once this is live.
