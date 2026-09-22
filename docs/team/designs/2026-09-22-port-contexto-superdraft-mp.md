# Design: port-contexto-superdraft-mp

Task: "Port Contexto/SuperDraft multiplayer branches to the dealt question (spec §10.3)"
(Category fullstack, P1). Follow-up to `docs/team/designs/2026-09-20-fix-3-trivia-tests-clean-dev.md`
"Findings outside this card". Since 6a1a11b (questions store Phase E) the relay deals a
`ContextoQuestion` / `SuperDraftQuestion`, but both renderers' multiplayer branches still read the
retired `{pool, day, secret_person_id}` / `{pool, day, slots}` configs through `useRoundPool`:
online Contexto is unplayable ("No player data available") and online SuperDraft only works by
accident (whole-pool download, objective from each client's local date).

Classify: standard / frontend + backend + ui + multiplayer / risk low. Design round 2026-09-22,
planner on Fable 5.1. Branch `team/port-contexto-superdraft-mp` (cut from `origin/dev` 345e63a).

## Decision summary

**Engine: sonnet** — 13 steps, each with an exact file, exact text (the whole new `Contexto.tsx`
is given verbatim; SuperDraft is given as exact old→new blocks) and a done-check command.

**Build order for this split card: `### Frontend` first, then `### Backend`.** The backend half is
tests-only (`backend/trivia/tests/test_contexto.py`, `test_superdraft.py`) and re-pins source
strings of the two renderers to the ported code. Those re-pins FAIL against the unported
renderers by design, so the orchestrator must build and verify the frontend half first and run the
backend half (and `manage.py test trivia`) on the same branch after the frontend steps have landed.
Running the backend tests before the frontend steps exist reproduces exactly three failures
(`test_the_renderer_resolves_the_same_secret`, `test_the_ranking_uses_the_magnitude_aware_metric`,
`test_renderer_plays_the_server_slots_and_never_redraws_online`) and means nothing.

**Relay contract change required: NO.** `multiplayer_server/src/index.js` (`fetchRound` →
`[await questions.deal(gameId)]`, `roundData: { gameData: [question], game }`, `resumeMatch`
snapshot with `gameData: room.gameData`), `multiplayer_server/src/questions.js`,
`multiplayer_server/scripts/sim_round_fanout.js` and every Django view/model stay untouched. The
one rule the dealt `SuperDraftQuestion` lacks — a shared objective, because
`questions/games/superdraft.py index_item` is `[None]` and `materialize` envelopes `{slots}` only,
per spec §7.4 — is derived client-side from the qid both clients already hold (below).

**The four decisions the classify entry left open:**

1. **One payload shape, both modes (spec §10.3).** `gameInfo` is `[ContextoQuestion]` /
   `[SuperDraftQuestion]` whether `MiniGame.handleStart` fetched it (`fetchQuestion`) or
   `OnlineMatch` got it from `roundData`. The renderers stop branching on the payload shape:
   Contexto has no multiplayer-specific code left at all; SuperDraft keeps `multiplayer` only for
   the two things that genuinely differ online — no re-roll (already so) and the objective rule.
2. **Online SuperDraft objective = `OBJECTIVES[fnv1a(question.qid) % 4]`.** Both clients hold the
   dealt question (and its `qid`) byte-identically, including after a reconnect (`resumeMatch`
   re-serves `room.gameData`), so the rule is deterministic, timezone-free and reconnect-stable.
   Rejected: (a) `utcToday()` on each client — agrees except across a UTC-midnight race between
   the two clients' `roundData` arrival, and a reconnect the next UTC day would recompute a
   different objective from the opponent's; (b) adding `day` to the relay payload — contradicts
   the card ("keep the relay contract as is") and would need a Django generator change plus a
   republished questions snapshot for a value the client can derive. **Solo keeps
   `dailyObjective()` on the local date, unchanged** (spec §7.4 and the card's "single-player
   behavior must not change"). The FNV-1a is the existing `hashStr` in `src/utils/questions.ts`,
   exported rather than copied.
3. **Fate of the retired types/hook.** `ContextoRoundConfig`, `SuperDraftRoundConfig`,
   `SlotConstraintConfig` are deleted from `src/types/types.tsx` (and the `GameData` union), and
   `src/hooks/useRoundPool.ts` is deleted: its only two callers are the two branches this card
   removes, and spec §10.3 names its removal. `src/utils/pool.ts` stays (NbaGrid, Heatmap, Bingo,
   Pack Five, GameUtils still use `fetchWholePool`).
4. **Contexto drops its `multiplayer` prop** (interface + the `multiplayer={multiplayer}` pass in
   `RenderGame.tsx`): nothing in the ported renderer reads it, and MULTIPLAYER_CONSTRAINTS MP-12
   says a game that plays identically solo and online needs no such prop. SuperDraft keeps it.
   Consequence for MP acceptance check 4: `grep -c 'multiplayer={multiplayer}'` goes from 5 to
   **4** and the "unwired `multiplayer?: boolean`" file list from 7 to **6** (Contexto leaves it).
   The doc's printed "3 / 7" was already stale before this card (observed 5 / 7 on 345e63a); the
   Test plan gives QA the post-change truth. No constraint doc is edited here.

**Deleted client code (Contexto):** the whole similarity engine (`franchiseSeasons`…`buildRanking`,
`POS_FAMILY`, `CURRENT_YEAR`, `Ranking`), `NO_POOL`, `mpSecret`, `mpRanking`, the multiplayer
branches of `resolveGuess`/`suggestions`/`attempted`/`poolSize`. Its Python twin
`backend/trivia/questions/similarity.py` (golden-tested by `test_questions_similarity.py`) is the
only ranking implementation left. **Deleted client code (SuperDraft):** `useRoundPool`, `NO_POOL`,
`MIN_ELIGIBLE`, `ringsOfEntry`, `ptsOfEntry`, `toPickFromEntry`, `ConstraintKind`,
`SlotConstraint`, `buildCandidates`, `resolveSlots`, `slotFromConstraint`, the multiplayer
`useEffect`, `candidates`/`candidateCount`, the name/alias `match` branch of `submitPick`,
`Pick.aliases`, the `day` parameter of `dailyObjective`. `randInt` STAYS (the 300-lineup grading
uses it).

Sign-off: this cloud session has no `Agent` tool and `ListAgents` lists no engine teammates, so the
`frontend-engine` and `backend-engine` proposal and sign-off seats were filled by the planner from
source (same fallback as the 2026-09-20 and 2026-09-22 rounds); the 5b self-review at the end of
this doc stands in for the sign-off pass. Recorded once in `docs/team/DECISIONS.md` (2026-09-22,
design entry for this card).

## Interfaces

Nothing new crosses a network boundary. Payloads consumed (unchanged, from
`backend/trivia/questions/base.py envelope()` + `games/{contexto,superdraft}.py materialize()`):

```ts
// src/types/types.tsx (existing)
interface SuperDraftSlot { kind: "team" | "draft" | "country"; value: string; label: string; sub: string;
                           eligible: [person_id, height_in | null, rings, career_pts, birth_year | null][] }
interface SuperDraftQuestion extends QuestionBase { slots: SuperDraftSlot[] }          // NO day
interface ContextoQuestion   extends QuestionBase { day: string; secret: PlayerIndexEntry; ranking: [number, number][] }
// QuestionBase = { schema: number; game: string; qid: string }
```

Who hands them to the renderers (unchanged): solo `MiniGame.handleStart` → `game.fetchData()` =
`fetchQuestion("<slug>")` → `{ success, data: [question] }`; online
`multiplayer_server/src/index.js dealRound` → `roundData { gameData: [question] }` →
`MultiplayerContext` `ROUND_DATA` → `OnlineMatch` → `renderGame({ gameData: mp.gameData, multiplayer: true })`.

Renderer props after the port:

```ts
// src/Game Renderers/Contexto.tsx
export interface ContextoProps { gameInfo: ContextoQuestion[]; onGameEnd: OnGameEnd; turn?: unknown; onTurnAction?: (a: unknown) => void }
// src/Game Renderers/SuperDraft.tsx
export interface SuperDraftProps { gameInfo: SuperDraftQuestion[]; onGameEnd: OnGameEnd; onPlayAgain?: () => void; onClose?: () => void;
                                   turn?: unknown; onTurnAction?: (a: unknown) => void; multiplayer?: boolean }
// src/utils/questions.ts — now exported (was module-private)
export function hashStr(s: string): number   // FNV-1a 32-bit, unchanged body
// src/Game Renderers/SuperDraft.tsx — new/changed module functions
function dailyObjective(): Objective          // solo: local calendar day (body unchanged minus the `day` branch)
function objectiveForQid(qid: string): Objective  // online: OBJECTIVES[hashStr(qid) % OBJECTIVES.length]
```

Online-mode network dependencies AFTER the port (relevant to QA on a CDN-blocked VM): each game
fetches exactly two questions-store files via `useNames()` → `loadNames()` — `${VITE_QUESTIONS_BASE}/questions/manifest.json`
and the manifest's `names` URL (`players-names.json`). Nothing else: no index, no question file, no
`players-index` pool, no Django call except the fire-and-forget `POST /trivia/log-guesses/`
(Contexto/SuperDraft guess logs, failure-tolerant) and SuperDraft's `cdn.nba.com` headshots (an
`onError` silhouette fallback exists). If the names fetch fails, `useNames` resolves `[]`: Contexto
renders the board with no autocomplete suggestions and every guess flashes "Not a player in the
index"; SuperDraft renders the five slots with `#<person_id>` in place of names and no pick can
resolve. Solo mode additionally fetches the game's `index.json` and one question file.

## File plan

| File | Change |
|---|---|
| `src/Game Renderers/Contexto.tsx` | Rewritten (full text in step F1): one `ContextoQuestion` path, similarity engine and `useRoundPool` gone, `multiplayer` prop gone. |
| `src/Game Renderers/SuperDraft.tsx` | Multiplayer branch ported (steps F2a–F2l): `question` state in both modes, slots from `question.slots`, `objectiveForQid` online, all pool/candidate/resolve machinery deleted. |
| `src/Game Renderers/RenderGame.tsx` | `contexto`/`superdraft` casts → `ContextoQuestion[]` / `SuperDraftQuestion[]`; Contexto no longer receives `multiplayer`; `*RoundConfig` imports removed. |
| `src/types/types.tsx` | Delete `SlotConstraintConfig`, `ContextoRoundConfig`, `SuperDraftRoundConfig` (+ their comment block) and the two `GameData` union members. |
| `src/utils/questions.ts` | `hashStr` exported. |
| `src/hooks/useRoundPool.ts` | Deleted. |
| `backend/trivia/tests/test_contexto.py` | Re-pin `test_the_renderer_resolves_the_same_secret`; move the awards-metric guard onto `trivia/questions/similarity.py` (renamed `test_the_ranking_uses_the_magnitude_aware_metric`); fix the two comment blocks that name the deleted renderer code. |
| `backend/trivia/tests/test_superdraft.py` | Re-pin `test_renderer_plays_the_server_slots_and_never_redraws_online`; fix the two docstrings that name `buildCandidates`/`resolveSlots`. |
| Everything else | untouched — explicitly `multiplayer_server/src/*`, `multiplayer_server/scripts/*`, `backend/trivia/games/*`, `backend/trivia/questions/*`, `src/utils/pool.ts`, `src/context/MultiplayerContext.tsx`, `src/components/MultiPlayer/*`, all CSS, all docs under `docs/constraints/`. |

## Risks

- **Online objective stops following the calendar.** Deliberate: the dealt question has no day and
  the contract is frozen; the objective becomes "one per dealt question" online (still one of the
  same four, still shown in the prompt). Solo is byte-for-byte the same rule as today.
- **The names list is still a CDN dependency online** (see Interfaces). Unchanged from solo today
  and from Career Path / Who Are Ya online; the visible failure mode is stated above so QA can tell
  it from a port regression. On the cloud QA VM supabase.co is blocked, so the Test plan serves a
  fixture questions store on `localhost:5280` to BOTH the relay and the browser.
- **Source-string tests stay brittle by nature.** Every re-pinned `assertIn` is a line this plan
  writes verbatim (F1/F2) and every `assertNotIn` is a structural absence; a reformat that splits
  the pinned memo line would fail the test loudly, not silently.
- **`react-hooks/exhaustive-deps`.** The two solo effects lint clean today; the plan only removes
  the `if (multiplayer) return;` guard and the `multiplayer` dep from them and deletes the
  multiplayer effect (which carried an `eslint-disable` line). No new effect is introduced.
- **MP acceptance check 4 numbers move** (5→4, 7→6 files) — stated in the Test plan with the
  reason; the documented "3/7" was already wrong on the base commit.
- **`randInt`/`Math.random`** survive only in `grade()` (percentile vs 300 random lineups) — that
  is per-client scoring noise that existed before and is unrelated to slot fairness.
- **Split-card ordering.** If the pipeline runs the backend half first, `manage.py test trivia`
  fails exactly the three tests named in the Decision summary. That is expected, not a defect.

## Test plan

Baseline on 345e63a (before changes): `cd backend && .venv/bin/python manage.py test trivia` →
`OK` (the 28c3dd8 re-pins hold against the unported renderers); `npx tsc --noEmit` clean.

1. **Frontend static** (after F1–F6): `npx next typegen && npx tsc --noEmit` → no output;
   `npm run lint` → no errors; `npm run build` → succeeds. `grep -rn "useRoundPool\|RoundConfig\|SlotConstraintConfig\|secret_person_id" src` → no output.
2. **Backend** (after B1–B2, on top of the frontend steps):
   `cd backend && .venv/bin/python manage.py test trivia.tests.test_contexto trivia.tests.test_superdraft` → `Ran 31 tests … OK`;
   `cd backend && .venv/bin/python manage.py test trivia` → `OK`.
3. **Mutation check that the re-pins bite** (a temporary edit, reverted in place — never
   `git checkout --` the renderer, that would discard the port): note `git diff --stat` first, then
   `sed -i 's/objectiveForQid(question.qid)/dailyObjective()/' "src/Game Renderers/SuperDraft.tsx"` and run
   `cd backend && .venv/bin/python manage.py test trivia.tests.test_superdraft.SuperDraftRoundTests.test_renderer_plays_the_server_slots_and_never_redraws_online`
   → `FAILED (failures=1)`; restore with
   `sed -i 's/multiplayer \&\& question ? dailyObjective() : dailyObjective()/multiplayer \&\& question ? objectiveForQid(question.qid) : dailyObjective()/' "src/Game Renderers/SuperDraft.tsx"`,
   confirm `grep -c "objectiveForQid(question.qid)" "src/Game Renderers/SuperDraft.tsx"` → `1` and
   `git diff --stat` matches what you noted.
4. **Relay sims unchanged, sanity**: `cd multiplayer_server && node scripts/sim_round_fanout.js` → 14 `ok` lines, exit 0; `node scripts/sim_turngames.js | tail -4` → 3× PASS.
5. **MP constraint acceptance checks** (MULTIPLAYER_CONSTRAINTS §Acceptance): 1, 2, 3, 5, 6 as
   documented. **Check 4 expected output after this card:** `grep -c 'multiplayer={multiplayer}' "src/Game Renderers/RenderGame.tsx"` → `4`; the second grep lists exactly six files — `BingoGame.tsx`, `CareerPath.tsx`, `NbaGrid.tsx`, `PackFive.tsx`, `SuperDraft.tsx`, `WhoAreYa.tsx` (Contexto dropped the prop; the doc's 3/7 predates this card and was 5/7 on the base commit). Treat these as the pass values.
6. **Shell audit** (GAME_DESIGN_CONSTRAINTS, no layout change intended): with the servers of item 7
   up, `node scripts/ui-audit.mjs --url http://localhost:5273 --only contexto --label qa-port-contexto-superdraft-mp`
   and the same with `--only superdraft` → exit 0.
7. **Two-client browser pass** (the card's own acceptance). This cloud VM cannot reach
   `supabase.co` (CONNECT 403), so neither `QUESTIONS_PUBLIC_BASE` (relay) nor
   `VITE_QUESTIONS_BASE` (browser) may point at the real store. Both are pointed at a local fixture
   server instead; the fixture is the `sim_round_fanout.js` one (same manifest/version keys
   `version: "t"`, `dataset: { players: "t" }`, `/questions/v/t/...` paths, the same
   `SUPERDRAFT_QUESTION` "sd-0001" and `CONTEXTO_QUESTION` "ctx-2026-09-06") plus a non-empty
   `players-names.json` so the names lookup resolves, and with **absolute** `names`/`index` URLs
   (the browser resolves a bare `/questions/...` against the Next origin, which would 404).

   7a. Fixture server — write `qa-fixture-server.mjs` at the repo root (scratch, delete after):
   ```js
   import http from "node:http";
   const BASE = "http://localhost:5280";
   const SUPERDRAFT_QUESTION = { schema: 1, game: "superdraft", qid: "sd-0001", slots: [
     { kind: "team", value: "LAL", label: "Los Angeles Lakers", sub: "Franchise", eligible: [[2544, 81, 4, 40474, 1984], [977, 78, 5, 33643, 1978]] },
     { kind: "draft", value: "2010", label: "2010s Draft", sub: "Draft class", eligible: [[203507, 83, 1, 17000, 1994], [1628369, 80, 1, 12000, 1998]] },
     { kind: "country", value: "Serbia", label: "Serbia", sub: "Country", eligible: [[203999, 83, 0, 15000, 1995], [1627749, 80, 0, 6000, 1997]] },
     { kind: "team", value: "BOS", label: "Boston Celtics", sub: "Franchise", eligible: [[1628369, 80, 1, 12000, 1998], [1883, 82, 1, 26000, 1976]] },
     { kind: "draft", value: "1980", label: "1980s Draft", sub: "Draft class", eligible: [[893, 78, 6, 32292, 1963], [1449, 84, 2, 26946, 1963]] },
   ] };
   const CONTEXTO_QUESTION = { schema: 1, game: "contexto", qid: "ctx-2026-09-06", day: "2026-09-06",
     secret: { person_id: 2544, full_name: "LeBron James", fame_tier: 1 }, ranking: [[2544, 1], [977, 2], [893, 3]] };
   const name = (id, full_name, birth_year, team_abbr) => ({ id, full_name, aliases: [], position: "F", birth_year, jersey: null, team_abbr, draft: null });
   const NAMES = [name(2544, "LeBron James", 1984, "LAL"), name(977, "Kobe Bryant", 1978, "LAL"), name(893, "Michael Jordan", 1963, "CHI"),
     name(203507, "Giannis Antetokounmpo", 1994, "MIL"), name(1628369, "Jayson Tatum", 1998, "BOS"), name(203999, "Nikola Jokic", 1995, "DEN"),
     name(1627749, "Bogdan Bogdanovic", 1997, "ATL"), name(1883, "Paul Pierce", 1976, "BOS"), name(1449, "Karl Malone", 1963, "UTA")];
   const FILES = {
     "/questions/manifest.json": { schema: 1, version: "t", dataset: { players: "t" }, names: `${BASE}/questions/v/t/players-names.json`,
       games: { superdraft: { index: `${BASE}/questions/v/t/superdraft/index.json`, count: 1 }, contexto: { index: `${BASE}/questions/v/t/contexto/index.json`, count: 1 } } },
     "/questions/v/t/players-names.json": NAMES,
     "/questions/v/t/superdraft/index.json": { schema: 1, game: "superdraft", version: "t", dataset: { players: "t" }, items: [["sd-0001"]] },
     "/questions/v/t/superdraft/sd-0001.json": SUPERDRAFT_QUESTION,
     "/questions/v/t/contexto/index.json": { schema: 1, game: "contexto", version: "t", dataset: { players: "t" }, items: [["ctx-2026-09-06", "2026-09-06"]] },
     "/questions/v/t/contexto/ctx-2026-09-06.json": CONTEXTO_QUESTION,
   };
   http.createServer((req, res) => {
     const body = FILES[req.url.split("?")[0]];
     res.writeHead(body ? 200 : 404, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*", "Cache-Control": "no-store" });
     res.end(body ? JSON.stringify(body) : "{}");
   }).listen(5280, () => console.log("fixture questions store on :5280"));
   ```
   Done-check: `curl -s http://localhost:5280/questions/manifest.json | head -c 80` prints the manifest.
   Both games' pickers land on the single item (superdraft `pickRandom` of one; contexto `pickDaily`
   has no item dated today → FNV fallback over one item), so solo AND online deal these exact
   questions on any date. Expected online SuperDraft objective for qid `sd-0001`:
   `hashStr("sd-0001") = 796951082`, `% 4 = 2` → `OBJECTIVES[2]` = title **"Most Career Points"**,
   eyebrow "Draft the biggest scorers".

   7b. Bring-up (all backgrounded, `localhost` never `127.0.0.1`):
   - `node qa-fixture-server.mjs`
   - `cd backend && .venv/bin/python manage.py migrate` (local sqlite, no `DATABASE_URL`) then
     `CORS_ALLOWED_ORIGINS=http://localhost:5273 .venv/bin/python manage.py runserver 8100`
     (`FRONTEND_ORIGINS` only lists :5173; the env var is additive).
   - `cd multiplayer_server && PORT=4100 CORS_ORIGINS=http://localhost:5273 QUESTIONS_PUBLIC_BASE=http://localhost:5280 node src/index.js`
     → log line `Multiplayer server on :4100`. No `_setForTest` launcher is needed: the relay's
     `questions.js` fetches the same fixture over HTTP (localhost is not proxied).
   - `NBA_DEV_ENV_SKIP=1 VITE_BACKEND_URL=http://localhost:8100/api VITE_SOCKET_URL=http://localhost:4100 VITE_QUESTIONS_BASE=http://localhost:5280 npm run dev -- --port 5273`
     (note `/api` on the backend URL, as `.env` has it).
   - `node node_modules/playwright-core/cli.js install --with-deps chromium` (no-op if present).

   7c. Users: two `POST http://localhost:8100/api/signup/` with JSON
   `{ "username": "qaAlice", "email": "qa-alice-<Date.now()>@example.com", "password": "Qa!pass-2026-contexto" }`
   (and `qaBob`); each response carries `access`, `refresh`, `user.id` (public id). For each client
   create `browser.newContext({ viewport: { width: 1100, height: 900 }, timezoneId })` with **A =
   `Pacific/Honolulu` and B = `Pacific/Kiritimati`** (their local calendar dates always differ, so
   an objective that still used the local date would diverge — this turns the card's bug into an
   assertion), then `context.addInitScript(([a, r]) => { localStorage.setItem("accessToken", a); localStorage.setItem("refreshToken", r); }, [access, refresh])`
   before `openApp(page, base, "/contexto")`; `src/app/providers.tsx` calls `/me/` and logs the
   user in (the "Play with a friend" button appears in `.mp-panel`).

   7d. Room (selectors from `MultiplayerPanel.tsx` / `FriendPlay.tsx` / `CodeInput.tsx`): on A click
   `button:has-text("Play with a friend")` then `button:has-text("Generate code")`; wait for
   `.fp-tile.is-code` count 6 and join their texts → `code`. On B click "Play with a friend",
   `button:has-text("Enter code")`, `page.fill(".fp-codein-input", code)`,
   `button:has-text("Join room")`. The relay starts the match when the room fills
   (`startFriendMatch` → `dealRound`); after the 2.6 s intro both pages show `.om-stage--play .gf`
   (wait up to 20 s).

   7e. Contexto assertions (both pages): no `.cx-note` ("No player data available") and
   `.cx-empty-title` visible; `shot(page, slug, "contexto-<a|b>-start")`. On BOTH pages fill
   `.gf-inputrow input` with `Kobe Bryant` + Enter → a `.cx-row` appears whose `.cx-row-rank` text is
   `#2` on A and on B; then `Michael Jordan` → `#3` on both (two guesses so equal ranks are not
   vacuous); the two rows are sorted `#2` above `#3`. On A click `.cx-giveup` → `.cx-reveal .cx-row-name`
   reads `LeBron James`; on B guess `LeBron James` → the row is `.is-win` and the popup text starts
   with `Got it in 3!`. `shot` both. Both `onGameEnd`s fire within ~2 s → `.om-yourscore` /
   results; click `.om-exit` on both to leave the room.

   7f. SuperDraft: `openApp(page, base, "/superdraft")` on both, repeat 7d. Assert on BOTH pages:
   `.gf-title` text === `Most Career Points` and `.gf-eyebrow` === `Draft the biggest scorers`
   (identical objective across two timezones, and equal to the qid-derived value computed in 7a);
   `.sd-slot-label` texts, in order, === `["Los Angeles Lakers", "2010s Draft", "Serbia", "Boston Celtics", "1980s Draft"]`
   on both; no `.sd-state` error; no `.sd-reroll` button (online); headshots fall back to
   `.sd-silhouette` (cdn.nba.com is unreachable here — expected). On A fill `.gf-inputrow input`
   with `LeBron James` + Enter → `.sd-slot.is-filled` count 1 and `.sd-slot-pick` of slot 1 reads
   `LeBron James` (names resolved through the fixture list). `shot` both. Click `.om-exit` on both.

   7g. Solo smoke (possible here thanks to the fixture): a fresh context, `/superdraft`,
   `startGame(page)` → `.gf-title` is one of the four labels (`Tallest Five`, `Most Rings`,
   `Most Career Points`, `Oldest Five`), `.sd-slot` count 5, `.sd-reroll` present; `/contexto`,
   `startGame(page)`, guess `Kobe Bryant` → `#2`. The authoritative solo regression guards remain
   item 1 (tsc/build) and item 2 (the re-pinned `if (multiplayer || rerollUsed …)` /
   `{drafting && !multiplayer && (` / `dailyObjective()` lines), since the real CDN cannot be
   exercised on this VM.

   7h. `writeVerdict("port-contexto-superdraft-mp", failures.length === 0, failures)`; kill the
   four servers by port (5280, 8100, 4100, 5273); delete `qa-run.mjs` and `qa-fixture-server.mjs`.

## Implementation plan

Work on branch `team/port-contexto-superdraft-mp`. Build `### Frontend` first, verify it (steps
F7), then `### Backend`. Do not touch any file outside the File plan.

### Frontend

#### Step F1 — `src/Game Renderers/Contexto.tsx`: replace the whole file

Overwrite the file with exactly the following (the JSX from `return (<GameFrame>` to the end is
unchanged from today except that `poolSize` no longer branches; it is reproduced in full so the
file can be written in one go):

```tsx
// LeContexto — similarity guesser. Name any player; see how close (by rank) you
// are to a hidden daily secret.
//
// Both modes are handed ONE precomputed ContextoQuestion as gameInfo[0]: the
// day, the secret (a full PlayerIndexEntry) and the WHOLE ranking of every
// playable player against it, computed server-side
// (backend/trivia/questions/games/contexto.py). Single-player fetches it from
// the questions store (utils/questions.ts fetchQuestion); a multiplayer room is
// dealt one by the relay (multiplayer_server/src/questions.js deal) and every
// member receives the same object, so two players can never rank against
// different secrets. The renderer never downloads the player pool and has no
// similarity engine of its own — it looks a guessed player's id up in the
// precomputed ranking. Names are resolved against the shared names list
// (useNames / buildNameLookup). Spec:
// docs/superpowers/specs/2026-09-10-questions-store-design.md §10.3.
import { useEffect, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import AutocompleteInput from "../components/AutoCompleteInput";
import SubmitGuessPopup from "../components/SubmitGuessPopUp";
import { Button, GameFrame, Spinner } from "../components/ui";
import { BACKEND_ORIGIN } from "../configurations/backend";
import { useNames } from "../hooks/useNames";
import { apiFetch } from "../utils/Api";
import { normalizeAnswer } from "../utils/answerMatch";
import { buildNameLookup } from "../utils/questions";
import type { OnGameEnd, ContextoQuestion } from "../types/types";
import "../styles/Contexto.css";

export interface ContextoProps {
  /** One precomputed ContextoQuestion — the same shape in single-player and multiplayer. */
  gameInfo: ContextoQuestion[];
  onGameEnd: OnGameEnd;
  turn?: unknown;
  onTurnAction?: (a: unknown) => void;
}

const MAX_SCORE = 200;

/** 200 - 5 per guess past the tenth, floor 50. */
function scoreFor(guesses: number): number {
  return Math.max(50, MAX_SCORE - 5 * Math.max(0, guesses - 10));
}

/** Row/bar color bucket. */
function rankColor(rank: number): "good" | "brand" | "bad" {
  if (rank <= 25) return "good";
  if (rank <= 100) return "brand";
  return "bad";
}

interface GuessRow {
  pid: number;
  name: string;
  rank: number;
}

interface GuessEntry {
  question_id: string;
  answer: string;
  correct: boolean;
  elapsed_ms: number;
}

export default function Contexto({ gameInfo, onGameEnd }: ContextoProps) {
  // The round IS the question, however it arrived (fetched solo, dealt online).
  const question = gameInfo[0] as ContextoQuestion | undefined;

  const reduce = useReducedMotion();
  const [rows, setRows] = useState<GuessRow[]>([]);
  const [guessedIds, setGuessedIds] = useState<Set<number>>(new Set());
  const [guess, setGuess] = useState("");
  const [won, setWon] = useState(false);
  const [gaveUp, setGaveUp] = useState(false);
  const [showPopup, setShowPopup] = useState(false);
  const [popup, setPopup] = useState({ Text: "", Color: "" });

  const startRef = useRef(Date.now());
  const guessLogRef = useRef<GuessEntry[]>([]);
  const timersRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  const endedRef = useRef(false); // hard guard: onGameEnd fires at most once

  // All delayed work goes through these so an exit/unmount can never fire a
  // stale onGameEnd (or setState) for an abandoned game.
  const later = (fn: () => void, ms: number) => {
    timersRef.current.push(setTimeout(fn, ms));
  };
  const clearTimers = () => {
    timersRef.current.forEach(clearTimeout);
    timersRef.current = [];
  };

  // The ranking is already computed server-side; wrap the [personId, rank]
  // pairs in a Map for O(1) lookup, built once per question.
  const rankById = useMemo(() => new Map<number, number>(question?.ranking ?? []), [question]);
  // Shared names list: a typed guess resolves to a person_id (and back to a
  // display name) through it.
  const names = useNames();
  const lookup = useMemo(() => (names ? buildNameLookup(names) : null), [names]);

  const secret = question?.secret ?? null;
  const ready = !!(lookup && rankById.size);
  const suggestions = useMemo(() => lookup?.suggestions ?? [], [lookup]);

  // Resolve a typed guess to { pid, name, rank }. Returns null for a name this
  // game doesn't recognize.
  const resolveGuess = (raw: string): { pid: number; name: string; rank: number } | null => {
    if (!lookup) return null;
    const pid = lookup.toId(raw);
    if (pid == null) return null;
    const rank = rankById.get(pid);
    if (rank == null) return null;
    return { pid, name: lookup.nameOf(pid) ?? raw, rank };
  };

  // Fire-and-forget guess log (the data flywheel). apiFetch only attaches the
  // JWT when one exists, so guests log anonymously and it never blocks the game.
  const sendGuessLog = () => {
    const entries = guessLogRef.current;
    guessLogRef.current = [];
    if (!entries.length) return;
    apiFetch(`${BACKEND_ORIGIN}/trivia/log-guesses/`, {
      method: "POST",
      body: JSON.stringify({ game: "contexto", entries }),
    }).catch(() => { /* analytics only */ });
  };

  // Fresh state whenever a new question arrives (e.g. play-again).
  useEffect(() => {
    clearTimers();
    setRows([]);
    setGuessedIds(new Set());
    setGuess("");
    setWon(false);
    setGaveUp(false);
    setShowPopup(false);
    endedRef.current = false;
    startRef.current = Date.now();
    guessLogRef.current = [];
  }, [gameInfo]);

  // Unmount: cancel pending end-calls and flush any un-sent guesses
  // (abandoned sessions still feed the flywheel; no-op when already flushed).
  useEffect(() => {
    return () => {
      clearTimers();
      sendGuessLog();
    };
  }, []);

  const flash = (text: string, color: string) => {
    setPopup({ Text: text, Color: color });
    setShowPopup(true);
    later(() => setShowPopup(false), 1500);
  };

  const endOnce = (finalScore: number) => {
    if (endedRef.current) return;
    endedRef.current = true;
    onGameEnd?.(finalScore);
  };

  const handleGuess = (raw: string) => {
    if (!secret || !ready || won || gaveUp) return;
    if (!normalizeAnswer(raw)) return;
    const resolved = resolveGuess(raw);
    if (!resolved) {
      flash("Not a player in the index", "var(--bad)");
      return;
    }
    const { pid, name, rank } = resolved;
    if (guessedIds.has(pid)) {
      flash("Already guessed", "var(--muted)");
      setGuess("");
      return;
    }
    const nextCount = guessedIds.size + 1;
    guessLogRef.current.push({
      question_id: String(secret.person_id),
      answer: name,
      correct: rank === 1,
      elapsed_ms: Date.now() - startRef.current,
    });
    setGuessedIds((prev) => new Set(prev).add(pid));
    setRows((prev) => [...prev, { pid, name, rank }].sort((a, b) => a.rank - b.rank));
    setGuess("");

    if (rank === 1) {
      setWon(true);
      const finalScore = scoreFor(nextCount);
      flash(`Got it in ${nextCount}! +${finalScore}`, "var(--good)");
      sendGuessLog();
      later(() => endOnce(finalScore), 1700);
    } else {
      flash(`#${rank}`, rank <= 25 ? "var(--good)" : rank <= 100 ? "var(--brand)" : "var(--bad)");
    }
  };

  const handleGiveUp = () => {
    if (!secret || won || gaveUp) return;
    setGaveUp(true);
    flash(`It was ${secret.full_name}`, "var(--bad)");
    sendGuessLog();
    later(() => endOnce(0), 1900);
  };

  // Loading / unplayable-round state. Once the shared names list has resolved
  // and there is still no secret or no ranking, the round can't be played —
  // the question is missing or empty.
  const attempted = names !== null;
  if (!secret || !ready) {
    return (
      <div className="cx-center">
        <Spinner label="Calibrating the radar…" />
        {attempted && (
          <p className="cx-note">No player data available. Please try again later.</p>
        )}
      </div>
    );
  }

  const poolSize = rankById.size;
  const barWidth = (rank: number) =>
    `${Math.max(5, Math.round(100 * (1 - (rank - 1) / Math.max(1, poolSize - 1))))}%`;

  return (
    <GameFrame>
      <GameFrame.Status
        left={<GameFrame.Label>HOME IN BY SIMILARITY</GameFrame.Label>}
        right={<GameFrame.Score value={guessedIds.size} label="GUESSES" />}
      />

      <GameFrame.Board>
      <div className="cx-list" role="log" aria-live="polite">
        {rows.length === 0 ? (
          <div className="cx-empty">
            <p className="cx-empty-title font-display">Name any player to begin.</p>
            <p className="cx-empty-sub">#1 is the secret. Green is close, red is cold.</p>
          </div>
        ) : (
          <AnimatePresence initial={false}>
            {rows.map((r) => {
              const color = rankColor(r.rank);
              return (
                <motion.div
                  key={r.pid}
                  layout={!reduce}
                  initial={reduce ? false : { opacity: 0, y: -6 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.25 }}
                  className={`cx-row is-${color}${r.rank === 1 ? " is-win" : ""}`}
                >
                  <span className="cx-row-name font-display">{r.name}</span>
                  <span className="cx-bar-track">
                    <span className="cx-bar-fill" style={{ width: barWidth(r.rank) }} />
                  </span>
                  <span className="cx-row-rank tnum">#{r.rank}</span>
                </motion.div>
              );
            })}
          </AnimatePresence>
        )}
      </div>

      {gaveUp && (
        <div className="cx-reveal is-brand">
          <span className="cx-row-name font-display">{secret.full_name}</span>
          <span className="cx-row-rank tnum">#1</span>
        </div>
      )}
      </GameFrame.Board>

      <GameFrame.Action>
        <GameFrame.InputRow>
          <AutocompleteInput
            placeholder="Guess a player…"
            value={guess}
            setValue={setGuess}
            suggestions={suggestions}
            onSubmit={(v) => handleGuess(v)}
            customStyleInput={{ width: "100%", height: "44px", padding: "0 12px", fontSize: "0.9rem" }}
            customStyleSuggestion={{ fontSize: "0.82rem", maxHeight: "180px", minWidth: "100%" }}
          />
          <Button
            size="md"
            aria-label="Submit guess"
            onClick={() => handleGuess(guess)}
            disabled={won || gaveUp || guess.trim() === ""}
          >
            Guess
          </Button>
        </GameFrame.InputRow>

        <button
          type="button"
          className="cx-giveup"
          onClick={handleGiveUp}
          disabled={won || gaveUp}
        >
          Give up
        </button>
      </GameFrame.Action>

      <SubmitGuessPopup show={showPopup} text={popup.Text} color={popup.Color} />
    </GameFrame>
  );
}
```

Done-check: `grep -n "useRoundPool\|secret_person_id\|buildRanking\|mpSecret\|mpRanking\|NO_POOL\|POS_FAMILY\|CURRENT_YEAR\|useRoundPool\|PlayerIndexEntry," "src/Game Renderers/Contexto.tsx"` → no output; `grep -c "multiplayer" "src/Game Renderers/Contexto.tsx"` → `2` (both in comments: the header and the `gameInfo` doc comment — no code reads it). `grep -n "const question = gameInfo\[0\] as ContextoQuestion | undefined;\|const secret = question?.secret ?? null;\|new Map<number, number>(question?.ranking ?? \[\])" "src/Game Renderers/Contexto.tsx"` → three hits (the backend re-pins depend on these exact lines).

#### Step F2 — `src/Game Renderers/SuperDraft.tsx`: port the multiplayer branch

Apply these edits in order (line numbers are from 345e63a and drift as you go; match on text).

F2a. Header comment: replace lines 11-25 (from `// Single-player is handed a precomputed
SuperDraftQuestion as \`gameInfo\`: five` through `// future phase will give multiplayer its own
precomputed payload.`) with:

