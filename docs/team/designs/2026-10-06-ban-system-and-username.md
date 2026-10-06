# Design: ban-system-and-username

Task: "Ban system and username moderation: 3 strikes, no AI, no external API" (card
3ee2cfb1-c595-819b-b3ec-f5940e7d93fa, P1, Difficulty hard, areas frontend/backend/auth/multiplayer/ui,
risk high). Spec, research summary, owner decisions 1-8 and the design sketch are in the brief
(`.team/run/ban-system-and-username/brief.md`); this doc pins every open choice and turns it into steps.
Design round 2026-10-06, planner on fable. Branch `team/ban-system-and-username` (cut from `origin/dev` b80ceb4).

Binding constraints from the card: no paid AI, no LLM, no external API at runtime, zero new dependencies
(Python or npm), plain Python/JS on our own backend. The one network action in the whole plan is a
build-time `curl` of the CC BY 4.0 LDNOOBW word lists into committed data files (checked reachable through
the proxy today, HTTP 200 for en/es/fr/de/it/pt/ru/hu).

## Decision summary

**Engine: mixed** — 12 steps; `[opus]` for the matcher, the strike/ban core, the enforcement wiring, the
relay token protocol and the ban-screen motion; `[sonnet]` for migration, hiding queries, admin, command,
frontend plumbing, live name check, docs and the final verification.

- **D1 — One pure-Python matcher, data-driven.** `users/moderation_text.py` + `users/moderation_data/*.json`.
  Two tiers with different matching modes: *severe* (strike) matches whole-token always and additionally as a
  substring of the letters-only "compact" name when the term has >= 6 letters after collapsing repeats;
  *mild* and *reserved* match whole-token only, reject, no strike. The allowlist (every token of the 5208
  player names + team/basketball words) overrides mild only. The lists never leave the server.
- **D2 — Strikes are for accounts; IPs get a signup lock.** A severe hit on `update_profile` by a signed-in
  account calls `record_strike`; the 3rd strike bans inside the same transaction. A severe hit on
  `signup_view` creates no account, so it increments a per-IP counter in the shared cache; the 3rd locks
  sign-ups from that IP for 24 h. Strikes never expire (owner decision 5).
- **D3 — Ban = `banned_at` set; enforced in the auth class, 403 not 401.** `users/authentication.py`
  `BanAwareJWTAuthentication` replaces `JWTAuthentication` in `DEFAULT_AUTHENTICATION_CLASSES` and raises
  `PermissionDenied(ban_payload(user))` after simplejwt loads the user (no extra query; DRF renders a dict
  detail as the body, so `{"code": "account_banned", ...}` is top-level). Login, Google login and refresh
  return the same 403 body. Banned accounts are hidden, never deleted (decision 4).
- **D4 — The relay verifies the token against Django `/api/me/`.** `identify` now carries `{ user, token }`;
  the relay keys the player by the *server's* `/me/` payload, caches verdicts 60 s per token, and refuses
  identify without a token. This closes the id-spoofing hole (AUTH-8/MP-1 are rewritten). Old token-less
  clients are not supported: the relay is not deployed today, and keeping them would keep the hole.
- **D5 — Frontend: one `reportBan` chokepoint, one `BanNotice` screen.** `src/utils/ban.ts` detects the 403
  body; `apiFetch`, `refreshSession`, the three `LogInSignUp` flows and the socket `identifyError` all call
  `reportBan`; `providers.tsx` owns the handler (clear tokens + cache, `accountBanned` in the slice);
  `BanNotice` is a full-viewport blocking state rendered under `ModalHost` so the Appeal button can open the
  existing feedback modal on top (`FeedbackModal` gets an `appeal` preset).
- **D6 — Appeal rides on Feedback with no schema change.** The appeal is a feedback row with
  `game="appeal"`, `page="/banned"`, the message prefixed `[Appeal #K7F3QD] `, stars hidden and a fixed
  neutral rating (the endpoint requires 1-5). The admin Feedback tab already searches message/public_id.

## Interfaces

### Backend models (`backend/users/models.py`, migration `0008_moderation.py`)
`CustomUser` gains:
- `strike_count = PositiveSmallIntegerField(default=0)`
- `banned_at = DateTimeField(null=True, blank=True)`
- `ban_reason = CharField(max_length=40, blank=True, default="")` — a reason code (`name_severe`, `photo`, `admin`), never text
- `canonical_email = CharField(max_length=254, blank=True, default="", db_index=True)` — filled only when banned (D2 anti-evasion); queried at signup

