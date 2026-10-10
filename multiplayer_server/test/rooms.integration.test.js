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
    // fan-favorites answers late, so a test can act while its round is still loading.
    if (req.url.startsWith("/trivia/fan-favorites/")) { setTimeout(() => res.end(JSON.stringify({ series: [{ q: 1 }, { q: 2 }] })), 400); return; }
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

test("the host resizes the room within bounds; guests cannot", async () => {
  const ivy = await player("Ivy");
  const jay = await player("Jay");
  const snap = await createRoom(ivy, "name-logo", 2);
  await join(jay, snap.code);

  const up = next(jay, "friendLobbyUpdate");
  ivy.emit("setRoomSize", { code: snap.code, size: 4 });
  assert.equal((await up).capacity, 4);

  jay.emit("setRoomSize", { code: snap.code, size: 3 });
  assert.equal(await arrives(ivy, "friendLobbyUpdate"), false, "a guest resized the room");

  const floor = next(jay, "friendLobbyUpdate");
  ivy.emit("setRoomSize", { code: snap.code, size: 1 });
  assert.equal((await floor).capacity, 2, "size dropped below the seated count");
  ivy.emit("leaveMatch", {});
});

test("setRoomSize caps the size at the game's max", async () => {
  const ann = await player("Ann");
  const snap = await createRoom(ann, "name-logo", 2);
  const capped = next(ann, "friendLobbyUpdate");
  ann.emit("setRoomSize", { code: snap.code, size: 9 });
  assert.equal((await capped).capacity, 4);
  ann.emit("leaveMatch", {});
});

test("a game whose max is below the seated count is refused; otherwise the size is re-clamped", async () => {
  const kim = await player("Kim");
  const lee = await player("Lee");
  const mo = await player("Mo");
  const snap = await createRoom(kim, "name-logo", 3);
  await join(lee, snap.code);
  await join(mo, snap.code);

  const err = next(kim, "friendError");
  kim.emit("changeFriendGame", { code: snap.code, game: { id: "tictactoe" } });
  assert.match((await err).message, /2 players/);

  const ned = await player("Ned");
  const refused = next(ned, "friendJoinError");
  ned.emit("joinFriendRoom", { code: snap.code });
  assert.match((await refused).message, /full/);
  kim.emit("leaveMatch", {});
});

test("a guest leaving the lobby frees the seat; the host leaving closes it", async () => {
  const oli = await player("Oli");
  const pat = await player("Pat");
  const snap = await createRoom(oli, "name-logo", 3);
  const hostSeen = next(oli, "friendLobbyUpdate"); // drain the join update so `freed` gets the leave
  await join(pat, snap.code);
  await hostSeen;
  const freed = next(oli, "friendLobbyUpdate");
  pat.emit("leaveMatch", { code: snap.code });
  assert.equal((await freed).members.length, 1);
  const again = await join(pat, snap.code);
  assert.equal(again.members.length, 2);

  const closed = next(pat, "friendRoomCancelled");
  oli.emit("leaveMatch", { code: snap.code });
  assert.match((await closed).message, /host closed/);
});

test("a guest leaving a 3-player match lets the other two finish; two left settles at once", async () => {
  const ann = await player("Ann");
  const bob = await player("Bob");
  const cat = await player("Cat");
  const snap = await createRoom(ann, "name-logo", 3);
  await join(bob, snap.code);
  await join(cat, snap.code);
  const rounds = [next(ann, "roundData"), next(bob, "roundData"), next(cat, "roundData")];
  ann.emit("startRoomNow", { code: snap.code });
  await Promise.all(rounds);

  ann.emit("submitScore", { code: snap.code, score: 30, elapsedMs: 9000 });
  cat.emit("submitScore", { code: snap.code, score: 10, elapsedMs: 9500 });
  await wait(200);
  const left = next(ann, "memberLeft");
  const resultA = next(ann, "matchResult");
  const resultC = next(cat, "matchResult");
  bob.emit("leaveMatch", { code: snap.code });
  assert.match((await left).message, /Bob left/);
  const [ra, rc] = await Promise.all([resultA, resultC]);
  assert.equal(ra.standings.length, 2);
  assert.equal(rc.outcome, "loss");
  ann.emit("leaveMatch", {});
});