```tsx
// Both modes are handed ONE precomputed SuperDraftQuestion as gameInfo[0]: five
// slots, each already carrying its eligible [person_id, height_in, rings,
// career_pts, birth_year] tuples resolved server-side
// (backend/trivia/questions/games/superdraft.py) — the renderer never downloads
// the player pool and never draws or resolves slots itself. Single-player
// fetches the question from the questions store (utils/questions.ts) and its
// one re-roll re-fetches a fresh one; a multiplayer room is dealt one by the
// relay (multiplayer_server/src/questions.js deal) and every member receives
// the same object, so both players draft under identical constraints. Names
// are resolved against the shared names list (useNames / buildNameLookup).
//
// The daily objective is the one thing the question does not carry (spec
// §7.4). Solo picks it from the local calendar day, as always. Online both
// clients derive it from the dealt question's qid instead — the one value the
// room provably shares — so two players in different timezones can never be
// graded on different objectives. Spec:
// docs/superpowers/specs/2026-09-10-questions-store-design.md §10.3.
```

F2b. Imports: delete the line `import { useRoundPool } from "../hooks/useRoundPool";`; change
`import { buildNameLookup, fetchQuestion } from "../utils/questions";` to
`import { buildNameLookup, fetchQuestion, hashStr } from "../utils/questions";`; replace the
`import type { PlayerIndexEntry, OnGameEnd, SlotConstraintConfig, SuperDraftQuestion,
SuperDraftRoundConfig, SuperDraftSlot } from "../types/types";` block with
`import type { OnGameEnd, SuperDraftQuestion, SuperDraftSlot } from "../types/types";`.

