# Design — logic-check: `log_session` credits only a visible game; unknown ids get 0 (2026-10-16)

Card `3fb2cfb1-c595-8186-ab8b-ddf2362656ce` · slug `logic-check-log-session` · finding `UIC-20261016-0918-logic-002`
(check `LC-GAMEDATA-02`, fingerprint `advisory|/trivia/log-session|log-session-replay`). Target `main`.
Rules quoted by the brief: AUTH-6 (one points writer, `trivia.awarding.award`), AUTH-7 (guests/online get 0 here),
AUTH-9 / BE-19 (`score-submit` 60/h stays as it is).

## 1. Decision summary
- A `game` id that is not a **visible** game is credited 0 and the POST still answers **200** with the existing
  zero receipt (`awarded: 0`). The 400 variant is rejected: the card's acceptance assertion already fixes
  `status 200, awarded == 0`, and 200 keeps the client's single code path (`applyAward` already handles 0 for guests).
- "Visible game" is decided server-side as `frozenset(awarding.GAME_MAX_POINTS) - trivia.games.HIDDEN_GAMES`:
  every id with a server ceiling (classic *and* modular games) minus the slugs nothing routes or lists for players.
  This mirrors the client's `visibleGames` (`src/utils/GameUtils.tsx`, `hidden: true` on the same seven slugs)
  and the catalogue filter `get_manifest`/`get_pool` already apply with `HIDDEN_GAMES` in `backend/trivia/views.py`.
  Un-hiding a game later needs no change here: drop it from `HIDDEN_GAMES` and it is credited.
- An uncredited play (unknown or hidden id) is still **logged** as a `GameSession` row, with `score = 0` and
  `awarded = 0`, so the attempt leaves an audit trail but cannot touch `earned_today` or the first-game-bonus
  check of the player's later honest plays (`award()` sums `score` over today's `single`/`match` rows).
- `awarding.cap_for` / `DEFAULT_MAX_POINTS` are **not** touched: the relay path (`multiplayer_result`) keeps its
  behaviour, and `test_awarding.CapTests.test_unknown_game_gets_the_default` stays valid.
- **No replay / one-time play id in this card** (see §4 and Follow-ups): it is a client+server protocol change
  (`src/views/Trivia/MiniGame.tsx`, the round GETs, the relay) and the existing bounds already cap replay.
- Correction to the finding's evidence: on this base the fallback is no longer `MAX_SESSION_POINTS = 1000` in
  `views.py`; the progression work moved caps to `trivia/awarding.py` (`GAME_MAX_POINTS`, `DEFAULT_MAX_POINTS = 300`).
  An unknown id is today credited up to 300 (+100 first-game bonus); after this card, 0.

**Engine: sonnet** (every step is explicit with a done-check; no motion, no judgment left open).

## 2. Interfaces
- `POST /trivia/log-session/` — request body unchanged: `{game: str, mode: 'single'|'match'|'friend', score, duration_ms}`.
  Response unchanged in shape. New behaviour: when `game not in _CREDITED_GAMES` the response is the existing zero
  receipt `{"ok": true, "awarded": 0, "points": <user.points or 0>, "rank": <user.rank or null>, "rank_up": null}`
  with status 200, for signed-in players and guests alike. No new status code, no new field.
- `backend/trivia/views.py` — new module constant, placed directly above `log_session`:
  `_CREDITED_GAMES = frozenset(awarding.GAME_MAX_POINTS) - HIDDEN_GAMES` (`HIDDEN_GAMES` is already imported at
  line 33; `awarding` is already imported). Type `frozenset[str]`. Must contain `"series-winner"`, `"wordle"`,
  `"who-would-win"`, `"tictactoe"`; must not contain `"heatmap"`, `"lc-no-such-game"`, `"coming-soon"`.
- `GameSession` row for an uncredited play: `game=<id as sent, [:40]>`, `mode=<as sent>`, `score=0`, `awarded=0`,
  `duration_ms=<clamped as today>`. No model or migration change.
- Throttle: `ScoreSubmitRateThrottle` (`score-submit` 60/h) unchanged.

## 3. File plan
- `backend/trivia/views.py` — add `_CREDITED_GAMES`; in `log_session` compute `credited`, zero the score when not
  credited, add `or not credited` to the existing "log and award 0" branch; update the docstring/comment.
