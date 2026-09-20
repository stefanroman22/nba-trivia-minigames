# Design: fix-3-trivia-tests-clean-dev

Task: "Fix 3 trivia tests that fail on a clean dev checkout" (Category backend, P1). On untouched
`origin/dev`, `manage.py test trivia` fails `test_contexto.ContextoPayloadTests.
test_the_renderer_resolves_the_same_secret`, `test_superdraft.SuperDraftRoundTests.
test_renderer_plays_the_server_slots_and_never_redraws_online` and `test_superdraft.
SuperDraftRoundTests.test_both_players_in_a_room_receive_the_same_slots`. They block the ship
skill's post-rebase backend test check for every backend card.

Classify: standard / backend + multiplayer / risk low. Design round 2026-09-20, planner on
Opus 4.8. Branch `team/fix-3-trivia-tests-clean-dev` (cut from `origin/dev` 0916d43).

## Decision summary

**Engine: sonnet** — six steps, each with an exact file, exact text and a done-check command; the
one non-trivial artifact (the rewritten sim) is given in full below.

**Verdict, per test: all three are stale tests. No renderer or relay code changes.** Reproduced
on this branch with `backend/.venv` (`Ran 31 tests ... FAILED (failures=3)` for the two modules;
the rest of `trivia` is green — see Test plan).

| Failing test | What it asserts | What happened in the code | Verdict |
|---|---|---|---|
| `test_contexto…test_the_renderer_resolves_the_same_secret` | literal `if (multiplayer) return pool.find(...)`, `return dailySecret(pool);`, the FNV/`fame_tier <= 2`/`toISOString` internals of `dailySecret`, `useRoundPool(localPool, round?.pool)` | 40b1ef8 (questions-store Phase D) made solo play a precomputed `ContextoQuestion` and **deleted `dailySecret` from `Contexto.tsx`**; the FNV daily rule moved server-side (`src/utils/questions.ts pickDaily`, `multiplayer_server/src/questions.js pickDaily`). The multiplayer branch still resolves the secret as `pool.find((p) => p.person_id === round?.secret_person_id) ?? null` (line 258) behind `if (!multiplayer \|\| !pool \|\| !pool.length) return null;` and still loads the pool via `useRoundPool(multiplayer ? null : NO_POOL, round?.pool)` (line 221). | **Stale.** Invariant ("online, the sent id is the only secret; no local fallback; pool from the CDN") still holds and is now stronger: there is no fallback function left to reach for. Re-pin the test to the current lines and assert `dailySecret` is absent. |
| `test_superdraft…test_renderer_plays_the_server_slots_and_never_redraws_online` | literal `const drawn = multiplayer ? resolveSlots(...) : drawSlots(candidates);` plus three other lines | 6e82128 (Phase C) made solo play a precomputed `SuperDraftQuestion` (re-roll refetches a question) and **deleted `drawSlots`**; the multiplayer effect is now `if (!multiplayer) return;` … `const drawn = resolveSlots(candidates, round?.slots ?? []);` (lines 419/445). The other three asserted lines (631, 723, 366) are unchanged and still pass. `randInt`/`Math.random` survive only in the 300-lineup percentile grading (lines 537/543), not slot drawing. | **Stale.** Invariant ("never redraw online") holds structurally — no draw exists on any path. Assert the resolve line and `drawSlots` absent; keep the other three assertions. |
| `test_superdraft…test_both_players_in_a_room_receive_the_same_slots` (runs `multiplayer_server/scripts/sim_round_fanout.js`) | the relay fetches ONE Django round per room and fans it out unchanged, re-served on reconnect | 6a1a11b (Phase E) moved `superdraft`/`contexto` into `QUESTION_GAMES` in `index.js`: `fetchRound` now returns `[await questions.deal(gameId)]` and never calls `fetch(gameEndpoints[...])`. The sim still stubs `global.fetch` with the two Django `{series:[…]}` payloads. `questions.deal` → `getManifest()` → `getJson("/questions/manifest.json")` hits that stub, which returns `CONTEXTO_ROUND` (the url has no "superdraft"), so `m.schema` is `undefined` → `questions schema undefined unsupported`; `dealRound` emits `roundDataError`, no `roundData`, and the sim's unguarded `sd.roundA[0].gameData` at line 178 throws the TypeError. Phase E rewrote `sim_turngames.js` onto `questions._setForTest` but missed this sim. | **Stale sim, relay not regressed.** Rewrite the sim onto the questions-store fixture seam (`questions._setForTest`, mirroring `sim_turngames.js`), keep the fairness/fan-out/reconnect assertions, make every check crash-proof, and add "no Django fetch" as an explicit check. The Python test body stays as is. |