F2c. Props: replace the three-line `gameInfo` doc comment + field with:
```tsx
  /** One precomputed SuperDraftQuestion — the same shape in single-player and multiplayer. */
  gameInfo: SuperDraftQuestion[];
```

F2d. Constants: delete `const MIN_ELIGIBLE = 8; // every slot constraint must offer at least this many players`
and the four-line `NO_POOL` block (comment + `const NO_POOL: PlayerIndexEntry[] = [];`).

F2e. `Pick`: change its doc comment to `/** A drafted player, flattened from a precomputed eligible
tuple — everything past the slot board (objectives, grading, JSX) reads this shape only. */` and
delete the `aliases: string[];` field. Delete the two `ringsOfEntry`/`ptsOfEntry` lines and their
two-line comment (`// Multiplayer resolves PlayerIndexEntry from the live pool — these derive the` …).

F2f. Objective rule: replace the whole `dailyObjective` function and its three-line comment
(`// Pick one objective per calendar day, stable within the day. Single-player` …) with:

```tsx
// Solo: one objective per local calendar day, stable within the day.
function dailyObjective(): Objective {
  const d = new Date();
  const ymd = d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();
  let h = ymd >>> 0;
  h = ((h ^ (h >>> 13)) * 0x9e3779b1) >>> 0; // cheap avalanche so adjacent days differ
  return OBJECTIVES[h % OBJECTIVES.length];
}

// Online: the dealt question carries no day (spec §7.4), so the objective is
// derived from its qid — data every member of the room holds byte-identically,
// including after a reconnect — never from each client's own clock.
function objectiveForQid(qid: string): Objective {
  return OBJECTIVES[hashStr(qid) % OBJECTIVES.length];
}
```

