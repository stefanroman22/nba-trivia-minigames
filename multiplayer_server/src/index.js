// multiplayer_server/src/index.js
//
// Realtime match server for the NBA minigames: random 1v1 matchmaking and
// private "play with a friend" rooms (share-code lobbies for 2-4 players, the host
// picks the size). Rooms are N-player throughout — matchmaking rooms hold 2 members,
// friend rooms hold what the host chose, within the game's bounds (turnGames.roomConfigFor).
//
// Design notes
// ------------
// Players are keyed by a STABLE identity (`uid`, the account's permanent public
// id as Django's /api/me/ reports it for the socket's access token — see
// identity.js; never the client's own claim) rather than by socket.id, because
// socket ids change on every reconnect. Keying by uid is what makes the robustness features possible:
//
//   • Reconnect / resume  — a dropped player keeps their seat for GRACE_MS; when
//     a socket re-identifies with the same uid we re-join it to the room and push
//     a full `resumeMatch` snapshot so the client lands exactly where it left off.
//   • Disconnect grace    — the opponent is told "disconnected, reconnecting…"
//     and only after GRACE_MS (or an explicit leave) does the match cancel.
//   • Play-again / switch  — unified "proposal" handshake: one side proposes,
//     everyone else must accept before a new round starts. Switching games does
//     NOT require re-queuing — the players stay in their room.
//   • Friend rooms        — the host creates a lobby and gets a 6-digit code;
//     friends join with the code and the host starts the room from the lobby
//     (see startRoomNow). The host can cancel or change the game while
//     waiting; if anyone leaves (lobby or match) the room is cancelled for
//     everyone.
//
// Scale notes (millions of concurrent rooms)
// ------------------------------------------
// Every hot path is O(1): rooms are hash-map lookups by code, codes come from a
// bounded crypto-random allocator (no scans, uniform over the 900k code space),
// lobbies self-expire (LOBBY_TTL_MS) so abandoned codes recycle, and join
// attempts are rate-limited per socket so codes can't be brute-forced. The
// 6-digit space caps ACTIVE rooms at ~900k; past that the allocator reports
// "busy" — widening the code is a one-line change. To scale horizontally, move
// `players`/`rooms` into Redis hashes and enable the Redis adapter below
// (setupRedisAdapter) so any instance can serve any room.
//
// Every client action funnels through here with explicit success/err events so
// the UI can always show the player what happened.

const express = require("express");
const http = require("http");
const crypto = require("crypto");
const { Server } = require("socket.io");
const cors = require("cors");
const gameEndpoints = require("./gameEndpoints");
const turnGames = require("./turnGames");
const questions = require("./questions");
const gameData = require("./gameData");
const identity = require("./identity");

// Which browser origins may use this server. Production must name them explicitly and
// should never list localhost: that is what keeps a developer's local site off the
// deployed (usage-billed) server — it gets pointed at a local one instead (scripts/dev-env.mjs).
const IS_PRODUCTION = process.env.NODE_ENV === "production";
if (IS_PRODUCTION && !process.env.CORS_ORIGINS) {
  console.error("CORS_ORIGINS must be set in production (comma-separated site origins).");
  process.exit(1);
}
const CORS_ORIGINS = (process.env.CORS_ORIGINS || "http://localhost:5173")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

const MATCH_TIMEOUT_MS = 30000;    // how long to wait in the matchmaking queue
const GRACE_MS = Number(process.env.GRACE_MS) || 30000; // reconnect window before a dropped player forfeits
const PROPOSAL_TIMEOUT_MS = 30000; // how long a play-again / switch request stays open

// Turn-based games run their own server-authoritative state machine (see
// turnGames.js) instead of the "everyone plays a round, submit a score" flow.
const TURN_GAMES = new Set(["tictactoe", "imposter"]);

const LOBBY_TTL_MS = 15 * 60000;   // unfilled lobbies self-destruct after this long
const LOBBY_GRACE_MS = Number(process.env.LOBBY_GRACE_MS) || 10000; // reconnect window for a player who drops while in a lobby
const JOIN_WINDOW_MS = 10000;      // join-attempt rate limit window…
const JOIN_MAX_TRIES = 8;          // …and how many tries a socket gets per window (anti brute-force)
const CODE_ALLOC_TRIES = 8;        // bounded retries against the 900k active-code space
const IDENTIFY_WINDOW_MS = 10000;  // identify rate limit window…
const IDENTIFY_MAX_TRIES = 6;      // …each identify with a new token costs a Django round trip
const EVENT_WINDOW_MS = 1000;      // per-socket flood guard: at most EVENT_MAX events…
const EVENT_MAX = 30;              // …per window; real clients send a handful per minute
const IDENTIFY_HOLD_MS = 5000;     // longest a new socket's events wait for its first identify
const ANON_IDLE_MS = 20000;        // a socket that never sends identify is dropped after this
const RESTART_MIN_MS = 3000;       // a room can't restart (re-deal, re-fetch) again sooner than this
const MAX_SCORE = 1000;            // above every game's maxPoints (career-path's 700 is the largest)
const INTRO_ALLOWANCE_MS = 5000;   // the VS intro (2.6 s) + latency between the deal and the first answer

// Matchmaking: nobody waits for a "fair" opponent who may never come (few players online). A new
// searcher is paired at once with a waiting player within RANK_REACH rank levels if there is one
// (closest points first), otherwise straight away with a random waiting player of the same game.
const RANK_LADDER = ["Rookie", "Role Player", "Sixth Man", "Starter", "All-Star", "All-NBA", "MVP", "Hall of Famer", "GOAT"]; // backend users.models RANK_CHOICES, lowest first
const RANK_REACH = 1;              // "close" = the same level or one either side
const MATCH_SWEEP_MS = 3000;       // safety net: pairs anyone left waiting (e.g. after a reconnect)

const app = express();
app.disable("x-powered-by");
app.use(cors({ origin: CORS_ORIGINS, methods: ["GET", "POST"] }));
app.get("/health", (_req, res) =>
  res.json({ ok: true, rooms: rooms.size, players: players.size, sockets: io.engine.clientsCount, uptimeS: Math.round(process.uptime()) }),
);

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: CORS_ORIGINS, methods: ["GET", "POST"] },
  // Client events are a few hundred bytes; the 1 MB default let one client push huge payloads.
  maxHttpBufferSize: 16 * 1024,
  // Notice a dead connection within ~20 s (default up to 45 s) before the reconnect grace starts.
  pingInterval: 10000,
  pingTimeout: 10000,
  // CORS headers only bind browsers' reads; this refuses the connection itself when a
  // browser presents an origin that isn't allowed (websocket upgrades ignore CORS).
  // Requests with no Origin (non-browser clients) still need a valid token to do anything.
  allowRequest: (req, callback) => {
    const origin = req.headers.origin;
    callback(null, !origin || CORS_ORIGINS.includes(origin));
  },
});

// uid -> { socketId, user, roomCode }
const players = new Map();
// roomCode -> Room (see makeRoom)
const rooms = new Map();
// gameId -> [{ uid, user }]
const queues = new Map();

// =========================
//  Helpers
// =========================
/**
 * Hand out an unused 6-digit code. Uniform crypto randomness (unguessable) with
 * bounded retries keeps allocation O(1) at any occupancy; returns null only when
 * the active-code space is effectively exhausted so the caller can say "busy".
 */