New `ModerationEvent` (docstring per BE-5: "feeds the admin inline and the owner's review; never the UI"):
- `user = ForeignKey(AUTH_USER_MODEL, null=True, blank=True, on_delete=SET_NULL, related_name="moderation_events")`
- `public_id = CharField(max_length=12, blank=True)` — snapshot, like `Feedback`
- `kind = CharField(max_length=20, choices=[("name_signup",..), ("name_change",..), ("photo",..)])`
- `tier = CharField(max_length=10, choices=[("severe",..), ("mild",..), ("reserved",..), ("none",..)])`
- `reason = CharField(max_length=40)` — code: `blocked`, `strike`, `ban`, `unban`, `signup_ip_locked`
- `ip_hash = CharField(max_length=64, blank=True)` — `sha256(f"{SECRET_KEY}:{ip}")`, never the IP
- `created_at = DateTimeField(auto_now_add=True)`; `Meta.indexes = [Index(fields=["user", "-created_at"])]`
The matched text is never stored (decision 6).

### `backend/users/moderation_text.py` (pure Python, loads JSON once at import)
```python
LEET = {"0": "o", "1": ("i", "l"), "3": "e", "4": "a", "5": "s", "7": "t", "8": "b"}
SUBSTRING_MIN_LETTERS = 6
Verdict = namedtuple("Verdict", "tier reason")   # tier: "ok" | "severe" | "mild" | "reserved"
def tokenize(name: str) -> list[str]           # split on "_", digit runs, camelCase; lowercased; leet-decoded variants included
def compact_forms(name: str) -> set[str]       # letters only, lowercase, leet-decoded; both 1->i and 1->l variants
def collapse(s: str) -> str                    # "fuuuck" -> "fuck"
def check_username(name: str) -> Verdict       # severe before reserved before mild; allowlist only cancels mild
MESSAGE_BLOCKED = "That name isn't allowed. Please choose another."
MESSAGE_RESERVED = "That name is reserved. Please choose another."
MESSAGE_STRIKE = "That name isn't allowed. Repeated attempts will lead to a ban ({n} of 3)."
MESSAGE_SIGNUP_SEVERE = "That name isn't allowed. Repeated attempts will block sign-ups from your network."
```
Data files under `backend/users/moderation_data/`:
- `ldnoobw/<lang>.txt` for en es fr de it pt ru hu — verbatim downloads; `ldnoobw/ATTRIBUTION.md` (CC BY 4.0, source URL, date)
- `severe.json`: `{"attribution": "...", "terms": [{"term": "...", "lang": "en", "source": "ldnoobw"}]}` — curated subset (slurs, explicit sexual terms, the f-word family); `ro` entries carry `"review": "needs-native-review"` (decision 8)
- `mild.json`: same shape — every remaining LDNOOBW entry plus the owner's mild list (dick, gay, ass, cur, pula, fut, cum, cock, sex)
- `reserved.json`: `["admin", "administrator", "moderator", "mod", "staff", "support", "official", "hoops24", "nba", "system", "root"]`
- `allowlist_extra.json`: 30 team names/nicknames + basketball words (assist, dunk, glass, knight, sexton, ...)
- `corpus/benign.json`: `{"nba": [60], "romanian": [30], "leet": [30], "embedded": [30]}` (about 150 names)
The player allowlist is built at import from `trivia/data/all-players.json` (tokens split on space/hyphen/apostrophe, plus the compact full name).