F2g. Delete `toPickFromEntry` (the `const toPickFromEntry = (p: PlayerIndexEntry): Pick => ({ … });`
block) and change the comment above the two converters to `// Build a Pick from a precomputed
eligible tuple, naming it through the shared names list.`; in `toPickFromTuple` delete the
`aliases: [],` line.

F2h. Delete the whole "Slot constraints" section: from the comment
`// ----- Slot constraints (multiplayer only — random pools resolved against the` through the end
of `resolveSlots` (`return picked;\n}`), EXCEPT keep this one line, which grading still uses:
`const randInt = (n: number) => Math.floor(Math.random() * n);`. Then in `DraftSlot` change
`kind: ConstraintKind;` to `kind: SuperDraftSlot["kind"];` and its doc comment to
`/** The render/scoring shape of one slot on the board. */`. Delete `slotFromConstraint`
(`const slotFromConstraint = (c: SlotConstraint): DraftSlot => ({ … });`).

F2i. Component head: replace
```tsx
  // Online, the round IS the config; offline, gameInfo[0] is a precomputed
  // SuperDraftQuestion (see soloQuestion state below).
  const round = multiplayer ? (gameInfo[0] as SuperDraftRoundConfig | undefined) : undefined;
  const pool = useRoundPool(multiplayer ? null : NO_POOL, round?.pool);

  const objective = useMemo(() => dailyObjective(round?.day), [round?.day]);
  const [phase, setPhase] = useState<Phase>("loading");
  const [soloQuestion, setSoloQuestion] = useState<SuperDraftQuestion | null>(
    multiplayer ? null : ((gameInfo[0] as SuperDraftQuestion) ?? null),
  );
```
with
```tsx
  // The round IS the question, however it arrived (fetched solo, dealt online).
  // Held in state because a solo re-roll swaps it for a fresh one.
  const [question, setQuestion] = useState<SuperDraftQuestion | null>(
    (gameInfo[0] as SuperDraftQuestion) ?? null,
  );
  // Solo: the local daily objective (unchanged). Online: derived from the
  // dealt question's qid so both clients grade against the same one.
  const objective = useMemo(
    () => (multiplayer && question ? objectiveForQid(question.qid) : dailyObjective()),
    [multiplayer, question],
  );
  const [phase, setPhase] = useState<Phase>("loading");
```
Update the `useNames` comment to `// Shared names list (id <-> full name, aliases) — the eligible
tuples' ids resolve through it, and so does a typed pick.`. Delete the two lines
`const candidates = useMemo(() => buildCandidates(pool ?? []), [pool]);` and
`const candidateCount = candidates.team.length + candidates.country.length + candidates.draft.length;`.