function allocateRoomCode() {
  for (let i = 0; i < CODE_ALLOC_TRIES; i++) {
    const code = crypto.randomInt(100000, 1000000);
    if (!rooms.has(code)) return code;
  }
  return null;
}

/** Stable identity of a connected, identified socket. A socket that a newer one replaced (second
 *  tab, reconnect) no longer acts for that player: null for it and for guests. */
const uidOf = (socket) => (socket.uid && players.get(socket.uid)?.socketId === socket.id ? socket.uid : null);

function makeRoom(code, gameId, game, members, type = "match", size = 2) {
  return {
    code,
    type,                                    // "match" (random 1v1) | "friend" (code lobby)
    gameId,
    game,                                    // full Game object (carries pointsPerCorrect, name…)
    capacity: type === "friend" ? clampRoomSize(gameId, size, members.length) : 2,
    members: [...members],                   // members[0] is the host
    scores: Object.fromEntries(members.map((m) => [m, null])), // final scores, null until submitted
    times: Object.fromEntries(members.map((m) => [m, null])),  // final elapsed ms per member, null until submitted
    gameData: null,                          // current round payload (array)
    phase: type === "friend" ? "lobby" : "intro", // lobby | intro | playing | waiting | results
    proposal: null,                          // { type:"again"|"switch", fromUid, gameId, game, accepted:Set, timeout }
    graceTimers: {},                         // uid -> setTimeout handle
    lobbyTimer: null,                        // TTL handle while a friend lobby waits for the host to start
    turn: null,                              // turnGames per-room state (turn-based games only)
    turnTimer: null,                         // turnGames per-turn/phase timeout handle
  };
}

/** A friend room's player count within its game's bounds, never below who is already seated. */
function clampRoomSize(gameId, size, seated) {
  const { min, max } = turnGames.roomConfigFor(gameId);
  const n = Number.isInteger(Number(size)) ? Number(size) : min;
  return Math.min(max, Math.max(min, seated, n));
}

function othersOf(room, uid) {
  return room.members.filter((m) => m !== uid);
}

function socketIdOf(uid) {
  return players.get(uid)?.socketId || null;
}

/** Emit to a player by uid (no-op if they're currently offline). */
function toUid(uid, event, payload) {
  const sid = socketIdOf(uid);
  if (sid) io.to(sid).emit(event, payload);
}

/** 13-15 year-olds (Django's is_teen) are kept off public surfaces: strangers in a random match
 *  see "Player". Friend rooms are joined by a code the teen chose to share, so names show there. */
function maskedForStrangers(user) {
  if (!user?.is_teen) return false;
  const room = rooms.get(players.get(user.id)?.roomCode);
  return !room || room.type === "match";
}

const publicUser = (user) =>
  user
    ? {
        id: user.id ?? null,                    // permanent public id (#K7F3QD)
        username: maskedForStrangers(user) ? "Player" : user.username,
        profile_photo: maskedForStrangers(user) ? null : user.profile_photo ?? null,
        rank: user.rank,
        points: user.points,
      }
    : { id: null, username: "Player" };

/** Display name for "X left" style messages (masked like publicUser). */
const nameOf = (uid) => {
  const user = players.get(uid)?.user;
  if (!user) return "A player";
  return maskedForStrangers(user) ? "Player" : user.username || "A player";
};

// Games dealt from the pre-generated questions (questions.js: the manifest-v3 data
// host when it publishes the game, else the Supabase questions store) instead of
// the Django backend (tictactoe/imposter are TURN_GAMES and never reach fetchRound).
const QUESTION_GAMES = new Set(["career-path", "who-are-ya", "contexto", "superdraft"]);

// Every game id the relay can deal. A client's `game` object is rebuilt from its id (unknown ids
// are refused) and its fields are type-checked, because the room broadcasts it to the opponent:
// a forged urlPath used to navigate the opponent's browser off-site.
const KNOWN_GAMES = new Set([...Object.keys(gameEndpoints), ...QUESTION_GAMES, ...TURN_GAMES]);

function cleanGame(game) {
  const id = typeof game?.id === "string" ? game.id : "";
  if (!KNOWN_GAMES.has(id)) return null;
  const text = (v, max) => (typeof v === "string" ? v.slice(0, max) : "");
  const num = (v) => {
    const n = Math.floor(Number(v));
    return Number.isFinite(n) ? Math.min(Math.max(n, 0), MAX_SCORE) : 0;
  };
  return {
    id,
    name: text(game.name, 60) || id,
    tag: text(game.tag, 30),
    urlPath: `/${id}`,                      // every game's page is /<id> (src/utils/GameUtils.tsx)
    pointsPerCorrect: num(game.pointsPerCorrect),
    maxPoints: num(game.maxPoints),
  };
}

// Fetch a fresh round of game data for a game id — either one pre-generated
// question from the questions store, a round of a pool game from the published
// manifest-v3 files (gameData.js; null = use its backend endpoint instead), or a
// round from the Django backend.
async function fetchRound(gameId) {
  if (QUESTION_GAMES.has(gameId)) return [await questions.deal(gameId)];
  const published = await gameData.dealOrNull(gameId);
  if (published) return published;
  const endpoint = gameEndpoints[gameId];
  if (!endpoint) throw new Error(`No endpoint configured for game id: ${gameId}`);
  // Without a timeout a hung backend leaves the room on "Loading the game…" forever.
  const response = await fetch(endpoint, { signal: AbortSignal.timeout(8000) });
  if (!response.ok) throw new Error(`Failed to fetch data: ${response.statusText}`);
  const body = await response.json();
  // Django wraps the array as { series: [...] }; static/raw arrays are also accepted.
  return Array.isArray(body) ? body : body.series ?? body.pool ?? [];
}

/** Load a round and broadcast it to both members; resolves the room into "playing". */
async function dealRound(room) {
  // Starting a fresh round: cancel any turn timer and clear stale turn state
  // from a previous game (e.g. after a play-again/switch off a turn game), and
  // the previous round's payload so a resume mid-switch can't snapshot it
  // (turn games have no gameData; the round branch re-assigns it below).
  if (room.turnTimer) clearTimeout(room.turnTimer);
  room.turnTimer = null;
  room.turn = null;
  room.gameData = null;
  room.dealtAt = Date.now();
  // This deal's generation: backToLobby/destroyRoom (and any newer deal) bump it, so a round
  // that finishes loading after the room moved on can tell it is stale.
  const gen = (room.dealGen = (room.dealGen || 0) + 1);
  room.credited = new Set(); // uids already credited for this round (see creditRoom)
  // Turn-based games don't fetch a shared round — they boot a server-authoritative
  // state machine that broadcasts turnState instead of roundData.
  if (TURN_GAMES.has(room.gameId)) {
    try {
      await turnGames.init(room, turnHelpers); // sets phase "playing" up front, turn state once loaded
      if (room.dealGen !== gen || room.phase !== "playing") {
        // The room moved on while the game loaded: undo the state init just set up, and re-send
        // the lobby (when the room still has one) so clients drop the stray turnState.
        if (room.turnTimer) clearTimeout(room.turnTimer);
        room.turnTimer = null;
        room.turn = null;
        if (rooms.get(room.code) === room && room.phase === "lobby") {
          const snap = lobbySnapshot(room);
          room.members.forEach((m) => toUid(m, "friendLobbyUpdate", snap));
        }
        return;
      }
    } catch (err) {
      console.error(`Turn game init failed for room ${room.code}:`, err.message);
      room.members.forEach((uid) =>
        toUid(uid, "roundDataError", { message: "Couldn't start the game. Please try again." })
      );
    }
    return;
  }
  try {
    const gameData = await fetchRound(room.gameId);
    if (room.dealGen !== gen || room.phase !== "intro") return; // the room moved on (left the intro, stopped, destroyed) while the round loaded
    if (!gameData || gameData.length === 0) throw new Error("empty round");
    room.gameData = gameData;
    room.scores = Object.fromEntries(room.members.map((m) => [m, null]));
    room.times = Object.fromEntries(room.members.map((m) => [m, null]));
    room.phase = "playing";
    room.members.forEach((uid) => toUid(uid, "roundData", { gameData, game: room.game }));
  } catch (err) {
    console.error(`Round load failed for room ${room.code}:`, err.message);
    room.members.forEach((uid) =>
      toUid(uid, "roundDataError", { message: "Couldn't load the game. Please try again." })
    );
  }
}

