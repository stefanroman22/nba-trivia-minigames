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

const API_BASE_URL = process.env.API_BASE_URL || "http://localhost:8000";
const PLAYERS_INDEX_URL = `${API_BASE_URL}/trivia/pool/players-index/`;

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
//  players-index — fetched ONCE per process, cached, with graceful fallback
// =========================================================================
let _poolCache = null;   // rows array once loaded
let _poolPromise = null; // in-flight fetch, so concurrent inits share one call

/**
 * Load the curated players-index the server validates TTT answers against and
 * seeds imposter mystery players from. Cached for the process lifetime. On any
 * failure we resolve to null (and log once) so the caller degrades to
 * trust-the-client validation instead of blocking the game.
 */
async function loadPlayersIndex() {
  if (_poolCache) return _poolCache;
  if (_poolPromise) return _poolPromise;
  _poolPromise = fetch(PLAYERS_INDEX_URL)
    .then((r) => {
      if (!r.ok) throw new Error(`players-index ${r.status}`);
      return r.json();
    })
    .then((body) => {
      const rows = Array.isArray(body) ? body : body.pool ?? body.series ?? [];
      if (!rows.length) throw new Error("players-index empty");
      _poolCache = rows;
      console.log(`[turnGames] players-index loaded (${rows.length} players)`);
      return rows;
    })
    .catch((err) => {
      console.warn(
        `[turnGames] players-index unavailable — turn games will trust client answers: ${err.message}`,
      );
      return null; // leaves _poolCache null so a later game retries the fetch
    })
    .finally(() => {
      _poolPromise = null;
    });
  return _poolPromise;
}

/** Test seam: preload the pool so the offline simulation never hits the network. */
function _setPlayersIndexForTest(rows) {
  _poolCache = Array.isArray(rows) && rows.length ? rows : null;
}

// =========================================================================
//  Criteria semantics — a faithful port of src/utils/criteria.ts (contract #3)
//  and the alias normaliser from src/utils/answerMatch.ts. Kept in lockstep so
//  the server accepts exactly what the client would.
// =========================================================================
const CURRENT_YEAR = new Date().getFullYear();

function decadeStart(value) {
  const m = String(value).match(/(\d{4})s$/);
  return m ? parseInt(m[1], 10) : null;
}

/** Does player `p` satisfy criterion `c`? Pure. Mirrors criteria.ts exactly. */
function playerMatches(p, c) {
  switch (c.type) {
    case "team":
      return p.teams.some((t) => t.abbr === c.value);
    case "award": {
      const a = p.awards;
      switch (c.value) {
        case "mvp": return a.mvp.length > 0;
        case "fmvp": return a.fmvp.length > 0;
        case "dpoy": return a.dpoy.length > 0;
        case "roty": return a.roty != null;
        case "smoy": return a.smoy.length > 0;
        case "ring": return a.rings.length > 0;
        case "allstar5plus": return a.allstar_count >= 5;
        case "allnba": return a.allnba_count > 0;
        default: return false;
      }
    }
    case "country":
      if (c.value === "USA") return p.country === "USA";
      if (c.value === "INTL") return p.country !== "USA";
      return p.country === c.value;
    case "draft": {
      if (c.value === "undrafted") return p.draft == null;
      if (!p.draft) return false;
      if (c.value === "top5") return p.draft.pick <= 5;
      if (c.value === "lottery") return p.draft.pick <= 14;
      if (c.value === "round2") return p.draft.round === 2;
      if (c.value.startsWith("decade-")) {
        const d = decadeStart(c.value);
        return d != null && p.draft.year >= d && p.draft.year <= d + 9;
      }
      return false;
    }
    case "college":
      if (c.value === "none") return p.college == null;
      return p.college === c.value;
    case "stat":
      switch (c.value) {
        case "20kpts": return p.career.pts >= 20000;
        case "25kpts": return p.career.pts >= 25000;
        case "ppg20": return p.career.ppg >= 20;
        case "rpg10": return p.career.rpg >= 10;
        case "apg8": return p.career.apg >= 8;
        case "seasons15plus": return p.career.seasons >= 15;
        default: return false;
      }
    case "era": {
      const d = decadeStart(c.value);
      if (d == null) return false;
      return p.teams.some(
        (t) => t.start_year <= d + 9 && (t.end_year ?? CURRENT_YEAR) >= d,
      );
    }
    default:
      return false;
  }
}

