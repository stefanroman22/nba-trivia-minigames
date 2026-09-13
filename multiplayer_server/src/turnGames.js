// multiplayer_server/src/turnGames.js
//
// Server-authoritative logic for the two TURN-BASED multiplayer games — NBA
// Tic-Tac-Toe ("tictactoe") and NBA Imposter ("imposter"). Everything else in
// the server is "everyone plays the same round, submit a score at the end";
// these two instead take turns, so the server owns a running `state` per room
// and broadcasts it after every action (frozen contract #6).
//
// Public surface (consumed by index.js — the only file allowed to call in):
//   roomConfigFor(gameId)            -> { capacity, min }   (friend-room sizing)
//   init(room, helpers)              -> start a turn game in a live room
//   handleAction(room, uid, action, helpers)  -> apply a client turnAction
//   onDisconnect(room, uid, helpers) -> a dropped player's turn auto-passes
//   resumeFor(room, uid, helpers)    -> re-push the current turnState on reconnect
//   clearTimers(room)                -> cancel the room's pending turn timer
//
// The `helpers` bag is index.js lending us its socket plumbing so we never touch
// its private maps directly:
//   helpers.toUid(uid, event, payload)  emit to one player (no-op if offline)
//   helpers.reject(uid, message)        private "that didn't work" feedback
//   helpers.settleMatch(room)           end the game via the shared scoreboard path
//   helpers.nameOf(uid)                 display name for a uid
//   helpers.isOnline(uid)               is this uid currently connected
//
// State shapes are VERBATIM from contract #6; a handful of clearly-named extra
// fields (turnUid / deadlineTs / youAreImposter / caught / …) are added on top
// so the client can render a countdown and role without re-deriving them. The
// client reads turnState as `any`, so extra fields are harmless.

const questions = require("./questions");
const { normalizeAnswer } = require("./answerMatch");

// --- Tunables -------------------------------------------------------------
const TTT_TURN_MS = 25000;       // per-turn clock; timeout = pass (contract #6)
const IMPOSTER_STEP_MS = 45000;  // per phase-step clock (clue / vote / guess)
const REVEAL_MS = 6000;          // reveal screen before the results scoreboard
const TTT_STEALS = 3;            // steals each player starts with
const IMPOSTER_CLUE_ROUNDS = 2;  // 2 clue rounds, then the vote

// TTT match scoring (fed into room.scores -> the shared rankRoom/settleMatch).
const TTT_WIN_SCORE = 225;       // matches the game's maxPoints
const TTT_LOSS_SCORE = 90;
const TTT_DRAW_SCORE = 150;

// Friend-room sizing per game. Everything not listed is a plain 2-player room.
const ROOM_CONFIGS = { imposter: { capacity: 5, min: 3 } };
const DEFAULT_ROOM_CONFIG = { capacity: 2, min: 2 };

/** Friend-room { capacity, min } for a game id (imposter is 3-5; else 2). */
function roomConfigFor(gameId) {
  return ROOM_CONFIGS[gameId] || DEFAULT_ROOM_CONFIG;
}

// =========================================================================
//  Small utilities
// =========================================================================
function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** The member whose turn comes after `uid` (rotates through room.members). */
function nextMember(room, uid) {
  const i = room.members.indexOf(uid);
  return room.members[(i + 1) % room.members.length];
}

// =========================================================================
//  Turn timers — one handle per room (room.turnTimer). index.js clears it in
//  destroyRoom too; we always clear before re-arming so there is never a leak.
// =========================================================================
function clearTimers(room) {
  if (room.turnTimer) {
    clearTimeout(room.turnTimer);
    room.turnTimer = null;
  }
}

function armTurnTimer(room, helpers) {
  clearTimers(room);
  const ms = room.turn && room.turn.game === "imposter" ? IMPOSTER_STEP_MS : TTT_TURN_MS;
  room.turnTimer = setTimeout(() => {
    try {
      onTimeout(room, helpers);
    } catch (e) {
      console.error(`[turnGames] timeout handler failed for room ${room.code}:`, e);
    }
  }, ms);
  if (room.turnTimer.unref) room.turnTimer.unref();
}