### `backend/users/strikes.py`
```python
MAX_STRIKES = 3
BAN_CODE = "account_banned"
BAN_MESSAGE = "This account has been banned."
BAN_REASON_NAME = "name_severe"
SIGNUP_IP_LIMIT = 3
SIGNUP_IP_LOCK_SECONDS = 24 * 3600
def client_ip_hash(request) -> str                      # first X-Forwarded-For entry else REMOTE_ADDR, sha256 with SECRET_KEY
def canonical_email(email: str) -> str                  # lowercase; gmail/googlemail: drop dots in local part; drop "+tag" everywhere
def ban_payload(user) -> dict                            # {"code","error","public_id","strikes","reason","banned_at"}
def record_strike(user, kind, ip_hash="") -> tuple[int, bool]   # atomic (select_for_update); logs event; bans at MAX_STRIKES
def ban_user(user, reason) -> None                       # banned_at, ban_reason, canonical_email; blacklist OutstandingTokens; leaderboard.remove(user); event "ban"
def unban_user(user) -> None                             # clears the three fields, strike_count=0; leaderboard.record_score; event "unban"
def log_event(user, kind, tier, reason, ip_hash="") -> ModerationEvent
def signup_ip_locked(ip_hash) -> bool                    # cache key f"signup-lock:{ip_hash}"
def note_blocked_signup(ip_hash) -> bool                 # cache.add/incr f"signup-severe:{ip_hash}" (24 h TTL); True once it locks
```

### `backend/users/authentication.py`
`class BanAwareJWTAuthentication(JWTAuthentication)`: `get_user()` calls super, then `if user.banned_at: raise PermissionDenied(ban_payload(user))`.
`settings.REST_FRAMEWORK["DEFAULT_AUTHENTICATION_CLASSES"] = ("users.authentication.BanAwareJWTAuthentication",)`.

### Endpoints (`backend/users/urls.py`, all under `api/`)
- `POST check-name/` body `{"username"}` → 200 `{"ok": true}` or `{"ok": false, "error": "<generic>"}`; throttle `NameCheckRateThrottle` scope `name-check` 120/hour (new class in `backend/throttles.py`, rate in settings). Never strikes, never logs.
- `POST signup/`: severe → 400 `{"error": MESSAGE_SIGNUP_SEVERE}` (+ IP counter); mild/reserved → 400 `{"error": MESSAGE_*}`; IP locked → 403 `{"code": "signup_locked", "error": "Sign-ups from your network are paused for 24 hours."}`; canonical email matches a banned account → 403 `{"code": "signup_blocked", "error": "This email can't be used to create an account."}`.
- `POST update-profile/` (JSON): severe → `record_strike(..., "name_change")` then 400 `{"error": MESSAGE_STRIKE.format(n=count)}`, or 403 `ban_payload` if that strike banned; mild/reserved → 400 generic.
- `POST login/`: after `authenticate()` succeeds and the user is banned → 403 `ban_payload` (checked after the password so a stranger cannot probe ban status by email).
- `POST login/google/`: existing banned user → 403 `ban_payload`; new account whose canonical email matches a banned one → 403 `signup_blocked`; auto-name that fails `check_username` → `f"Player{secrets.randbelow(9000) + 1000}"`, no event.
- `POST token/refresh/`: `SessionRefreshSerializer.validate` first decodes the raw token with `token_backend.decode(raw, verify=True)` (signature + expiry, not blacklist), loads the user, and raises `PermissionDenied(ban_payload)` when banned — before the stock path, because a ban blacklists every outstanding token and the stock path would answer 401 "blacklisted".
- Every authenticated endpoint: 403 `ban_payload` from the auth class.

### Hidden when banned
- `leaderboard.top/rank_of/total/friends_board` Postgres paths filter `banned_at__isnull=True`; new `leaderboard.remove(user)` (`zrem`, no-op without Redis); `record_score` is a no-op for banned users; `sync_leaderboard` excludes them.
- `friends.search_users` adds `.filter(banned_at__isnull=True)`.
- `photos.profile_photo_view` selects `banned_at` too and returns the same 404 when set.
- Relay: a banned token is refused at identify (below).

### Relay (`multiplayer_server/src/identity.js`, new; `index.js`)
```js
// identity.js — zero deps; node >= 18 global fetch
const VERIFY_TTL_MS = 60000;
async function verifyToken(token, { fetchImpl = fetch, now = Date.now, apiBaseUrl } = {})
  // -> { ok: true, user } | { ok: false, code: "account_banned" | "invalid_token" | "auth_unavailable", message }
  // GET `${apiBaseUrl}/api/me/` with Authorization: Bearer; 200 -> user; 403 body.code === "account_banned" -> banned;
  // 401/other 4xx -> invalid_token; network error / 5xx -> auth_unavailable (fail closed). Verdicts cached per token for
  // VERIFY_TTL_MS in a Map pruned of expired entries when it exceeds 10000 keys.
module.exports = { verifyToken, VERIFY_TTL_MS, _cache };
```
`index.js`:
- `socket.on("identify", ({ user, token } = {}))` → `socket.identifying = verifyToken(token)`; on `ok` set `socket.uid = user.id`, `socket.token = token`, `players.set(uid, { socketId, user: serverUser, roomCode })` and run the existing resume logic; on `account_banned` emit `identifyError { code, message }` then `socket.disconnect(true)`; on any other failure emit `identifyError` and leave `socket.uid` unset. A missing token is `invalid_token`.
- `findMatch`, `createFriendRoom`, `joinFriendRoom` become `async` and `await socket.identifying` before `uidOf(socket)`; an unset uid keeps the existing "You need to be signed in" error.
- `API_BASE_URL` (already in `gameEndpoints.js`) is the Django base; export it from there or read `process.env.API_BASE_URL` in `identity.js` the same way.

