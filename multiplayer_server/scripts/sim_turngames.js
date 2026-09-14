// multiplayer_server/scripts/sim_turngames.js
//
// Standalone, no-network simulation of the two turn-based games in turnGames.js.
// It stubs the `helpers` bag index.js normally lends the module, injects a
// fixture questions store via turnGames._setQuestionsForTest (so tictactoe/
// imposter's questions.deal()/loadNames() calls resolve from an in-memory
// fixture instead of touching Supabase Storage), then:
//   1. drives a 2-player Tic-Tac-Toe to a win using the fixture's fixed
//      rows/cols/valid board,
//   2. exercises the id-lookup validation directly: a claim canonicalises via
//      an alias, a used player is rejected on a second cell, and an unknown
//      name is rejected as not fitting, and
//   3. drives a 3-player Imposter to the reveal (imposter caught, guesses right).
//
// Run:  node scripts/sim_turngames.js
const turnGames = require("../src/turnGames");

// Deterministic RNG: turnGames.js uses Math.random to pick the imposter's
// identity, the mystery player, and the clue order (tictactoe no longer rolls
// any dice of its own — its board comes verbatim from the dealt question).
// Seed it so every run of this script is identical; the imposter assertions
// below are written to adapt to whichever uid the deterministic run picks.
function seededRandom(seed) {
  let s = seed >>> 0;
  return function () {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}
Math.random = seededRandom(0xc0ffee);

// ------------------------------------------------------------- fixture store
// A minimal questions-store fixture: one tictactoe question with a fixed
// rows/cols/valid board, and one imposter question with a small name pool.
// Keyed by the exact URLs questions.js builds from the manifest (BASE is
// empty here since QUESTIONS_PUBLIC_BASE is unset — the sim never fetches).
// NamesEntry objects — mirrors the real players-names.json shape (an array of
// { id, full_name, aliases, ... } objects, src/types/types.tsx), NOT tuples.
const NAMES = [
  { id: 1, full_name: "Kobe Bryant", aliases: [] },
  { id: 2, full_name: "LeBron James", aliases: [] },
  { id: 3, full_name: "Shaquille O'Neal", aliases: ["Shaq"] },
  { id: 4, full_name: "Tim Duncan", aliases: [] },
  { id: 5, full_name: "Dirk Nowitzki", aliases: [] },
  { id: 6, full_name: "Kevin Garnett", aliases: [] },
  { id: 7, full_name: "Magic Johnson", aliases: [] },
  { id: 8, full_name: "Larry Bird", aliases: [] },
  { id: 9, full_name: "Hakeem Olajuwon", aliases: [] },
];

// 3x3 board, row-major. cell4 also accepts id 3 (Shaquille O'Neal) besides
// cell1, so the "same player on a second cell" rejection has somewhere legal
// (name-wise) to land.
const TTT_VALID = [
  [1, 2], [3, 4], [5, 6],
  [7, 8], [3, 9], [2, 8],
  [4, 9], [5, 7], [6, 8],
];

const FIXTURE = {
  files: {
    "/questions/manifest.json": {
      schema: 1,
      version: "t",
      dataset: { players: "t" },
      names: "/questions/v/t/players-names.json",
      games: {
        tictactoe: { index: "/questions/v/t/tictactoe/index.json", count: 1 },
        imposter: { index: "/questions/v/t/imposter/index.json", count: 1 },
      },
    },
    "/questions/v/t/players-names.json": NAMES,
    "/questions/v/t/tictactoe/index.json": {
      schema: 1,
      game: "tictactoe",
      version: "t",
      dataset: { players: "t" },
      items: [["ttt-0001"]],
    },
    "/questions/v/t/tictactoe/ttt-0001.json": {
      schema: 1,
      game: "tictactoe",
      qid: "ttt-0001",
      rows: [
        { type: "team", value: "LAL", label: "Lakers" },
        { type: "team", value: "BOS", label: "Celtics" },
        { type: "team", value: "SAS", label: "Spurs" },
      ],
      cols: [
        { type: "award", value: "ring", label: "Won a ring" },
        { type: "award", value: "mvp", label: "MVP" },
        { type: "era", value: "2000s", label: "Played in the 2000s" },
      ],
      valid: TTT_VALID,
    },
    "/questions/v/t/imposter/index.json": {
      schema: 1,
      game: "imposter",
      version: "t",
      dataset: { players: "t" },
      items: [["imp-0001"]],
    },
    "/questions/v/t/imposter/imp-0001.json": {
      schema: 1,
      game: "imposter",
      qid: "imp-0001",
      names: ["LeBron James", "Stephen Curry", "Kevin Durant", "Giannis Antetokounmpo", "Nikola Jokic"],
    },
  },
};
turnGames._setQuestionsForTest(FIXTURE);

// -------------------------------------------------------------- test harness
const log = [];
function line(s) {
  log.push(s);
  console.log(s);
}

// A fake room shaped exactly like index.js's makeRoom output (only the fields
// turnGames touches). turnState emissions are captured per uid.
function makeRoom(code, members, gameId) {
  return {
    code,
    gameId,
    game: { id: gameId, name: gameId },
    members: [...members],
    scores: Object.fromEntries(members.map((m) => [m, null])),
    times: Object.fromEntries(members.map((m) => [m, null])),
    phase: "intro",
    turn: null,
    turnTimer: null,
    _last: {}, // uid -> last turnState state (test-only capture)
  };
}

let settled = null;
function makeHelpers(room) {
  return {
    toUid(uid, event, payload) {
      if (event === "turnState") room._last[uid] = payload.state;
      if (event === "turnReject") line(`   reject -> ${uid}: ${payload.message}`);
    },
    reject(uid, message) {
      line(`   reject -> ${uid}: ${message}`);
    },
    settleMatch(r) {
      r.phase = "results";
      const standings = r.members
        .map((uid) => ({ uid, score: r.scores[uid] ?? 0 }))
        .sort((a, b) => b.score - a.score);
      const best = standings[0].score;
      settled = standings.map((s) => ({
        ...s,
        outcome: s.score === best ? (standings.filter((x) => x.score === best).length > 1 ? "tie" : "win") : "loss",
      }));
      line(`   settleMatch -> ${settled.map((s) => `${s.uid}:${s.score}(${s.outcome})`).join("  ")}`);
    },
    nameOf: (uid) => uid,
    isOnline: () => true,
  };
}

// ============================================================== TIC-TAC-TOE
// Alice wins the top row (cells 0,1,2) with Bob filling in between; every
// claimed id is drawn from TTT_VALID so no name doubles up on the board.
async function simTicTacToe() {
  line("\n================ TIC-TAC-TOE (2 players) ================");
  const room = makeRoom(111111, ["Alice", "Bob"], "tictactoe");
  const helpers = makeHelpers(room);
  await turnGames.init(room, helpers);

  const st = room.turn.state;
  line(`rows: ${st.criteria.rows.map((c) => c.label).join(" | ")}`);
  line(`cols: ${st.criteria.cols.map((c) => c.label).join(" | ")}`);
  line(`first turn: ${st.turnUid}`);

  // cell -> playerName to claim it with (id chosen from TTT_VALID[cell], no reuse).
  const claimPlan = {
    0: "Kobe Bryant",     // TTT_VALID[0] = [1,2]
    1: "Tim Duncan",      // TTT_VALID[1] = [3,4]
    2: "Dirk Nowitzki",   // TTT_VALID[2] = [5,6]
    3: "Magic Johnson",   // TTT_VALID[3] = [7,8]
    5: "Larry Bird",      // TTT_VALID[5] = [2,8]
  };
  const plan = { Alice: [0, 1, 2], Bob: [3, 5] };
  let guard = 0;
  while (!st.winnerUid && !st.draw && guard++ < 12) {
    const uid = st.turnUid;
    const cell = plan[uid].shift();
    if (cell === undefined) {
      throw new Error(`sim plan exhausted for ${uid} before a winner emerged — no progress possible`);
    }
    const name = claimPlan[cell];
    line(`${uid} claims cell ${cell} with "${name}"`);
    turnGames.handleAction(room, uid, { type: "claim", cell, playerName: name }, helpers);
  }

  line(`\nBoard owners: [${room.turn.state.board.map((c) => (c ? c.ownerUid[0] : "·")).join(" ")}]`);
  line(`winnerUid: ${room.turn.state.winnerUid}   draw: ${room.turn.state.draw}`);
  line(`final scores: ${JSON.stringify(room.scores)}`);
  return !!room.turn.state.winnerUid;
}

// ===================================================== ID-LOOKUP VALIDATION
// A fresh room, exercising handleTTT's answer validation directly:
//   1. "Shaq" on a cell whose valid[] contains id 3 succeeds and canonicalises
//      to "Shaquille O'Neal" (alias resolved via questions.nameLookup).
//   2. The same player claimed again on a DIFFERENT cell that also accepts id 3
//      is rejected — "already on the board" (mirrors solo mode: a player fills
//      at most one cell).
//   3. A name with no id at all is rejected — "doesn't fit that square."
async function simTTTValidation() {
  line("\n================ TIC-TAC-TOE (id-lookup validation) ================");
  const room = makeRoom(444444, ["Ivy", "Jon"], "tictactoe");
  const helpers = makeHelpers(room);
  await turnGames.init(room, helpers);
  const st = room.turn.state;

  // TTT_VALID[1] = [3,4]: "Shaq" resolves to id 3 -> canonical "Shaquille O'Neal".
  line(`${st.turnUid} claims cell 1 with "Shaq"`);
  turnGames.handleAction(room, st.turnUid, { type: "claim", cell: 1, playerName: "Shaq" }, helpers);
  const canonicalised = st.board[1]?.playerName === "Shaquille O'Neal";
  line(`cell 1 canonicalised to "${st.board[1]?.playerName}": ${canonicalised ? "PASS" : "FAIL"}`);

  // TTT_VALID[4] = [3,9]: id 3 is a legal fit here too, but Shaquille O'Neal is
  // already on the board (cell 1) -> rejected regardless of who claims it.
  line(`${st.turnUid} claims cell 4 with "Shaquille O'Neal" (already on the board)`);
  turnGames.handleAction(room, st.turnUid, { type: "claim", cell: 4, playerName: "Shaquille O'Neal" }, helpers);
  const usedRejected = st.board[4] === null;
  line(`cell 4 stayed empty: ${usedRejected ? "PASS" : "FAIL"}`);

  // TTT_VALID[6] = [4,9]: "Random Nobody" isn't in the names table at all.
  line(`${st.turnUid} claims cell 6 with "Random Nobody" (not a real name)`);
  turnGames.handleAction(room, st.turnUid, { type: "claim", cell: 6, playerName: "Random Nobody" }, helpers);
  const unknownRejected = st.board[6] === null;
  line(`cell 6 stayed empty: ${unknownRejected ? "PASS" : "FAIL"}`);

  return canonicalised && usedRejected && unknownRejected;
}

// ================================================================= IMPOSTER
async function simImposter() {
  line("\n================ IMPOSTER (3 players) ================");
  settled = null;
  const room = makeRoom(222222, ["Ivy", "Jon", "Kim"], "imposter");
  const helpers = makeHelpers(room);
  await turnGames.init(room, helpers);

  const t = room.turn;
  const s = t.state;
  const imposter = t.imposterUid;
  line(`mystery player: ${t.mystery.full_name}`);
  line(`imposter (secret): ${imposter}`);
  line(`clue order: ${s.order.join(" -> ")}`);

  // Verify redaction: the imposter must NOT receive the mystery player.
  const impView = room._last[imposter];
  const civilianView = room._last[room.members.find((m) => m !== imposter)];
  line(
    `redaction ok: imposter.mysteryPlayer=${JSON.stringify(impView.mysteryPlayer)}  ` +
      `civilian.mysteryPlayer=${JSON.stringify(civilianView.mysteryPlayer && civilianView.mysteryPlayer.full_name)}  ` +
      `imposterUid(pre-reveal)=${JSON.stringify(impView.imposterUid)}`,
  );

  // --- clue phases (2 rounds) ---
  let guard = 0;
  while (s.phase === "clue" && guard++ < 20) {
    const uid = s.turnUid;
    const text = uid === imposter ? "scorer" : "legend";
    line(`[round ${s.round}] ${uid} clue: "${text}"${uid === imposter ? "  (imposter bluffing)" : ""}`);
    turnGames.handleAction(room, uid, { type: "clue", text }, helpers);
  }

  // --- vote: both civilians finger the imposter; the imposter deflects ---
  line(`\nphase -> ${s.phase}`);
  const civilians = room.members.filter((m) => m !== imposter);
  for (const uid of room.members) {
    const target = uid === imposter ? civilians[0] : imposter;
    line(`${uid} votes for ${target}`);
    turnGames.handleAction(room, uid, { type: "vote", targetUid: target }, helpers);
  }

  // --- reveal + imposter guess ---
  line(`\nphase -> ${s.phase}   caught: ${t.caught}   awaitingGuess: ${t.awaitingGuess}`);
  if (t.awaitingGuess) {
    line(`${imposter} (imposter) guesses the mystery: "${t.mystery.full_name}"`);
    turnGames.handleAction(room, imposter, { type: "guess", playerName: t.mystery.full_name }, helpers);
  }

  line(`\nreveal scores: ${JSON.stringify(s.scores)}`);
  line(`guessCorrect: ${t.guessCorrect}`);
  line(`final room.scores: ${JSON.stringify(room.scores)}`);
  return s.phase === "reveal" && settled != null;
}

(async () => {
  const tttWin = await simTicTacToe();
  const validationOk = await simTTTValidation();
  const impDone = await simImposter();
  line("\n================ RESULT ================");
  line(`Tic-Tac-Toe reached a win        : ${tttWin ? "PASS" : "FAIL"}`);
  line(`Id-lookup validation (all 3)     : ${validationOk ? "PASS" : "FAIL"}`);
  line(`Imposter reached reveal          : ${impDone ? "PASS" : "FAIL"}`);
  process.exit(tttWin && validationOk && impDone ? 0 : 1);
})();