/**
 * Rank a room's members for the final scoreboard: score DESC, then elapsed
 * time ASC (a null time counts as slowest). "tie" only when score AND time
 * both match (or both times are null); slower equal-scorers get "loss". Rows
 * carry elapsedMs so clients can show how a tie was broken. Shared by
 * settleMatch AND snapshotFor so live results and resumes can never disagree.
 */
function rankRoom(room) {
  const timeKey = (uid) => (room.times[uid] == null ? Infinity : room.times[uid]);
  const ranked = room.members
    .map((uid) => ({ uid, score: room.scores[uid] ?? 0, elapsedMs: room.times[uid] ?? null }))
    .sort((a, b) => b.score - a.score || timeKey(a.uid) - timeKey(b.uid));
  const best = ranked[0];
  const sameAsBest = (e) => e.score === best.score && timeKey(e.uid) === timeKey(best.uid);
  const winners = ranked.filter(sameAsBest);
  return ranked.map((e) => ({
    ...publicUser(players.get(e.uid)?.user),
    id: e.uid,
    score: e.score,
    elapsedMs: e.elapsedMs,
    outcome: !sameAsBest(e) ? "loss" : winners.length > 1 ? "tie" : "win",
  }));
}

// Online matches add each player's score to their profile, like a solo game. Only the relay can
// credit them: Django's /trivia/multiplayer-result/ requires MULTIPLAYER_SHARED_SECRET, and the
// scores are this room's own (already clamped in submitScore / set by turnGames). Each player is
// credited once per round (`only` credits just those uids, e.g. a finished guest who leaves early,
// without blocking the rest). Unset secret (local dev): online play awards nothing.
const API_BASE_URL = process.env.API_BASE_URL || "http://localhost:8000";
const RELAY_KEY = process.env.MULTIPLAYER_SHARED_SECRET || "";

function creditRoom(room, only = null) {
  if (!RELAY_KEY) return null;
  const uids = (only ?? room.members).filter((uid) => room.scores[uid] != null && !room.credited.has(uid));
  if (uids.length === 0) return null;
  uids.forEach((uid) => room.credited.add(uid));
  const results = uids
    .map((uid) => ({ public_id: uid, score: room.scores[uid], duration_ms: room.times[uid] ?? 0 }));
  return fetch(`${API_BASE_URL}/trivia/multiplayer-result/`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Relay-Key": RELAY_KEY },
    body: JSON.stringify({ game: room.gameId, mode: room.type === "friend" ? "friend" : "match", results }),
    signal: AbortSignal.timeout(8000),
  })
    .then(async (res) => {
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = await res.json();
      for (const r of body.results || []) {
        if (r.awarded > 0) toUid(r.public_id, "pointsAwarded", { awarded: r.awarded, points: r.points, rank: r.rank });
      }
    })
    .catch((err) => console.error(`Crediting room ${room.code} failed:`, err.message));
}

/** Compute and send the final result to every player (any room size). */
function settleMatch(room) {
  room.phase = "results";
  creditRoom(room);
  // Shared scoreboard, best score first — the client renders this for 3-player rooms.
  const standings = rankRoom(room);
  standings.forEach((row) => {
    const bestOther = Math.max(...standings.filter((o) => o.id !== row.id).map((o) => o.score));
    toUid(row.id, "matchResult", {
      yourScore: row.score,
      opponentScore: bestOther, // legacy 1v1 shape (the single opponent's score)
      outcome: row.outcome,
      standings,
    });
  });
}

// Plumbing lent to turnGames.js so it can drive turn-based rooms without
// reaching into this module's private maps. (Defined after its dependencies.)
const turnHelpers = {
  toUid,
  reject: (uid, message) => toUid(uid, "turnReject", { message }),
  settleMatch,
  nameOf,
  isOnline: (uid) => !!socketIdOf(uid),
};

/** Tear a room down completely and free all members. */
function destroyRoom(room, reason) {
  if (!room) return;
  // Someone left mid-round: whoever already finished still gets their points.
  if (room.phase === "playing" || room.phase === "waiting") creditRoom(room);
  if (room.proposal?.timeout) clearTimeout(room.proposal.timeout);
  if (room.lobbyTimer) clearTimeout(room.lobbyTimer);
  if (room.turnTimer) clearTimeout(room.turnTimer); // turn-game per-turn/phase timer
  room.dealGen = (room.dealGen || 0) + 1; // invalidates any deal still loading
  Object.values(room.graceTimers).forEach((t) => clearTimeout(t));
  room.members.forEach((uid) => {
    const p = players.get(uid);
    if (p && p.roomCode === room.code) p.roomCode = null;
    const sid = socketIdOf(uid);
    if (sid) io.sockets.sockets.get(sid)?.leave(room.code);
  });
  rooms.delete(room.code);
  console.log(`Room ${room.code} destroyed (${reason})`);
}

/** Everyone back to the lobby: the room lives on with its code and seats, the round is dropped
 *  (scores finished so far are credited). `exceptUid` gets the snapshot but not the message. */
function backToLobby(room, message, exceptUid = null) {
  if (room.phase === "playing" || room.phase === "waiting") creditRoom(room);
  if (room.turnTimer) clearTimeout(room.turnTimer);
  room.turnTimer = null;
  room.turn = null;
  room.gameData = null;
  room.dealGen = (room.dealGen || 0) + 1; // invalidates any deal still loading
  clearProposal(room);
  room.scores = Object.fromEntries(room.members.map((m) => [m, null]));
  room.times = Object.fromEntries(room.members.map((m) => [m, null]));
  room.phase = "lobby";
  armLobbyTimer(room);
  const snap = lobbySnapshot(room);
  room.members.forEach((m) => {
    if (m !== exceptUid) toUid(m, "matchStopped", { message });
    toUid(m, "friendLobbyUpdate", snap);
  });
}

/** Deal a fresh round of `gameObj` to the whole room (play again / switch). Shared by the 1v1
 *  proposal handshake (registerAccept) and the friend-room host's restartRoom. */
function restartRound(room, gameObj, why) {
  clearProposal(room);
  room.restartedAt = Date.now();
  room.gameId = gameObj.id;
  room.game = gameObj;
  room.phase = "intro";
  room.members.forEach((u) => toUid(u, "matchRestart", { game: gameObj }));
  dealRound(room);
  console.log(`Room ${room.code} restart (${why} -> ${gameObj.id})`);
}