- `backend/trivia/tests/test_score_award.py` — four new tests in `ScoreAwardTests` (see §5).
- `.team/run/logic-check-log-session/build-report.json` — written by the engine when done (pipeline requirement).
- Nothing else. Not touched: `trivia/awarding.py`, `trivia/games/__init__.py`, `src/views/Trivia/MiniGame.tsx`,
  `multiplayer_server/`, settings/throttles, models/migrations.

## 4. Risks
- **A real visible game is accidentally uncredited** (LC-GAMEDATA-02 regresses). Prevented by building the set from
  `GAME_MAX_POINTS` (which lists every classic and modular game with a ceiling), not from `_GAME_MODULES` (which
  omits the six classic games), and by the new `series-winner` test plus the existing `wordle`/`who-would-win`
  cap tests.
- **Hidden-game drift** between client and server. Both lists name the same seven slugs today (`HIDDEN_GAMES` vs
  `hidden: true`); the server list is the authority for credit, and a mismatch can only ever withhold points from a
  game players cannot reach anyway (its `get_round` is not routed and its pool 404s).
- **Side effects on honest plays from a forged unknown-game row.** Prevented by storing `score=0` on uncredited rows:
  `award()`'s `earned_today` sum and `todays.filter(score__gt=0)` first-game check ignore them (tested).
- **Replay of a finished play is still possible** up to 60/h. Accepted for this card: per-game ceilings (max 500),
  the daily soft cap (1,500 full, next 1,500 at 50%, then 10%), the Wordle once-a-day block
  (`_repeat_blocked`) and the 60/h throttle bound an account to roughly 2,250 points + a 10% tail per day, versus the
  unbounded forged-id path this card closes. A server-checked play id is a protocol change recorded as a follow-up.
- **Relay path** (`multiplayer_result`) still clamps an unknown game to `DEFAULT_MAX_POINTS`. It is authenticated by
  `MULTIPLAYER_SHARED_SECRET` and its game ids come from the relay's own room state, so the exposure is a compromised
  relay key, not a browser. Out of scope (fingerprint is `log-session`); follow-up.
- **Guest rows**: guests already log any string; they now log `score=0` for an unknown id. No reader depends on guest
  scores of unknown games.

## 5. Test plan
Gate 1 (unchanged command): `DATABASE_URL="" python manage.py check && python manage.py test users trivia`
(~369 existing + 4 new). No migration, so `makemigrations --check` is not needed.

New tests, `backend/trivia/tests/test_score_award.py::ScoreAwardTests` (use the existing `_finish` helper and `points()`):
1. `test_unknown_game_is_logged_but_awarded_nothing` — `_finish(game="lc-no-such-game", score=1_000_000)` →
   `status 200`, `json["awarded"] == 0`, `points() == 0`,
   `GameSession.objects.filter(user=self.user, game="lc-no-such-game", score=0, awarded=0).count() == 1`.
2. `test_hidden_game_is_awarded_nothing` — `_finish(game="heatmap", score=300)` → `awarded == 0`, `points() == 0`.
3. `test_classic_game_is_credited_its_cap` — `_finish(game="series-winner", score=10**6)` →
   `awarded == 100 + FIRST_GAME_BONUS`, `points() == 200` (a classic game is not in `_GAME_MODULES`; proves the set
   is built from `GAME_MAX_POINTS`).
4. `test_unknown_game_does_not_eat_the_first_game_bonus` — `_finish(game="lc-no-such-game", score=300)` then
   `_finish(score=250)` (wordle) → second response `awarded == 250 + FIRST_GAME_BONUS`, `points() == 350`.
Existing tests that must stay green (LC-GAMEDATA-02): `test_inflated_score_is_clamped`,
`test_who_would_win_is_capped_at_its_own_ceiling`, `test_who_would_win_honest_max_is_awarded_in_full`,
`test_guests_are_awarded_nothing_but_still_logged`, `test_awarding.CapTests.test_unknown_game_gets_the_default`.