test("a guest leaving a 2-player match sends the host back to the lobby", async () => {
  const dan = await player("Dan");
  const eve = await player("Eve");
  const snap = await createRoom(dan, "name-logo", 2);
  await join(eve, snap.code);
  const round = next(dan, "roundData");
  dan.emit("startRoomNow", { code: snap.code });
  await round;
  const stopped = next(dan, "matchStopped");
  const lobby = next(dan, "friendLobbyUpdate");
  eve.emit("leaveMatch", { code: snap.code });
  assert.match((await stopped).message, /Eve left/);
  assert.equal((await lobby).members.length, 1);
  dan.emit("leaveMatch", {});
});

test("after a guest leaves, the host can switch to a smaller-cast game and the size re-clamps", async () => {
  const kim = await player("Kim");
  const lee = await player("Lee");
  const mo = await player("Mo");
  const snap = await createRoom(kim, "name-logo", 3);
  await join(lee, snap.code);
  await join(mo, snap.code);
  mo.emit("leaveMatch", { code: snap.code });
  await wait(200);
  const upd = next(lee, "friendLobbyUpdate");
  kim.emit("changeFriendGame", { code: snap.code, game: { id: "tictactoe" } });
  const u = await upd;
  assert.equal(u.game.id, "tictactoe");
  assert.equal(u.capacity, 2);
  assert.equal(u.max, 2);
  kim.emit("leaveMatch", {});
});

test("host disconnect in the lobby closes it after the grace", async () => {
  const fay = await player("Fay");
  const gus = await player("Gus");
  const snap = await createRoom(fay, "name-logo", 2);
  await join(gus, snap.code);
  const closed = next(gus, "friendRoomCancelled", 3000);
  fay.close();
  assert.match((await closed).message, /host closed/);
});

test("a guest who finished and then leaves keeps their points; the others are still credited", async () => {
  const ivy = await player("Ivy");
  const jay = await player("Jay");
  const ned = await player("Ned");
  const snap = await createRoom(ivy, "name-logo", 3);
  await join(jay, snap.code);
  await join(ned, snap.code);
  const rounds = [next(ivy, "roundData"), next(jay, "roundData"), next(ned, "roundData")];
  ivy.emit("startRoomNow", { code: snap.code });
  await Promise.all(rounds);

  const waiting = next(jay, "waitingForOpponent");
  jay.emit("submitScore", { code: snap.code, score: 15, elapsedMs: 9000 });
  await waiting;
  const jayPoints = next(jay, "pointsAwarded");
  jay.emit("leaveMatch", { code: snap.code });
  assert.equal((await jayPoints).awarded, 15);

  const results = [next(ivy, "matchResult"), next(ned, "matchResult")];
  const points = [next(ivy, "pointsAwarded"), next(ned, "pointsAwarded")];
  ivy.emit("submitScore", { code: snap.code, score: 20, elapsedMs: 9000 });
  ned.emit("submitScore", { code: snap.code, score: 12, elapsedMs: 9000 });
  await Promise.all(results);
  const [pi, pn] = await Promise.all(points);
  assert.equal(pi.awarded, 20);
  assert.equal(pn.awarded, 12);
  ivy.emit("leaveMatch", {});
});

/** Create a `size` room, seat `guests`, start it; resolves { code } once everyone has round data. */
async function startedRoom(host, guests, gameId = "name-logo") {
  const snap = await createRoom(host, gameId, guests.length + 1);
  for (const g of guests) await join(g, snap.code);
  const rounds = [host, ...guests].map((s) => next(s, "roundData"));
  host.emit("startRoomNow", { code: snap.code });
  await Promise.all(rounds);
  return { code: snap.code };
}

