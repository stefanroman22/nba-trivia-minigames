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
const credits = []; // every /trivia/multiplayer-result/ body the relay posted, in order
// Questions store for the turn games (QUESTIONS_PUBLIC_BASE points here). The relay caches each
// file once fetched, so `slowOnce` delays only the next request for a path (a test arms it first).
const slowOnce = new Map(); // path -> ms
const Q = "/questions/v/t";
function questionFile(url) {
  const base = `http://127.0.0.1:${backendPort}`;
  const files = {
    "/questions/manifest.json": {
      schema: 1, version: "t", names: `${base}${Q}/players-names.json`,
      games: { tictactoe: { index: `${base}${Q}/tictactoe/index.json` }, imposter: { index: `${base}${Q}/imposter/index.json` } },
    },
    [`${Q}/players-names.json`]: [{ id: 1, full_name: "Kobe Bryant", aliases: [] }, { id: 2, full_name: "LeBron James", aliases: [] }],
    [`${Q}/tictactoe/index.json`]: { items: [["ttt-1"]] },
    [`${Q}/tictactoe/ttt-1.json`]: { rows: [{ label: "A" }, { label: "B" }, { label: "C" }], cols: [{ label: "D" }, { label: "E" }, { label: "F" }], valid: Array(9).fill([1, 2]) },
    [`${Q}/imposter/index.json`]: { items: [["imp-1"]] },
    [`${Q}/imposter/imp-1.json`]: { names: ["Kobe Bryant", "LeBron James"] },
  };
  return files[url];
}

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
        credits.push(body);
        res.end(JSON.stringify({ ok: true, results: body.results.map((r) => ({ public_id: r.public_id, awarded: r.score, points: 1000, rank: "Rookie" })) }));
      });
      return;
    }
    if (req.url.startsWith("/questions/")) {
      const file = questionFile(req.url);
      const ms = slowOnce.get(req.url) || 0;
      slowOnce.delete(req.url);
      setTimeout(() => { res.statusCode = file ? 200 : 404; res.end(JSON.stringify(file ?? {})); }, ms);
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
      CORS_ORIGINS: "http://localhost:5173", DATA_PUBLIC_BASE: "", QUESTIONS_PUBLIC_BASE: `http://127.0.0.1:${backendPort}`,
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
  const lateGuest = arrives(oli, "roundData", 900);
  ned.emit("startRoomNow", { code: snap.code });
  await wait(50);
  ned.emit("stopMatch", { code: snap.code });
  assert.match((await stopped).message, /host ended/);
  assert.equal((await lobby).members.length, 2);
  assert.equal(await late, false, "a round loaded after the stop reached the lobby");
  assert.equal(await lateGuest, false, "a round loaded after the stop reached a guest");
  ned.emit("leaveMatch", {});
});

test("the host cannot restart into a game that needs more players than are seated", async () => {
  const gus = await player("Gus");
  const pat = await player("Pat");
  const { code } = await startedRoom(gus, [pat]);
  const results = [next(gus, "matchResult"), next(pat, "matchResult")];
  gus.emit("submitScore", { code, score: 20, elapsedMs: 5000 });
  pat.emit("submitScore", { code, score: 10, elapsedMs: 6000 });
  await Promise.all(results);

  await wait(3100); // past RESTART_MIN_MS, so the cast is what refuses it
  const err = next(gus, "friendError");
  const restarted = arrives(pat, "matchRestart");
  gus.emit("restartRoom", { code, game: { id: "imposter" } });
  assert.match((await err).message, /at least 3/);
  assert.equal(await restarted, false, "the room restarted into a game it can't seat");
  gus.emit("leaveMatch", {});
});

/** Public ids credited by the relay's POSTs from index `from` on, sorted. */
const creditedSince = (from, game) => credits.slice(from)
  .filter((c) => !game || c.game === game)
  .flatMap((c) => c.results.map((r) => r.public_id))
  .sort();

test("a guest leaving while a restart loads neither re-settles nor re-credits the last round", async () => {
  const ann = await player("Ann");
  const bob = await player("Bob");
  const cat = await player("Cat");
  const { code } = await startedRoom(ann, [bob, cat]);
  const from = credits.length;
  const results = [ann, bob, cat].map((s) => next(s, "matchResult"));
  ann.emit("submitScore", { code, score: 30, elapsedMs: 5000 });
  bob.emit("submitScore", { code, score: 20, elapsedMs: 5000 });
  cat.emit("submitScore", { code, score: 10, elapsedMs: 5000 });
  await Promise.all(results);
  await wait(3100); // RESTART_MIN_MS since the deal; the round's credit has landed meanwhile
  assert.deepEqual(creditedSince(from), ["ANN000", "BOB000", "CAT000"]);

  const atRestart = credits.length;
  const restarted = next(ann, "matchRestart");
  ann.emit("restartRoom", { code, game: { id: "fan-favorites" } }); // its round loads slowly
  await restarted;
  const stale = arrives(ann, "matchResult", 900);
  const staleGuest = arrives(bob, "matchResult", 900);
  const roundA = next(ann, "roundData");
  const roundB = next(bob, "roundData");
  cat.emit("leaveMatch", { code });
  const [ra] = await Promise.all([roundA, roundB]);
  assert.equal(ra.game.id, "fan-favorites");
  assert.equal(await stale, false, "the finished round was settled again");
  assert.equal(await staleGuest, false, "the finished round was settled again for a guest");
  assert.equal(credits.length, atRestart, "the finished round was credited again");

  // The two left play the new round, and only it is credited.
  const again = [next(ann, "matchResult"), next(bob, "matchResult")];
  ann.emit("submitScore", { code, score: 8, elapsedMs: 5000 });
  bob.emit("submitScore", { code, score: 6, elapsedMs: 5000 });
  const [r2] = await Promise.all(again);
  assert.equal(r2.standings.length, 2);
  await wait(200);
  assert.deepEqual(creditedSince(from, "name-logo"), ["ANN000", "BOB000", "CAT000"]);
  assert.deepEqual(creditedSince(atRestart, "fan-favorites"), ["ANN000", "BOB000"]);
  ann.emit("leaveMatch", {});
});