F2j. Effects: delete the entire multiplayer effect — from the comment
`// ----- Multiplayer: fresh draft whenever the round changes, or once the` through its closing
`}, [gameInfo, pool, multiplayer]);` (including its `// eslint-disable-next-line
react-hooks/exhaustive-deps`). Then make the two remaining effects mode-agnostic:

```tsx
  // ----- A fresh gameInfo payload (mount / play-again / a new online round)
  // resets the round and adopts its question; reroll() below swaps `question`
  // without going through this reset (rerollUsed must stay true for the rest
  // of the game). -----
  useEffect(() => {
    clearTimers();
    setRerollUsed(false);
    setPercentile(0);
    setRevealCount(0);
    setShowResult(false);
    setCopied(false);
    setShowPopup(false);
    endedRef.current = false;
    setQuestion((gameInfo[0] as SuperDraftQuestion) ?? null);
  }, [gameInfo]);

  // ----- Derive the slot board from the current question once the shared
  // names list is ready. Runs again on a solo reroll (new question). -----
  useEffect(() => {
    setDraftValue("");
    guessLogRef.current = [];
    startRef.current = Date.now();

    if (!question || !lookup) {
      setSlots([]);
      setPicks([]);
      setPhase("loading");
      return;
    }
    if (question.slots.length < SLOT_COUNT) {
      setSlots([]);
      setPicks([]);
      setPhase("error");
      return;
    }
    setSlots(question.slots.map((s) => slotFromQuestion(s, lookup)));
    setPicks(Array(SLOT_COUNT).fill(null));
    setPhase("draft");
  }, [question, lookup]);
```
(i.e. the old solo effects minus `if (multiplayer) return;`, minus `multiplayer` in the deps,
`soloQuestion` → `question`.)