/** A player is gone (left, or didn't reconnect). 1v1 rooms and a leaving HOST end the room for
 *  everyone; a guest leaving a friend room frees the seat: the lobby carries on, a round carries on
 *  if two or more remain (and it isn't a turn game), otherwise everyone returns to the lobby. */
function removeMember(room, uid, why) {
  const name = nameOf(uid);
  if (room.type !== "friend" || room.members[0] === uid) {
    if (room.phase === "lobby") {
      othersOf(room, uid).forEach((m) => toUid(m, "friendRoomCancelled", { message: "The host closed the room." }));
    } else {
      const message = room.members.length > 2 ? `${name} left, so the match ended.` : "Your opponent left the match.";
      othersOf(room, uid).forEach((m) => toUid(m, "opponentLeft", { message }));
    }
    destroyRoom(room, why);
    return;
  }
  if (room.graceTimers[uid]) {
    clearTimeout(room.graceTimers[uid]);
    delete room.graceTimers[uid];
  }
  // A finished leaver keeps their points (their score is dropped from the room just below).
  if ((room.phase === "playing" || room.phase === "waiting") && room.scores[uid] != null) creditRoom(room, [uid]);
  room.members = room.members.filter((m) => m !== uid);
  delete room.scores[uid];
  delete room.times[uid];
  const p = players.get(uid);
  if (p && p.roomCode === room.code) p.roomCode = null;
  const sid = socketIdOf(uid);
  if (sid) io.sockets.sockets.get(sid)?.leave(room.code);
  if (room.phase === "lobby") {
    const snap = lobbySnapshot(room);
    room.members.forEach((m) => toUid(m, "friendLobbyUpdate", snap));
    return;
  }
  if (room.members.length < 2 || room.turn) {
    backToLobby(room, `${name} left, so the match ended.`);
    return;
  }
  clearProposal(room);
  room.members.forEach((m) => toUid(m, "memberLeft", { id: uid, username: name, message: `${name} left the match.` }));
  // Their missing score no longer holds up the settle.
  if (room.phase !== "results" && room.members.every((m) => room.scores[m] != null)) settleMatch(room);
}

function clearProposal(room) {
  if (room.proposal?.timeout) clearTimeout(room.proposal.timeout);
  room.proposal = null;
}

/** Public view of a friend lobby, broadcast on every membership/game change. */
function lobbySnapshot(room) {
  const { min, max } = turnGames.roomConfigFor(room.gameId);
  return {
    code: room.code,
    game: room.game,
    capacity: room.capacity,
    min,                                     // the game's player bounds, for the host's size stepper
    max,
    hostUid: room.members[0],
    members: room.members.map((uid) => ({
      ...publicUser(players.get(uid)?.user),
      id: uid,
      isHost: uid === room.members[0],
      online: !!socketIdOf(uid),
    })),
  };
}

/** Build the resume snapshot a reconnecting client needs to restore its screen. */
function snapshotFor(room, uid) {
  const opps = othersOf(room, uid);
  let proposal = null;
  if (room.proposal) {
    proposal =
      room.proposal.fromUid === uid
        ? { role: "mine", type: room.proposal.type, gameId: room.proposal.gameId }
        : {
            role: "theirs",
            type: room.proposal.type,
            gameId: room.proposal.gameId,
            gameName: room.proposal.game?.name,
            fromName: nameOf(room.proposal.fromUid),
          };
  }
  // The room's phase is shared, but "playing" vs "waiting" is per player: you
  // wait once YOUR score is in, and keep playing while others have finished.
  let phase = room.phase;
  if (phase === "playing" || phase === "waiting") {
    phase = room.scores[uid] != null ? "waiting" : "playing";
  }
  const standings = phase === "results" ? rankRoom(room) : null;
  return {
    code: room.code,
    game: room.game,
    phase,
    roomType: room.type,
    roomSize: room.members.length,
    role: room.members[0] === uid ? "host" : "guest",
    opponents: opps.map((m) => ({
      ...publicUser(players.get(m)?.user),
      id: m,
      online: !!socketIdOf(m),
      finished: room.scores[m] != null,
    })),
    opponent: publicUser(players.get(opps[0])?.user),  // legacy 1v1 shape
    opponentOnline: !!socketIdOf(opps[0]),             // legacy 1v1 shape
    gameData: room.gameData,
    yourScore: room.scores[uid],
    opponentScore: room.scores[opps[0]],
    standings,
    lobby: room.phase === "lobby" ? lobbySnapshot(room) : null,
    proposal,
  };
}

// Remove a uid from every matchmaking queue.
function dropFromQueues(uid) {
  for (const [gameId, q] of queues) {
    const i = q.findIndex((p) => p.uid === uid);
    if (i !== -1) {
      q.splice(i, 1);
      if (q.length === 0) queues.delete(gameId);
      return true;
    }
  }
  return false;
}

// =========================
//  Fair matchmaking
// =========================
const pointsOf = (user) => Number(user?.points) || 0;
/** Position on the rank ladder (an unknown rank counts as the bottom). */
const levelOf = (user) => Math.max(0, RANK_LADDER.indexOf(user?.rank));

/** The opponent for `uid`: a waiting, online player within RANK_REACH levels (closest points), else
 *  any waiting online player at random — never "keep waiting". null only when nobody else is here. */
function pickOpponent(queue, uid, user) {
  const waiting = queue.filter((p) => p.uid !== uid && socketIdOf(p.uid));
  if (waiting.length === 0) return null;
  const mine = levelOf(user);
  const near = waiting.filter((p) => Math.abs(levelOf(p.user) - mine) <= RANK_REACH);
  if (near.length) {
    const gap = (p) => Math.abs(pointsOf(p.user) - pointsOf(user));
    return near.reduce((best, p) => (gap(p) < gap(best) ? p : best));
  }
  return waiting[crypto.randomInt(waiting.length)];
}

/** Seat two queue entries in a fresh 1v1 room and deal the first round. */
function createMatchRoom(game, entryA, entryB) {
  const code = allocateRoomCode();
  if (code == null) {
    [entryA.uid, entryB.uid].forEach((u) => toUid(u, "matchError", { message: "Servers are busy. Please try again." }));
    return false;
  }
  const room = makeRoom(code, game.id, game, [entryA.uid, entryB.uid]);
  rooms.set(code, room);
  [entryA.uid, entryB.uid].forEach((u) => {
    const p = players.get(u);
    if (p) p.roomCode = code;
    io.sockets.sockets.get(socketIdOf(u))?.join(code);
    const sock = io.sockets.sockets.get(socketIdOf(u));
    if (sock?._findTimeout) clearTimeout(sock._findTimeout);
  });

  const [host, guest] = [entryA.uid, entryB.uid];
  toUid(host, "matchFound", {
    code, role: "host", roomType: "match", roomSize: 2,
    you: publicUser(players.get(host)?.user),
    opponent: publicUser(players.get(guest)?.user),
    opponents: [publicUser(players.get(guest)?.user)], game,
  });
  toUid(guest, "matchFound", {
    code, role: "guest", roomType: "match", roomSize: 2,
    you: publicUser(players.get(guest)?.user),
    opponent: publicUser(players.get(host)?.user),
    opponents: [publicUser(players.get(host)?.user)], game,
  });
  console.log(`Match ${code} (${game.id})`);

  // Pre-load the first round during the VS intro.
  dealRound(room);
  return true;
}