function onTimeout(room, helpers) {
  if (!room.turn) return;
  if (room.turn.game === "tictactoe") return tttTimeout(room, helpers);
  return imposterTimeout(room, helpers);
}

// =========================================================================
//  Broadcast — full authoritative state after every change (per-uid redaction
//  for imposter so the imposter never receives the mystery player / their role
//  is only their own to see).
// =========================================================================
function broadcastTurnState(room, helpers) {
  const t = room.turn;
  if (!t) return;
  room.members.forEach((uid) => {
    const state = t.game === "imposter" ? imposterStateFor(room, uid) : t.state;
    helpers.toUid(uid, "turnState", { code: room.code, game: t.game, state });
  });
}

/** Re-send the current turnState to a single (reconnecting) player. */
function resumeFor(room, uid, helpers) {
  const t = room.turn;
  if (!t) return;
  const state = t.game === "imposter" ? imposterStateFor(room, uid) : t.state;
  helpers.toUid(uid, "turnState", { code: room.code, game: t.game, state });
}

// =========================================================================
//  Dispatch
// =========================================================================
async function init(room, helpers) {
  // Turn games reset the shared score/time maps themselves (they never go
  // through dealRound's reset) and mark the room live before the first broadcast.
  room.scores = Object.fromEntries(room.members.map((m) => [m, null]));
  room.times = Object.fromEntries(room.members.map((m) => [m, null]));
  room.phase = "playing";
  if (room.gameId === "tictactoe") return initTTT(room, helpers);
  if (room.gameId === "imposter") return initImposter(room, helpers);
}

function handleAction(room, uid, action, helpers) {
  if (!room.turn || !action || typeof action !== "object") return;
  if (room.turn.game === "tictactoe") return handleTTT(room, uid, action, helpers);
  if (room.turn.game === "imposter") return handleImposter(room, uid, action, helpers);
}

function onDisconnect(room, uid, helpers) {
  const t = room.turn;
  if (!t) return;
  const s = t.state;
  if (t.game === "tictactoe") {
    if (s.winnerUid || s.draw) return;
    if (s.turnUid === uid) {
      s.turnUid = nextMember(room, uid);
      s.deadlineTs = Date.now() + TTT_TURN_MS;
      armTurnTimer(room, helpers);
      broadcastTurnState(room, helpers);
    }
    return;
  }
  // imposter: only auto-advance the step actually blocked on this player.
  if (s.phase === "clue" && s.turnUid === uid) {
    s.clues.push({ uid, text: "—" });
    afterClue(room, helpers);
  } else if (s.phase === "vote") {
    if (voteComplete(room, helpers)) resolveVote(room, helpers);
  } else if (s.phase === "reveal" && t.awaitingGuess && uid === t.imposterUid) {
    t.awaitingGuess = false;
    finalizeImposter(room, helpers);
  }
}

// =========================================================================
//  NBA TIC-TAC-TOE
// =========================================================================
/** The three winning cell-lines of a 3x3 board. */
const TTT_LINES = [
  [0, 1, 2], [3, 4, 5], [6, 7, 8],
  [0, 3, 6], [1, 4, 7], [2, 5, 8],
  [0, 4, 8], [2, 4, 6],
];

/** ownerUid of a completed line, or null. */
function tttWinner(board) {
  for (const [a, b, c] of TTT_LINES) {
    const o = board[a] && board[a].ownerUid;
    if (o && board[b] && board[b].ownerUid === o && board[c] && board[c].ownerUid === o) {
      return o;
    }
  }
  return null;
}

async function initTTT(room, helpers) {
  const [question, names] = await Promise.all([questions.deal("tictactoe"), questions.loadNames()]);
  const state = {
    board: Array(9).fill(null),
    criteria: { rows: question.rows, cols: question.cols },
    turnUid: room.members[0],
    deadlineTs: Date.now() + TTT_TURN_MS,
    stealsLeft: Object.fromEntries(room.members.map((m) => [m, TTT_STEALS])),
    winnerUid: null,
    draw: false,
  };
  room.turn = { game: "tictactoe", state, valid: question.valid, lookup: questions.nameLookup(names), trustClient: false };
  armTurnTimer(room, helpers);
  broadcastTurnState(room, helpers);
}