### Frontend
- `src/utils/ban.ts`: `BAN_CODE`, `type BanInfo = { code: "account_banned"; error: string; public_id: string; strikes: number; reason: string; banned_at: string | null }`, `isBanPayload(body: unknown): body is BanInfo`, `banFromResponse(res: Response): Promise<BanInfo | null>` (403 + JSON only, uses `res.clone()`), `setBanHandler(fn)`, `reportBan(info)`. Imports nothing from `Api.tsx` (no cycle).
- `src/store/userSlice.tsx`: state `banned: BanInfo | null` (initial null); reducer `accountBanned(state, { payload: BanInfo })` sets `isLoggedIn=false`, `user=null`, `authChecked=true`, `banned=payload`; `logout` also sets `banned=null`.
- `src/utils/Api.tsx`: `apiFetch` after its final response: `if (response.status === 403) { const ban = await banFromResponse(response); if (ban) reportBan(ban); }` then returns the response unchanged. `refreshSession` `!res.ok` branch: a 403 ban body calls `reportBan` before the existing `clearTokens()`/throw.
- `src/app/providers.tsx` `AppEffects`: `setBanHandler((info) => { clearTokens(); clearCachedUser(); dispatch(accountBanned(info)); })` in a mount effect. The bootstrap needs no new branch: a 403 from `/me/` is reported by `apiFetch` and `accountBanned` replaces the hydrated user.
- `src/components/LogInSignUp.tsx`: each of the three flows, right after `const data = await response.json()`: `if (response.status === 403 && isBanPayload(data)) { reportBan(data); onClose(); return; }` (with `setIsSubmitting(false)`). Leaves the state-machine room the other card needs: ban is a slice state, not a form state.
- `src/context/MultiplayerContext.tsx`: `identify` becomes `async identifyNow(): Promise<void>` — `let token = getAccessToken(); if (!token || isAccessTokenExpired(token)) token = (await refreshSession()).access;` then `socket.emit("identify", { user, token })`; `findMatch`/`createFriendRoom`/`joinFriendRoom` do `identifyNow().then(() => socket.emit(...))`. New listener `identifyError`: `account_banned` → `reportBan({ code, error: message, public_id: user.id, strikes: 3, reason: "", banned_at: null })`; otherwise dispatch the existing `NOTICE` warn with the message.
- `src/components/BanNotice.tsx` + `src/styles/BanNotice.css` (UI-4/UI-6 prefix `ban-`): reads `state.user.banned`; `AnimatePresence` + `motion.div` with `fadeIn` from `src/motion/variants.ts`; fixed full-viewport, z-index from the existing scale one step *below* the modal backdrop (UI-12; check `theme.css`/`Modal.css`), `role="alertdialog"`, `aria-modal`. Content: `h2` "Your account has been banned", a paragraph explaining what happened (reason code → sentence map: `name_severe` → "Your display name broke the rules three times."), `SwapText` line "Strikes: 3 of 3", id line "Account #K7F3QD", two `<Button>`s: "Appeal" (`openModal("feedback", { preset: "appeal", publicId })`) and "Log out" (`clearTokens(); clearCachedUser(); dispatch(logout())`). Mounted in `providers.tsx` directly before `<ModalHost />`. Phone width 390 and desktop 1280 both single-column, 16 px gutters.
- `src/context/ModalContext.tsx`: `export interface FeedbackPayload { preset?: "appeal"; publicId?: string }`; `ModalPayload` union gains it. `ModalHost` passes `preset`/`publicId` to `FeedbackModal`; title "Appeal a ban" for the preset.
- `src/components/modals/FeedbackModal.tsx`: props `{ onClose; preset?: "appeal"; publicId?: string }`; preset hides the star row, initial text `[Appeal #<publicId>] `, submits `rating: APPEAL_RATING` (3), `game: "appeal"`, `page: "/banned"`; the guest email field stays visible (tokens are cleared by then, so the request is a guest one).
- `src/utils/nameCheck.ts`: `checkName(username: string): Promise<{ ok: boolean; error?: string }>` → `fetch(`${BACKEND_URL}/check-name/`)`, never throws (network error → `{ ok: true }` so the server stays the judge). Used by `LogInSignUp` (signup username field) and `UserProfile` (username editor): 500 ms debounce after the regex passes, result shown in a `<p className="auth-field-note" aria-live="polite">` / `.profile-name-note` under the field.

