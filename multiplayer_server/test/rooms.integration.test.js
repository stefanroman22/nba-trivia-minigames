// End to end: a real relay process, real socket.io clients and a fake Django — friend rooms v2
// (host-chosen size, host-started games, host controls, leave semantics).
const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { io } = require(path.join(__dirname, "..", "..", "node_modules", "socket.io-client"));

const NAMES = ["Ann", "Bob", "Cat", "Dan", "Eve", "Fay", "Gus", "Hank", "Ivy", "Jay", "Kim", "Lee", "Mo", "Ned", "Oli", "Pat"];
const tok = (name) => `tok-${name}-`.padEnd(40, "x");
const USERS = Object.fromEntries(NAMES.map((n, i) => [tok(n), {
  id: n.toUpperCase().padEnd(6, "0"), username: n, email: `${n}@example.com`, points: 10 + i,
}]));

let backend, server, backendPort, serverPort;
const sockets = [];

const freePort = () => new Promise((resolve) => {
  const s = http.createServer().listen(0, () => { const p = s.address().port; s.close(() => resolve(p)); });
});
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

test.before(async () => {
  backend = http.createServer((req, res) => {
    res.setHeader("Content-Type", "application/json");
    if (req.url.startsWith("/trivia/multiplayer-result/")) {
      let raw = "";
      req.on("data", (c) => { raw += c; });
      req.on("end", () => {
        const body = JSON.parse(raw);
        res.end(JSON.stringify({ ok: true, results: body.results.map((r) => ({ public_id: r.public_id, awarded: r.score, points: 1000, rank: "Rookie" })) }));
      });
      return;
    }
    if (req.url.startsWith("/trivia/")) { res.end(JSON.stringify({ series: [{ q: 1 }, { q: 2 }] })); return; }
    const user = USERS[(req.headers.authorization || "").replace("Bearer ", "")];
    res.statusCode = user ? 200 : 401;
    res.end(JSON.stringify(user ? { user } : { detail: "bad token" }));
  });
  await new Promise((r) => backend.listen(0, r));
  backendPort = backend.address().port;
  serverPort = await freePort();
  server = spawn(process.execPath, [path.join(__dirname, "..", "src", "index.js")], {
    env: {
      ...process.env, PORT: String(serverPort), API_BASE_URL: `http://127.0.0.1:${backendPort}`,
      CORS_ORIGINS: "http://localhost:5173", DATA_PUBLIC_BASE: "", QUESTIONS_PUBLIC_BASE: "",
      MULTIPLAYER_SHARED_SECRET: "relay-key", LOBBY_GRACE_MS: "300", GRACE_MS: "300",
    },
    stdio: ["ignore", "pipe", "inherit"],
  });
  await new Promise((resolve, reject) => {
    server.stdout.on("data", (d) => String(d).includes("Multiplayer server on") && resolve());
    server.once("exit", () => reject(new Error("server exited early")));
  });
});

test.after(() => {
  sockets.forEach((s) => s.close());
  server?.kill();
  backend?.close();
});

const connect = () => new Promise((resolve, reject) => {
  const s = io(`http://127.0.0.1:${serverPort}`, { transports: ["websocket"], reconnection: false, timeout: 4000 });
  sockets.push(s);
  s.on("connect", () => resolve(s));
  s.on("connect_error", (e) => reject(new Error(`connect failed: ${e.message}`)));
});
const next = (s, event, ms = 4000) => new Promise((resolve, reject) => {
  const t = setTimeout(() => reject(new Error(`timed out waiting for ${event}`)), ms);
  s.once(event, (d) => { clearTimeout(t); resolve(d); });
});
/** Resolves true if `event` arrives within `ms`, false otherwise (for "must NOT happen" checks). */
const arrives = (s, event, ms = 400) => new Promise((resolve) => {
  const t = setTimeout(() => { s.off(event, on); resolve(false); }, ms);
  const on = () => { clearTimeout(t); resolve(true); };
  s.once(event, on);
});
const player = async (name) => { const s = await connect(); s.emit("identify", { token: tok(name) }); await wait(150); return s; };

/** Host creates a room of `size` for `gameId`; resolves the lobby snapshot. */
async function createRoom(host, gameId, size) {
  const created = next(host, "friendRoomCreated");
  host.emit("createFriendRoom", { game: { id: gameId }, size });
  return created;
}
/** Guest joins `code`; resolves the guest's lobby snapshot. */
async function join(guest, code) {
  const joined = next(guest, "friendRoomJoined");
  guest.emit("joinFriendRoom", { code });
  return joined;
}

test("a room takes the host's size, clamped to the game's bounds", async () => {
  const ann = await player("Ann");
  const snap = await createRoom(ann, "name-logo", 3);
  assert.equal(snap.capacity, 3);
  assert.equal(snap.min, 2);
  assert.equal(snap.max, 4);
  ann.emit("leaveMatch", { code: snap.code });
  await wait(200);

  const bob = await player("Bob");
  assert.equal((await createRoom(bob, "name-logo", 9)).capacity, 4);
  bob.emit("leaveMatch", {});
  await wait(200);

  const cat = await player("Cat");
  const ttt = await createRoom(cat, "tictactoe", 3);
  assert.equal(ttt.capacity, 2);
  assert.equal(ttt.max, 2);
  cat.emit("leaveMatch", {});
});

test("a full room does not start by itself; only the host starts it", async () => {
  const dan = await player("Dan");
  const eve = await player("Eve");
  const snap = await createRoom(dan, "name-logo", 2);
  const hostUpdate = next(dan, "friendLobbyUpdate");
  const joined = await join(eve, snap.code);
  assert.equal(joined.members.length, 2);
  assert.equal((await hostUpdate).members.length, 2);
  assert.equal(await arrives(dan, "matchFound"), false, "the full room started on its own");

  eve.emit("startRoomNow", { code: snap.code });
  assert.equal(await arrives(eve, "matchFound"), false, "a guest started the room");

  const foundA = next(dan, "matchFound");
  const foundB = next(eve, "matchFound");
  dan.emit("startRoomNow", { code: snap.code });
  const [a, b] = await Promise.all([foundA, foundB]);
  assert.equal(a.roomSize, 2);
  assert.equal(b.role, "guest");
  dan.emit("leaveMatch", { code: snap.code });
});

test("the host cannot start alone", async () => {
  const fay = await player("Fay");
  const snap = await createRoom(fay, "name-logo", 3);
  const err = next(fay, "friendError");
  fay.emit("startRoomNow", { code: snap.code });
  assert.match((await err).message, /at least 2/);
  fay.emit("leaveMatch", {});
});

test("the host cannot start while a seated player is reconnecting", async () => {
  const gus = await player("Gus");
  const hank = await player("Hank");
  const snap = await createRoom(gus, "name-logo", 2);
  const hostSeen = next(gus, "friendLobbyUpdate"); // drain the join update so `offline` gets the drop
  await join(hank, snap.code);
  await hostSeen;
  const offline = next(gus, "friendLobbyUpdate");
  hank.close();
  assert.equal((await offline).members.find((m) => m.username === "Hank").online, false);
  const err = next(gus, "friendError");
  gus.emit("startRoomNow", { code: snap.code });
  assert.match((await err).message, /reconnect/);
  gus.emit("leaveMatch", {});
});