function tttTimeout(room, helpers) {
  const s = room.turn.state;
  if (s.winnerUid || s.draw) return;
  s.turnUid = nextMember(room, s.turnUid);
  s.deadlineTs = Date.now() + TTT_TURN_MS;
  armTurnTimer(room, helpers);
  broadcastTurnState(room, helpers);
}

function handleTTT(room, uid, action, helpers) {
  const t = room.turn;
  const s = t.state;
  if (s.winnerUid || s.draw) return; // game already over
  if (uid !== s.turnUid) return helpers.reject(uid, "It isn't your turn.");

  const cell = Number(action.cell);
  if (!Number.isInteger(cell) || cell < 0 || cell > 8) {
    return helpers.reject(uid, "Pick a square on the board.");
  }
  const name = String(action.playerName || "").trim();
  if (!name) return helpers.reject(uid, "Type a player's name.");

  const existing = s.board[cell];

  // --- claim / steal legality (before we validate the name) ---
  if (action.type === "claim") {
    if (existing) {
      return helpers.reject(
        uid,
        existing.ownerUid === uid ? "You already own that square." : "Taken — steal it instead.",
      );
    }
  } else if (action.type === "steal") {
    if (!existing) return helpers.reject(uid, "Nothing to steal there — claim it.");
    if (existing.ownerUid === uid) return helpers.reject(uid, "You already own that square.");
    if ((s.stealsLeft[uid] || 0) <= 0) return helpers.reject(uid, "No steals left.");
    if (normalizeAnswer(name) === normalizeAnswer(existing.playerName)) {
      return helpers.reject(uid, "Name a different player to steal it.");
    }
  } else {
    return helpers.reject(uid, "Unknown move.");
  }

  // --- answer validation (id lookup against the pre-generated question's valid[cell]) ---
  const id = t.lookup.toId(name);
  if (id === null || !t.valid[cell].includes(id)) {
    return helpers.reject(uid, `${name} doesn't fit that square.`);
  }
  const displayName = t.lookup.nameOf(id); // canonicalise (handles aliases / casing)

  // --- used-player check (mirrors solo mode: a real player fills at most one
  // cell on the board, even across the two duelling players) ---
  const usedElsewhere = s.board.some(
    (occ, idx) => idx !== cell && occ && normalizeAnswer(occ.playerName) === normalizeAnswer(displayName),
  );
  if (usedElsewhere) {
    return helpers.reject(uid, `${displayName} is already on the board.`);
  }

  // --- apply the move ---
  s.board[cell] = { ownerUid: uid, playerName: displayName };
  if (action.type === "steal") s.stealsLeft[uid] -= 1;

  const winner = tttWinner(s.board);
  if (winner) {
    s.winnerUid = winner;
  } else if (s.board.every(Boolean)) {
    s.draw = true;
  } else {
    s.turnUid = nextMember(room, uid);
    s.deadlineTs = Date.now() + TTT_TURN_MS;
  }

  if (s.winnerUid || s.draw) {
    endTTT(room, helpers);
  } else {
    armTurnTimer(room, helpers);
    broadcastTurnState(room, helpers);
  }
}

function endTTT(room, helpers) {
  clearTimers(room);
  const s = room.turn.state;
  if (s.draw) {
    room.members.forEach((m) => { room.scores[m] = TTT_DRAW_SCORE; });
  } else {
    room.members.forEach((m) => {
      room.scores[m] = m === s.winnerUid ? TTT_WIN_SCORE : TTT_LOSS_SCORE;
    });
  }
  broadcastTurnState(room, helpers); // final board with winnerUid/draw set
  helpers.settleMatch(room);
}

// =========================================================================
//  NBA IMPOSTER
// =========================================================================
/** Pick a random mystery player from the pre-generated imposter question's name pool. */
async function pickMystery() {
  const q = await questions.deal("imposter");
  const pool = q.names;
  const name = pool[Math.floor(Math.random() * pool.length)];
  return { full_name: name, aliases: [], person_id: null };
}