### Admin (`backend/users/admin.py`)
`CustomUserAdmin`: `list_display += ("strike_count", "banned_at")`, `list_filter += (("banned_at", admin.EmptyFieldListFilter),)`, fieldset `("Moderation", {"fields": ("strike_count", "banned_at", "ban_reason", "canonical_email")})` all in `readonly_fields`, `actions = ["unban_users"]` ("Unban (reset strikes)" → `strikes.unban_user`), `inlines = [ModerationEventInline]` (TabularInline, `readonly_fields` = all, `can_delete=False`, `has_add_permission` False, `extra=0`). `ModerationEventAdmin` registered read-only with `list_filter = ("kind", "tier", "reason")`.

### Management command `backend/users/management/commands/scan_existing_users.py`
Reports only: for every user in pk order, `check_username(username)`; prints `public_id  tier  reason` for non-ok names and a final count. No writes, no events; `--strict` is not added (scope).

### Settings / env
No new env vars. `REST_FRAMEWORK["DEFAULT_THROTTLE_RATES"]["name-check"] = "120/hour"`. The relay keeps using `API_BASE_URL`.

## File plan
- `backend/users/models.py` — fields + `ModerationEvent`
- `backend/users/migrations/0008_moderation.py` — auto-generated
- `backend/users/moderation_text.py` — new matcher
- `backend/users/moderation_data/{ldnoobw/*.txt, ldnoobw/ATTRIBUTION.md, severe.json, mild.json, reserved.json, allowlist_extra.json, corpus/benign.json}` — new data
- `backend/users/strikes.py` — new strike/ban/lock service
- `backend/users/authentication.py` — new auth class
- `backend/users/tokens.py` — ban check in `SessionRefreshSerializer.validate`
- `backend/users/views.py` — signup/login/google/update_profile wiring, `check_name` view
- `backend/users/urls.py` — `check-name/`
- `backend/users/leaderboard.py` — banned filters, `remove()`
- `backend/users/management/commands/sync_leaderboard.py` — exclude banned
- `backend/users/friends.py` — `search_users` filter
- `backend/users/photos.py` — 404 when banned
- `backend/users/admin.py` — moderation fields, action, inline, event admin
- `backend/users/management/commands/scan_existing_users.py` — new
- `backend/backend/settings.py` — auth class, throttle rate
- `backend/backend/throttles.py` — `NameCheckRateThrottle`
- `backend/users/test_moderation.py`, `backend/users/test_strikes.py` — new (flat modules, BE-17)
- `multiplayer_server/src/identity.js` — new; `multiplayer_server/src/index.js` — identify/findMatch/createFriendRoom/joinFriendRoom; `multiplayer_server/scripts/test_identity.js` — new (`node --test`); `multiplayer_server/package.json` — `"test": "node --test scripts/test_identity.js"` (scripts only, no deps)
- `src/utils/ban.ts`, `src/utils/nameCheck.ts`, `src/components/BanNotice.tsx`, `src/styles/BanNotice.css` — new
- `src/store/userSlice.tsx`, `src/utils/Api.tsx`, `src/app/providers.tsx`, `src/components/LogInSignUp.tsx`, `src/components/UserProfile.tsx`, `src/context/MultiplayerContext.tsx`, `src/context/ModalContext.tsx`, `src/components/ModalHost.tsx`, `src/components/modals/FeedbackModal.tsx` — edits
- `docs/constraints/AUTH_CONSTRAINTS.md` (AUTH-3, AUTH-8, new AUTH-13, acceptance checks 7/8), `docs/constraints/MULTIPLAYER_CONSTRAINTS.md` (MP-1), `docs/team/DECISIONS.md` — docs

