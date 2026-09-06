import { io, type Socket } from "socket.io-client";

// Multiplayer socket server URL. Configurable via env for non-local deploys,
// with a localhost dev fallback. Allows polling fallback if WS upgrade is blocked.
const SOCKET_URL = process.env.VITE_SOCKET_URL || "http://localhost:4000";

// Next.js evaluates this module on the server as well (every page is
// server-rendered), where a real connection must never open. Every consumer
// touches the socket only from effects/handlers, which run in the browser, so
// the server-side value is never dereferenced.
const socket: Socket =
  typeof window === "undefined"
    ? (null as unknown as Socket)
    : io(SOCKET_URL, {
        transports: ["websocket", "polling"],
      });

export default socket;