/** Tell everyone still waiting where they stand in the queue. */
function broadcastQueueState(gameId) {
  const q = queues.get(gameId);
  if (!q) return;
  q.forEach((entry, i) => {
    toUid(entry.uid, "searching", { inQueue: q.length, position: i + 1 });
  });
}

/** Longest-waiting first, pair everyone still waiting (findMatch pairs on arrival; this catches
 *  players who were offline at that moment and are back). */
function sweepQueue(gameId) {
  const q = queues.get(gameId);
  if (!q || q.length < 2) return;
  let paired = false;
  let i = 0;
  while (q.length >= 2 && i < q.length) {
    const entry = q[i];
    const candidate = socketIdOf(entry.uid) ? pickOpponent(q, entry.uid, entry.user) : null;
    if (!candidate) {
      i += 1;
      continue;
    }
    q.splice(q.indexOf(candidate), 1);
    q.splice(q.indexOf(entry), 1);
    createMatchRoom(entry.game, entry, candidate);
    paired = true;
  }
  if (q.length === 0) queues.delete(gameId);
  else if (paired) broadcastQueueState(gameId);
}

// One cheap global sweep (see sweepQueue).
setInterval(() => {
  for (const gameId of [...queues.keys()]) sweepQueue(gameId);
}, MATCH_SWEEP_MS).unref();

/** Fixed-window rate limit: true once `tries` exceeds `max` within `windowMs` for this key. */
function overLimit(map, key, windowMs, max) {
  const now = Date.now();
  let w = map.get(key);
  if (!w || now - w.start > windowMs) {
    w = { start: now, tries: 0 };
    map.set(key, w);
  }
  return ++w.tries > max;
}

// Join attempts per player (not per socket: reconnecting used to reset the count), so room
// codes can't be brute-forced. Stale windows are pruned by the sweep below.
const joinWindows = new Map();
const joinThrottled = (uid) => overLimit(joinWindows, uid, JOIN_WINDOW_MS, JOIN_MAX_TRIES);
setInterval(() => {
  const now = Date.now();
  for (const [uid, w] of joinWindows) if (now - w.start > JOIN_WINDOW_MS) joinWindows.delete(uid);
}, 60000).unref();

/** A friend lobby that never fills evaporates, freeing its code for reuse. */
function armLobbyTimer(room) {
  if (room.lobbyTimer) clearTimeout(room.lobbyTimer);
  room.lobbyTimer = setTimeout(() => {
    room.members.forEach((m) =>
      toUid(m, "friendRoomCancelled", { message: "The room expired. Generate a new code to play." })
    );
    destroyRoom(room, "lobby TTL");
  }, LOBBY_TTL_MS);
}

/** The host started the room — flip it into a live match (same flow as matchmaking). */
function startFriendMatch(room) {
  if (room.lobbyTimer) {
    clearTimeout(room.lobbyTimer);
    room.lobbyTimer = null;
  }
  room.phase = "intro";
  room.members.forEach((uid) => {
    const opps = othersOf(room, uid);
    toUid(uid, "matchFound", {
      code: room.code,
      role: uid === room.members[0] ? "host" : "guest",
      roomType: "friend",
      roomSize: room.members.length,
      you: publicUser(players.get(uid)?.user),
      opponent: publicUser(players.get(opps[0])?.user),           // legacy 1v1 shape
      opponents: opps.map((m) => publicUser(players.get(m)?.user)),
      game: room.game,
    });
  });
  console.log(`Friend match ${room.code}: ${room.members.length} players (${room.gameId})`);
  dealRound(room);
}