Rejected alternative: re-point the sim's `global.fetch` stub at fake manifest/index/question URLs.
That re-implements `questions.js`'s loader contract in the sim and diverges from the fixture
pattern the codebase already has (`sim_turngames.js`, `turnGames._setQuestionsForTest`); the
`_setForTest` seam exists precisely for this.

Sign-off: this cloud session has no `Agent` tool and `ListAgents` shows no teammate engines, so
the two `backend-engine` seats (Django tests; Node sim) were filled by the planner from source and
`git log -p`, and the sign-off pass is the 5b self-review at the end of this doc. Recorded in
`docs/team/DECISIONS.md` (2026-09-20, second entry).

### Findings outside this card (not planned here — needs its own card)

Reading the contract on both sides surfaced a real relay→renderer mismatch that none of the three
tests covers and whose fix is UI work with a browser pass, so it is out of scope for a P1 test
unblock:

1. **Online Contexto is unplayable on `dev`.** The relay deals a `ContextoQuestion`
   (`{schema, game, qid, day, secret: <row>, ranking}` — no `secret_person_id`), but
   `Contexto.tsx`'s multiplayer branch reads `round?.secret_person_id`, so `mpSecret` is `null`
   and the renderer shows "No player data available" (line 397-406). Since 6a1a11b. Spec
   `docs/superpowers/specs/2026-09-10-questions-store-design.md` §10.3 intended `gameInfo =
   [question]` in both modes with `useRoundPool` removed; Phase D left the multiplayer branch on
   `ContextoRoundConfig` "for a future phase" and Phase E switched the relay anyway.
2. **Online SuperDraft works by accident and lost `day`.** The dealt `SuperDraftQuestion` has no
   `pool`/`day`; `useRoundPool(null, undefined)` falls back to `"players-index"` (still published)
   so `resolveSlots` matches `kind`/`value`, but `dailyObjective(undefined)` now uses each
   client's local date (cross-timezone objective divergence the `day` field existed to prevent)
   and the client downloads the whole pool the migration meant to retire.

Suggested follow-up card: "Port Contexto/SuperDraft multiplayer branches to the dealt question
(spec §10.3)". Areas ui + multiplayer; needs `docs/GAME_DESIGN_CONSTRAINTS.md` and browser QA.

## Interfaces

Nothing new is exposed or consumed by product code. The sim consumes three existing seams:

```js
// multiplayer_server/src/questions.js (unchanged)
questions._setForTest({ files: { "<BASE-relative url>": <json> } })  // BASE = "" when QUESTIONS_PUBLIC_BASE unset
questions.deal(gameId) -> Promise<question>                              // index.js calls it via the module object
// multiplayer_server/src/index.js (unchanged)
QUESTION_GAMES = {"career-path","who-are-ya","contexto","superdraft"}; fetchRound -> [await questions.deal(gameId)]
roundData payload: { gameData: [question], game }; resumeMatch snapshot carries gameData: room.gameData
```

Question shapes the fixture must match (from `backend/trivia/questions/base.py envelope()` and
`trivia/questions/games/{superdraft,contexto}.py materialize()`):