/** True if a free-text guess names the mystery player (by name or alias). */
function matchesMystery(mystery, guess) {
  const n = normalizeAnswer(guess);
  if (!n) return false;
  if (normalizeAnswer(mystery.full_name) === n) return true;
  return (mystery.aliases || []).some((a) => normalizeAnswer(a) === n);
}

/** Per-uid imposter state: redacts the mystery player from the imposter and the
 *  imposter's identity from everyone until the reveal. */
function imposterStateFor(room, uid) {
  const t = room.turn;
  const s = t.state;
  const reveal = s.phase === "reveal";
  const isImposter = uid === t.imposterUid;
  return {
    // --- contract #6 fields (verbatim) ---
    phase: s.phase,
    round: s.round,
    order: s.order,
    clues: s.clues,
    votes: s.votes,
    mysteryPlayer: reveal || !isImposter ? s.mysteryPlayer : null,
    imposterUid: reveal ? t.imposterUid : null,
    scores: s.scores,
    // --- convenience extras (per-uid safe; client reads state as any) ---
    turnUid: s.turnUid ?? null,
    deadlineTs: s.deadlineTs ?? null,
    youAreImposter: isImposter,
    caught: reveal ? !!t.caught : null,
    awaitingGuess: reveal ? !!t.awaitingGuess : false,
    imposterGuess: reveal ? t.imposterGuess ?? null : null,
    guessCorrect: reveal ? t.guessCorrect ?? null : null,
  };
}

async function initImposter(room, helpers) {
  const mystery = await pickMystery();
  const members = [...room.members];
  const imposterUid = members[Math.floor(Math.random() * members.length)];
  const order = shuffle(members); // clue-speaking order
  const state = {
    phase: "clue",
    round: 1,
    order,
    clues: [],
    votes: {},
    mysteryPlayer: { full_name: mystery.full_name, person_id: mystery.person_id },
    scores: Object.fromEntries(members.map((m) => [m, 0])),
    turnUid: order[0],
    deadlineTs: Date.now() + IMPOSTER_STEP_MS,
  };
  room.turn = {
    game: "imposter",
    state,
    imposterUid,
    mystery,
    caught: false,
    awaitingGuess: false,
    imposterGuess: null,
    guessCorrect: null,
  };
  armTurnTimer(room, helpers);
  broadcastTurnState(room, helpers);
}

/** After a clue is recorded: advance to the next speaker, next round, or the vote. */
function afterClue(room, helpers) {
  const s = room.turn.state;
  const n = s.order.length;
  const given = s.clues.length;
  if (given >= IMPOSTER_CLUE_ROUNDS * n) {
    s.phase = "vote";
    s.round = IMPOSTER_CLUE_ROUNDS;
    s.turnUid = null;
    s.deadlineTs = Date.now() + IMPOSTER_STEP_MS;
  } else {
    s.round = Math.floor(given / n) + 1;
    s.turnUid = s.order[given % n];
    s.deadlineTs = Date.now() + IMPOSTER_STEP_MS;
  }
  armTurnTimer(room, helpers);
  broadcastTurnState(room, helpers);
}

/** Vote step is done once every still-connected member has cast a vote. */
function voteComplete(room, helpers) {
  const votes = room.turn.state.votes;
  return room.members.every((m) => votes[m] != null || !helpers.isOnline(m));
}