test("the host stops a match: everyone returns to the lobby; a guest cannot", async () => {
  const hank = await player("Hank");
  const ivy = await player("Ivy");
  const { code } = await startedRoom(hank, [ivy]);
  ivy.emit("stopMatch", { code });
  assert.equal(await arrives(hank, "matchStopped"), false, "a guest stopped the match");

  const stopped = next(ivy, "matchStopped");
  const lobbyH = next(hank, "friendLobbyUpdate");
  const lobbyI = next(ivy, "friendLobbyUpdate");
  hank.emit("stopMatch", { code });
  assert.match((await stopped).message, /host ended/);
  assert.equal((await lobbyH).members.length, 2);
  assert.equal((await lobbyI).code, code);
  hank.emit("leaveMatch", {});
});

test("after a round the host restarts or changes the game at once; guests cannot; spam is throttled", async () => {
  const jay = await player("Jay");
  const kim = await player("Kim");
  const { code } = await startedRoom(jay, [kim]);
  const results = [next(jay, "matchResult"), next(kim, "matchResult")];
  jay.emit("submitScore", { code, score: 20, elapsedMs: 5000 });
  kim.emit("submitScore", { code, score: 10, elapsedMs: 6000 });
  await Promise.all(results);

  kim.emit("restartRoom", { code, game: { id: "guess-mvps" } });
  assert.equal(await arrives(jay, "matchRestart"), false, "a guest restarted the room");
  kim.emit("proposeAgain", { code });
  assert.equal(await arrives(jay, "proposalReceived"), false, "a proposal reached a friend room");

  await wait(3100); // RESTART_MIN_MS since the deal
  const restartK = next(kim, "matchRestart");
  const roundK = next(kim, "roundData");
  jay.emit("restartRoom", { code, game: { id: "guess-mvps" } });
  assert.equal((await restartK).game.id, "guess-mvps");
  await roundK;

  // Finish the restarted round at once: back in results, but inside RESTART_MIN_MS of the deal.
  const again = [next(jay, "matchResult"), next(kim, "matchResult")];
  jay.emit("submitScore", { code, score: 5, elapsedMs: 5000 });
  kim.emit("submitScore", { code, score: 5, elapsedMs: 5000 });
  await Promise.all(again);
  const err = next(jay, "friendError");
  jay.emit("restartRoom", { code });
  assert.match((await err).message, /moment/);
  jay.emit("leaveMatch", {});
});

test("a round that finishes loading after the room went back to the lobby is dropped", async () => {
  const lee = await player("Lee");
  const mo = await player("Mo");
  const snap = await createRoom(lee, "fan-favorites", 2);
  const hostSeen = next(lee, "friendLobbyUpdate"); // drain the join update so `lobby` gets the stop
  await join(mo, snap.code);
  await hostSeen;
  const stopped = next(lee, "matchStopped");
  const lobby = next(lee, "friendLobbyUpdate");
  const late = arrives(lee, "roundData", 900);
  lee.emit("startRoomNow", { code: snap.code });
  await wait(50);
  mo.emit("leaveMatch", { code: snap.code });
  assert.match((await stopped).message, /Mo left/);
  assert.equal((await lobby).members.length, 1);
  assert.equal(await late, false, "a round loaded after the stop reached the lobby");
  lee.emit("leaveMatch", {});
});

test("the host stopping during the intro drops the loading round", async () => {
  const ned = await player("Ned");
  const oli = await player("Oli");
  const snap = await createRoom(ned, "fan-favorites", 2);
  const hostSeen = next(ned, "friendLobbyUpdate"); // drain the join update so `lobby` gets the stop
  await join(oli, snap.code);
  await hostSeen;
  const stopped = next(oli, "matchStopped");
  const lobby = next(ned, "friendLobbyUpdate");
  const late = arrives(ned, "roundData", 900);
  ned.emit("startRoomNow", { code: snap.code });
  await wait(50);
  ned.emit("stopMatch", { code: snap.code });
  assert.match((await stopped).message, /host ended/);
  assert.equal((await lobby).members.length, 2);
  assert.equal(await late, false, "a round loaded after the stop reached the lobby");
  ned.emit("leaveMatch", {});
});