## Risks
- **Locking every account out** (auth class on every request): the class only adds `if user.banned_at`; `test_strikes.py` asserts `/me/` is 200 for a normal user and 403 only after the ban; unban restores 200.
- **False positives on real names**: the 5208-name test and the benign corpus run in CI at the severe tier with 0 allowed; severe terms are forbidden from being a player-name token (`test_no_severe_term_is_a_player_token`), so Dick Barnett, Rudy Gay, Dell Curry, Terry Cummings, Collin Sexton can never strike.
- **Wordlist leak**: `check-name` returns only the generic message; no endpoint returns a term; the JSON lives under `backend/`, never `src/` or `public/`.
- **Refresh answering 401 instead of 403 after a ban** (tokens blacklisted): handled by the pre-decode in `SessionRefreshSerializer` (Interfaces). Test: ban, then refresh → 403 `account_banned`.
- **Relay race** (findMatch arrives before `/me/` answers): `await socket.identifying`. **Django down**: `auth_unavailable` fails closed with a clear message; no spoofed play.
- **Throttle counters on LocMemCache**: the IP lock uses the same `CACHES` tier as throttles (shared in production, BE-19); tests use `override_settings` LocMem and `cache.clear()` in `setUp`.
- **UI-8 (every overlay goes through ModalHost)**: `BanNotice` is a page-level blocking state, not a dismissible overlay, and it must sit *under* the feedback modal; this is a deliberate, documented exception (DECISIONS).
- **Frontend cycle**: `ban.ts` imports nothing from `Api.tsx`/the store; `Api.tsx` imports `ban.ts`; the handler lives in `providers.tsx`.
- **Scope creep into the photo card**: `kind="photo"` and `ban_reason="photo"` are reserved values only; no photo code changes here.

## Test plan
Gate 1 (unchanged): `npm run lint`, `npx next typegen && npx tsc --noEmit`, `npm run build`,
`cd backend && DATABASE_URL="" python manage.py check && python manage.py test users trivia` (expect ~369 + the new ~35),
plus `DATABASE_URL="" python manage.py makemigrations --check --dry-run` and `cd multiplayer_server && npm test`.

New tests the engine adds:
- `users/test_moderation.py`: required names pass (Rudy Gay, Dick Barnett, Dell Curry, Terry Cummings, Collin Sexton, CurryFan30, DikembeMutombo, Cockburn, RudyGay, DickBarnett, AssistKing, GlassCleaner); all 5208 player names and their compact forms → tier `ok` or `mild` never `severe` (0 severe false blocks); benign corpus ≤ 1 false block overall; generated offensive set (leet, repeated letters, camelCase/underscore split, digit suffixes from `severe.json`/`mild.json` seeds) recall ≥ 90 % overall and ≥ 98 % severe; reserved names rejected; the test prints the measured numbers.
- `users/test_strikes.py`: 3 severe `update-profile` changes → 403 `account_banned` on the third, `banned_at` set, 3 `ModerationEvent`s + ban event; after the ban `/me/`, `login/`, `login/google/` (mock `requests.post` + `id_token.verify_oauth2_token`) and `token/refresh/` each 403 `account_banned`; first strike message contains "(1 of 3)"; mild name → 400 with no strike; three severe signups from one IP → no account, 4th → 403 `signup_locked`; `check-name/` never creates an event; banned user absent from `get-users`, `search-users`, photo 404; `unban_user` → `/me/` 200, `strike_count` 0, leaderboard row back; canonical-email signup refused; `scan_existing_users` prints and writes nothing.
- `multiplayer_server/scripts/test_identity.js` (`node:test`, fake `fetchImpl`): 200 → ok with the server user; 403 banned → `account_banned`; 401 → `invalid_token`; thrown fetch → `auth_unavailable`; a second call within 60 s does not call fetch; after 60 s it does.

