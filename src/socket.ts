import { io } from "socket.io-client";

// Multiplayer socket server URL. Configurable via env for non-local deploys,
// with a localhost dev fallback. Allows polling fallback if WS upgrade is blocked.
const SOCKET_URL = import.meta.env.VITE_SOCKET_URL || "http://localhost:4000";

const socket = io(SOCKET_URL, {
  transports: ["websocket", "polling"],
});

export default socket;
