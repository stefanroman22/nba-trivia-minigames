const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");
const gameEndpoints = require("./gameEndpoints");

const app = express();

// CORS
app.use(
  cors({
    origin: "http://localhost:5173",
    methods: ["GET", "POST"],
  })
);

const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: "http://localhost:5173",
    methods: ["GET", "POST"],
  },
});

const rooms = {}; // { code: { status, host, timeout, startTime } }

// =========================
//  Helper Functions
// =========================

const waitingPlayers = {};
const rematchRequests = {};

// Add helper to remove a player from queue if they disconnect or cancel
function removeFromQueue(socketId) {
  for (const game in waitingPlayers) {
    const queue = waitingPlayers[game];
    const index = queue.findIndex((player) => player.socketId === socketId);

    if (index !== -1) {
      queue.splice(index, 1); // Remove this player from the queue
      console.log(`Removed ${socketId} from ${game} queue`);
      return true; // Stop after removing from the correct queue
    }
  }

  console.log(`No queue entry found for ${socketId}`);
  return false;
}

function leaveMultiplayer(socket, io, waitingPlayers) {
  console.log(`leaveMultiplayer triggered for ${socket.id}`);

  let removedFromQueue = false;

  // 1. Remove user from any waiting queue
  for (const gameId in waitingPlayers) {
    const queue = waitingPlayers[gameId];
    const index = queue.findIndex((player) => player.socketId === socket.id);

    if (index !== -1) {
      const [player] = queue.splice(index, 1);

      // Clear timeout if it exists
      if (player.timeout) {
        clearTimeout(player.timeout);
      }

      console.log(
        `User ${socket.id} removed from waiting queue for game ${gameId}`
      );
      removedFromQueue = true;
    }
  }

  if (removedFromQueue) return; // Done if user was just waiting, not matched yet

  // 2. User is in a match → notify opponent and leave room
  const userRooms = Array.from(socket.rooms).filter((r) => r !== socket.id);
  if (userRooms.length === 0) return; // No active game room found

  const currentRoom = userRooms[0];

  // Find opponent in this room
  const roomMembers = Array.from(
    io.sockets.adapter.rooms.get(currentRoom) || []
  );
  const opponentId = roomMembers.find((id) => id !== socket.id);

  if (opponentId) {
    console.log(
      `User ${socket.id} left match. Notifying opponent ${opponentId}`
    );
    io.to(opponentId).emit("opponentLeft", {
      message: "Your opponent has left the match.",
    });
  }

  // Leave the room
  socket.leave(currentRoom);
  console.log(`User ${socket.id} has left room ${currentRoom}`);
}