```
SuperDraftQuestion = { schema: 1, game: "superdraft", qid, slots: [{ kind, value, label, sub, eligible: [[person_id, height_in, rings, career_pts, birth_year], …] } × 5] }
ContextoQuestion   = { schema: 1, game: "contexto",   qid, day: "YYYY-MM-DD", secret: <player row>, ranking: [[person_id, rank], …] }
manifest           = { schema: 1, version, dataset: { players }, names: <url>, games: { <slug>: { index: <url>, count } } }
index              = { schema: 1, game, version, dataset, items: [[qid] | [qid, day]] }
```

Pickers (both unchanged): `superdraft` → `pickRandom` (one item ⇒ deterministic); `contexto` →
`pickDaily(index)`: no item dated today ⇒ FNV fallback over the sorted items ⇒ the only item.

## File plan

| File | Change |
|---|---|
| `backend/trivia/tests/test_contexto.py` | Re-pin `test_the_renderer_resolves_the_same_secret` to the current multiplayer branch; fix the two comment blocks that claim the renderer still has `dailySecret`. |
| `backend/trivia/tests/test_superdraft.py` | Re-pin `test_renderer_plays_the_server_slots_and_never_redraws_online`; update the docstring of `test_both_players_in_a_room_receive_the_same_slots`. Body of the latter unchanged. |
| `multiplayer_server/scripts/sim_round_fanout.js` | Rewrite onto the questions-store fixture (full text in step 3). |
| Everything else | untouched — explicitly: `src/Game Renderers/Contexto.tsx`, `src/Game Renderers/SuperDraft.tsx`, `multiplayer_server/src/*`, `backend/trivia/games/*`, `backend/trivia/questions/*`. |

## Risks

- **Weakening a guard into a no-op.** Mitigated: every replaced assertion pins a still-live line
  of the renderer or a structural absence (`dailySecret`/`drawSlots` not in source); the sim
  gains a mutation done-check (step 3) proving it exits 1 when the dealt question is wrong, and
  every "same as" comparison requires the left side to be present so two `undefined`s cannot
  pass (the old sim printed `ok … SAME slot constraints` while `0 vs 0` rounds were received).
- **Source-string tests stay brittle by nature.** Accepted for this card: the spec asks to fix
  the three tests, not to redesign the guard style. The new strings are the exact current lines
  (verified by line number above) and few.
- **Env leakage.** `questions.js` reads `QUESTIONS_PUBLIC_BASE` at load; a developer shell with
  it set would break the BASE-relative fixture URLs. The sim pins it to `""` before any require.
- **Timing.** `dealRound` is async over several awaited microtasks; the sim replaces the two fixed
  `setImmediate` ticks with a bounded `settle()` loop (100 ticks) so it neither races nor hangs.
- **`node` absent on the ship runner** → the sim test is `skipIf`'d (unchanged behaviour).

## Test plan

Baseline on this branch (before changes): `cd backend && .venv/bin/python manage.py test
trivia.tests.test_contexto trivia.tests.test_superdraft` → `Ran 31 tests … FAILED (failures=3)`,
exactly the three named tests; the whole app, `manage.py test trivia` → `Ran 311 tests in 112s …
FAILED (failures=3)`, the same three and nothing else; `node multiplayer_server/scripts/sim_round_fanout.js` → the
`questions schema undefined unsupported` line and the TypeError at line 178;
`node multiplayer_server/scripts/sim_turngames.js` → 3× PASS.

