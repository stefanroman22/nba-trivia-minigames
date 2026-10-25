// A socket.io client of the relay for the rooms suite (node, no browser), identifying exactly as the site does:
// src/socket.ts opens `io(url, { transports: ['websocket', 'polling'], tryAllTransports: true })` and
// src/context/MultiplayerContext.tsx identifyNow() sends `identify { token }` (the Django access token only; the relay asks
// Django's /api/me/ who it is, multiplayer_server/src/identity.js). No Origin header: the relay admits non-browser clients
// (allowRequest) and they still need a valid token for every gated action. The relay acks nothing: every answer is an
// event, so waits read the event log from a position taken before the emit.
//   const c = await connect('host', { url, token })   → client (connected; identify sent when a token is given). A
//                                                      connect_error is not final while another transport may still
//                                                      succeed: only the timeout rejects (naming the last error).
//   c.emit(event, payload)                             fire and forget
//   c.mark()                                           the current position in the event log
//   await c.waitFor(event, { timeout, filter, since }) the first `event` at log index ≥ since (default 0) whose payload
//                                                      passes filter → its payload; rejects after timeout naming the
//                                                      events that did arrive
//   await c.quiet(event, { within, filter, since })    null when no such event arrives within `within` ms, else its payload
//   c.events()                                         [{ event, data, at }] everything received, in order
//   c.identify(token)                                  send identify again
//   await c.leave()                                    leaveMatch {} + cancelFind (the relay finds the room by the player)
//   c.drop()                                           disconnect WITHOUT leaving (the relay's disconnect / grace path)
//   await c.close()                                    leave(), then disconnect; safe to call twice — always in `finally`.
//                                                      When the socket dropped by itself (not drop()), the relay still
//                                                      holds the player's seat for its grace (GRACE_MS 30 s in a match,
//                                                      LOBBY_GRACE_MS 10 s in a lobby) and the next test would RESUME
//                                                      that room: close() then connects once more with the same token,
//                                                      identifies (which resumes the seat), leaves and disconnects.
import { io } from 'socket.io-client';

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
// An *Error event carries its message (e.g. friendJoinError "No room found for that code."), so a timeout says why.
const brief = (log, n = 8) => log.slice(-n).map((e) => (/Error$/.test(e.event) && e.data && typeof e.data.message === 'string' ? `${e.event} "${e.data.message.slice(0, 80)}"` : e.event)).join(', ') || 'nothing';
const OPTIONS = { transports: ['websocket', 'polling'], tryAllTransports: true, reconnection: false, forceNew: true };

/** An io() socket, connected → resolves it; rejects only after `timeout` (with the last connect_error). */
function open(role, url, timeout) {
  const socket = io(url, { ...OPTIONS, timeout });
  return new Promise((resolve, reject) => {
    let last = null;
    const onError = (e) => { last = e; };
    const t = setTimeout(() => { socket.off('connect_error', onError); socket.close(); reject(new Error(`socket ${role}: no connection to ${url} within ${timeout} ms${last ? ` (last connect_error: ${last.message})` : ''}`)); }, timeout);
    socket.on('connect_error', onError);
    socket.once('connect', () => { clearTimeout(t); socket.off('connect_error', onError); resolve(socket); });
  });
}

export async function connect(role, { url, token = null, timeout = 8000 } = {}) {
  if (!/^https?:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/.test(String(url))) throw new Error(`socket: ${url} is not a local relay (the rooms suite never opens a socket to a deployed one)`);
  const socket = await open(role, url, timeout);
  const log = [];
  const waiters = new Set();
  socket.onAny((event, data) => {
    const e = { event, data, at: Date.now() };
    log.push(e);
    for (const w of [...waiters]) w(e, log.length - 1);
  });
  let closed = false;
  let identified = token;

  const find = (event, filter, since) => {
    for (let i = Math.max(0, since); i < log.length; i++) if (log[i].event === event && filter(log[i].data)) return log[i];
    return null;
  };

  const c = {
    role,
    socket,
    get connected() { return socket.connected; },
    emit: (event, payload) => { socket.emit(event, payload); },
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
    identify: (t) => { identified = t; socket.emit('identify', { token: t }); },
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
      if (socket.connected) {
        try { await c.leave(); } finally { socket.disconnect(); }
        return;
      }
      socket.close();
      if (!identified) return;
      // Dropped by itself: free the seat now instead of leaving it to the relay's grace timer.
      const again = await open(`${role}/cleanup`, url, timeout).catch(() => null);
      if (!again) return;
      again.emit('identify', { token: identified });
      again.emit('leaveMatch', {}); // held by the relay until the identify settles, then run as this player
      again.emit('cancelFind');
      await wait(400);
      again.disconnect();
    },
  };
  if (token) c.identify(token);
  return c;
}