// =========================
//  Socket logic
// =========================
io.on("connection", (socket) => {
  // Every client event passes through here before its handler:
  //  • a null payload becomes undefined: the handlers' `({ ... } = {})` default only covers
  //    undefined, and a throw there used to take down the process (and every live match);
  //  • a per-socket flood guard drops events past EVENT_MAX a second;
  //  • until the socket's first identify settles, other events wait (in order). socket.io-client
  //    flushes what it buffered while offline (a final score, a turn) BEFORE our identify, and
  //    the server would drop them as anonymous. Guests never identify, so the hold times out.
  const eventWindows = new Map();
  let held = [];
  let identSettled = false;
  const settleFirstIdentify = () => {
    if (identSettled) return;
    identSettled = true;
    clearTimeout(holdTimer);
    held.forEach((next) => next());
    held = [];
  };
  const holdTimer = setTimeout(settleFirstIdentify, IDENTIFY_HOLD_MS);
  // Only sockets that never even tried to identify: one whose identify failed (Django briefly down)
  // keeps its connection, so the player's next action can identify again.
  const anonTimer = setTimeout(() => { if (!socket.uid && !socket._identifySeq) socket.disconnect(true); }, ANON_IDLE_MS);
  socket.use((packet, next) => {
    if (packet[1] === null) packet[1] = undefined;
    if (overLimit(eventWindows, "all", EVENT_WINDOW_MS, EVENT_MAX)) return;
    if (identSettled || packet[0] === "identify") return next();
    held.push(next);
  });

  // --- Identity (sent on every (re)connect and before every gated action) ---
  // The client sends { user, token }; only the token counts. identity.js asks
  // Django's /api/me/ who it belongs to, and the player is keyed by THAT answer,
  // so nobody can claim someone else's id and a banned account is refused.
  // A token-less (old) client is not identified: keeping it would keep the
  // id-spoofing hole (docs/constraints/AUTH_CONSTRAINTS.md AUTH-8).
  const identifyWindows = new Map();
  socket.on("identify", ({ token } = {}) => {
    if (overLimit(identifyWindows, "all", IDENTIFY_WINDOW_MS, IDENTIFY_MAX_TRIES)) return;
    const seq = (socket._identifySeq || 0) + 1;
    socket._identifySeq = seq;
    socket.identifying = identity.verifyToken(token).then((verdict) => {
      // A newer identify superseded this one while Django answered.
      if (socket._identifySeq !== seq || socket.disconnected) return;
      if (!verdict.ok) {
        refuseIdentity(verdict);
        return;
      }
      socket.token = token;
      onIdentified(verdict.user);
    }).catch((err) => console.error("identify failed:", err.message))
      .finally(settleFirstIdentify);
  });

  // Gated actions: wait for any in-flight identify, then re-check the token
  // (cached ~60 s in identity.js), so a ban takes effect before the next match.
  async function verifiedUid() {
    if (socket.identifying) await socket.identifying;
    if (!socket.uid || !socket.token) return null;
    const verdict = await identity.verifyToken(socket.token);
    if (!verdict.ok) {
      refuseIdentity(verdict);
      return null;
    }
    return socket.disconnected ? null : uidOf(socket);
  }

  // A refused identify: tell the client why. A banned account is disconnected
  // outright (its seat, if any, then goes through the normal disconnect path).
  function refuseIdentity(verdict) {
    socket.emit("identifyError", { code: verdict.code, message: verdict.message });
    if (verdict.code === "account_banned") {
      socket.token = null;
      socket.disconnect(true);
    }
  }

  // Verified: key the player by the server's payload (minus the email, which
  // the relay never needs), then run the resume logic.
  function onIdentified(serverUser) {
    const { email: _email, ...user } = serverUser;
    const uid = user.id;
    socket.uid = uid;
    clearTimeout(anonTimer);
    const prev = players.get(uid);
    players.set(uid, { socketId: socket.id, user, roomCode: prev?.roomCode ?? null });
    // The same socket identifying again (token refresh, profile change) is not a reconnect:
    // resuming would reset the player's round and tell the opponent "X reconnected".
    if (prev?.socketId === socket.id) return;

    // Reconnecting into a live room? Rejoin and resume.
    const room = prev?.roomCode ? rooms.get(prev.roomCode) : null;
    if (room) {
      if (room.graceTimers[uid]) {
        clearTimeout(room.graceTimers[uid]);
        delete room.graceTimers[uid];
      }
      socket.join(room.code);
      // After the events held for this identify have run (settleFirstIdentify releases them on
      // the next ticks), so a final score sent while offline is already in the snapshot.
      setImmediate(() => {
        if (socket.disconnected || !rooms.has(room.code)) return;
        socket.emit("resumeMatch", snapshotFor(room, uid));
        // Turn games carry live state outside the resume snapshot — re-push it.
        if (room.turn) turnGames.resumeFor(room, uid, turnHelpers);
      });
      if (room.phase === "lobby") {
        const snap = lobbySnapshot(room);
        othersOf(room, uid).forEach((m) => toUid(m, "friendLobbyUpdate", snap));
      } else {
        othersOf(room, uid).forEach((m) => toUid(m, "opponentReconnected", { id: uid, username: nameOf(uid) }));
      }
      console.log(`Room ${room.code}: player resumed (${room.phase})`);
    }
  }

  // --- Matchmaking ---
  // Paired on arrival: a player within RANK_REACH levels if one is waiting, else anyone waiting
  // (pickOpponent). Only an empty queue makes a player wait (up to MATCH_TIMEOUT_MS).
  socket.on("findMatch", async ({ game: sent } = {}) => {
    const uid = await verifiedUid();
    if (!uid) {
      socket.emit("matchError", { message: "You need to be signed in to play online." });
      return;
    }
    const game = cleanGame(sent);
    if (!game) {
      socket.emit("matchError", { message: "That game can't be played online." });
      return;
    }
    // Guard against double-queueing / queueing while already in a room.
    if (players.get(uid)?.roomCode) {
      socket.emit("matchError", { message: "You're already in a match." });
      return;
    }
    dropFromQueues(uid);
    // A previous search's timer must not fire against this fresh queue entry.
    if (socket._findTimeout) clearTimeout(socket._findTimeout);

    if (!queues.has(game.id)) queues.set(game.id, []);
    const queue = queues.get(game.id);
    const me = { uid, user: players.get(uid)?.user, game, since: Date.now() };

    const candidate = pickOpponent(queue, uid, me.user);
    if (candidate) {
      queue.splice(queue.indexOf(candidate), 1);
      if (queue.length === 0) queues.delete(game.id);
      if (createMatchRoom(game, candidate, me)) {
        broadcastQueueState(game.id);
        return;
      }
      // "busy" — put the waiting player back (re-registering the queue if it
      // was just deleted) and fall through so `me` queues with a timeout too.
      queues.set(game.id, queue);
      queue.unshift(candidate);
      broadcastQueueState(game.id);
    }

    queue.push(me);
    socket.emit("searching", { inQueue: queue.length, position: queue.length });
    socket._findTimeout = setTimeout(() => {
      if (dropFromQueues(uid)) toUid(uid, "noOpponent", { game });
    }, MATCH_TIMEOUT_MS);
    console.log(`Queued for ${game.id} (${queue.length} waiting)`);
  });

  socket.on("cancelFind", () => {
    const uid = uidOf(socket);
    if (uid) dropFromQueues(uid);
    if (socket._findTimeout) clearTimeout(socket._findTimeout);
  });

  // --- Friend rooms (private share-code lobbies for 2-4 players; the host starts the game) ---
  socket.on("createFriendRoom", async ({ game: sent, size } = {}) => {
    const uid = await verifiedUid();
    if (!uid) {
      socket.emit("friendError", { message: "You need to be signed in to create a room." });
      return;
    }
    const game = cleanGame(sent);
    if (!game) {
      socket.emit("friendError", { message: "That game can't be played online." });
      return;
    }
    if (players.get(uid)?.roomCode) {
      socket.emit("friendError", { message: "You're already in a room." });
      return;
    }
    dropFromQueues(uid);
    if (socket._findTimeout) clearTimeout(socket._findTimeout);
    const code = allocateRoomCode();
    if (code == null) {
      socket.emit("friendError", { message: "Servers are busy. Please try again in a moment." });
      return;
    }
    const room = makeRoom(code, game.id, game, [uid], "friend", size);
    rooms.set(code, room);
    const p = players.get(uid);
    if (p) p.roomCode = code;
    socket.join(code);
    armLobbyTimer(room);
    socket.emit("friendRoomCreated", lobbySnapshot(room));
    console.log(`Friend room ${code} created (${game.id})`);
  });

  socket.on("joinFriendRoom", async ({ code } = {}) => {
    const uid = await verifiedUid();
    if (!uid) {
      socket.emit("friendJoinError", { message: "You need to be signed in to join a room." });
      return;
    }
    if (joinThrottled(uid)) {
      socket.emit("friendJoinError", { message: "Too many attempts. Wait a few seconds and try again." });
      return;
    }
    const numeric = Number(String(code).trim());
    const room = Number.isInteger(numeric) ? rooms.get(numeric) : null;
    if (!room || room.type !== "friend") {
      socket.emit("friendJoinError", { message: "No room found for that code." });
      return;
    }
    if (players.get(uid)?.roomCode) {
      socket.emit("friendJoinError", {
        message: room.members.includes(uid) ? "You're already in this room." : "You're already in a room.",
      });
      return;
    }
    if (room.phase !== "lobby") {
      socket.emit("friendJoinError", { message: "That match has already started." });
      return;
    }
    if (room.members.length >= room.capacity) {
      socket.emit("friendJoinError", { message: "That room is already full." });
      return;
    }
    dropFromQueues(uid);
    if (socket._findTimeout) clearTimeout(socket._findTimeout);
    room.members.push(uid);
    room.scores[uid] = null;
    room.times[uid] = null;
    const p = players.get(uid);
    if (p) p.roomCode = room.code;
    socket.join(room.code);
    armLobbyTimer(room); // joining is activity — give the lobby a fresh TTL
    console.log(`Friend room ${room.code}: ${room.members.length}/${room.capacity} joined`);
    // A full room waits for the host to start it (startRoomNow); nothing starts by itself.
    const snap = lobbySnapshot(room);
    socket.emit("friendRoomJoined", snap);
    othersOf(room, uid).forEach((m) => toUid(m, "friendLobbyUpdate", snap));
  });

  // Host-only: swap which game the room will play (lobby phase only).
  socket.on("changeFriendGame", ({ code, game: sent } = {}) => {
    const room = rooms.get(Number(code));
    const uid = uidOf(socket);
    const game = cleanGame(sent);
    if (!room || room.type !== "friend" || room.phase !== "lobby") return;
    if (!uid || room.members[0] !== uid || !game) return;
    // A game with a smaller cast than the seated players would strand someone: refuse it.
    const { max } = turnGames.roomConfigFor(game.id);
    if (room.members.length > max) {
      socket.emit("friendError", { message: `${game.name} is for ${max} players; ${room.members.length} are seated.` });
      return;
    }
    room.gameId = game.id;
    room.game = game;
    // The size follows the new game's bounds, never shrinking below who is already seated.
    room.capacity = clampRoomSize(game.id, room.capacity, room.members.length);
    const snap = lobbySnapshot(room);
    room.members.forEach((m) => toUid(m, "friendLobbyUpdate", snap));
    console.log(`Friend room ${room.code} game -> ${game.id}`);
  });

  // Host-only (lobby): how many players the room is for, within the game's bounds and never below
  // who is already seated.
  socket.on("setRoomSize", ({ code, size } = {}) => {
    const room = rooms.get(Number(code));
    const uid = uidOf(socket);
    if (!room || room.type !== "friend" || room.phase !== "lobby") return;
    if (!uid || room.members[0] !== uid) return;
    room.capacity = clampRoomSize(room.gameId, size, room.members.length);
    const snap = lobbySnapshot(room);
    room.members.forEach((m) => toUid(m, "friendLobbyUpdate", snap));
  });

  // Host-only: start the room once at least `min` players are seated and everyone is online.
  socket.on("startRoomNow", ({ code } = {}) => {
    const room = rooms.get(Number(code));
    const uid = uidOf(socket);
    if (!room || room.type !== "friend" || room.phase !== "lobby") return;
    if (!uid || room.members[0] !== uid) return;
    const { min, max } = turnGames.roomConfigFor(room.gameId);
    if (room.members.length < min) {
      socket.emit("friendError", { message: `Need at least ${min} players to start.` });
      return;
    }
    // Backstop: never start a game with more seated players than it supports.
    if (room.members.length > max) {
      socket.emit("friendError", { message: `${room.game.name} is for ${max} players; ${room.members.length} are seated.` });
      return;
    }
    if (!room.members.every((m) => socketIdOf(m))) {
      socket.emit("friendError", { message: "Wait for everyone to reconnect before starting." });
      return;
    }
    startFriendMatch(room);
  });

  // Host-only: end the current match for everyone and return the room to its lobby.
  socket.on("stopMatch", ({ code } = {}) => {
    const room = rooms.get(Number(code));
    const uid = uidOf(socket);
    if (!room || room.type !== "friend" || room.phase === "lobby") return;
    if (!uid || room.members[0] !== uid) return;
    backToLobby(room, "The host ended the match.", uid);
    console.log(`Room ${room.code}: host stopped the match`);
  });

  // Host-only, after a round: play the same game again, or a different one, for everyone at once.
  socket.on("restartRoom", ({ code, game: sent } = {}) => {
    const room = rooms.get(Number(code));
    const uid = uidOf(socket);
    if (!room || room.type !== "friend" || room.phase !== "results") return;
    if (!uid || room.members[0] !== uid) return;
    if (Date.now() - Math.max(room.restartedAt || 0, room.dealtAt || 0) < RESTART_MIN_MS) {
      socket.emit("friendError", { message: "Wait a moment before starting another game." });
      return;
    }
    const gameObj = sent ? cleanGame(sent) : room.game;
    if (!gameObj) {
      socket.emit("friendError", { message: "That game can't be played online." });
      return;
    }
    const { max } = turnGames.roomConfigFor(gameObj.id);
    if (room.members.length > max) {
      socket.emit("friendError", { message: `${gameObj.name} is for ${max} players; ${room.members.length} are seated.` });
      return;
    }
    restartRound(room, gameObj, "host");
  });

  // --- Turn-based game actions (tictactoe / imposter) ---
  // The client emits turnAction; turnGames validates it against the authoritative
  // room state and broadcasts the resulting turnState (per-uid redaction inside).
  socket.on("turnAction", ({ code, action } = {}) => {
    const room = rooms.get(Number(code));
    const uid = uidOf(socket);
    if (!room || !uid || !room.members.includes(uid) || !room.turn) return;
    if (!action || typeof action !== "object") return;
    turnGames.handleAction(room, uid, action, turnHelpers);
  });

  // --- Score submission ---
  socket.on("submitScore", ({ code, score, elapsedMs } = {}) => {
    const uid = uidOf(socket);
    if (!uid) return;
    const room = rooms.get(code);
    if (!room || !room.members.includes(uid)) {
      // The match is gone (the server restarted, or it was closed): end the client's
      // "Waiting for…" screen instead of leaving it there forever.
      if (!room && !players.get(uid)?.roomCode) socket.emit("opponentLeft", { message: "This match is no longer running." });
      return;
    }
    // Only a dealt round takes scores (not a lobby, the intro, or a turn game's own scoring).
    if ((room.phase !== "playing" && room.phase !== "waiting") || room.turn) return;
    if (room.scores[uid] != null) return; // ignore duplicate submissions

    room.scores[uid] = Math.min(Math.max(Math.floor(Number(score) || 0), 0), MAX_SCORE);
    // Play time breaks equal-score ties (fastest wins); junk values count as slowest. A claimed
    // time can't undercut the real time since the deal (minus the intro), so 0 ms can't win ties.
    const ms = Number(elapsedMs);
    const floor = Math.max(0, Date.now() - (room.dealtAt || 0) - INTRO_ALLOWANCE_MS);
    room.times[uid] = Number.isFinite(ms) && ms >= 0 ? Math.max(ms, floor) : null;
    const stillPlaying = room.members.filter((m) => room.scores[m] == null);
    if (stillPlaying.length === 0) {
      settleMatch(room);
    } else {
      room.phase = "waiting";
      socket.emit("waitingForOpponent", {});
      // let the still-playing sides show "finished"
      othersOf(room, uid).forEach((m) => toUid(m, "opponentFinished", { id: uid, username: nameOf(uid) }));
    }
  });

  // --- Optional progress relay (drives the "opponent still playing" indicator) ---
  socket.on("reportProgress", ({ code, round, total } = {}) => {
    const room = rooms.get(code);
    const uid = uidOf(socket);
    if (!room || !uid || !room.members.includes(uid)) return;
    const int = (v) => Math.min(Math.max(Math.floor(Number(v)) || 0, 0), 1000);
    othersOf(room, uid).forEach((m) => toUid(m, "opponentProgress", { id: uid, username: nameOf(uid), round: int(round), total: int(total) }));
  });

  // --- Play-again / switch-game proposals ---
  // One member proposes; every OTHER member must accept before the room restarts
  // (for a 1v1 room that's the single opponent, for a friend room both friends).
  const propose = (type, code, game) => {
    const room = rooms.get(code);
    const uid = uidOf(socket);
    if (!room || !uid || !room.members.includes(uid)) return;
    // A lobby starts through startRoomNow (which enforces the game's minimum players).
    if (room.phase === "lobby") return;
    // Friend rooms are run by their host (restartRoom); the handshake is for random 1v1 rooms.
    if (room.type === "friend") return;

    // If someone else already has a proposal open, treat this as an accept.
    if (room.proposal && room.proposal.fromUid !== uid) {
      registerAccept(room, uid);
      return;
    }
    if (room.proposal) {
      socket.emit("matchError", { message: "A request is already pending." });
      return;
    }
    // Each restart re-deals (and may re-fetch) a round: two accounts looping
    // propose/accept would otherwise hammer the data sources.
    if (Date.now() - (room.restartedAt || 0) < RESTART_MIN_MS) {
      socket.emit("matchError", { message: "Wait a moment before starting another game." });
      return;
    }
    const gameObj = type === "switch" ? cleanGame(game) : room.game;
    if (!gameObj) return;
    const gameId = gameObj.id;

    room.proposal = {
      type, fromUid: uid, gameId, game: gameObj, accepted: new Set(),
      timeout: setTimeout(() => {
        clearProposal(room);
        room.members.forEach((u) => toUid(u, "proposalTimeout", {}));
      }, PROPOSAL_TIMEOUT_MS),
    };
    socket.emit("proposalPending", { type, gameId, gameName: gameObj?.name });
    othersOf(room, uid).forEach((m) =>
      toUid(m, "proposalReceived", {
        type, gameId, gameName: gameObj?.name, fromName: nameOf(uid),
      })
    );
  };

  function registerAccept(room, byUid) {
    const prop = room.proposal;
    if (!prop || prop.fromUid === byUid) return;
    prop.accepted.add(byUid);
    if (prop.accepted.size < room.members.length - 1) {
      // Still waiting on someone — tell the rest who's in.
      room.members.forEach((u) => {
        if (u !== byUid) toUid(u, "proposalProgress", { id: byUid, username: nameOf(byUid), accepted: prop.accepted.size, needed: room.members.length - 1 });
      });
      return;
    }
    restartRound(room, prop.game, prop.type);
  }

  socket.on("proposeAgain", ({ code } = {}) => propose("again", code));
  socket.on("proposeSwitch", ({ code, game } = {}) => propose("switch", code, game));

  socket.on("respondProposal", ({ code, accept } = {}) => {
    const room = rooms.get(code);
    const uid = uidOf(socket);
    if (!room || !room.proposal || !uid || !room.members.includes(uid)) return;
    if (room.proposal.fromUid === uid) return; // can't answer your own
    if (accept) {
      registerAccept(room, uid);
    } else {
      const decliner = uid;
      clearProposal(room);
      othersOf(room, decliner).forEach((m) => toUid(m, "proposalDeclined", { id: decliner, username: nameOf(decliner) }));
    }
  });

  socket.on("cancelProposal", ({ code } = {}) => {
    const room = rooms.get(code);
    const uid = uidOf(socket);
    if (!room || !room.proposal || room.proposal.fromUid !== uid) return;
    clearProposal(room);
    othersOf(room, uid).forEach((m) => toUid(m, "proposalCancelled", {}));
  });

  // --- Explicit leave ---
  // A guest leaving a friend room frees their seat; a 1v1 player or the host leaving ends the
  // room for everyone (see removeMember).
  socket.on("leaveMatch", ({ code } = {}) => {
    const uid = uidOf(socket);
    // The search-cancel path funnels through here too — kill any queue timer.
    if (socket._findTimeout) clearTimeout(socket._findTimeout);
    const room = rooms.get(code) || (players.get(uid)?.roomCode && rooms.get(players.get(uid).roomCode));
    if (!room || !room.members.includes(uid)) {
      if (uid) dropFromQueues(uid);
      return;
    }
    removeMember(room, uid, "a player left");
  });

  // --- Disconnect → start the grace window ---
  socket.on("disconnect", (reason) => {
    clearTimeout(holdTimer);
    clearTimeout(anonTimer);
    held = [];
    // This socket's queue timer must not fire against a newer socket's queue entry.
    if (socket._findTimeout) clearTimeout(socket._findTimeout);
    // null when a newer socket already replaced this one: only the active socket going away
    // makes the player offline.
    const uid = uidOf(socket);
    if (!uid) return;
    console.log(`Player disconnected (${reason})`);
    dropFromQueues(uid);

    const p = players.get(uid);
    // The socket is gone: until a new one identifies as this uid, the player is offline
    // (socketIdOf -> null: toUid no-ops, snapshots show "Reconnecting", startRoomNow refuses).
    p.socketId = null;

    const room = p.roomCode ? rooms.get(p.roomCode) : null;
    if (!room) {
      players.delete(uid);
      return;
    }
    const name = nameOf(uid);
    if (room.phase === "lobby") {
      // Show the seat as offline; if they don't come back, treat it as leaving.
      const snap = lobbySnapshot(room);
      othersOf(room, uid).forEach((m) => toUid(m, "friendLobbyUpdate", snap));
      room.graceTimers[uid] = setTimeout(() => {
        removeMember(room, uid, "lobby grace timeout");
        players.delete(uid);
      }, LOBBY_GRACE_MS);
      return;
    }
    othersOf(room, uid).forEach((m) => toUid(m, "opponentDisconnected", { id: uid, username: name, graceMs: GRACE_MS }));
    // Turn games: don't stall the round waiting out the grace window — a dropped
    // player's turn auto-passes (they can still reconnect and resume mid-game).
    if (room.turn) turnGames.onDisconnect(room, uid, turnHelpers);
    room.graceTimers[uid] = setTimeout(() => {
      removeMember(room, uid, "grace timeout");
      players.delete(uid);
    }, GRACE_MS);
  });
});

