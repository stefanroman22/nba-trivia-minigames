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
const emitted = []; // { sid, event, payload }

// CLONE AT CAPTURE. dealRound emits the same object REFERENCE to every member,
// so recording the reference would make "both players got the same slots" a
// comparison of one object with itself — an assertion that cannot fail, which
// is worse than no assertion. Independent copies make the check real: mutate
// one player's captured payload and the comparison must go red.
const record = (sid, event, payload) => {
  emitted.push({ sid, event, payload: structuredClone(payload) });
};

const fakeIo = {
  handlers: {},
  sockets: { sockets: new Map() },
  on(event, fn) {
    this.handlers[event] = fn;
  },
  to(sid) {
    return {
      emit(event, payload) {
        record(sid, event, payload);
      },
    };
  },
  adapter() {},
};

const stubs = {
  express: Object.assign(() => ({ use() {}, get() {} }), { json: () => () => {} }),
  cors: () => () => {},
  "socket.io": { Server: function Server() { return fakeIo; } },
};

const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (Object.prototype.hasOwnProperty.call(stubs, request)) return stubs[request];
  if (request === "http") {
    return { createServer: () => ({ listen() {} }) };
  }
  return originalLoad.apply(this, arguments);
};

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
function makeSocket(id) {
  const socket = {
    id,
    handlers: {},
    on(event, fn) {
      this.handlers[event] = fn;
    },
    emit(event, payload) {
      record(id, event, payload);
    },
    join() {},
    leave() {},
    send(event, payload) {
      this.handlers[event]?.(payload);
    },
  };
  fakeIo.sockets.sockets.set(id, socket);
  fakeIo.handlers.connection(socket);
  return socket;
}

const eventsFor = (sid, event) =>
  emitted.filter((e) => e.sid === sid && e.event === event).map((e) => e.payload);

const GAMES = {
  superdraft: { id: "superdraft", name: "SuperDraft Five", pointsPerCorrect: 0 },
  contexto: { id: "contexto", name: "LeContexto", pointsPerCorrect: 0 },
};

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
