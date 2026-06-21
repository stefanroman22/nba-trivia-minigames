// multiplayer_server/src/index.js
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");
const gameEndpoints = require("./gameEndpoints");

const CORS_ORIGINS = (
  process.env.CORS_ORIGINS || "http://localhost:5173,https://nba-trivia-minigames.online"
)
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const MATCH_TIMEOUT_MS = 30000;

const app = express();
app.use(cors({ origin: CORS_ORIGINS, methods: ["GET", "POST"] }));

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: CORS_ORIGINS, methods: ["GET", "POST"] } });

const rooms = {};           // { roomCode: { host, opponent, scores, status, gameId, gameData } }
const waitingPlayers = {};  // { gameId: [{ socketId, userInfo, timeout }] }
const rematchRequests = {}; // { roomCode: { players, gameId, timeout } }

// =========================
//  Helpers
// =========================
const randomRoomCode = () => Math.floor(Math.random() * (999999 - 100000 + 1)) + 100000;

// Fetch a fresh round of game data for a game id from the Django backend.
async function fetchGameData(gameId) {
  const endpoint = gameEndpoints[gameId];
  if (!endpoint) throw new Error(`No endpoint configured for game ID: ${gameId}`);
  const response = await fetch(endpoint);
  if (!response.ok) throw new Error(`Failed to fetch data: ${response.statusText}`);
  return response.json();
}

// Remove a socket from matchmaking: drop it from any queue, or notify its opponent and leave the room.
function leaveMultiplayer(socket) {
  // 1. Still waiting in a queue → drop it (and clear its timeout).
  for (const gameId in waitingPlayers) {
    const queue = waitingPlayers[gameId];
    const index = queue.findIndex((p) => p.socketId === socket.id);
    if (index !== -1) {
      const [player] = queue.splice(index, 1);
      if (player.timeout) clearTimeout(player.timeout);
      console.log(`Removed ${socket.id} from ${gameId} queue`);
      return;
    }
  }

  // 2. Otherwise in an active room → notify the opponent and leave.
  const currentRoom = Array.from(socket.rooms).find((r) => r !== socket.id);
  if (!currentRoom) return;

  const members = Array.from(io.sockets.adapter.rooms.get(currentRoom) || []);
  const opponentId = members.find((id) => id !== socket.id);
  if (opponentId) {
    io.to(opponentId).emit("opponentLeft", { message: "Your opponent has left the match." });
  }
  socket.leave(currentRoom);
  console.log(`User ${socket.id} left room ${currentRoom}`);
}