/** Lowercase, strip accents + punctuation, collapse whitespace. Mirrors answerMatch.ts. */
function normalizeAnswer(s) {
  return String(s)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/['’.,-]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** First pool player whose full_name or an alias matches the guess, else null. */
function findPlayerByName(pool, name) {
  const n = normalizeAnswer(name);
  if (!n) return null;
  return (
    pool.find(
      (p) =>
        normalizeAnswer(p.full_name) === n ||
        (p.aliases || []).some((a) => normalizeAnswer(a) === n),
    ) || null
  );
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

/** k distinct random elements of arr. */
function pickDistinct(arr, k) {
  return shuffle(arr).slice(0, k);
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
// Candidate non-team criteria for grid columns. Labels track criteria.ts values.
const ATTR_CRITERIA = [
  { type: "award", value: "mvp", label: "MVP" },
  { type: "award", value: "fmvp", label: "Finals MVP" },
  { type: "award", value: "dpoy", label: "Defensive POY" },
  { type: "award", value: "roty", label: "Rookie of the Year" },
  { type: "award", value: "smoy", label: "Sixth Man" },
  { type: "award", value: "ring", label: "Won a ring" },
  { type: "award", value: "allstar5plus", label: "5x+ All-Star" },
  { type: "award", value: "allnba", label: "All-NBA" },
  { type: "country", value: "USA", label: "USA" },
  { type: "country", value: "INTL", label: "International" },
  { type: "era", value: "1990s", label: "Played in the 90s" },
  { type: "era", value: "2000s", label: "Played in the 2000s" },
  { type: "era", value: "2010s", label: "Played in the 2010s" },
  { type: "era", value: "2020s", label: "Played in the 2020s" },
  { type: "draft", value: "top5", label: "Top-5 pick" },
  { type: "draft", value: "lottery", label: "Lottery pick" },
  { type: "draft", value: "round2", label: "2nd-round pick" },
  { type: "draft", value: "undrafted", label: "Undrafted" },
  { type: "stat", value: "20kpts", label: "20,000+ points" },
  { type: "stat", value: "ppg20", label: "20+ PPG career" },
  { type: "stat", value: "rpg10", label: "10+ RPG career" },
  { type: "stat", value: "apg8", label: "8+ APG career" },
  { type: "stat", value: "seasons15plus", label: "15+ seasons" },
];

const TEAM_MIN_PLAYERS = 3; // a team column/row needs at least this many pool players
const ATTR_MIN_PLAYERS = 2;
const GRID_ATTEMPTS = 600;  // random 3x3 tries before falling back

// A generically-solvable board for when the pool is missing (trust-client mode).
function fallbackGrid() {
  return {
    rows: [
      { type: "team", value: "LAL", label: "Lakers" },
      { type: "team", value: "BOS", label: "Celtics" },
      { type: "team", value: "GSW", label: "Warriors" },
    ],
    cols: [
      { type: "award", value: "ring", label: "Won a ring" },
      { type: "award", value: "mvp", label: "MVP" },
      { type: "era", value: "2010s", label: "Played in the 2010s" },
    ],
    validated: false,
  };
}

/** Precompute, per candidate criterion, the set of person_ids that satisfy it. */
function buildMatcherSets(pool) {
  const nameByAbbr = new Map();
  const teamIds = new Map(); // abbr -> Set<person_id>
  for (const p of pool) {
    for (const t of p.teams || []) {
      if (!nameByAbbr.has(t.abbr)) nameByAbbr.set(t.abbr, t.name || t.abbr);
      if (!teamIds.has(t.abbr)) teamIds.set(t.abbr, new Set());
      teamIds.get(t.abbr).add(p.person_id);
    }
  }
  const teamCrits = [];
  for (const [abbr, set] of teamIds) {
    if (set.size >= TEAM_MIN_PLAYERS) {
      teamCrits.push({ crit: { type: "team", value: abbr, label: nameByAbbr.get(abbr) }, set });
    }
  }
  const attrCrits = [];
  for (const crit of ATTR_CRITERIA) {
    const set = new Set();
    for (const p of pool) if (playerMatches(p, crit)) set.add(p.person_id);
    if (set.size >= ATTR_MIN_PLAYERS) attrCrits.push({ crit, set });
  }
  return { teamCrits, attrCrits };
}

/** Do the two person_id sets share at least one player? */
function setsIntersect(a, b) {
  const [small, big] = a.size <= b.size ? [a, b] : [b, a];
  for (const id of small) if (big.has(id)) return true;
  return false;
}

/**
 * Build a solvable board: teams down the rows, categories across the columns,
 * every one of the 9 intersections satisfiable by a real pool player. Falls
 * back to a static board (trust-client) if the pool is thin or generation misses.
 */
function generateGrid(pool) {
  if (!pool || !pool.length) return fallbackGrid();
  const { teamCrits, attrCrits } = buildMatcherSets(pool);
  if (teamCrits.length < 3 || attrCrits.length < 3) return fallbackGrid();
  for (let attempt = 0; attempt < GRID_ATTEMPTS; attempt++) {
    const rows = pickDistinct(teamCrits, 3);
    const cols = pickDistinct(attrCrits, 3);
    let ok = true;
    for (let r = 0; r < 3 && ok; r++) {
      for (let c = 0; c < 3 && ok; c++) {
        if (!setsIntersect(rows[r].set, cols[c].set)) ok = false;
      }
    }
    if (ok) {
      return { rows: rows.map((x) => x.crit), cols: cols.map((x) => x.crit), validated: true };
    }
  }
  return fallbackGrid();
}

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
  const pool = await loadPlayersIndex();
  const grid = generateGrid(pool);
  const state = {
    board: Array(9).fill(null),
    criteria: { rows: grid.rows, cols: grid.cols },
    turnUid: room.members[0],
    deadlineTs: Date.now() + TTT_TURN_MS,
    stealsLeft: Object.fromEntries(room.members.map((m) => [m, TTT_STEALS])),
    winnerUid: null,
    draw: false,
  };
  // trust the client only when we could not build a pool-validated board.
  room.turn = { game: "tictactoe", state, pool, trustClient: !grid.validated };
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

  const row = Math.floor(cell / 3);
  const col = cell % 3;
  const rowCrit = s.criteria.rows[row];
  const colCrit = s.criteria.cols[col];
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

  // --- answer validation (pool when we have it, else trust the client) ---
  let displayName = name;
  if (t.trustClient) {
    // pool unreachable: accept the client's (already client-validated) answer.
  } else {
    const player = findPlayerByName(t.pool, name);
    if (!player || !playerMatches(player, rowCrit) || !playerMatches(player, colCrit)) {
      return helpers.reject(uid, `${name} doesn't fit that square.`);
    }
    displayName = player.full_name; // canonicalise (handles aliases / casing)
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
// Famous-player fallback pool for when players-index is unreachable.
const FALLBACK_MYSTERY = [
  { full_name: "LeBron James", aliases: ["LeBron", "King James", "Bron"] },
  { full_name: "Stephen Curry", aliases: ["Steph Curry", "Steph", "Chef Curry"] },
  { full_name: "Kevin Durant", aliases: ["KD", "Durant"] },
  { full_name: "Giannis Antetokounmpo", aliases: ["Giannis", "Greek Freak"] },
  { full_name: "Michael Jordan", aliases: ["MJ", "Jordan", "Air Jordan"] },
  { full_name: "Kobe Bryant", aliases: ["Kobe", "Black Mamba", "Mamba"] },
  { full_name: "Shaquille O'Neal", aliases: ["Shaq", "Shaquille O Neal"] },
  { full_name: "Tim Duncan", aliases: ["Duncan", "The Big Fundamental"] },
  { full_name: "Nikola Jokic", aliases: ["Jokic", "Joker"] },
  { full_name: "Luka Doncic", aliases: ["Luka", "Doncic"] },
  { full_name: "Kevin Garnett", aliases: ["KG", "Garnett", "The Big Ticket"] },
  { full_name: "Dirk Nowitzki", aliases: ["Dirk", "Nowitzki"] },
];

/** Pick a well-known mystery player (pool tier 1-2 preferred, else fallback). */
function pickMystery(pool) {
  if (pool && pool.length) {
    const famous = pool.filter((p) => (p.fame_tier || 4) <= 2);
    const from = famous.length ? famous : pool;
    const p = from[Math.floor(Math.random() * from.length)];
    return { full_name: p.full_name, aliases: p.aliases || [], person_id: p.person_id ?? null };
  }
  const p = FALLBACK_MYSTERY[Math.floor(Math.random() * FALLBACK_MYSTERY.length)];
  return { full_name: p.full_name, aliases: p.aliases, person_id: null };
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
  const pool = await loadPlayersIndex();
  const mystery = pickMystery(pool);
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
    pool,
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
  _setPlayersIndexForTest,
  _test: { playerMatches, normalizeAnswer, findPlayerByName, generateGrid, matchesMystery, tttWinner },
};
