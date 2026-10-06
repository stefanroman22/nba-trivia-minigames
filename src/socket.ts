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

// Next.js evaluates this module on the server as well (every page is
// server-rendered), where a real connection must never open. Every consumer
// touches the socket only from effects/handlers, which run in the browser, so
// the server-side value is never dereferenced.
const socket: Socket =
  typeof window === "undefined"
    ? (null as unknown as Socket)
    : io(SOCKET_URL || "http://localhost:4000", {
        transports: ["websocket", "polling"],
        autoConnect: Boolean(SOCKET_URL),
      });

export default socket;
