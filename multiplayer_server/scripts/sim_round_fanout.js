// multiplayer_server/scripts/sim_round_fanout.js
//
// Standalone, no-network, no-dependency check that a room's ROUND is decided
// once and handed to every member unchanged — the property SuperDraft's online
// fairness rests on (each player used to draw their own slot constraints
// client-side and then be scored against the other's lineup).
//
// index.js needs express/socket.io/cors, which aren't installed for a test run,
// so this stubs them through Module._load the way a test double would, stubs
// global fetch with the Django round payloads, then drives the real relay:
//   1. two players identify and queue for superdraft -> a room is created,
//   2. assert BOTH received roundData and the slot constraints are identical
//      (captures are deep-cloned, so this is a real comparison of two payloads
//      and not of one shared object reference with itself),
//   3. assert a reconnect (index.js's resumeMatch snapshot) re-serves the same
//      round, and that the retained payload is config-sized, not the pool,
//   4. same for contexto's secret.
//
// Run:  node scripts/sim_round_fanout.js     (exit code 0 = pass)

const Module = require("module");

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

// The two round payloads exactly as backend/trivia/games/*.py serve them.
const SUPERDRAFT_ROUND = {
  series: [
    {
      pool: "players-index",
      day: "2026-09-06",
      slots: [
        { kind: "team", value: "LAL", label: "Los Angeles Lakers", sub: "Franchise" },
        { kind: "draft", value: "2010", label: "2010s Draft", sub: "Draft class" },
        { kind: "country", value: "USA", label: "USA", sub: "Country" },
        { kind: "team", value: "BOS", label: "Boston Celtics", sub: "Franchise" },
        { kind: "draft", value: "1980", label: "1980s Draft", sub: "Draft class" },
      ],
    },
  ],
};
const CONTEXTO_ROUND = {
  series: [{ pool: "players-index", day: "2026-09-06", secret_person_id: 2544 }],
};

let fetchCalls = 0;
global.fetch = async (url) => {
  fetchCalls++;
  const body = url.includes("superdraft") ? SUPERDRAFT_ROUND : CONTEXTO_ROUND;
  return { ok: true, statusText: "OK", json: async () => JSON.parse(JSON.stringify(body)) };
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
  await new Promise((r) => setImmediate(r));
  await new Promise((r) => setImmediate(r));
  return {
    a,
    b,
    userA,
    userB,
    roundA: eventsFor(a.id, "roundData"),
    roundB: eventsFor(b.id, "roundData"),
  };
}

(async () => {
  // 1. SuperDraft — the fairness case.
  const before = fetchCalls;
  const sd = await playRound("superdraft", "1");
  check("superdraft: one round fetched for the whole room", fetchCalls - before === 1,
    `fetched ${fetchCalls - before}x`);
  check("superdraft: both players received roundData",
    sd.roundA.length === 1 && sd.roundB.length === 1,
    `${sd.roundA.length} vs ${sd.roundB.length}`);

  const slotsA = sd.roundA[0]?.gameData?.[0]?.slots;
  const slotsB = sd.roundB[0]?.gameData?.[0]?.slots;
  check("superdraft: the round carries five slot constraints", slotsA?.length === 5,
    JSON.stringify(slotsA));
  check("superdraft: BOTH players got the SAME slot constraints",
    JSON.stringify(slotsA) === JSON.stringify(slotsB),
    `${JSON.stringify(slotsA)} vs ${JSON.stringify(slotsB)}`);
  // Guards the guard: if the capture ever stops cloning, the check above
  // compares one object with itself and silently stops being able to fail.
  check("superdraft: the two captures are independent copies",
    sd.roundA[0].gameData !== sd.roundB[0].gameData);
  check("superdraft: both players got the same objective day",
    sd.roundA[0]?.gameData?.[0]?.day === sd.roundB[0]?.gameData?.[0]?.day);
  check("superdraft: the round carries no player rows",
    !JSON.stringify(sd.roundA[0].gameData).includes("person_id"));

  // 2. A reconnect re-serves the same round, still config-sized.
  sd.a.send("identify", { user: sd.userA });
  const resume = eventsFor(sd.a.id, "resumeMatch");
  check("superdraft: reconnect resumed the match", resume.length === 1);
  check("superdraft: the resumed round is the same one",
    JSON.stringify(resume[0]?.gameData) === JSON.stringify(sd.roundA[0].gameData));
  const resumeBytes = JSON.stringify(resume[0]?.gameData).length;
  check("superdraft: the retained round payload is config-sized", resumeBytes < 1000,
    `${resumeBytes} bytes`);

  // 3. Contexto — the secret, not the pool.
  const cx = await playRound("contexto", "2");
  check("contexto: both players received roundData",
    cx.roundA.length === 1 && cx.roundB.length === 1);
  check("contexto: both players got the SAME secret",
    cx.roundA[0]?.gameData?.[0]?.secret_person_id ===
      cx.roundB[0]?.gameData?.[0]?.secret_person_id);
  check("contexto: the round carries no player array",
    JSON.stringify(cx.roundA[0].gameData).length < 200 &&
      !JSON.stringify(cx.roundA[0].gameData).includes("full_name"),
    JSON.stringify(cx.roundA[0].gameData));

  console.log(failures === 0 ? "\nAll round fan-out checks passed." : `\n${failures} check(s) failed.`);
  process.exit(failures === 0 ? 0 : 1);
})();