Gate 2 QA assertions (copied into the brief):
```json
[
  { "route": "/", "selector": ".app-shell", "expect": "visible" },
  { "flow": "Open the login modal, Sign up tab. Type 'Baller' in the username field: no .auth-field-note appears. Type 'admin1': within 1 s an .auth-field-note reads 'That name is reserved. Please choose another.' Screenshot." },
  { "flow": "Create a throwaway account (unique email). Open the profile username editor and submit the first `term` of backend/users/moderation_data/severe.json with '1' appended; the error alert text contains 'Repeated attempts will lead to a ban (1 of 3)'. Screenshot at 390x844. Dismiss and repeat with '2' appended: '(2 of 3)'." },
  { "flow": "Submit a third severe name ('3' appended). The page shows .ban-notice with 'Your account has been banned', 'Strikes: 3 of 3', the account #ID, an 'Appeal' button and a 'Log out' button; no nav user chip; localStorage has no accessToken/refreshToken. Screenshot at 390x844 and 1280x800." },
  { "flow": "Click Appeal: a modal titled 'Appeal a ban' opens above .ban-notice with the textarea pre-filled '[Appeal #<id>] ' and no star row. Close it. Click Log out: .ban-notice is gone and the guest 'Log in' button is back." },
  { "flow": "Open the login modal and log in with the banned account's email: .ban-notice appears again (403 account_banned); no 'Incorrect password' alert." }
]
```

## Implementation plan