After the plan:
1. `cd multiplayer_server && node scripts/sim_round_fanout.js` → every line `ok`, exit 0.
2. Mutation check (step 3) → `FAIL  superdraft: the round carries five slot constraints …`, exit 1.
3. `cd backend && .venv/bin/python manage.py test trivia.tests.test_contexto trivia.tests.test_superdraft` → `Ran 31 tests … OK`.
4. `cd backend && .venv/bin/python manage.py test trivia` → `OK` (full green — the card's acceptance).
5. `cd multiplayer_server && node scripts/sim_turngames.js` → still 3× PASS (untouched, sanity).

## Implementation plan

Work in the task worktree on branch `team/fix-3-trivia-tests-clean-dev`. Do not touch any file
outside the File plan. Do not run `npm ci`, lint or the frontend build — no TypeScript changes.

### Step 1 — `backend/trivia/tests/test_contexto.py`: re-pin the multiplayer-secret guard

1a. Replace the body of `test_the_renderer_resolves_the_same_secret` (lines 208-233) with exactly:

```python
    def test_the_renderer_resolves_the_same_secret(self):
        """The multiplayer path must use the id it was sent — and ONLY that.

        A local fallback there would let a client whose pool lacks the id rank
        against a different secret from its opponent's and still be scored
        against them: the exact silent divergence this contract removes. When
        the id isn't in the loaded pool the round must be unplayable instead.

        Since the questions-store migration (40b1ef8) single-player plays a
        precomputed ContextoQuestion and the renderer has no daily rule of its
        own any more — the FNV pick lives server-side (pickDaily in
        src/utils/questions.ts and multiplayer_server/src/questions.js) — so
        there is nothing left for the online path to fall back to.
        """
        with open(CONTEXTO_TSX, "r", encoding="utf-8") as f:
            src = f.read()
        # Online: the sent id, found in the loaded pool, or no secret at all.
        self.assertIn("if (!multiplayer || !pool || !pool.length) return null;", src)
        self.assertIn(
            "return pool.find((p) => p.person_id === round?.secret_person_id) ?? null;",
            src,
        )
        # No local daily rule exists in the renderer to fall back on.
        self.assertNotIn("dailySecret", src)
        # Solo takes the secret its precomputed question carries; it never picks one.
        self.assertIn("const secret = multiplayer ? mpSecret : (question?.secret ?? null);", src)
        # The pool arrives from the CDN cache, never through the socket server.
        self.assertIn("useRoundPool(multiplayer ? null : NO_POOL, round?.pool)", src)
```

1b. In the module docstring, replace lines 9-15 (from `What must not change` through
`source guards pin the renderer to the rule the mirror encodes.`) with:

```
What must not change is the property an earlier fix established: single-player
and multiplayer resolve the SAME secret for the same day. ``daily_secret`` below
is an independent mirror of the rule the endpoint's ``contexto.daily_secret``
encodes (the renderer's own ``dailySecret`` copy was deleted by the questions-
store migration, 40b1ef8 — solo now plays a precomputed ContextoQuestion), so
the tests can assert the endpoint stays on that rule, and the source guard pins
the renderer's multiplayer path to the id it was sent.
```

1c. Replace the comment block at lines 33-36 (`# --- Python mirror of dailySecret() …` through
`# the endpoint hands multiplayer match the one single-player picks for itself?`) with:

```python
# --- Python mirror of the daily-secret rule (trivia/games/contexto.daily_secret) --
# Kept independent of the module under test so a test can ask: given the same
# day, does the endpoint keep landing on the player this rule picks?
```

Done-check: `cd backend && .venv/bin/python manage.py test trivia.tests.test_contexto` →
`Ran 18 tests … OK`. Also `grep -c "dailySecret" backend/trivia/tests/test_contexto.py` prints
`2` (the docstring mention and the new `assertNotIn` only).

### Step 2 — `backend/trivia/tests/test_superdraft.py`: re-pin the never-redraws guard

2a. Replace the body of `test_renderer_plays_the_server_slots_and_never_redraws_online`
(lines 124-137) with exactly:

```python
    def test_renderer_plays_the_server_slots_and_never_redraws_online(self):
        """Guards defect B: online, the renderer resolves the server's slots and
        has no draw of its own. Since the questions-store migration (6e82128)
        solo plays a precomputed SuperDraftQuestion and its re-roll refetches
        one, so drawSlots() is gone from the renderer entirely."""
        with open(SUPERDRAFT_TSX, "r", encoding="utf-8") as f:
            src = f.read()
        self.assertIn("const drawn = resolveSlots(candidates, round?.slots ?? []);", src)
        # No client-side slot draw exists on any path.
        self.assertNotIn("drawSlots", src)
        # The one re-roll would swap the slots — it is single-player only.
        self.assertIn("if (multiplayer || rerollUsed || phase !== \"draft\") return;", src)
        self.assertIn("{drafting && !multiplayer && (", src)
        # The daily objective follows the round's day, not each client's clock.
        self.assertIn("dailyObjective(round?.day)", src)
```

2b. Replace the docstring of `test_both_players_in_a_room_receive_the_same_slots` (lines
112-114) with:

```python
        """Drives the real relay: two players queue, a room is created, ONE
        superdraft question is dealt from the questions store, and both
        emissions (plus a reconnect's resume snapshot) must carry byte-identical
        slot constraints. See multiplayer_server/scripts/sim_round_fanout.js."""
```

The test body (`subprocess.run([... sim ...])`, `assertEqual(proc.returncode, 0, …)`) stays as is.

Done-check: `cd backend && .venv/bin/python manage.py test
trivia.tests.test_superdraft.SuperDraftRoundTests.test_renderer_plays_the_server_slots_and_never_redraws_online`
→ `OK`. (The room test still fails until step 3.)

### Step 3 — `multiplayer_server/scripts/sim_round_fanout.js`: rewrite onto the questions-store fixture

Overwrite the file with the following. Keep the stub/capture machinery (`record` with
`structuredClone`, `fakeIo`, `stubs`, `Module._load`, `makeSocket`, `eventsFor`, `GAMES`) as it
is today; the changes are the header, the env pin, the fixture in place of the Django payload
constants, the deal counter, the throwing `fetch`, `settle()`, and the check list.

```js
// multiplayer_server/scripts/sim_round_fanout.js
//
// Standalone, no-network, no-dependency check that a room's ROUND is decided
// once and handed to every member unchanged — the property SuperDraft's online
// fairness rests on (each player used to draw their own slot constraints
// client-side and then be scored against the other's lineup).
//
// Since the questions-store migration (Phase E, 6a1a11b) the relay deals
// superdraft and contexto from multiplayer_server/src/questions.js — one
// pre-generated question per room — instead of fetching a round from Django.
// So this sim injects a questions-store fixture through questions._setForTest
// (the same seam scripts/sim_turngames.js uses) and stubs global.fetch to
// THROW: any Django round fetch for these games fails the run.
//
// index.js needs express/socket.io/cors, which aren't installed for a test run,
// so this stubs them through Module._load the way a test double would, then
// drives the real relay:
//   1. two players identify and queue for superdraft -> a room is created,
//   2. assert ONE question was dealt, BOTH received roundData, the slot
//      constraints are identical (captures are deep-cloned, so this is a real
//      comparison of two payloads and not of one shared object reference with
//      itself), and the payload is the dealt question verbatim,
//   3. assert a reconnect (index.js's resumeMatch snapshot) re-serves the same
//      round,
//   4. same for contexto's secret.
//
// Run:  node scripts/sim_round_fanout.js     (exit code 0 = pass)

// questions.js builds URLs from QUESTIONS_PUBLIC_BASE at load time; the fixture
// below is keyed BASE-relative, so pin it empty whatever the shell has.
process.env.QUESTIONS_PUBLIC_BASE = "";

const Module = require("module");
const questions = require("../src/questions");

let failures = 0;
function check(label, ok, detail) {
  if (ok) {
    console.log(`  ok  ${label}`);
  } else {
    failures++;
    console.log(`FAIL  ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

// ------------------------------------------------------------------ stubs
// (emitted / record / fakeIo / stubs / Module._load — UNCHANGED from the current file)

// ------------------------------------------------------- questions fixture
// The two dealt questions exactly as trivia/questions/games/{superdraft,
// contexto}.py materialize them (base.envelope(): schema/game/qid + payload).
// Small eligible lists and ranking — the shape is what matters, not the size.
const SUPERDRAFT_QUESTION = {
  schema: 1,
  game: "superdraft",
  qid: "sd-0001",
  slots: [
    { kind: "team", value: "LAL", label: "Los Angeles Lakers", sub: "Franchise", eligible: [[2544, 81, 4, 40474, 1984], [977, 78, 5, 33643, 1978]] },
    { kind: "draft", value: "2010", label: "2010s Draft", sub: "Draft class", eligible: [[203507, 83, 1, 17000, 1994], [1628369, 80, 1, 12000, 1998]] },
    { kind: "country", value: "Serbia", label: "Serbia", sub: "Country", eligible: [[203999, 83, 0, 15000, 1995], [1627749, 80, 0, 6000, 1997]] },
    { kind: "team", value: "BOS", label: "Boston Celtics", sub: "Franchise", eligible: [[1628369, 80, 1, 12000, 1998], [1883, 82, 1, 26000, 1976]] },
    { kind: "draft", value: "1980", label: "1980s Draft", sub: "Draft class", eligible: [[893, 78, 6, 32292, 1963], [1449, 84, 2, 26946, 1963]] },
  ],
};
const CONTEXTO_QUESTION = {
  schema: 1,
  game: "contexto",
  qid: "ctx-2026-09-06",
  day: "2026-09-06",
  secret: { person_id: 2544, full_name: "LeBron James", fame_tier: 1 },
  ranking: [[2544, 1], [977, 2], [893, 3]],
};
const FIXTURE = {
  files: {
    "/questions/manifest.json": {
      schema: 1,
      version: "t",
      dataset: { players: "t" },
      names: "/questions/v/t/players-names.json",
      games: {
        superdraft: { index: "/questions/v/t/superdraft/index.json", count: 1 },
        contexto: { index: "/questions/v/t/contexto/index.json", count: 1 },
      },
    },
    "/questions/v/t/players-names.json": [],
    "/questions/v/t/superdraft/index.json": { schema: 1, game: "superdraft", version: "t", dataset: { players: "t" }, items: [["sd-0001"]] },
    "/questions/v/t/superdraft/sd-0001.json": SUPERDRAFT_QUESTION,
    // pickDaily: no item is dated "today", so the FNV fallback over the sorted
    // index lands on the only item — deterministic whatever day the sim runs.
    "/questions/v/t/contexto/index.json": { schema: 1, game: "contexto", version: "t", dataset: { players: "t" }, items: [["ctx-2026-09-06", "2026-09-06"]] },
    "/questions/v/t/contexto/ctx-2026-09-06.json": CONTEXTO_QUESTION,
  },
};
questions._setForTest(FIXTURE);

// index.js calls questions.deal(gameId) through the module object, so wrapping
// the export here is what the relay sees. One room = one deal.
let deals = 0;
const realDeal = questions.deal;
questions.deal = (gameId) => {
  deals++;
  return realDeal(gameId);
};

// superdraft/contexto must never reach Django any more: a fetch is a failure,
// not something to satisfy with a stub.
let networkFetches = 0;
global.fetch = async (url) => {
  networkFetches++;
  throw new Error(`unexpected network fetch: ${url}`);
};

require("../src/index");
Module._load = originalLoad;

// ------------------------------------------------------------------ fake sockets
// (makeSocket / eventsFor / GAMES — UNCHANGED from the current file)

/** Wait (bounded) until pred() holds — dealRound is async over several microtask hops. */
async function settle(pred, ticks = 100) {
  for (let i = 0; i < ticks && !pred(); i++) await new Promise((r) => setImmediate(r));
}

/** Queue two fresh players for a game and return the roundData each received. */
async function playRound(gameId, suffix) {
  const a = makeSocket(`sa-${suffix}`);
  const b = makeSocket(`sb-${suffix}`);
  const userA = { id: `A${suffix}`, username: `alice${suffix}`, points: 100 };
  const userB = { id: `B${suffix}`, username: `bob${suffix}`, points: 100 };
  a.send("identify", { user: userA });
  b.send("identify", { user: userB });
  a.send("findMatch", { game: GAMES[gameId] });
  b.send("findMatch", { game: GAMES[gameId] });
  await settle(() => eventsFor(a.id, "roundData").length && eventsFor(b.id, "roundData").length);
  return { a, b, userA, userB, roundA: eventsFor(a.id, "roundData"), roundB: eventsFor(b.id, "roundData") };
}

(async () => {
  // 1. SuperDraft — the fairness case. Every access below is optional-chained
  // so a failing run prints its FAIL lines and exits 1 instead of throwing.
  const sdBefore = deals;
  const sd = await playRound("superdraft", "1");
  check("superdraft: one question dealt for the whole room", deals - sdBefore === 1, `dealt ${deals - sdBefore}x`);
  check("superdraft: both players received roundData",
    sd.roundA.length === 1 && sd.roundB.length === 1, `${sd.roundA.length} vs ${sd.roundB.length}`);
  const qA = sd.roundA[0]?.gameData?.[0];
  const qB = sd.roundB[0]?.gameData?.[0];
  check("superdraft: the round is a schema-1 superdraft question",
    qA?.schema === 1 && qA?.game === "superdraft" && typeof qA?.qid === "string", JSON.stringify(qA));
  check("superdraft: the round carries five slot constraints with eligibility",
    qA?.slots?.length === 5 && qA.slots.every((s) => s.kind && s.value && s.label && s.sub && Array.isArray(s.eligible)),
    JSON.stringify(qA?.slots));
  check("superdraft: BOTH players got the SAME slot constraints",
    !!qA?.slots && JSON.stringify(qA.slots) === JSON.stringify(qB?.slots),
    `${JSON.stringify(qA?.slots)} vs ${JSON.stringify(qB?.slots)}`);
  // Guards the guard: if the capture ever stops cloning, the check above
  // compares one object with itself and silently stops being able to fail.
  check("superdraft: the two captures are independent copies",
    !!sd.roundA[0]?.gameData && sd.roundA[0].gameData !== sd.roundB[0]?.gameData);
  check("superdraft: the round is the dealt question, unchanged",
    JSON.stringify(qA) === JSON.stringify(SUPERDRAFT_QUESTION));

  // 2. A reconnect re-serves the same round.
  sd.a.send("identify", { user: sd.userA });
  const resume = eventsFor(sd.a.id, "resumeMatch");
  check("superdraft: reconnect resumed the match", resume.length === 1);
  check("superdraft: the resumed round is the same one",
    !!resume[0]?.gameData && JSON.stringify(resume[0].gameData) === JSON.stringify(sd.roundA[0]?.gameData));

  // 3. Contexto — the secret, dealt once for the room.
  const cxBefore = deals;
  const cx = await playRound("contexto", "2");
  check("contexto: one question dealt for the whole room", deals - cxBefore === 1, `dealt ${deals - cxBefore}x`);
  check("contexto: both players received roundData",
    cx.roundA.length === 1 && cx.roundB.length === 1, `${cx.roundA.length} vs ${cx.roundB.length}`);
  const cA = cx.roundA[0]?.gameData?.[0];
  const cB = cx.roundB[0]?.gameData?.[0];
  check("contexto: both players got the SAME secret and day",
    cA?.secret?.person_id === 2544 && cA?.secret?.person_id === cB?.secret?.person_id &&
      cA?.day === "2026-09-06" && cA?.day === cB?.day,
    `${JSON.stringify(cA?.secret)}/${cA?.day} vs ${JSON.stringify(cB?.secret)}/${cB?.day}`);
  check("contexto: the round is the dealt question, unchanged",
    JSON.stringify(cA) === JSON.stringify(CONTEXTO_QUESTION));

  // 4. Neither game went anywhere near Django.
  check("no network round fetch for either game", networkFetches === 0, `${networkFetches} fetch(es)`);

  console.log(failures === 0 ? "\nAll round fan-out checks passed." : `\n${failures} check(s) failed.`);
  process.exit(failures === 0 ? 0 : 1);
})();
```

Rules for the rewrite: (i) nothing in `multiplayer_server/src/` changes; (ii) the old
`SUPERDRAFT_ROUND`/`CONTEXTO_ROUND` Django payload constants, the `fetchCalls` counter and the
`url.includes("superdraft")` fetch stub are deleted, not left commented out; (iii) the old
"objective day" and "config-sized (< 1000 bytes)" checks are dropped on purpose — the dealt
`SuperDraftQuestion` carries no `day` (spec §7.4 keeps `dailyObjective` in the renderer) and a
byte bound only measured the fixture; the verbatim-question check replaces them.

Done-checks (run from `multiplayer_server/`):
- `node scripts/sim_round_fanout.js; echo "exit=$?"` → 14 `ok` lines, `All round fan-out checks
  passed.`, `exit=0`. No `Round load failed` line in the output.
- Mutation check, proving the sim can fail (no file edit; the prelude pops a slot from the
  fixture before the sim installs it):
  `QUESTIONS_PUBLIC_BASE= node -e 'const q=require("./src/questions");const o=q._setForTest;q._setForTest=(f)=>{f.files["/questions/v/t/superdraft/sd-0001.json"].slots.pop();o(f)};require("./scripts/sim_round_fanout.js")'; echo "exit=$?"`
  → output contains `FAIL  superdraft: the round carries five slot constraints with eligibility`
  and ends with `exit=1`, with no stack trace.
- `node scripts/sim_turngames.js | tail -4` → the three `PASS` lines (untouched; sanity).

### Step 4 — the two modules green

Done-check: `cd backend && .venv/bin/python manage.py test trivia.tests.test_contexto
trivia.tests.test_superdraft` → `Ran 31 tests … OK`.

### Step 5 — the card's acceptance: whole `trivia` app green

Done-check: `cd backend && .venv/bin/python manage.py test trivia` → ends in `OK` (no `FAILED`,
no `ERROR`). This is the command the ship skill runs post-rebase.

### Step 6 — commit

`git add backend/trivia/tests/test_contexto.py backend/trivia/tests/test_superdraft.py
multiplayer_server/scripts/sim_round_fanout.js` and commit as
`test(trivia): re-pin the contexto/superdraft renderer guards and move the fan-out sim onto the
questions-store fixture` with a body naming the three tests and the verdict (stale tests; no
renderer or relay change). Done-check: `git status --short` shows nothing else modified;
`git diff --stat HEAD~1` lists exactly the three files.

## Self-review (5b)

- **Coverage.** Spec item "decide per test, regressed vs stale" → Decision summary table (three
  verdicts with commit evidence). "fix the right side" → steps 1-3, tests only. "root-cause
  `questions schema undefined unsupported`" → table row 3 (stale fetch stub answered the manifest
  request with `CONTEXTO_ROUND`). "TypeError at line 178" → optional chaining rule in step 3.
  "`manage.py test trivia` fully green" → step 5. "prefer behaviour/invariants, don't weaken into
  a no-op" → Risks bullet 1 and the mutation done-check.
- **No placeholders.** Every step carries the exact replacement text and an exact command with
  its expected output. The sim's "UNCHANGED" blocks name the exact identifiers to keep from the
  current file.
- **Consistency.** `SUPERDRAFT_QUESTION`/`CONTEXTO_QUESTION`/`FIXTURE`/`deals`/`networkFetches`/
  `settle` are the only new names and are used identically across the header comment, code and
  done-checks. The fixture URL popped in the mutation check matches the key in `FIXTURE.files`.
  Line numbers quoted for the renderers are from this branch (0916d43).
- **Scope.** No renderer, relay, endpoint, docs-table or constraint-doc edits. The out-of-scope
  Contexto/SuperDraft multiplayer contract break is recorded, not planned. Comment edits in the
  tests are limited to text that describes the assertions being changed.
- **Ambiguity resolved.** (a) "config-sized" and "objective day" checks: dropped, with the reason
  stated. (b) Whether to keep the `dailySecret` internals guards: dropped — the rule left the
  renderer; its Python twin is still covered by `test_single_player_and_multiplayer_agree_on_the_days_secret`.
  (c) Fixture pattern vs fetch-stub pattern: fixture (`_setForTest`), as the codebase already does.
