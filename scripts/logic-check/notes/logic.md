# Logic Check notes

Facts the triage agent and the next implementer need. Keep bullets short and dated.

## auth + signup suites (2026-10-16)

- **Budget: ≤ 4 accounts created per run; POSTs are unthrottled locally via per-request X-Forwarded-For.** DRF
  throttles (`backend/backend/throttles.py`, all `UserRateThrottle`) count every request that reaches them, rejected or
  not, keyed per account or, for a guest, per client address: the whole `X-Forwarded-For` header while `NUM_PROXIES` is
  unset (its last hop with `NUM_PROXIES` ≥ 1, which is still ours locally); `users.strikes.client_ip_hash` takes its
  first hop. `lib/auth.mjs` `clientIp()` sends a fresh `10.a.b.n` per request, so each case has its own bucket: the
  machine's real 10/h signup, 30/h login and 60/h refresh budgets (shared with UI check's sign-up flow on the same
  stack) are never spent. Per run: 26 matrix rows + 2 happy path + 3 browser = 31 signup POSTs.
- **Account cap (4 per run).** Every account a `POST /signup/` creates is appended to `<runDir>/signup-accounts.json`
  (one JSON object per line; signup.spec + signup-ui.spec, survives worker restarts). Normally 2 (LC-SIGNUP-05) + one
  per validation gap. At the cap a row is sent with logic.actor's taken email: every non-email branch is checked before
  "email taken", so a gap answers 409 and still FAILS as `validation-gap` ("not created: cap"); invalid-email rows are
  not sent (`signup-budget`), and LC-SIGNUP-05 does not run its sign-ups (`signup-budget`). LC-AUTH-08's throwaway is
  minted (ORM), not signed up, and not counted.
- **Only `NUM_PROXIES = 0`** (DRF then uses REMOTE_ADDR alone) breaks the X-Forwarded-For technique: cases start
  answering 429 → `throttled` violations ("the case was not tested"). Then either run the matrix as core-only against
  a freshly started stack (LocMemCache resets per process) or split it across hours; do not mark the cases expected.
- **Matrix provenance** (`lib/matrix.mjs` header): signup_view's check order decides which branch a row hits, so every
  row is otherwise valid. Email "taken" is checked after the password, so taken rows carry a strong password. Django's
  `EmailValidator` allow-lists `localhost`, so `x@localhost` is valid (the invalid row uses `lgc@uicheck`). Moderated
  words: mild "Dick", reserved "admin1" (from `users/test_moderation.py`); never a severe word (it strikes the IP and
  the third locks sign-ups from it for 24 h). Also excluded: a banned account's email (409, answered like a taken
  email) and the IP-locked sign-up (403 `signup_locked`). A JSON number / boolean password reaches `validate_password`
  as an int / bool; the matrix expects 400.
- **Frontend rule list** (`src/utils/passwordRules.ts`): length ≥ 8, not only numbers, not like username/email;
  "Too common" is declared server-only in its doc comment (LC-SIGNUP-00 reads that sentence). The form never sends an
  unticked sign-up, so LC-SIGNUP-UI-01's consent case asserts the client text equals the backend message.
- **Throwaways**: `lgc<12 digits of the process start ms><2-digit slot>`; slots 01–26 matrix rows, 70–73 browser case,
  80 LC-AUTH-08, 90 LC-SIGNUP-05 (its repeat uses email `<name>r@uicheck.test`, which the lgc sweep does NOT match:
  the check deletes it itself). Username rows that a gap would accept are non-lgc names: deleted in-step or reported
  as `cleanup`.
- **Throttle headers**: DRF sends none below the limit (Retry-After only with a 429), so LC-AUTH-06 proves the limits
  from the source (decorators, scopes, `DEFAULT_THROTTLE_RATES`) instead of hunting a 429.
- **Logout** blacklists the refresh token only; the 15-minute access token stays valid until it expires (stateless
  JWT, by design) — not asserted.
- **Google**: a bad code makes Django call Google's token endpoint (or answer "isn't available right now" without
  CLIENT_ID/CLIENT_SECRET); both are 400. The local stack has no CLIENT_ID/CLIENT_SECRET (2026-10-16), so LC-AUTH-07's
  bad-code rows stop at "Google sign-in isn't available right now." and never reach Google's token exchange.
  LC-AUTH-GOOGLE-01 needs accounts.google.com reachable from this machine.
- **First run 20261016-0655-logic**: 17/18 pass; LC-SIGNUP-03 "similar to the username" → 201 (`validation-gap`, real):
  `signup_view` calls `validate_password(password)` without a user, so `UserAttributeSimilarityValidator` never runs,
  although `passwordRules.ts` says "the server still runs [it] on submit". Fix in backend: pass
  `User(username=username, email=email)`. Expect this FAIL until that ships; it is not flaky.
- **Fix round 1 (2026-10-16)**: JSON number / boolean password rows answer 500 (`validate_password` on a non-string
  raises inside signup_view's catch-all) → `server-error`, real, kept strict.

## Owner advisories

- Rate limits and the strike IP lock key on client-supplied X-Forwarded-For (NUM_PROXIES unset); safe only behind a
  proxy that overwrites it (Vercel does); set NUM_PROXIES if the host changes.