// =========================
//  Socket logic
// =========================
io.on("connection", (socket) => {
  console.log("User connected:", socket.id);
  socket.user = null;

  socket.on("setUserInfo", (user) => {
    socket.user = user || null;
  });

  // --- Matchmaking ---
  socket.on("playOnline", ({ game }) => {
    if (!waitingPlayers[game.id]) waitingPlayers[game.id] = [];
    const queue = waitingPlayers[game.id];

    if (queue.length > 0) {
      const opponent = queue.shift();
      if (opponent.timeout) clearTimeout(opponent.timeout);
      const roomCode = randomRoomCode();

      socket.join(roomCode);
      io.sockets.sockets.get(opponent.socketId)?.join(roomCode);

      rooms[roomCode] = {
        host: socket.id,
        opponent: opponent.socketId,
        scores: {},
        status: "active",
        gameId: game.id,
        gameData: null,
      };

      io.to(socket.id).emit("matchFound", { roomCode, opponent: opponent.userInfo, game, role: "host", selfSocketId: socket.id });
      io.to(opponent.socketId).emit("matchFound", { roomCode, opponent: socket.user, game, role: "opponent", selfSocketId: opponent.socketId });
      console.log(`Match found in ${game.id}: ${socket.id} vs ${opponent.socketId}`);
    } else {
      const player = { socketId: socket.id, userInfo: socket.user };
      player.timeout = setTimeout(() => {
        const index = queue.findIndex((p) => p.socketId === socket.id);
        if (index !== -1) {
          queue.splice(index, 1);
          io.to(socket.id).emit("opponentNotFound", { game });
        }
      }, MATCH_TIMEOUT_MS);
      queue.push(player);
      console.log(`Added ${socket.id} to waiting queue for ${game.id}`);
    }
  });

  // --- Host requests the round's data, broadcast to the room ---
  socket.on("requestGameData", async ({ code, gameId }) => {
    try {
      const gameData = await fetchGameData(gameId);
      if (!rooms[code]) rooms[code] = { host: null, opponent: null, scores: {}, status: "active", gameId };
      rooms[code].gameData = gameData;
      io.to(code).emit("gameData", gameData);
    } catch (error) {
      console.error("Error fetching game data:", error);
      io.to(code).emit("gameDataError", { message: "Failed to load game data." });
    }
  });

  // --- A player reports their final score ---
  socket.on("playerFinished", ({ code, score }) => {
    const room = rooms[code];
    if (!room) {
      console.error(`Room ${code} not found when player finished`);
      return;
    }
    if (room.scores[socket.id] != null) return; // ignore duplicate submissions

    room.scores[socket.id] = score;
    const hostScore = room.scores[room.host];
    const oppScore = room.scores[room.opponent];

    if (hostScore != null && oppScore != null) {
      const sendResult = (playerId, yourScore, opponentScore) =>
        io.to(playerId).emit("matchComplete", { yourScore, opponentScore, gameId: room.gameId, gameData: room.gameData });
      sendResult(room.host, hostScore, oppScore);
      sendResult(room.opponent, oppScore, hostScore);
      room.status = "finished";
      console.log(`Match complete in room ${code}`, room.scores);
    } else {
      io.to(socket.id).emit("waitingForOpponent", { message: "Waiting for your opponent to finish..." });
    }
  });

  // --- Rematch handshake ---
  socket.on("rematchRequest", ({ code, gameId }) => {
    if (!rematchRequests[code]) rematchRequests[code] = { players: [], gameId, timeout: null };
    const state = rematchRequests[code];
    if (!state.players.includes(socket.id)) state.players.push(socket.id);

    if (state.players.length === 1) {
      io.to(socket.id).emit("rematchWaiting", { message: "Waiting for opponent to confirm rematch..." });
      state.timeout = setTimeout(() => {
        state.players.forEach((id) => io.to(id).emit("rematchTimeout", { message: "Opponent did not confirm rematch in time." }));
        delete rematchRequests[code];
      }, MATCH_TIMEOUT_MS);
    } else if (state.players.length === 2) {
      if (state.timeout) clearTimeout(state.timeout);
      if (rooms[code]) {
        rooms[code].scores = {};
        rooms[code].status = "active";
      } else {
        rooms[code] = { host: state.players[0], opponent: state.players[1], scores: {}, status: "active", gameId };
      }

      fetchGameData(gameId)
        .then((newGameData) => {
          rooms[code].gameData = newGameData;
          state.players.forEach((id) => io.to(id).emit("rematchStart", newGameData));
          delete rematchRequests[code];
        })
        .catch((err) => {
          console.error("Error fetching rematch data:", err);
          state.players.forEach((id) => io.to(id).emit("gameDataError", { message: "Failed to load rematch data." }));
        });
    }
  });

  // --- Leaving ---
  socket.on("leaveMultiplayer", () => leaveMultiplayer(socket));
  socket.on("disconnect", () => {
    console.log(`User disconnected: ${socket.id}`);
    leaveMultiplayer(socket);
  });
});

// Optional Redis adapter: lets multiple server instances share Socket.IO rooms/broadcasts.
// Enable by setting REDIS_URL (e.g. Upstash). NOTE: the in-memory `rooms` / `waitingPlayers`
// / `rematchRequests` matchmaking state is still per-instance — full multi-instance
// matchmaking also requires moving that state into Redis (follow-up). The adapter is the
// necessary first step and the dependencies are lazy-required, so without REDIS_URL the
// server runs single-instance exactly as before.
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
    server.listen(PORT, "0.0.0.0", () => console.log(`Server running on port ${PORT}`)),
  );