test("a guest back after the match grace is told they left; their late score counts for nothing", async () => {
  const gus = await player("Gus");
  const hank = await player("Hank");
  const ivy = await player("Ivy");
  const { code } = await startedRoom(gus, [hank, ivy]);
  const from = credits.length;
  const left = next(gus, "memberLeft");
  ivy.close();
  await left; // the grace window (300 ms) ran out and Ivy was removed

  const ivy2 = await connect();
  const told = next(ivy2, "roomLeft");
  const resumed = arrives(ivy2, "resumeMatch", 600);
  ivy2.emit("identify", { token: tok("Ivy") });
  assert.match((await told).message, /away too long/);
  assert.equal(await resumed, false, "a removed player was resumed");

  const toldAgain = next(ivy2, "roomLeft");
  ivy2.emit("submitScore", { code, score: 50, elapsedMs: 5000 });
  assert.match((await toldAgain).message, /away too long/);

  const results = [next(gus, "matchResult"), next(hank, "matchResult")];
  gus.emit("submitScore", { code, score: 20, elapsedMs: 5000 });
  hank.emit("submitScore", { code, score: 10, elapsedMs: 5000 });
  const [rg] = await Promise.all(results);
  assert.deepEqual(rg.standings.map((s) => s.username).sort(), ["Gus", "Hank"]);
  await wait(200);
  assert.deepEqual(creditedSince(from), ["GUS000", "HANK00"]);
  gus.emit("leaveMatch", {});
});

test("a lobby guest back after the lobby grace is told they left the room", async () => {
  const jay = await player("Jay");
  const kim = await player("Kim");
  const snap = await createRoom(jay, "name-logo", 3);
  const hostSeen = next(jay, "friendLobbyUpdate"); // drain the join update
  await join(kim, snap.code);
  await hostSeen;
  const offline = next(jay, "friendLobbyUpdate");
  kim.close();
  await offline;
  const freed = next(jay, "friendLobbyUpdate");
  assert.equal((await freed).members.length, 1); // the lobby grace (300 ms) ran out

  const kim2 = await connect();
  const told = next(kim2, "roomLeft");
  kim2.emit("identify", { token: tok("Kim") });
  assert.match((await told).message, /away too long/);
  jay.emit("leaveMatch", {});
});

test("start, stop and start again is throttled like a restart", async () => {
  const lee = await player("Lee");
  const mo = await player("Mo");
  const snap = await createRoom(lee, "name-logo", 2);
  const hostSeen = next(lee, "friendLobbyUpdate"); // drain the join update
  await join(mo, snap.code);
  await hostSeen;
  const t0 = Date.now();
  const round = next(lee, "roundData");
  lee.emit("startRoomNow", { code: snap.code });
  await round;
  const lobby = next(lee, "friendLobbyUpdate");
  lee.emit("stopMatch", { code: snap.code });
  await lobby;

  const err = next(lee, "friendError");
  const early = arrives(mo, "matchFound", 300);
  lee.emit("startRoomNow", { code: snap.code });
  assert.match((await err).message, /moment/);
  assert.equal(await early, false, "the room restarted inside the throttle");

  await wait(3200 - (Date.now() - t0)); // past RESTART_MIN_MS since the first deal
  const found = next(mo, "matchFound");
  lee.emit("startRoomNow", { code: snap.code });
  assert.equal((await found).roomSize, 2);
  lee.emit("leaveMatch", {});
});

test("the host leaving mid-match closes the room for the guests", async () => {
  const ned = await player("Ned");
  const oli = await player("Oli");
  const { code } = await startedRoom(ned, [oli]);
  const closed = next(oli, "opponentLeft");
  ned.emit("leaveMatch", { code });
  assert.match((await closed).message, /host closed the room/);
});

test("the host going back to the lobby from the results says so", async () => {
  const pat = await player("Pat");
  const ann = await player("Ann");
  const { code } = await startedRoom(pat, [ann]);
  const results = [next(pat, "matchResult"), next(ann, "matchResult")];
  pat.emit("submitScore", { code, score: 5, elapsedMs: 5000 });
  ann.emit("submitScore", { code, score: 4, elapsedMs: 5000 });
  await Promise.all(results);
  const back = next(ann, "matchStopped");
  pat.emit("stopMatch", { code });
  assert.match((await back).message, /went back to the lobby/);
  pat.emit("leaveMatch", {});
});

