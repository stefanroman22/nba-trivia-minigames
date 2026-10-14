# Account suite notes (for the judge agents)

Specs: `specs/account/{auth,google,profile,surfaces,permissions,blocking}.spec.mjs`. Locators: `pagemap/account.json`
(+ `guest.json` for the modal shell, `common.json` for nav and drawer). Helpers: `lib/account.mjs` (API calls as a
minted user, throwaway names, in-page typing latency, nav flash sampler, `tabSlide`, `motionStep`, friendship cleanup).
Harness additions: `lib/accounts.mjs` accepts throwaway names `uic<digits>` and has `forgetAge()`; `lib/mint_tokens.py`
has the `forget_age` op; `fixtures/upload/avatar.png` (64x64).

## How judges use this file

The `ui-check-account` judge reads "Intentional exemptions", "Measurement notes" and "Flaky spots" before judging
(what they describe is not a finding), "Throttle budget" before it probes anything (probes never submit), and
"Personas" and "Selector tips" when it writes acceptance assertions. After judging it appends what a later run can
reuse (a false positive and why, a selector that works, a flaky spot) as one bullet `- (<runId>) …` under the
matching heading; it never edits or deletes existing lines.

## Personas

- `solo` (project default): a minted session for the worker's account (`testuser3`, `testuser3w<n>`).
- Specs that need a logged-out page use `test.use({ persona: 'guest' })` (auth, google, PROFILE-03). Extra contexts
  (fresh-context email login, Instagram user agent, guest login in BLOCK-01) come from `browser.newContext` plus
  `createAudit(page, testInfo, { label })`.
- Throwaways: `uic<run digits><kind><core index>`, kind 1 = sign-up flow (real sign-up UI), kind 2 = delete-account flow
  (created like a sign-up by the mint op, because the sign-up throttle is shared), kind 3 = AC-BLOCK-01's age and delete submits. All are deleted in a `finally`.

## Throttle budget (per full run, one IP)

| endpoint | limit | used |
|---|---|---|
| `POST /api/signup/` | 10/h per IP | 7: AC-SIGNUP-02 2 per core vp (duplicate email + real) = 6, AC-BLOCK-01 1 (phone-390). Accounts created: 3. |
| `POST /api/login/` | 30/h per IP | about 18: AC-LOGIN-01 3 per core vp, AC-BLOCK-01 1 per core vp, AC-PROFILE-03 2 per core vp (`accountExists` before and after delete) |
| export / delete / set-age (scope `account-data`) | 10/h per **account** | solo account: 7 (AC-PROFILE-02 set-age, once per vp). Each throwaway: AC-PROFILE-03 export + 2 deletes, AC-BLOCK-01 set-age + 1 delete + cleanup delete. |
| `check-name` | 120/h (per account when signed in, per IP for guests) | about 6 per AC-SIGNUP-01 run x 7 (guest, one IP) |

The `@perf` serial pass runs every viewport on the SAME solo account (worker 0), so per-account limits add up there:
that is why AC-BLOCK-01's age and delete submits use a throwaway (kind 3) and not the solo account (an earlier version
put 13 `account-data` calls on `testuser3` and got HTTP 429 on the last viewports).

The counters live in Django's LocMem cache: **restarting the stack resets them**. Re-running a signup/login check
several times in one hour on one stack hits the limit and shows up as HTTP 429 in the login/sign-up forms
(`node scripts/ui-check/run.mjs --stop`, then run again).

## Selector tips

- A label inside `SwapText` or `.seg-label` is a child span: `button:text-is('Play 1v1')` never matches the button.
  Use `:has-text()` (`guest.json` `mpPlay1v1Btn` / `mpFriendBtn` use `text-is` and so never match anything).
- `SwapText` with `reserveWidth` keeps every state's text in the DOM (invisible): `toHaveText` sees all of them. Use
  `toHaveText(x, { useInnerText: true })` for the Play 1v1 / Cancel button.
- Nav chip: `nav.nav3 button.nav3-user:visible`, `aria-label` = `<name> #<id>`. The mobile chip opens the same profile menu
  as the desktop one; the drawer has its own Log out button.
- Auth modal fields are found by `aria-label`: `Email or username`, `Email`, `Username`, `Password`; rules lists by
  `ul[aria-label='Password requirements' | 'Username requirements']`; errors are `p.auth-error-msg`.
- `/profile` rows: `#ps-username`, `#ps-photo`, `.ps-row:has(.ps-label:text-is('Player ID'))`. A username error is a
  SweetAlert popup (`.swal2-popup`), not inline; the live rules under the field are inline.
- Landing profile card is `.profile-card` inside `#leaderboard`; friends panel `.fr-tabs` (Friends, Requests, Find,
  Blocked); leaderboard scope tabs `#leaderboard .lb-scope`. The card remembers its view in
  `localStorage['sq:profile-view']`.

## Intentional exemptions

- `slow POST /api/(signup|login|account/delete)/`: password hashing takes 1-2 s here. Their budget is the explicit
  in-page timing (sign-up and log in: click to avatar <= 1500 ms); `account/delete` has no budget.
- 401 console lines in AC-LOGIN-02, 409 in AC-SIGNUP-02, 428 in AC-PROFILE-02, 403 in AC-PROFILE-03 and AC-BLOCK-01:
  the status is the thing under test (bad token, duplicate email, `age_required` hand-off, wrong delete password).
- AC-PROFILE-03 does not require the delete password to be filled to enable the button: Google-only accounts have no
  password (the placeholder says so); the server answers 403 for a wrong one, which the test asserts.
- No "username taken" checks: names repeat by design. The checks assert an existing name passes the rules.
- AC-SURF-02 and the throttled parts of AC-BLOCK-01 run on the core viewports only (shared `testuser2`, friend-request
  and login/sign-up throttles); AC-BLOCK-01 signs up on `phone-390` only.

## Measurement notes

- Click-to-avatar and busy-within-100ms are measured inside the page (`routeLatency`): capture-phase click to a frame
  where the predicate is true. Node-side polling adds hundreds of ms.
- `NAV_SAMPLER` (lib/account.mjs) records `nav.nav3` and the chip on every frame from the first paint of each document;
  `navFlash` returns the total time the nav showed without the chip. The gap before the first chip includes the server
  render -> hydration time, so a valid-token reload is recorded as a baseline.
- Every `audit.motion` in this suite goes through `motionStep`, which adds `during: <step>` to the violation note.
- Dev mode adds the React 19 `element.ref` console error on pages that open the login modal; it is dev-only. Judge on prod.
- A stale dev server returned 404 for `/profile` and `/terms` (route table from a previous build); `--stop` and restart.

## Flaky spots

- Photo upload (`POST /api/update-profile/`) took 1.2 s for a 64x64 image in dev under load (`slow-api`); re-run alone
  before calling it real.
- AC-LOGIN-02's flash number is dominated by hydration time; it grows with machine load.
- The Google click needs `accounts.google.com/gsi/client` to load; offline it records the soft warning `skip-explained`.