F2k. `submitPick`: replace from the comment `// Solo: resolve the guess against the shared names
list first, then find` through the end of the `const already = …;` statement with:

```tsx
    // Resolve the guess against the shared names list, then find that id
    // inside this slot's precomputed eligible tuples — both modes.
    const id = lookup?.toId(raw) ?? null;
    const match: Pick | undefined =
      id !== null ? slot.eligible.find((p) => p.person_id === id && !pickedIds.has(p.person_id)) : undefined;

    if (!match) {
      // Distinguish "already drafted" / "not in this pool" for a helpful nudge.
      const already = id !== null && pickedIds.has(id);
```

F2l. `reroll`: `setSoloQuestion(res.data[0] as SuperDraftQuestion);` → `setQuestion(res.data[0] as SuperDraftQuestion);`.
The guard line `if (multiplayer || rerollUsed || phase !== "draft") return;`, its comment, and
the JSX `{drafting && !multiplayer && (` stay exactly as they are (backend pins).

Done-checks: `grep -n "useRoundPool\|NO_POOL\|candidates\|resolveSlots\|buildCandidates\|slotFromConstraint\|toPickFromEntry\|soloQuestion\|PlayerIndexEntry\|RoundConfig\|SlotConstraintConfig\|round?\.\|MIN_ELIGIBLE\|ringsOfEntry\|ptsOfEntry\|ConstraintKind\|aliases" "src/Game Renderers/SuperDraft.tsx"` → no output (the word "pool" still appears in prose — the header, the error-state copy and "Pools re-rolled" — and that is fine). `grep -n "multiplayer && question ? objectiveForQid(question.qid) : dailyObjective()\|setSlots(question.slots.map((s) => slotFromQuestion(s, lookup)));\|const randInt" "src/Game Renderers/SuperDraft.tsx"` → three hits, the first two on single lines.

