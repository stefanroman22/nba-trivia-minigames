// multiplayer_server/src/index.js
//
// Realtime match server for the NBA minigames: random 1v1 matchmaking and
// private "play with a friend" rooms (share-code lobbies for FRIEND_ROOM_SIZE
// players). Rooms are N-player throughout — matchmaking rooms hold 2 members,
// friend rooms hold exactly FRIEND_ROOM_SIZE.
//
// Design notes
// ------------
// Players are keyed by a STABLE identity (`uid`, derived from the logged-in
// username) rather than by socket.id, because socket ids change on every
// reconnect. Keying by uid is what makes the robustness features possible:
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
//     friends join with the code and the match starts the moment the room is
//     full. The host can cancel or change the game while waiting; if anyone
//     leaves (lobby or match) the room is cancelled for everyone.
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

const CORS_ORIGINS = (
  process.env.CORS_ORIGINS || "http://localhost:5173,https://nba-trivia-minigames.online"
)
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

const MATCH_TIMEOUT_MS = 30000;    // how long to wait in the matchmaking queue
const GRACE_MS = 30000;            // reconnect window before a dropped player forfeits
const PROPOSAL_TIMEOUT_MS = 30000; // how long a play-again / switch request stays open

const FRIEND_ROOM_SIZE = 2;        // a friend room starts the moment exactly this many players are in
const LOBBY_TTL_MS = 15 * 60000;   // unfilled lobbies self-destruct after this long
const LOBBY_GRACE_MS = 10000;      // reconnect window for a player who drops while in a lobby
const JOIN_WINDOW_MS = 10000;      // join-attempt rate limit window…
const JOIN_MAX_TRIES = 8;          // …and how many tries a socket gets per window (anti brute-force)
const CODE_ALLOC_TRIES = 8;        // bounded retries against the 900k active-code space

// Fair matchmaking: pair players whose POINTS are close, widening the accepted
// gap the longer someone waits so nobody queues forever. Both sides' windows
// must accept the gap.
const MATCH_WINDOW_BASE = 200;     // points gap considered fair immediately
const MATCH_WINDOW_GROWTH = 400;   // extra tolerance gained per step below
const MATCH_WINDOW_STEP_MS = 5000;
const MATCH_WINDOW_UNCAP_MS = 25000; // after this, any opponent is acceptable
const MATCH_SWEEP_MS = 3000;       // re-check waiting players this often

const app = express();
app.use(cors({ origin: CORS_ORIGINS, methods: ["GET", "POST"] }));
app.get("/health", (_req, res) => res.json({ ok: true }));

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: CORS_ORIGINS, methods: ["GET", "POST"] } });

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

/** Stable identity for a connected user. Falls back to the socket id for guests. */
const uidOf = (socket) => socket.uid || null;