1. **[sonnet] Model fields, `ModerationEvent`, migration.** `backend/users/models.py` (fields exactly as in Interfaces, docstrings per BE-5), `backend/users/migrations/0008_moderation.py` via `makemigrations users -n moderation`. Done: `DATABASE_URL="" python manage.py makemigrations --check --dry-run` prints "No changes"; `python manage.py migrate` on sqlite succeeds; existing suite still passes.
2. **[opus] Word lists, matcher, corpus, matcher tests.** `curl` the eight LDNOOBW lists into `backend/users/moderation_data/ldnoobw/` with `ATTRIBUTION.md`; curate `severe.json` (slurs, explicit sexual terms, f-word family, ~40-80 entries; a term whose normalized form is a player-name token is never severe), `mild.json` (everything else + the owner's mild list), `reserved.json`, `allowlist_extra.json`, `corpus/benign.json`; write `moderation_text.py` exactly as the Interfaces section (tokenize/compact_forms/collapse/check_username, substring rule only for severe terms with ≥ 6 collapsed letters); write `users/test_moderation.py` including the programmatic offensive generator and the printed metrics. Done: `python manage.py test users.test_moderation` passes with 0 severe false blocks on the 5208 names and the NBA set, ≤ 1/150 benign, ≥ 90 %/98 % recall; the numbers are copied into `build-report.json` `assumed`.
3. **[opus] Strike, ban, lock service.** `backend/users/strikes.py` as in Interfaces (atomic `record_strike` with `select_for_update`, `ban_user` blacklisting every `OutstandingToken` via `BlacklistedToken.objects.get_or_create`, `unban_user`, `canonical_email`, `client_ip_hash`, cache-backed `signup_ip_locked`/`note_blocked_signup`); `leaderboard.remove()` + banned filters in `top/rank_of/total/friends_board` + no-op `record_score` for banned. Done: unit tests in `users/test_strikes.py` for `record_strike` (counts, bans on 3, events logged, tokens blacklisted, `zrem` called on the `FakeRedis` from `test_leaderboard.py`), `canonical_email` ("A.b+x@Gmail.com" → "ab@gmail.com"; "a.b+x@other.com" → "a.b@other.com"), lock after 3.
4. **[opus] Enforcement wiring.** `users/authentication.py` + `settings.py` auth class; `tokens.py` pre-decode ban check; `views.py`: `signup_view` (lock check → format → `check_username` → severe counts IP / mild generic → canonical-email check), `update_profile` (severe → `record_strike("name_change")` → 400 strike message or 403 ban payload; mild/reserved → 400), `login_view` (ban check after `authenticate`), `google_login` (ban check; canonical-email refusal; safe auto-name), new `check_name` view; `urls.py`; `throttles.py` + rate. Done: `users/test_strikes.py` endpoint tests listed in Test plan pass, including 403 bodies with `code == "account_banned"` on `/me/`, login, Google login, refresh, and "(1 of 3)".
5. **[sonnet] Hide banned accounts.** `friends.search_users` filter, `photos.profile_photo_view` 404, `sync_leaderboard` exclude. Done: tests for each in `test_strikes.py` (search omits, photo 404 same body as no-photo, sync skips) pass.
6. **[sonnet] Admin and scan command.** `admin.py` fields/filter/readonly/action/inline/event admin; `scan_existing_users.py`. Done: `python manage.py check` clean; test calls `call_command("scan_existing_users", stdout=buf)` on a seeded banned-looking name and asserts the line is printed and no `ModerationEvent` row or field changed; admin action test via `self.client.post` on the changelist with `force_login` superuser → user unbanned.
7. **[opus] Relay token verification + client identify.** `multiplayer_server/src/identity.js`, `index.js` (identify/findMatch/createFriendRoom/joinFriendRoom as in Interfaces), `package.json` test script, `scripts/test_identity.js`; `src/context/MultiplayerContext.tsx` (`identifyNow` with refresh, `{ user, token }`, `identifyError` listener). Done: `cd multiplayer_server && npm test` passes the six cases; `grep -rn "identify" multiplayer_server/src/index.js` shows the await before each of the three gated actions; `npx tsc --noEmit` clean for the context.
8. **[sonnet] Frontend ban plumbing.** `src/utils/ban.ts`, `userSlice.tsx` (`banned`, `accountBanned`), `Api.tsx` (apiFetch 403 hook, refreshSession 403), `providers.tsx` (handler), `LogInSignUp.tsx` (three flows). Done: `npx tsc --noEmit` clean; manual check in the dev server with a banned account: `/me/` 403 clears tokens and `state.user.banned` is set (visible via the step-9 screen; until then `console.log` is not left behind).
9. **[opus] Ban screen and appeal preset.** `BanNotice.tsx` + `BanNotice.css`, mount in `providers.tsx`; `ModalContext` `FeedbackPayload`; `ModalHost` title/props; `FeedbackModal` appeal preset (hidden stars, prefix, `game: "appeal"`); the ban screen's Log out. Done: with a banned account the screen renders at 390x844 and 1280x800 with no horizontal scroll, Appeal opens the modal above it, Log out returns to the guest UI; reduced-motion honoured through `MotionConfig` (UI-20); `npm run lint` clean.
10. **[sonnet] Live name check.** `src/utils/nameCheck.ts`; debounced note in `LogInSignUp` signup username field and `UserProfile` editor. Done: typing a reserved name shows the note within 1 s, a plain name shows none, a network failure shows none; `npx tsc --noEmit` clean.
11. **[sonnet] Docs.** `AUTH_CONSTRAINTS.md`: AUTH-3 names `BanAwareJWTAuthentication`; AUTH-8 rewritten ("identify carries the access token; the relay verifies it against `/api/me/` and keys the player by the server payload"); new AUTH-13 "Bans: `banned_at` is the switch, the auth class the gate, 403 `account_banned` the contract; strikes never expire; banned accounts are hidden, not deleted; anti-evasion is weak by design"; acceptance check 7 now expects `identity.js` to be the only `Authorization` user and check 8 the new class. `MULTIPLAYER_CONSTRAINTS.md` MP-1 drops "trusts it unverified". `DECISIONS.md` entry (defaults 1-8, the relay token rule, the UI-8 exception). Done: `grep -n "BanAwareJWTAuthentication" docs/constraints/AUTH_CONSTRAINTS.md backend/backend/settings.py` hits both.
12. **[sonnet] Verify and report.** Run the gate-1 commands plus `makemigrations --check` and the relay test; write `.team/run/ban-system-and-username/build-report.json` with `did`, `assumed` (the measured corpus numbers, the UI-8 exception, the fixed appeal rating, the token-required relay rule), `touched`, `testsAdded`. Done: every command exits 0 and the report exists.

## Self-review
- Coverage: every "Done when" line maps to steps 2-9 and the QA flows; the two docs to step 11; screenshots to gate 2.
- No placeholders: every message, code, field, path and threshold is named.
- Consistency: `account_banned`, `ban_payload`, `reportBan`, `BanNotice`, `check-name/`, `identifyError`, `identity.js` are spelled the same in Interfaces, File plan and steps.
- Scope: no photo code, no Feedback schema change, no new env vars, no new dependencies.
- Ambiguity settled: ban check after the password (not before); refresh pre-decodes to answer 403; relay requires the token; appeal uses a fixed rating; `BanNotice` is the documented UI-8 exception.