#### Step F3 — `src/utils/questions.ts`: export the FNV

Change `function hashStr(s: string): number {` to `export function hashStr(s: string): number {`
and its comment line to `/** FNV-1a over a string — the Contexto daily fallback, and SuperDraft's online objective (hashStr(qid)). */`.
Done-check: `grep -n "export function hashStr" src/utils/questions.ts` → one hit.

#### Step F4 — `src/types/types.tsx`: retire the round configs

Delete the block from `/* ---- Multiplayer round CONFIG for the players-index games ----` through
the closing `}` of `SuperDraftRoundConfig` (i.e. the comment, `SlotConstraintConfig`,
`ContextoRoundConfig`, `SuperDraftRoundConfig`), and delete the two `GameData` union members
`| ContextoRoundConfig` and `| SuperDraftRoundConfig`. Done-check:
`grep -c "RoundConfig\|SlotConstraintConfig" src/types/types.tsx` → `0`; the `GameData` union still
contains `| PlayerIndexEntry`, `| Question` and `| string`.

#### Step F5 — `src/Game Renderers/RenderGame.tsx`

Remove `ContextoRoundConfig,` and `SuperDraftRoundConfig,` from the type import. Replace the
`contexto` case with:
```tsx
    case "contexto":
      // One ContextoQuestion in both modes (fetched solo, dealt by the relay online).
      return (
        <Contexto
          gameInfo={gameData as ContextoQuestion[]}
          onGameEnd={onGameEnd}
        />
      );
```
and the `superdraft` case's comment + cast with:
```tsx
    case "superdraft":
      // One SuperDraftQuestion in both modes (fetched solo, dealt by the relay
      // online); `multiplayer` only hides the re-roll and picks the objective rule.
      return (
        <SuperDraft
          gameInfo={gameData as SuperDraftQuestion[]}
          onGameEnd={onGameEnd}
          onPlayAgain={onPlayAgain}
          onClose={onClose}
          multiplayer={multiplayer}
        />
      );
```
Done-check: `grep -c 'multiplayer={multiplayer}' "src/Game Renderers/RenderGame.tsx"` → `4`;
`grep -c "RoundConfig" "src/Game Renderers/RenderGame.tsx"` → `0`.

#### Step F6 — delete `src/hooks/useRoundPool.ts`

`git rm "src/hooks/useRoundPool.ts"`. Done-check: `grep -rn "useRoundPool" src` → no output.

#### Step F7 — frontend verification

`npx next typegen && npx tsc --noEmit` → no output; `npm run lint` → no errors; `npm run build` →
succeeds. `grep -rn "RoundConfig\|SlotConstraintConfig\|secret_person_id\|useRoundPool" src` → no
output. Then run Test plan items 4–7 (QA stage runs 6–7).

### Backend

The steps below re-pin source guards to the code written in F1/F2. They must be applied AFTER the
frontend steps on the same branch; against the unported renderers they fail by design.

#### Step B1 — `backend/trivia/tests/test_contexto.py`

B1a. Imports: after `from trivia.games import contexto, players_index` add
`from trivia.questions import similarity as questions_similarity`, and add `import inspect` to
the stdlib imports (alphabetical: after `import datetime`).

B1b. Module docstring: replace the paragraph from `What must not change is the property an earlier
fix established` through `the renderer's multiplayer path to the id it was sent.` with:

```
What must not change is the property an earlier fix established: single-player
and multiplayer resolve the SAME secret for the same day. ``daily_secret`` below
is an independent mirror of the rule the endpoint's ``contexto.daily_secret``
encodes, so the tests can assert the endpoint stays on that rule. The renderer
itself now plays one precomputed ContextoQuestion in BOTH modes (the questions
store deals the same object to every member of a room), so its source guard
pins that single path and the absence of any client-side secret or ranking.
```

B1c. Replace the comment block
`# --- Python mirror of awardsSimilarity() in src/Game Renderers/Contexto.tsx --` … `# bottom of
this module fails if the renderer stops using it.` with:

```python
# --- Python mirror of _awards_similarity() in trivia/questions/similarity.py --
# The résumé component of the ranking. Mirrored here so its properties can be
# asserted against the REAL curated pool the game ranks; the guard at the end
# of ContextoAwardsSimilarityTests fails if the ranking stops using it.
```

B1d. Replace `test_the_renderer_uses_the_magnitude_aware_metric` (whole method) with:

```python
    def test_the_ranking_uses_the_magnitude_aware_metric(self):
        """Guards this mirror: the ranking must not fall back to bare cosine.

        The ranking is precomputed server-side (trivia/questions/similarity.py);
        the renderer's TypeScript copy was deleted when multiplayer moved onto
        the dealt question, so this is the only implementation left to pin.
        """
        for a, b in (
            ([1, 6, 2, 0], [2, 12, 4, 0]),
            ([0, 0, 0, 0], [0, 0, 0, 0]),
            ([0, 0, 0, 0], [4, 21, 4, 0]),
            ([2, 15, 5, 0], [2, 15, 5, 0]),
        ):
            self.assertAlmostEqual(
                questions_similarity._awards_similarity(a, b), awards_similarity(a, b)
            )
        src = inspect.getsource(questions_similarity.similarity)
        self.assertIn("_awards_similarity(_awards_vec(secret), _awards_vec(p))", src)
        self.assertNotIn("_cosine(_awards_vec(", src)
```

B1e. Replace `test_the_renderer_resolves_the_same_secret` (whole method) with:

