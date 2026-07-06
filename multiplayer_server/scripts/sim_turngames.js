// multiplayer_server/scripts/sim_turngames.js
//
// Standalone, no-network simulation of the two turn-based games in turnGames.js.
// It stubs the `helpers` bag index.js normally lends the module, injects a
// synthetic players-index (so grid generation + answer validation run for real
// without touching the Django backend), then:
//   1. drives a 2-player Tic-Tac-Toe to a win, and
//   2. drives a 3-player Imposter to the reveal (imposter caught, guesses right).
//
// Run:  node scripts/sim_turngames.js
const turnGames = require("../src/turnGames");
const { playerMatches } = turnGames._test;

// ------------------------------------------------------------------ pool
// A synthetic curated pool: 5 franchises x 8 players, attributes fanned out so
// every team x category intersection the grid generator might pick is solvable.
const TEAMS = [
  ["LAL", "Lakers"],
  ["BOS", "Celtics"],
  ["GSW", "Warriors"],
  ["MIA", "Heat"],
  ["CHI", "Bulls"],
];
function buildPool() {
  const rows = [];
  let id = 1;
  for (const [abbr, name] of TEAMS) {
    for (let k = 0; k < 8; k++) {
      const start = 1990 + k * 4; // 1990..2018 -> 1990s..2010s eras
      rows.push({
        person_id: id,
        full_name: `${abbr} Player ${k}`,
        aliases: [`${abbr}${k}`],
        fame_tier: k < 2 ? 1 : k < 4 ? 2 : 3,
        position: "G",
        country: k % 3 === 0 ? "Spain" : "USA",
        college: k % 2 === 0 ? "Duke" : null,
        draft:
          k >= 6
            ? { year: start, round: 2, pick: 34 + k }
            : { year: start, round: 1, pick: 1 + k * 3 },
        is_active: start >= 2015,
        teams: [{ abbr, name, start_year: start, end_year: start + 5, gp: 400, ppg: 15 }],
        awards: {
          mvp: k === 1 ? [start + 2] : [],
          fmvp: k === 2 ? [start + 3] : [],
          dpoy: k === 3 ? [start + 2] : [],
          roty: k === 4 ? start + 1 : null,
          smoy: k === 5 ? [start + 2] : [],
          allstar_count: k, // k>=5 satisfies allstar5plus
          allnba_count: k % 2,
          rings: k % 2 === 0 ? [start + 3] : [],
        },
        career: {
          pts: 15000 + k * 3000, // some >= 20k / 25k
          reb: 4000 + k * 800,
          ast: 2000 + k * 700,
          ppg: 12 + k * 2, // some >= 20
          rpg: 4 + k, // some >= 10
          apg: 2 + k, // some >= 8
          seasons: 8 + k, // some >= 15
        },
      });
      id += 1;
    }
  }
  return rows;
}
const POOL = buildPool();
turnGames._setPlayersIndexForTest(POOL);

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

// Find any pool player satisfying both criteria (guaranteed to exist because the
// generator only emits solvable cells).
function playerForCell(rowCrit, colCrit) {
  const p = POOL.find((pl) => playerMatches(pl, rowCrit) && playerMatches(pl, colCrit));
  return p ? p.full_name : null;
}

// ============================================================== TIC-TAC-TOE
async function simTicTacToe() {
  line("\n================ TIC-TAC-TOE (2 players) ================");
  const room = makeRoom(111111, ["Alice", "Bob"], "tictactoe");
  const helpers = makeHelpers(room);
  await turnGames.init(room, helpers);

  const st = room.turn.state;
  line(`rows: ${st.criteria.rows.map((c) => c.label).join(" | ")}`);
  line(`cols: ${st.criteria.cols.map((c) => c.label).join(" | ")}`);
  line(`validated grid: ${!room.turn.trustClient}   first turn: ${st.turnUid}`);

  // Plan: Alice takes the top row (0,1,2) for the win; Bob takes filler squares.
  const plan = { Alice: [0, 1, 2], Bob: [3, 5] };
  let guard = 0;
  while (!st.winnerUid && !st.draw && guard++ < 12) {
    const uid = st.turnUid;
    const cell = plan[uid].shift();
    const row = Math.floor(cell / 3);
    const col = cell % 3;
    const name = playerForCell(st.criteria.rows[row], st.criteria.cols[col]);
    line(`${uid} claims cell ${cell} with "${name}"`);
    turnGames.handleAction(room, uid, { type: "claim", cell, playerName: name }, helpers);
  }

  line(`\nBoard owners: [${room.turn.state.board.map((c) => (c ? c.ownerUid[0] : "·")).join(" ")}]`);
  line(`winnerUid: ${room.turn.state.winnerUid}   draw: ${room.turn.state.draw}`);
  line(`final scores: ${JSON.stringify(room.scores)}`);
  return !!room.turn.state.winnerUid;
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
  const impDone = await simImposter();
  line("\n================ RESULT ================");
  line(`Tic-Tac-Toe reached a win : ${tttWin ? "PASS" : "FAIL"}`);
  line(`Imposter reached reveal   : ${impDone ? "PASS" : "FAIL"}`);
  process.exit(tttWin && impDone ? 0 : 1);
})();