// Optional Redis adapter (multi-instance broadcasts). The in-memory maps above are
// still per-instance — full multi-instance matchmaking needs them in Redis too.
async function setupRedisAdapter() {
  const url = process.env.REDIS_URL;
  if (!url) return;
  const { createAdapter } = require("@socket.io/redis-adapter");
  const { createClient } = require("redis");
  const pubClient = createClient({ url });
  const subClient = pubClient.duplicate();
  await Promise.all([pubClient.connect(), subClient.connect()]);
  io.adapter(createAdapter(pubClient, subClient));
  console.log("Socket.IO Redis adapter enabled");
}

// Last resort: one bad packet or upstream hiccup must not drop every live match. Log and carry on;
// Railway still restarts the process if it genuinely dies.
process.on("unhandledRejection", (err) => console.error("Unhandled rejection:", err?.message || err));
process.on("uncaughtException", (err) => console.error("Uncaught exception:", err?.stack || err));

// A redeploy stops this process (SIGTERM). Rooms live in memory, so tell everyone their match
// ended instead of leaving them on a screen the new process knows nothing about.
let shuttingDown = false;
process.on("SIGTERM", () => {
  if (shuttingDown) return;
  shuttingDown = true;
  const message = "The game server is updating. Please start a new match.";
  for (const room of rooms.values()) {
    if (room.phase === "playing" || room.phase === "waiting") creditRoom(room); // finished players keep their points
    const event = room.phase === "lobby" ? "friendRoomCancelled" : "opponentLeft";
    room.members.forEach((uid) => toUid(uid, event, { message }));
  }
  for (const q of queues.values()) q.forEach((entry) => toUid(entry.uid, "noOpponent", {}));
  console.log(`SIGTERM: notified ${rooms.size} rooms, closing`);
  // 3 s: room for the credit calls above (Railway waits drainingSeconds = 5 before killing).
  setTimeout(() => io.close(() => process.exit(0)), 3000).unref();
});

const PORT = process.env.PORT || 4000;
setupRedisAdapter()
  .catch((err) => console.error("Redis adapter setup failed:", err))
  .finally(() =>
    server.listen(PORT, "0.0.0.0", () => console.log(`Multiplayer server on :${PORT}`)),
  );
