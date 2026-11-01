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
- log-session credits every POST (no play id), so a play can be replayed up to 60/h × the per-game cap. An unknown
  `game` falls back to MAX_SESSION_POINTS=1000, which allows up to 60k points/h (LC-GAMEDATA-02 asserts the cap itself;
  Task 6's triage files this once: minor, backend).

## game-data + rooms suites (2026-10-16)

- Budgets: `score-submit` 60/h is per account. `logic.actor` spends 6 `log-session` POSTs per run (the 400 one counts:
  DRF throttles every request that reaches the view). `wordle-play` 20/h: 3 POSTs on a fresh lgc throwaway's own bucket
  and 1 guest POST on a fresh simulated client. Neither is ever close to its limit.
- `log-session` has no per-play dedupe. Each POST is a finished game and is credited, and the client's `awardedRef`
  sends it once. LC-GAMEDATA-02 asserts that `/me/` moves by exactly the reported `awarded`, accepting either 37 or 0
  on the repeat, so a dedupe can land without breaking it.
- A local stack's sqlite has no synced `Player` / `Team` tables. The daily Wordle word is seeded from the bundled
  `wordle.json` when it is missing (LC-GAMEDATA-04). The Django round endpoints the relay falls back to for name-logo
  (Team) and wordle (Player) 500 locally for that reason. LC-GAMEDATA-01 therefore checks the sources the site reads
  plus Django's `/trivia/pool/`; the relay's dealing is checked through `roundData` (LC-ROOMS-07/10).
- Rooms: the relay acks nothing, so the client helper waits for events from a log position (`mark()` before the emit,
  `waitFor(event, { since })`). Identify has no success event; LC-ROOMS-01 proves it by a reply only a player gets.
  Strangers in a random match see the real name and id, whatever the age (no masking; LC-ROOMS-10 seeds both as legacy
  teens to prove it).
- Relay throttles (multiplayer_server/src/index.js): `joinFriendRoom` 8 per 10 s per account (JOIN_MAX_TRIES), then
  "Too many attempts…"; `identify` 6 per 10 s per socket (IDENTIFY_MAX_TRIES, the rest are dropped silently); 30
  events/s per socket (EVENT_MAX, the rest are dropped). LC-ROOMS-09, the busiest test, joins about 6 times in about 20 s.
- Two checkers sharing one lane stack must run from the same checkout. If the minter is on one checkout's sqlite and
  the running Django on another's, every id differs. ui-check's `stack-setup` now refuses that state for every suite
  (see CHECKS.md "How runs work"), and stack.json records `repo: null, relayKey: null` for a reused Django.

## profile + friends suites (2026-10-16)

- **Budget.** Authenticated throttles key by account (user pk), so X-Forwarded-For does not help here. `account-data`
  10/h per account: testuser4 / testuser5 spend none since the age route went (2026-10-26.2); the export and the
  deletes spend `lgc` throwaways' own buckets (a new pk every run). `friend-action` 60/h: testuser4
  ≈ 9, testuser5 ≈ 2 per run (≥ 6 runs an hour before a 429). `user-search` 120/h: ≤ 9 per user per run. LocMemCache:
  restarting the stack resets every bucket.
- **The mint restores a test account's username** on every mint (`mint_tokens.py account()`), so LC-PROFILE-01 mints
  once and renames back through the API; never mint testuser4 between a rename and its check.
- **Age.** No age rules since 2026-10-26.2 (owner decision, pre-launch): no tick-box, no `POST /account/age/` (404), no
  photo age gate, `is_teen` always false, nobody hidden or masked. The legacy columns (`age_group`, birth month / year,
  `age_sets`) stay in the database unread. Checks seed a "teen" with the mint's `legacy_teen` op (`seedLegacyTeen`) to
  prove nothing reads them, and put it back with `forgetAge` in `finally`; the logic sweep resets testuser4/5/6 to
  unknown as well (`ages` in its output). A check that finds a 428 `age_required`, a teen 403, a 428 Google consent
  step or a masked stranger is a regression of that decision, never something to "fix" by restoring the gate.
- **Photo moderation** is skipped on the local stack (`IMAGE_MODERATION_URL` unset, `MODERATION_REQUIRED` false without
  `DATABASE_URL`), so an upload is saved at once. A stack with moderation configured would call the service (503 when it
  is unreachable): LC-PROFILE-02/03/04 would then fail on the upload (a 503), not on an age rule.
- **Upload** is multipart, which `api.fetch` (JSON only) cannot send: profile.spec has its own fetch that asks the guard
  first. The image is a 1x1 PNG (the backend normalises it to a 256x256 JPEG data URL).
- **Search rule** (`users/friends.py search_users`): every non-banned player is findable by name or player id, whatever
  their age (owner decision 2026-10-19; unknown-age and teen players were findable by exact id only until then;
  LC-FRIENDS-08 proves it on a seeded legacy teen).
  Blocked players are hidden in both directions; a send is refused (403) from either side; the block row is one-way.
- **friends-overview** is cached 60 s (`friends_cache`) and invalidated by every write view; one Django process with
  LocMemCache, so reads after a write are consistent.
- **Throwaway slots**: 60–63 (profile); 41 is game-data's (a shared slot in one worker process is the same account).
- **Runs**: `20261016-0710-logic` and `20261016-0745-logic` 14/14, sweep clean. No REAL findings. A mutated
  expectation (`LC-PROFILE-03` teen message) failed with one digest line, as it should.

## triage (2026-10-16)

- (20261016-0918-logic) Prod code (`--ref main`) still has both LC-SIGNUP-03 defects: similarity validator skipped (`validate_password(password)` without a user, views.py:296) and non-string password 500. Probes of the number/boolean rows FAIL with 500 (guest, own X-Forwarded-For). The similarity row is not probed by assertion: a failing probe creates an account; its acceptance is the lc check only.
- (20261016-0918-logic) `advisories.mjs` creates `findings/` if missing and writes a bare array; if `findings/logic.json` is written before it exists use Bash `mkdir`, and merge into the array (do not overwrite) after advisories run. `probe.mjs` has no `--ports` flag.
