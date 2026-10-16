// A socket.io client of the relay for the rooms suite (node, no browser), identifying exactly as the site does:
// src/socket.ts opens `io(url, { transports: ['websocket', 'polling'], tryAllTransports: true })` and
// src/context/MultiplayerContext.tsx identifyNow() sends `identify { token }` (the Django access token only; the relay asks
// Django's /api/me/ who it is, multiplayer_server/src/identity.js). No Origin header: the relay admits non-browser clients
// (allowRequest) and they still need a valid token for every gated action.
//   const c = await connect('host', { url, token })   → client (connected; identify sent when a token is given)
//   c.emit(event, payload)                             fire and forget (the relay answers with events, not acks)
//   await c.emitAck(event, payload, { timeout })       a socket.io ack round trip (for an event that acks; the relay's
//                                                      current protocol has none, so this rejects on timeout)
//   c.mark()                                           the current position in the event log
//   await c.waitFor(event, { timeout, filter, since }) the first `event` at log index ≥ since (default 0) whose payload
//                                                      passes filter → its payload; rejects after timeout naming the
//                                                      events that did arrive
//   await c.quiet(event, { within, filter, since })    null when no such event arrives within `within` ms, else its payload
//   c.events()                                         [{ event, data, at }] everything received, in order
//   c.identify(token)                                  send identify again
//   await c.leave()                                    leaveMatch {} + cancelFind (the relay finds the room by the player)
//   c.drop()                                           disconnect WITHOUT leaving (the relay's disconnect / grace path)
//   await c.close()                                    leave(), then disconnect; safe to call twice — always in `finally`
import { io } from 'socket.io-client';

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const brief = (log, n = 8) => log.slice(-n).map((e) => e.event).join(', ') || 'nothing';

export async function connect(role, { url, token = null, timeout = 8000 } = {}) {
  if (!/^https?:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/.test(String(url))) throw new Error(`socket: ${url} is not a local relay (the rooms suite never opens a socket to a deployed one)`);
  const socket = io(url, { transports: ['websocket', 'polling'], tryAllTransports: true, reconnection: false, forceNew: true, timeout });
  const log = [];
  const waiters = new Set();
  socket.onAny((event, data) => {
    const e = { event, data, at: Date.now() };
    log.push(e);
    for (const w of [...waiters]) w(e, log.length - 1);
  });
  await new Promise((resolve, reject) => {
    const t = setTimeout(() => { socket.close(); reject(new Error(`socket ${role}: no connection to ${url} within ${timeout} ms`)); }, timeout);
    socket.once('connect', () => { clearTimeout(t); resolve(); });
    socket.once('connect_error', (e) => { clearTimeout(t); socket.close(); reject(new Error(`socket ${role}: connect_error ${e.message}`)); });
  });
  let closed = false;

  const find = (event, filter, since) => {
    for (let i = Math.max(0, since); i < log.length; i++) if (log[i].event === event && filter(log[i].data)) return log[i];
    return null;
  };

  const c = {
    role,
    socket,
    get connected() { return socket.connected; },
    emit: (event, payload) => { socket.emit(event, payload); },
    emitAck: (event, payload, { timeout: ms = 5000 } = {}) => socket.timeout(ms).emitWithAck(event, payload),
    mark: () => log.length,
    events: () => log.map(({ event, data, at }) => ({ event, data, at })),
    waitFor(event, { timeout: ms = 8000, filter = () => true, since = 0 } = {}) {
      const hit = find(event, filter, since);
      if (hit) return Promise.resolve(hit.data);
      return new Promise((resolve, reject) => {
        const w = (e, i) => { if (i >= since && e.event === event && filter(e.data)) { clearTimeout(t); waiters.delete(w); resolve(e.data); } };
        const t = setTimeout(() => { waiters.delete(w); reject(new Error(`${role}: no ${event} within ${ms} ms (received: ${brief(log.slice(since))})`)); }, ms);
        waiters.add(w);
      });
    },
    async quiet(event, { within = 800, filter = () => true, since = 0 } = {}) {
      try { return await c.waitFor(event, { timeout: within, filter, since }); } catch { return null; }
    },
    identify: (t) => { socket.emit('identify', { token: t }); },
    async leave() {
      if (!socket.connected) return;
      socket.emit('leaveMatch', {});
      socket.emit('cancelFind');
      await wait(150); // let the relay process both before a disconnect could race them
    },
    drop: () => { closed = true; socket.disconnect(); },
    async close() {
      if (closed) return;
      closed = true;
      try { await c.leave(); } finally { socket.disconnect(); }
    },
  };
  if (token) c.identify(token);
  return c;
}
