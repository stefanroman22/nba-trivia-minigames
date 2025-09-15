// src/socket.js
import { io } from "socket.io-client";

// point this to where your Node.js server runs
// for local dev: http://localhost:4000
const socket = io("http://localhost:4000", {
  transports: ["websocket"], // force WebSocket for consistency
});

export default socket;