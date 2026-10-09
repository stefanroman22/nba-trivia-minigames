import { io, type Socket } from "socket.io-client";

// Multiplayer socket server URL. Multiplayer is billed by usage, so:
//  - a local run (`next dev`) only ever connects to a local server (scripts/dev.mjs starts
//    one on :4000), whatever VITE_SOCKET_URL says;
//  - a production build uses VITE_SOCKET_URL only, and has no localhost fallback.
// With no URL the socket never connects and the UI says it can't reach the game server.
const configured = process.env.VITE_SOCKET_URL || "";
const isLocalUrl = (url: string) => /^https?:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/.test(url);
const SOCKET_URL =
  process.env.NODE_ENV === "production"
    ? configured
    : isLocalUrl(configured) ? configured : "http://localhost:4000";

/** False when no game server is configured: the provider then never connects. */
export const socketConfigured = Boolean(SOCKET_URL);

// Next.js evaluates this module on the server as well (every page is
// server-rendered), where a real connection must never open. Every consumer
// touches the socket only from effects/handlers, which run in the browser, so
// the server-side value is never dereferenced.
// No auto-connect: only signed-in visitors can play online, so MultiplayerProvider
// connects on sign-in and disconnects on sign-out (guests hold no connection).
const socket: Socket =
  typeof window === "undefined"
    ? (null as unknown as Socket)
    : io(SOCKET_URL || "http://localhost:4000", {
        transports: ["websocket", "polling"],
        // Without this the client never falls back to polling when websockets are blocked.
        tryAllTransports: true,
        autoConnect: false,
      });

export default socket;