```python
    def test_the_renderer_resolves_the_same_secret(self):
        """Both modes play the ContextoQuestion they were handed — and ONLY that.

        The secret and the whole ranking are precomputed server-side
        (trivia/questions/games/contexto.py); a multiplayer room is dealt one
        question (multiplayer_server/src/questions.js deal) and every member
        receives the same object. The renderer therefore has no secret-picking,
        no pool download and no similarity engine of its own — the retired
        {pool, day, secret_person_id} multiplayer branch is gone — so two
        players can never rank against different secrets.
        """
        with open(CONTEXTO_TSX, "r", encoding="utf-8") as f:
            src = f.read()
        # One payload shape for both modes: the question is gameInfo[0].
        self.assertIn("const question = gameInfo[0] as ContextoQuestion | undefined;", src)
        self.assertIn("const secret = question?.secret ?? null;", src)
        self.assertIn("new Map<number, number>(question?.ranking ?? [])", src)
        # The retired multiplayer config and its client-side machinery are gone.
        self.assertNotIn("secret_person_id", src)
        self.assertNotIn("useRoundPool", src)
        self.assertNotIn("buildRanking", src)
        self.assertNotIn("dailySecret", src)
```

Done-check: `cd backend && .venv/bin/python manage.py test trivia.tests.test_contexto` →
`Ran 18 tests … OK`; `grep -c "awardsSimilarity\|Contexto.tsx" backend/trivia/tests/test_contexto.py` → `1` (the `CONTEXTO_TSX` path only).

#### Step B2 — `backend/trivia/tests/test_superdraft.py`

B2a. `eligible_for` docstring → `"""The players a slot constraint offers — the eligibility rule of
trivia/questions/games/superdraft.slot_matches (the renderer's buildCandidates copy is gone)."""`.

B2b. `test_every_slot_resolves_in_the_pool_the_renderer_loads` docstring → `"""The legacy endpoint
only draws constraints with >= MIN_ELIGIBLE players — the same floor the questions-store generator
enforces per slot (superdraft.materialize)."""`.

B2c. Replace `test_renderer_plays_the_server_slots_and_never_redraws_online` (whole method) with:

```python
    def test_renderer_plays_the_server_slots_and_never_redraws_online(self):
        """Guards defect B: online, the renderer plays the five slots of the
        SuperDraftQuestion the room was dealt and has no draw, no resolve and
        no pool of its own. Solo plays a precomputed question too (its re-roll
        refetches one), and porting the multiplayer branch onto the dealt
        question removed the last client-side slot machinery
        (buildCandidates / resolveSlots / useRoundPool)."""
        with open(SUPERDRAFT_TSX, "r", encoding="utf-8") as f:
            src = f.read()
        # Both modes derive the board from the question's precomputed slots.
        self.assertIn("setSlots(question.slots.map((s) => slotFromQuestion(s, lookup)));", src)
        # No client-side slot draw, resolve or pool download exists on any path.
        self.assertNotIn("drawSlots", src)
        self.assertNotIn("resolveSlots", src)
        self.assertNotIn("buildCandidates", src)
        self.assertNotIn("useRoundPool", src)
        # The one re-roll would swap the slots — it is single-player only.
        self.assertIn("if (multiplayer || rerollUsed || phase !== \"draft\") return;", src)
        self.assertIn("{drafting && !multiplayer && (", src)
        # Online the objective comes from the dealt question's qid — data both
        # clients hold — never from each client's clock; solo keeps the daily rule.
        self.assertIn("multiplayer && question ? objectiveForQid(question.qid) : dailyObjective()", src)
        self.assertNotIn("dailyObjective(round", src)
        self.assertNotIn("round?.day", src)
```

Done-check: `cd backend && .venv/bin/python manage.py test trivia.tests.test_superdraft` →
`Ran 13 tests … OK` (the sim-driven room test is unchanged and still passes: the relay is untouched).

#### Step B3 — whole app green

`cd backend && .venv/bin/python manage.py test trivia` → ends in `OK`. This is the command the ship
skill runs post-rebase.

#### Step B4 — commit

Frontend half: `git add "src/Game Renderers/Contexto.tsx" "src/Game Renderers/SuperDraft.tsx"
"src/Game Renderers/RenderGame.tsx" src/types/types.tsx src/utils/questions.ts` (plus the
`git rm` of the hook) → `feat(games): port Contexto/SuperDraft multiplayer onto the dealt question`.
Backend half: `git add backend/trivia/tests/test_contexto.py backend/trivia/tests/test_superdraft.py`
→ `test(trivia): re-pin the Contexto/SuperDraft renderer guards to the dealt-question port`. Each
`git status --short` shows nothing else modified.

## Self-review (5b)

- **Coverage.** "Port both renderers' multiplayer branches to consume the dealt question
  directly, gameInfo = [question] in both modes" → F1, F2i–F2k, F5. "Remove the useRoundPool
  fallback for these games" → F2b/F2i (SuperDraft), F1 (Contexto), F6 (hook deleted). "Keep the
  relay contract as is" → no relay/Django step; Decision summary answers "relay change: no" with
  the qid rule (decision 2). "Online Contexto shows No player data" → F1 reads `question.secret`;
  Test plan 7e. "SuperDraft cross-timezone objective" → F2f/F2i; Test plan 7f runs the two
  clients in Honolulu/Kiritimati. "Client downloads the whole pool" → F2h/F6; Interfaces lists
  the two remaining online fetches. "Single-player must not change" → `dailyObjective()` body
  identical minus the dead `day` branch, solo effects identical minus the mode guard, solo
  `fetchQuestion`/reroll untouched; guarded by the re-pinned solo lines (B2c) and 7g. "Backend =
  test re-pins, each meaningful" → B1d/B1e/B2c pin verbatim lines from F1/F2 plus structural
  absences; Test plan 3 mutates the objective line and shows the pin fails. "Backend suite green"
  → B3. "tsc/lint/build" → F7. "Two-client browser pass with room seeding on :4100/:8100/:5273"
  → Test plan 7a–7h, including the CDN-blocked fixture server the coordinator required.
- **No placeholders.** Contexto is given in full; every SuperDraft edit names the exact old text
  and the exact new text; every test method is given in full; every done-check is a command with
  its expected output; the fixture server and its expected values (objective label, slot labels,
  ranks #2/#3) are computed here, not left to QA.
- **Consistency.** `question` / `setQuestion` / `objectiveForQid` / `hashStr` / `rankById` are
  spelled identically in F1, F2, F3, B1e and B2c; the B1e/B2c `assertIn` strings are substrings of
  single lines in F1/F2i/F2j; `RenderGame` passes `multiplayer` to SuperDraft only, and check-4's
  expected `4` / six-file list in Test plan 5 follows from F1+F5; the fixture keys in 7a match
  `questions.js`'s `${BASE}/questions/manifest.json` and absolute `names`/`index` URLs.
- **Scope.** No relay, Django view/model, generator, CSS, constraint-doc or MASTER_PLAN edit. The
  only edits beyond the two renderers and two test files are the direct consequences the spec's
  port implies: the retired types, the dead hook, the RenderGame casts, and exporting an existing
  function. Comment/docstring edits are limited to text that names deleted code. The stale "3/7"
  in MULTIPLAYER_CONSTRAINTS is reported to QA, not fixed here (bootstrap-audit owns that file).
- **Ambiguity resolved.** (a) Shared objective: qid hash, not UTC date, not a new relay field —
  reasons in decision 2. (b) Contexto's `multiplayer` prop: removed (decision 4), with the
  acceptance-check consequence spelled out. (c) Whether SuperDraft keeps `Pick.aliases` / the
  name-match branch: no — tuples never carried aliases, both modes resolve through the names
  list. (d) `randInt`: kept, grading only. (e) Split ordering: frontend first; backend re-pins
  fail before that by design. (f) The awards-metric guard that the deleted TypeScript engine
  would have broken: moved onto the Python implementation with a numeric mirror check, not
  weakened into a no-op.