// =========================
//  Main Socket Logic
// =========================
io.on("connection", (socket) => {
  console.log("User connected:", socket.id);
  socket.user = null;

  // Set user info for this socket
  socket.on("setUserInfo", (user) => {
    socket.user = user || null;
    console.log(
      `Socket ${socket.id} set user:`,
      socket.user?.username || "Guest"
    );
  });

  // =========================
  // Play Online
  // =========================
  socket.on("playOnline", ({ game }) => {
    console.log(`${socket.id} clicked Play Online for game: ${game.id}`);

    if (!waitingPlayers[game.id]) {
      waitingPlayers[game.id] = [];
    }

    const queue = waitingPlayers[game.id];

    if (queue.length > 0) {
      const opponent = queue.shift();
      const roomCode =
        Math.floor(Math.random() * (999999 - 100000 + 1)) + 100000;

      console.log(
        `Match found in ${game.id}: ${socket.id} vs ${opponent.socketId}`
      );

      socket.join(roomCode);
      io.sockets.sockets.get(opponent.socketId)?.join(roomCode);

      // ✅ Create room object
      rooms[roomCode] = {
        host: socket.id,
        opponent: opponent.socketId,
        scores: {},
        status: "active",
        gameId: game.id,
        gameData: null,
      };

      // ✅ Send info about roles to both players
      io.to(socket.id).emit("matchFound", {
        roomCode,
        opponent: opponent.userInfo,
        game,
        role: "host", // Mark this player as host
        selfSocketId: socket.id, // Include this player's socket ID
      });

      io.to(opponent.socketId).emit("matchFound", {
        roomCode,
        opponent: socket.user,
        game,
        role: "opponent", // Mark this player as opponent
        selfSocketId: opponent.socketId,
      });

      if (opponent.timeout) clearTimeout(opponent.timeout);
    } else {
      const playerData = { socketId: socket.id, userInfo: socket.user };

      playerData.timeout = setTimeout(() => {
        const index = queue.findIndex((p) => p.socketId === socket.id);
        if (index !== -1) {
          queue.splice(index, 1);
          console.log(`Removed ${socket.id} from queue due to timeout`);
          io.to(socket.id).emit("opponentNotFound", { game });
        }
      }, 30000);

      queue.push(playerData);
      console.log(`Added ${socket.id} to waiting queue for ${game.id}`);
    }
  });

  socket.on("requestGameData", async ({ code, gameId }) => {
    console.log(`Fetching game data for game: ${gameId} in room: ${code}`);

    // Fetch from external source
    try {
      const endpoint = gameEndpoints[gameId];
      if (!endpoint) {
        throw new Error(`No endpoint configured for game ID: ${gameId}`);
      }

      const response = await fetch(endpoint);
      if (!response.ok) {
        throw new Error(`Failed to fetch data: ${response.statusText}`);
      }

      const gameData = await response.json();

      if (!rooms[code]) {
        rooms[code] = {
          host: null,
          opponent: null,
          scores: {},
          status: "active",
          gameId,
        };
      }

      rooms[code].gameData = gameData;
      io.to(code).emit("gameData", gameData);

      console.log("Game data sent to both players:", gameData);
    } catch (error) {
      console.error("Error fetching game data:", error);
      io.to(code).emit("gameDataError", {
        message: "Failed to load game data.",
      });
    }
  });

  socket.on("playerFinished", ({ code, score }) => {
    const room = rooms[code];
    if (!room) {
      console.error(`Room ${code} not found when player finished`);
      return;
    }

    // ✅ If this player already finished, ignore duplicate submissions
    if (
      room.scores[socket.id] !== undefined &&
      room.scores[socket.id] !== null
    ) {
      console.log(
        `Player ${socket.id} already finished, ignoring duplicate event`
      );
      return;
    }

    // Save this player's score
    room.scores[socket.id] = score;
    console.log(`Player ${socket.id} finished with score: ${score}`);

    const player1 = room.host;
    const player2 = room.opponent;

    const player1Score = room.scores[player1];
    const player2Score = room.scores[player2];

    // Check if both players have finished
    const bothFinished =
      player1Score !== undefined &&
      player1Score !== null &&
      player2Score !== undefined &&
      player2Score !== null;

    if (bothFinished) {
      console.log(`Both players finished in room ${code}`);

      // Send results individually to each player
      io.to(player1).emit("matchComplete", {
        yourScore: player1Score,
        opponentScore: player2Score,
        gameId: room.gameId,
        gameData: room.gameData,
      });

      io.to(player2).emit("matchComplete", {
        yourScore: player2Score,
        opponentScore: player1Score,
        gameId: room.gameId,
        gameData: room.gameData,
      });

      // Mark the room as finished
      room.status = "finished";
      console.log(`Match complete in room ${code}`, room.scores);
    } else {
      // Only one player finished → notify them to wait
      io.to(socket.id).emit("waitingForOpponent", {
        message: "Waiting for your opponent to finish...",
      });
      console.log(
        `Player ${socket.id} is waiting for opponent in room ${code}`
      );
    }
  });

  socket.on("rematchRequest", ({ code, gameId }) => {
    console.log(`Rematch requested by ${socket.id} for room: ${code}`);

    // Initialize rematch request if none exists
    if (!rematchRequests[code]) {
      rematchRequests[code] = {
        players: [],
        gameId,
        timeout: null,
      };
    }

    const rematchState = rematchRequests[code];

    // Prevent duplicates
    if (!rematchState.players.includes(socket.id)) {
      rematchState.players.push(socket.id);
    }

    // If first player, start timeout
    if (rematchState.players.length === 1) {
      console.log(`First player waiting for rematch in room ${code}`);

      // Notify first player
      io.to(socket.id).emit("rematchWaiting", {
        message: "Waiting for opponent to confirm rematch...",
      });

      // Set timeout to cancel after 30 seconds
      rematchState.timeout = setTimeout(() => {
        console.log(`Rematch timeout expired for room ${code}`);
        rematchState.players.forEach((playerId) => {
          io.to(playerId).emit("rematchTimeout", {
            message: "Opponent did not confirm rematch in time.",
          });
        });
        delete rematchRequests[code]; // Clean up
      }, 30000);
    }
    // If second player joins → start new game
    else if (rematchState.players.length === 2) {
      console.log(`Both players confirmed rematch in room ${code}`);

      // Clear timeout
      if (rematchState.timeout) clearTimeout(rematchState.timeout);

      // Reset scores in existing room
      if (rooms[code]) {
        rooms[code].scores = {};
        rooms[code].status = "active";
      } else {
        rooms[code] = {
          host: rematchState.players[0],
          opponent: rematchState.players[1],
          scores: {},
          status: "active",
          gameId,
        };
      }

      // Fetch new game data automatically
      const endpoint = gameEndpoints[gameId];
      if (!endpoint) {
        console.error(`No endpoint for game ID: ${gameId}`);
        return;
      }

      fetch(endpoint)
        .then((res) => res.json())
        .then((newGameData) => {
          console.log("Fetched new game data for rematch:", newGameData);

          // Update room gameData
          rooms[code].gameData = newGameData;

          // Notify both players
          rematchState.players.forEach((playerId) => {
            io.to(playerId).emit("rematchStart", newGameData);
          });

          delete rematchRequests[code]; // Cleanup
        })
        .catch((err) => {
          console.error("Error fetching new game data for rematch:", err);
          rematchState.players.forEach((playerId) => {
            io.to(playerId).emit("gameDataError", {
              message: "Failed to load rematch data.",
            });
          });
        });
    }
  });

  // Cancel matchmaking if user backs out
  socket.on("cancelSearch", () => {
    removeFromQueue(socket.id);
    console.log(`${socket.id} cancelled matchmaking`);
  });

  // Handle disconnect
  socket.on("disconnect", () => {
    removeFromQueue(socket.id);
    console.log("User disconnected:", socket.id);
  });

  // Create a room
  socket.on("createRoom", (callback) => {
    let code;
    do {
      code = Math.floor(Math.random() * (999999 - 100000 + 1)) + 100000;
    } while (rooms[code]);

    rooms[code] = { status: "pending", host: socket.id };
    console.log(` Room created: ${code}`);
    callback({ code, status: "pending" });
  });

  // Activate a room (host starts waiting for opponent)
  socket.on("activateRoom", (code, callback) => {
    if (!rooms[code] || rooms[code].host !== socket.id) {
      return callback({ ok: false, error: "Room not found or not host" });
    }

    rooms[code].status = "active";
    rooms[code].startTime = Date.now();

    // Auto timeout if no joiner arrives
    rooms[code].timeout = setTimeout(() => {
      if (rooms[code] && io.sockets.adapter.rooms.get(code)?.size <= 1) {
        rooms[code].status = "ready";
        console.log(`⏰ Room ${code} timed out (no opponent joined).`);
        io.to(code).emit("matchupTimeout", {
          message: "No opponent joined in time",
        });
      }
    }, 30000);

    socket.join(code);
    console.log(`Room activated: ${code}`);
    callback({ ok: true });
  });

  // Deactivate room (host stops waiting for joiners)
  socket.on("deactivateRoom", (code, callback) => {
    if (!rooms[code] || rooms[code].status !== "active") {
      return callback({ ok: false, error: "Room not found or inactive" });
    }

    rooms[code].status = "pending";
    console.log(` Room ${code} deactivated.`);
    callback({ ok: true });
  });

  // Join a room as opponent
  socket.on("joinRoom", (code, callback) => {
    const room = rooms[code];
    if (!room || room.status !== "active") {
      return callback({ ok: false, error: "Room not active" });
    }

    socket.join(code);

    // Opponent info
    const opponentInfo = socket.user
      ? { id: socket.id, ...socket.user }
      : { id: socket.id };

    // Send opponent info to host
    io.to(room.host).emit("opponentJoined", opponentInfo);

    // Send host info to joiner
    const hostSocket = io.sockets.sockets.get(room.host);
    const hostInfo = hostSocket?.user
      ? { id: room.host, ...hostSocket.user }
      : { id: room.host };

    socket.emit("hostInfo", hostInfo);

    console.log(`🎮 ${socket.id} joined room ${code}`);
    callback({ ok: true });
  });

  // =========================
  // Leaving a room
  // =========================

  // Explicit leave room/multiplayer
  socket.on("leaveRoom", ({ code }, callback) => {
    console.log(`🚪 User ${socket.id} leaving room ${code}`);
    if (!rooms[code]) return callback?.({ ok: false, error: "Room not found" });

    if (rooms[code].host === socket.id) {
      handleHostLeave(code, "Host left the game.");
    } else {
      handleJoinerLeave(socket, code);
    }

    console.log(" Current rooms:", rooms);
    callback?.({ ok: true });
  });

  socket.on("leaveMultiplayer", () => {
    console.log(`User disconnected: ${socket.id}`);
    leaveMultiplayer(socket, io, waitingPlayers);
  });

  // =========================
  //  Disconnect
  // =========================
  socket.on("disconnect", () => {
    console.log(`User disconnected: ${socket.id}`);
    leaveMultiplayer(socket, io, waitingPlayers);
  });
});

// =========================
// Start server
// =========================
const PORT = 4000;
server.listen(PORT, () => {
  console.log(` Server running on http://localhost:${PORT}`);
});