function makeRoom(code, gameId, game, members, type = "match") {
  return {
    code,
    type,                                    // "match" (random 1v1) | "friend" (code lobby)
    gameId,
    game,                                    // full Game object (carries pointsPerCorrect, name…)
    capacity: type === "friend" ? FRIEND_ROOM_SIZE : 2,
    members: [...members],                   // members[0] is the host
    scores: Object.fromEntries(members.map((m) => [m, null])), // final scores, null until submitted
    gameData: null,                          // current round payload (array)
    phase: type === "friend" ? "lobby" : "intro", // lobby | intro | playing | waiting | results
    proposal: null,                          // { type:"again"|"switch", fromUid, gameId, game, accepted:Set, timeout }
    graceTimers: {},                         // uid -> setTimeout handle
    lobbyTimer: null,                        // TTL handle while a friend lobby waits to fill
  };
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

const publicUser = (user) =>
  user
    ? {
        id: user.id ?? null,                    // permanent public id (#K7F3QD)
        username: user.username,
        profile_photo: user.profile_photo ?? null,
        rank: user.rank,
        points: user.points,
      }
    : { id: null, username: "Player" };

/** Display name for log lines / "X left" messages. */
const nameOf = (uid) => players.get(uid)?.user?.username || "A player";

// Fetch a fresh round of game data for a game id from the Django backend.
async function fetchRound(gameId) {
  const endpoint = gameEndpoints[gameId];
  if (!endpoint) throw new Error(`No endpoint configured for game id: ${gameId}`);
  const response = await fetch(endpoint);
  if (!response.ok) throw new Error(`Failed to fetch data: ${response.statusText}`);
  const body = await response.json();
  // Django wraps the array as { series: [...] }; static/raw arrays are also accepted.
  return Array.isArray(body) ? body : body.series ?? body.pool ?? [];
}

/** Load a round and broadcast it to both members; resolves the room into "playing". */
async function dealRound(room) {
  try {
    const gameData = await fetchRound(room.gameId);
    if (!gameData || gameData.length === 0) throw new Error("empty round");
    room.gameData = gameData;
    room.scores = Object.fromEntries(room.members.map((m) => [m, null]));
    room.phase = "playing";
    room.members.forEach((uid) => toUid(uid, "roundData", { gameData, game: room.game }));
  } catch (err) {
    console.error(`Round load failed for room ${room.code}:`, err.message);
    room.members.forEach((uid) =>
      toUid(uid, "roundDataError", { message: "Couldn't load the game. Please try again." })
    );
  }
}

/** Compute and send the final result to every player (any room size). */
function settleMatch(room) {
  room.phase = "results";
  const entries = room.members.map((uid) => ({ uid, score: room.scores[uid] ?? 0 }));
  const top = Math.max(...entries.map((e) => e.score));
  const winners = entries.filter((e) => e.score === top);
  const outcomeOf = (e) => (e.score !== top ? "loss" : winners.length > 1 ? "tie" : "win");
  // Shared scoreboard, best score first — the client renders this for 3-player rooms.
  const standings = [...entries]
    .sort((a, b) => b.score - a.score)
    .map((e) => ({ ...publicUser(players.get(e.uid)?.user), id: e.uid, score: e.score, outcome: outcomeOf(e) }));
  entries.forEach((e) => {
    const bestOther = Math.max(...entries.filter((o) => o.uid !== e.uid).map((o) => o.score));
    toUid(e.uid, "matchResult", {
      yourScore: e.score,
      opponentScore: bestOther, // legacy 1v1 shape (the single opponent's score)
      outcome: outcomeOf(e),
      standings,
    });
  });
}

/** Tear a room down completely and free all members. */
function destroyRoom(room, reason) {
  if (!room) return;
  if (room.proposal?.timeout) clearTimeout(room.proposal.timeout);
  if (room.lobbyTimer) clearTimeout(room.lobbyTimer);
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

function clearProposal(room) {
  if (room.proposal?.timeout) clearTimeout(room.proposal.timeout);
  room.proposal = null;
}

/** Public view of a friend lobby, broadcast on every membership/game change. */
function lobbySnapshot(room) {
  return {
    code: room.code,
    game: room.game,
    capacity: room.capacity,
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
            fromName: players.get(room.proposal.fromUid)?.user?.username,
          };
  }
  // The room's phase is shared, but "playing" vs "waiting" is per player: you
  // wait once YOUR score is in, and keep playing while others have finished.
  let phase = room.phase;
  if (phase === "playing" || phase === "waiting") {
    phase = room.scores[uid] != null ? "waiting" : "playing";
  }
  const entries = room.members.map((m) => ({ uid: m, score: room.scores[m] ?? 0 }));
  const top = Math.max(...entries.map((e) => e.score));
  const winners = entries.filter((e) => e.score === top);
  const standings =
    phase === "results"
      ? [...entries]
          .sort((a, b) => b.score - a.score)
          .map((e) => ({
            ...publicUser(players.get(e.uid)?.user),
            id: e.uid,
            score: e.score,
            outcome: e.score !== top ? "loss" : winners.length > 1 ? "tie" : "win",
          }))
      : null;
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

/** How large a points gap this queue entry accepts right now (grows while waiting). */
function windowFor(entry, now) {
  const waited = now - entry.since;
  if (waited >= MATCH_WINDOW_UNCAP_MS) return Infinity;
  return MATCH_WINDOW_BASE + MATCH_WINDOW_GROWTH * Math.floor(waited / MATCH_WINDOW_STEP_MS);
}

/** The fairest (smallest points gap) waiting opponent BOTH windows accept. */
function bestCandidate(queue, uid, myPoints, myWindow, now) {
  let best = null;
  let bestGap = Infinity;
  for (const p of queue) {
    if (p.uid === uid || !socketIdOf(p.uid)) continue;
    const gap = Math.abs(pointsOf(p.user) - myPoints);
    if (gap <= myWindow && gap <= windowFor(p, now) && gap < bestGap) {
      best = p;
      bestGap = gap;
    }
  }
  return best;
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
  console.log(`Match ${code}: ${nameOf(host)}#${host} vs ${nameOf(guest)}#${guest} (${game.id})`);

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

/** Longest-waiting first, pair everyone whose widened windows now overlap. */
function sweepQueue(gameId) {
  const q = queues.get(gameId);
  if (!q || q.length < 2) return;
  const now = Date.now();
  let paired = false;
  let i = 0;
  while (q.length >= 2 && i < q.length) {
    const entry = q[i];
    const candidate = bestCandidate(q, entry.uid, pointsOf(entry.user), windowFor(entry, now), now);
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

// One cheap global sweep keeps widening windows effective for waiting players.
setInterval(() => {
  for (const gameId of [...queues.keys()]) sweepQueue(gameId);
}, MATCH_SWEEP_MS).unref();

/** Sliding-window rate limit on join attempts per socket (stops code brute-forcing). */
function joinThrottled(socket) {
  const now = Date.now();
  if (!socket._joinWin || now - socket._joinWin.start > JOIN_WINDOW_MS) {
    socket._joinWin = { start: now, tries: 0 };
  }
  return ++socket._joinWin.tries > JOIN_MAX_TRIES;
}

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

/** The lobby is full — flip it into a live match (same flow as matchmaking). */
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
  console.log(`Friend match ${room.code}: ${room.members.join(", ")} (${room.gameId})`);
  dealRound(room);
}

// =========================
//  Socket logic
// =========================
io.on("connection", (socket) => {
  console.log("Socket connected:", socket.id);

  // --- Identity (sent on every (re)connect) ---
  // Players are keyed by their permanent public id; the username fallback
  // keeps not-yet-updated clients working (they can't share names anyway).
  socket.on("identify", ({ user } = {}) => {
    const uid = user?.id || user?.username;
    if (!uid) return;
    socket.uid = uid;
    const prev = players.get(uid);
    players.set(uid, { socketId: socket.id, user, roomCode: prev?.roomCode ?? null });

    // Reconnecting into a live room? Rejoin and resume.
    const room = prev?.roomCode ? rooms.get(prev.roomCode) : null;
    if (room) {
      if (room.graceTimers[uid]) {
        clearTimeout(room.graceTimers[uid]);
        delete room.graceTimers[uid];
      }
      socket.join(room.code);
      socket.emit("resumeMatch", snapshotFor(room, uid));
      if (room.phase === "lobby") {
        const snap = lobbySnapshot(room);
        othersOf(room, uid).forEach((m) => toUid(m, "friendLobbyUpdate", snap));
      } else {
        othersOf(room, uid).forEach((m) => toUid(m, "opponentReconnected", { id: uid, username: nameOf(uid) }));
      }
      console.log(`${uid} resumed room ${room.code} (${room.phase})`);
    }
  });

  // --- Matchmaking ---
  // Skill-aware: pair with the closest-points opponent whose fairness window
  // (and ours) accepts the gap; the sweep interval re-tries as windows widen.
  socket.on("findMatch", ({ game } = {}) => {
    const uid = uidOf(socket);
    if (!uid || !game?.id) {
      socket.emit("matchError", { message: "You need to be signed in to play online." });
      return;
    }
    // Guard against double-queueing / queueing while already in a room.
    if (players.get(uid)?.roomCode) {
      socket.emit("matchError", { message: "You're already in a match." });
      return;
    }
    dropFromQueues(uid);

    if (!queues.has(game.id)) queues.set(game.id, []);
    const queue = queues.get(game.id);
    const me = { uid, user: players.get(uid)?.user, game, since: Date.now() };

    const candidate = bestCandidate(queue, uid, pointsOf(me.user), windowFor(me, me.since), me.since);
    if (candidate) {
      queue.splice(queue.indexOf(candidate), 1);
      if (queue.length === 0) queues.delete(game.id);
      if (!createMatchRoom(game, candidate, me)) {
        queue.unshift(candidate); // "busy" — the waiting player keeps their spot
      }
      broadcastQueueState(game.id);
      return;
    }

    queue.push(me);
    socket.emit("searching", { inQueue: queue.length, position: queue.length });
    socket._findTimeout = setTimeout(() => {
      if (dropFromQueues(uid)) toUid(uid, "noOpponent", { game });
    }, MATCH_TIMEOUT_MS);
    console.log(`${nameOf(uid)}#${uid} queued for ${game.id} (${pointsOf(me.user)} pts)`);
  });

  socket.on("cancelFind", () => {
    const uid = uidOf(socket);
    if (uid) dropFromQueues(uid);
    if (socket._findTimeout) clearTimeout(socket._findTimeout);
  });

  // --- Friend rooms (private share-code lobbies for FRIEND_ROOM_SIZE players) ---
  socket.on("createFriendRoom", ({ game } = {}) => {
    const uid = uidOf(socket);
    if (!uid || !game?.id) {
      socket.emit("friendError", { message: "You need to be signed in to create a room." });
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
    const room = makeRoom(code, game.id, game, [uid], "friend");
    rooms.set(code, room);
    const p = players.get(uid);
    if (p) p.roomCode = code;
    socket.join(code);
    armLobbyTimer(room);
    socket.emit("friendRoomCreated", lobbySnapshot(room));
    console.log(`Friend room ${code} created by ${uid} (${game.id})`);
  });

  socket.on("joinFriendRoom", ({ code } = {}) => {
    const uid = uidOf(socket);
    if (!uid) {
      socket.emit("friendJoinError", { message: "You need to be signed in to join a room." });
      return;
    }
    if (joinThrottled(socket)) {
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
    const p = players.get(uid);
    if (p) p.roomCode = room.code;
    socket.join(room.code);
    armLobbyTimer(room); // joining is activity — give the lobby a fresh TTL
    console.log(`${uid} joined friend room ${room.code} (${room.members.length}/${room.capacity})`);
    if (room.members.length === room.capacity) {
      startFriendMatch(room);
    } else {
      const snap = lobbySnapshot(room);
      socket.emit("friendRoomJoined", snap);
      othersOf(room, uid).forEach((m) => toUid(m, "friendLobbyUpdate", snap));
    }
  });

  // Host-only: swap which game the room will play (lobby phase only).
  socket.on("changeFriendGame", ({ code, game } = {}) => {
    const room = rooms.get(Number(code));
    const uid = uidOf(socket);
    if (!room || room.type !== "friend" || room.phase !== "lobby") return;
    if (!uid || room.members[0] !== uid || !game?.id) return;
    room.gameId = game.id;
    room.game = game;
    const snap = lobbySnapshot(room);
    room.members.forEach((m) => toUid(m, "friendLobbyUpdate", snap));
    console.log(`Friend room ${room.code} game -> ${game.id}`);
  });

  // --- Score submission ---
  socket.on("submitScore", ({ code, score } = {}) => {
    const room = rooms.get(code);
    const uid = uidOf(socket);
    if (!room || !uid || !room.members.includes(uid)) return;
    if (room.scores[uid] != null) return; // ignore duplicate submissions

    room.scores[uid] = Number(score) || 0;
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
    othersOf(room, uid).forEach((m) => toUid(m, "opponentProgress", { id: uid, username: nameOf(uid), round, total }));
  });

  // --- Play-again / switch-game proposals ---
  // One member proposes; every OTHER member must accept before the room restarts
  // (for a 1v1 room that's the single opponent, for a friend room both friends).
  const propose = (type, code, game) => {
    const room = rooms.get(code);
    const uid = uidOf(socket);
    if (!room || !uid || !room.members.includes(uid)) return;

    // If someone else already has a proposal open, treat this as an accept.
    if (room.proposal && room.proposal.fromUid !== uid) {
      registerAccept(room, uid);
      return;
    }
    if (room.proposal) {
      socket.emit("matchError", { message: "A request is already pending." });
      return;
    }
    const gameId = type === "switch" ? game?.id : room.gameId;
    const gameObj = type === "switch" ? game : room.game;
    if (type === "switch" && !gameId) return;

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
        type, gameId, gameName: gameObj?.name, fromName: players.get(uid)?.user?.username,
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
    clearProposal(room);
    room.gameId = prop.gameId;
    room.game = prop.game;
    room.phase = "intro";
    room.members.forEach((u) => toUid(u, "matchRestart", { game: prop.game }));
    dealRound(room);
    console.log(`Room ${room.code} restart (${prop.type} -> ${prop.gameId})`);
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
  // One player leaving (or the host cancelling) ends the room for EVERYONE:
  // lobby members get `friendRoomCancelled`, in-match members get `opponentLeft`.
  socket.on("leaveMatch", ({ code } = {}) => {
    const uid = uidOf(socket);
    const room = rooms.get(code) || (players.get(uid)?.roomCode && rooms.get(players.get(uid).roomCode));
    if (!room || !room.members.includes(uid)) {
      if (uid) dropFromQueues(uid);
      return;
    }
    const name = players.get(uid)?.user?.username || "A player";
    if (room.phase === "lobby") {
      const message = uid === room.members[0] ? "The host closed the room." : `${name} left, so the room was closed.`;
      othersOf(room, uid).forEach((m) => toUid(m, "friendRoomCancelled", { message }));
    } else {
      const message = room.members.length > 2 ? `${name} left, so the match ended.` : "Your opponent left the match.";
      othersOf(room, uid).forEach((m) => toUid(m, "opponentLeft", { message }));
    }
    destroyRoom(room, `${uid} left`);
  });

  // --- Disconnect → start the grace window ---
  socket.on("disconnect", () => {
    const uid = uidOf(socket);
    console.log("Socket disconnected:", socket.id, uid || "(anon)");
    if (!uid) return;
    if (socket._findTimeout) clearTimeout(socket._findTimeout);
    dropFromQueues(uid);

    const p = players.get(uid);
    // Only treat as offline if this socket is still the player's active socket.
    if (!p || p.socketId !== socket.id) return;

    const room = p.roomCode ? rooms.get(p.roomCode) : null;
    if (!room) {
      players.delete(uid);
      return;
    }
    const name = p.user?.username || "A player";
    if (room.phase === "lobby") {
      // Show the seat as offline, then close the room if they don't come back.
      const snap = lobbySnapshot(room);
      othersOf(room, uid).forEach((m) => toUid(m, "friendLobbyUpdate", snap));
      room.graceTimers[uid] = setTimeout(() => {
        othersOf(room, uid).forEach((m) =>
          toUid(m, "friendRoomCancelled", { message: `${name} disconnected, so the room was closed.` })
        );
        destroyRoom(room, `${uid} lobby grace timeout`);
        players.delete(uid);
      }, LOBBY_GRACE_MS);
      return;
    }
    othersOf(room, uid).forEach((m) => toUid(m, "opponentDisconnected", { id: uid, username: nameOf(uid), graceMs: GRACE_MS }));
    room.graceTimers[uid] = setTimeout(() => {
      const message = room.members.length > 2
        ? `${name} didn't reconnect, so the match ended.`
        : "Your opponent didn't reconnect in time.";
      othersOf(room, uid).forEach((m) => toUid(m, "opponentLeft", { message }));
      destroyRoom(room, `${uid} grace timeout`);
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

const PORT = process.env.PORT || 4000;
setupRedisAdapter()
  .catch((err) => console.error("Redis adapter setup failed:", err))
  .finally(() =>
    server.listen(PORT, "0.0.0.0", () => console.log(`Multiplayer server on :${PORT}`)),
  );
