import { io } from "socket.io-client";

const API_BASE_URL = "http://localhost"; // base host for local dev
const socket = io(`${API_BASE_URL}:4000`, {
  transports: ["websocket"], // force WebSocket for consistency
});

export default socket;