Gate 2 (api-only; no browser routes or selectors): the check card's `verify` entry runs
`node scripts/ui-check/verify.mjs --from <findings.json>` on the lane, which POSTs as persona `logic.actor`
`{"game":"lc-no-such-game","mode":"single","score":1000000,"duration_ms":60000}` and expects `status 200`,
`awarded == 0`. QA assertions block for the brief:
```json
[
  { "verify": "/home/user/nba-trivia-minigames/.team/attachments/3fb2cfb1-c595-8186-ab8b-ddf2362656ce/0.bin" }
]
```

## Implementation plan
1. `[sonnet]` `backend/trivia/views.py` — directly above `log_session` (after `_MAX_DURATION_MS` / `log_guesses`),
   add `_CREDITED_GAMES = frozenset(awarding.GAME_MAX_POINTS) - HIDDEN_GAMES` with a two-line comment: a play is
   credited only for a game players can reach (every id with a ceiling minus `HIDDEN_GAMES`, mirroring
   `visibleGames` in `src/utils/GameUtils.tsx`); anything else is logged with 0 (LC-GAMEDATA-02). No new imports.
   Done: `cd backend && DATABASE_URL="" python -c "import django,os;os.environ.setdefault('DJANGO_SETTINGS_MODULE','backend.settings');django.setup();from trivia.views import _CREDITED_GAMES as c;assert 'series-winner' in c and 'wordle' in c and 'heatmap' not in c and 'lc-no-such-game' not in c"` exits 0.
2. `[sonnet]` `backend/trivia/views.py::log_session` — after `mode` is resolved: `credited = game in _CREDITED_GAMES`;
   `score = awarding.clamp_score(game, mode, body.get('score', 0)) if credited else 0`; change the branch to
   `if user is None or mode != 'single' or not credited:` (body unchanged: it already creates the `GameSession`
   with `awarded` defaulting to 0 and returns the zero receipt). Extend the branch comment with one line: an
   unknown or hidden game id is not a play a browser can have finished, so it is logged with score 0 and credited
   nothing. Add one docstring sentence saying only `_CREDITED_GAMES` ids are credited. Nothing else in the view
   changes (throttle, AllowAny, the `awarding.award` call for credited plays).
   Done: `python manage.py test trivia.tests.test_score_award` — all existing tests pass.
3. `[sonnet]` `backend/trivia/tests/test_score_award.py` — add the four tests of §5 to `ScoreAwardTests`, placed
   after `test_who_would_win_honest_max_is_awarded_in_full`, with a one-line docstring on the first naming
   `LC-GAMEDATA-02` and that an unknown or hidden id used to be credited `DEFAULT_MAX_POINTS`.
   Done: `python manage.py test trivia.tests.test_score_award` passes with 4 more tests than before.
4. `[sonnet]` Gate-1 run: `cd backend && DATABASE_URL="" python manage.py check && python manage.py test users trivia`.
   Done: 0 failures; the count is the previous total + 4; `test_awarding.CapTests.test_unknown_game_gets_the_default`
   still passes (no change to `awarding.py`).
5. `[sonnet]` Write `.team/run/logic-check-log-session/build-report.json`:
   `did` = "log_session credits only visible games (`_CREDITED_GAMES`); unknown/hidden ids are logged with score 0
   and awarded 0, status 200", `assumed` = "replay play-id is a follow-up card; `multiplayer_result` unchanged",
   `touched` = the two files, `testsAdded` = the four test names.
   Done: file is valid JSON (`node -e "JSON.parse(require('fs').readFileSync(process.argv[1],'utf8'))" <path>`).

## Follow-ups (not in this card)
- **Replay guard / one-time play id** — a server-issued play token checked once by `log_session`. Needs: a token
  minted when a round is served (the classic round GETs are plain Django views, BE-9, and are cached/public), the
  client sending it from `src/views/Trivia/MiniGame.tsx` (`awardedRef` is the only guard today), and the relay flow
  for `match` rooms. Rationale for deferring: bounded today by the 60/h throttle, per-game ceilings, the daily soft
  cap and the Wordle once-a-day block; the unbounded path was the forged game id, closed here.
- **`multiplayer_result` game gate** — apply the same `_CREDITED_GAMES` (or move it to `trivia/awarding.py`) to the
  relay endpoint so a compromised relay key cannot credit an unknown id up to `DEFAULT_MAX_POINTS`. One-line change
  plus a test; separate card because its fingerprint and route differ.