// Turn games below. Each question file is fetched once per relay process, so the two tests that
// slow a first fetch (slowOnce) must stay the first to deal their game.

test("a guest leaving while an Imposter game loads sends the room back to the lobby", async () => {
  const gus = await player("Gus");
  const hank = await player("Hank");
  const ivy = await player("Ivy");
  const snap = await createRoom(gus, "imposter", 3);
  await join(hank, snap.code);
  await join(ivy, snap.code);
  slowOnce.set(`${Q}/imposter/imp-1.json`, 800);
  const found = next(gus, "matchFound");
  gus.emit("startRoomNow", { code: snap.code });
  await found;
  const stopped = next(gus, "matchStopped");
  const lobby = next(gus, "friendLobbyUpdate");
  const stray = arrives(gus, "turnState", 1300);
  const strayGuest = arrives(hank, "turnState", 1300);
  ivy.emit("leaveMatch", { code: snap.code });
  assert.match((await stopped).message, /Ivy left, so the match ended/);
  assert.equal((await lobby).members.length, 2);
  assert.equal(await stray, false, "the game started a seat short");
  assert.equal(await strayGuest, false, "the game started a seat short for a guest");
  gus.emit("leaveMatch", {});
});

test("a turn game that finishes loading after a newer deal leaves that deal alone", async () => {
  const dan = await player("Dan");
  const eve = await player("Eve");
  const snap = await createRoom(dan, "tictactoe", 2);
  const hostSeen = next(dan, "friendLobbyUpdate"); // drain the join update
  await join(eve, snap.code);
  await hostSeen;
  slowOnce.set(`${Q}/tictactoe/ttt-1.json`, 4000); // the first deal's question lands ~4 s after its start
  const t0 = Date.now();
  const found = next(dan, "matchFound");
  dan.emit("startRoomNow", { code: snap.code });
  await found;
  const lobby = next(dan, "friendLobbyUpdate");
  dan.emit("stopMatch", { code: snap.code });
  await lobby;

  await wait(3200 - (Date.now() - t0)); // past RESTART_MIN_MS since the first deal
  const fresh = next(dan, "turnState");
  dan.emit("startRoomNow", { code: snap.code });
  await fresh;
  assert.equal(await arrives(dan, "turnState", 1800), false, "the stale deal broadcast its board");
  // The live deal still owns the room: a bad move is refused (not silently dropped for want of turn state).
  const reject = next(dan, "turnReject");
  dan.emit("turnAction", { code: snap.code, action: { type: "claim", cell: 99, playerName: "Kobe Bryant" } });
  assert.match((await reject).message, /square/);
  dan.emit("leaveMatch", {});
});

test("a guest dropping out of a live turn game sends the room back to the lobby", async () => {
  const fay = await player("Fay");
  const gus = await player("Gus");
  const hank = await player("Hank");
  const ivy = await player("Ivy");
  const snap = await createRoom(fay, "imposter", 4);
  for (const g of [gus, hank, ivy]) await join(g, snap.code);
  const turns = [fay, gus, hank, ivy].map((s) => next(s, "turnState"));
  fay.emit("startRoomNow", { code: snap.code });
  await Promise.all(turns);
  const stopped = next(fay, "matchStopped");
  const lobby = next(fay, "friendLobbyUpdate");
  ivy.close();
  assert.match((await stopped).message, /Ivy left, so the match ended/);
  assert.equal((await lobby).members.length, 3);
  fay.emit("leaveMatch", {});
});

test("restarting into a smaller-cast game re-clamps the room size", async () => {
  const dan = await player("Dan");
  const eve = await player("Eve");
  const snap = await createRoom(dan, "name-logo", 4);
  await join(eve, snap.code);
  const rounds = [next(dan, "roundData"), next(eve, "roundData")];
  dan.emit("startRoomNow", { code: snap.code });
  await Promise.all(rounds);
  const results = [next(dan, "matchResult"), next(eve, "matchResult")];
  dan.emit("submitScore", { code: snap.code, score: 3, elapsedMs: 5000 });
  eve.emit("submitScore", { code: snap.code, score: 2, elapsedMs: 5000 });
  await Promise.all(results);
  await wait(3100); // RESTART_MIN_MS since the deal

  const turn = next(eve, "turnState");
  dan.emit("restartRoom", { code: snap.code, game: { id: "tictactoe" } });
  await turn;
  const lobby = next(eve, "friendLobbyUpdate");
  dan.emit("stopMatch", { code: snap.code });
  const l = await lobby;
  assert.equal(l.capacity, 2);
  assert.equal(l.max, 2);

  const fay = await player("Fay");
  const refused = next(fay, "friendJoinError");
  fay.emit("joinFriendRoom", { code: snap.code });
  assert.match((await refused).message, /full/);
  dan.emit("leaveMatch", {});
});