function handleImposter(room, uid, action, helpers) {
  const t = room.turn;
  const s = t.state;

  if (action.type === "clue") {
    if (s.phase !== "clue") return helpers.reject(uid, "Not the clue phase.");
    if (uid !== s.turnUid) return helpers.reject(uid, "Wait for your turn to give a clue.");
    const text = String(action.text || "").trim().slice(0, 30);
    if (!text) return helpers.reject(uid, "Type a one-word clue.");
    s.clues.push({ uid, text });
    afterClue(room, helpers);
    return;
  }

  if (action.type === "vote") {
    if (s.phase !== "vote") return helpers.reject(uid, "Not the voting phase.");
    if (s.votes[uid] != null) return helpers.reject(uid, "You already voted.");
    const target = action.targetUid;
    if (!room.members.includes(target)) return helpers.reject(uid, "Pick a player to vote for.");
    if (target === uid) return helpers.reject(uid, "You can't vote for yourself.");
    s.votes[uid] = target;
    broadcastTurnState(room, helpers);
    if (voteComplete(room, helpers)) resolveVote(room, helpers);
    return;
  }

  if (action.type === "guess") {
    if (s.phase !== "reveal" || !t.awaitingGuess) return helpers.reject(uid, "No guess to make.");
    if (uid !== t.imposterUid) return helpers.reject(uid, "Only the imposter guesses.");
    const guess = String(action.playerName || "").trim();
    if (!guess) return helpers.reject(uid, "Name the mystery player.");
    const right = matchesMystery(t.mystery, guess);
    if (right) s.scores[t.imposterUid] += 3; // caught but nailed the reveal
    t.imposterGuess = guess;
    t.guessCorrect = right;
    t.awaitingGuess = false;
    finalizeImposter(room, helpers);
    return;
  }

  helpers.reject(uid, "Unknown move.");
}

/** Tally the vote, score it, and move into the reveal. */
function resolveVote(room, helpers) {
  clearTimers(room);
  const t = room.turn;
  const s = t.state;
  const imposter = t.imposterUid;

  const tally = Object.fromEntries(room.members.map((m) => [m, 0]));
  for (const target of Object.values(s.votes)) {
    if (tally[target] != null) tally[target] += 1;
  }
  const maxVotes = Math.max(0, ...room.members.map((m) => tally[m]));
  const imposterVotes = tally[imposter] || 0;
  const caught = imposterVotes > 0 && imposterVotes === maxVotes; // ties count as caught

  // Every non-imposter who fingered the imposter scores +1.
  room.members.forEach((m) => {
    if (m !== imposter && s.votes[m] === imposter) s.scores[m] += 1;
  });

  t.caught = caught;
  s.phase = "reveal";
  s.round = IMPOSTER_CLUE_ROUNDS;
  s.turnUid = null;

  if (caught) {
    // The imposter gets one shot at naming the mystery player for redemption.
    t.awaitingGuess = true;
    s.deadlineTs = Date.now() + IMPOSTER_STEP_MS;
    armTurnTimer(room, helpers);
    broadcastTurnState(room, helpers);
  } else {
    // Survived: +1 for every non-imposter who failed to catch them.
    const wrong = room.members.filter((m) => m !== imposter && s.votes[m] !== imposter).length;
    s.scores[imposter] += wrong;
    t.awaitingGuess = false;
    s.deadlineTs = Date.now() + REVEAL_MS;
    broadcastTurnState(room, helpers);
    room.turnTimer = setTimeout(() => {
      try {
        finalizeImposter(room, helpers);
      } catch (e) {
        console.error(`[turnGames] reveal settle failed for room ${room.code}:`, e);
      }
    }, REVEAL_MS);
    if (room.turnTimer.unref) room.turnTimer.unref();
  }
}

function finalizeImposter(room, helpers) {
  clearTimers(room);
  const s = room.turn.state;
  room.members.forEach((m) => { room.scores[m] = s.scores[m] ?? 0; });
  broadcastTurnState(room, helpers); // final reveal (with the guess result)
  helpers.settleMatch(room);
}

function imposterTimeout(room, helpers) {
  const t = room.turn;
  const s = t.state;
  if (s.phase === "clue") {
    if (s.turnUid) s.clues.push({ uid: s.turnUid, text: "—" });
    afterClue(room, helpers);
  } else if (s.phase === "vote") {
    resolveVote(room, helpers);
  } else if (s.phase === "reveal" && t.awaitingGuess) {
    t.awaitingGuess = false;
    finalizeImposter(room, helpers);
  }
}

module.exports = {
  roomConfigFor,
  init,
  handleAction,
  onDisconnect,
  resumeFor,
  clearTimers,
  // test seams (used by scripts/sim_turngames.js — no network in the sim)
  _setQuestionsForTest: questions._setForTest,
  _test: { normalizeAnswer, matchesMystery, tttWinner },
};
