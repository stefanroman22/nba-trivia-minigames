// End to end: a real relay process, real socket.io clients and a fake Django — the 2026-10-09
// hardening (null payloads, forged games, identify flooding, held events, re-identify, score
// bounds, teen masking, per-player join limit).
const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { io } = require(path.join(__dirname, "..", "..", "node_modules", "socket.io-client"));

const NAMES = ["Ann", "Bob", "Cat", "Dan", "Eve", "Fay", "Gus", "Hank", "Ivy", "Jay", "Tina", "Kim", "Lee", "Mo", "Ned"];
const tok = (name) => `tok-${name}-`.padEnd(40, "x");
const USERS = Object.fromEntries(NAMES.map((n, i) => [tok(n), {
  id: n.toUpperCase().padEnd(6, "0"), username: n, email: `${n}@example.com`, points: 10 + i, is_teen: n === "Tina",
}]));
// Far apart on the rank ladder: MVP vs Rookie.
Object.assign(USERS[tok("Mo")], { rank: "MVP", points: 2500 });
Object.assign(USERS[tok("Ned")], { rank: "Rookie", points: 15 });

let backend, server, backendPort, serverPort;
let meCalls = 0;
const credits = []; // { key, body } of every /trivia/multiplayer-result/ call
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
        credits.push({ key: req.headers["x-relay-key"], body });
        res.end(JSON.stringify({ ok: true, results: body.results.map((r) => ({ public_id: r.public_id, awarded: r.score, points: 1000 + r.score, rank: "Rookie" })) }));
      });
      return;
    }
    if (req.url.startsWith("/trivia/")) {
      res.end(JSON.stringify({ series: [{ q: 1 }, { q: 2 }] }));
      return;
    }
    meCalls += 1;
    const user = USERS[(req.headers.authorization || "").replace("Bearer ", "")];
    res.statusCode = user ? 200 : 401;
    res.end(JSON.stringify(user ? { user } : { detail: "bad token" }));
  });
  await new Promise((r) => backend.listen(0, r));
  backendPort = backend.address().port;
  serverPort = await freePort();
  server = spawn(process.execPath, [path.join(__dirname, "..", "src", "index.js")], {
    env: { ...process.env, PORT: String(serverPort), API_BASE_URL: `http://127.0.0.1:${backendPort}`, CORS_ORIGINS: "http://localhost:5173", DATA_PUBLIC_BASE: "", QUESTIONS_PUBLIC_BASE: "", MULTIPLAYER_SHARED_SECRET: "relay-key" },
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
  s.on("connect_error", (e) => reject(new Error(`connect failed (is the relay still up?): ${e.message}`)));
});
const next = (s, event, ms = 4000) => new Promise((resolve, reject) => {
  const t = setTimeout(() => reject(new Error(`timed out waiting for ${event}`)), ms);
  s.once(event, (d) => { clearTimeout(t); resolve(d); });
});
const record = (s, event) => { const got = []; s.on(event, (d) => got.push(d)); return got; };
const player = async (name) => { const s = await connect(); s.emit("identify", { token: tok(name) }); return s; };
const health = () => new Promise((resolve, reject) => {
  http.get(`http://127.0.0.1:${serverPort}/health`, (res) => {
    let body = "";
    res.on("data", (c) => { body += c; });
    res.on("end", () => resolve({ status: res.statusCode, body: JSON.parse(body), headers: res.headers }));
  }).on("error", reject);
});

/** Queue a then b for one game; resolves once both have their round. */
async function matchUp(a, b, gameId, gameA = { id: gameId }, gameB = { id: gameId }) {
  a.emit("findMatch", { game: gameA });
  await next(a, "searching");
  const foundA = next(a, "matchFound");
  const foundB = next(b, "matchFound");
  const roundA = next(a, "roundData");
  const roundB = next(b, "roundData");
  b.emit("findMatch", { game: gameB });
  const [fa, fb] = await Promise.all([foundA, foundB]);
  await Promise.all([roundA, roundB]);
  return { code: fa.code, foundA: fa, foundB: fb };
}

test("null, number and string payloads on every event leave the relay running", async () => {
  const s = await connect();
  const events = ["identify", "findMatch", "cancelFind", "createFriendRoom", "joinFriendRoom", "changeFriendGame",
    "startRoomNow", "turnAction", "submitScore", "reportProgress", "proposeAgain", "proposeSwitch",
    "respondProposal", "cancelProposal", "leaveMatch"];
  for (const e of events) s.emit(e, null);
  s.emit("submitScore", 5);
  s.emit("findMatch", "x");
  s.emit("turnAction", { code: 1, action: null });
  await wait(400);
  assert.equal(server.exitCode, null);
  const h = await health();
  assert.equal(h.status, 200);
  assert.equal(h.body.ok, true);
  assert.equal(h.headers["x-powered-by"], undefined);
});

test("a forged game object is rebuilt from its id; unknown ids are refused", async () => {
  const bob = await player("Bob");
  const ann = await player("Ann");
  const forged = { id: "guess-mvps", name: "x".repeat(500), urlPath: "https://evil.example/login", pointsPerCorrect: -5, backgroundImage: "url(https://evil.example)" };
  const { foundA } = await matchUp(bob, ann, "guess-mvps", { id: "guess-mvps" }, forged);
  assert.equal(foundA.game.urlPath, "/guess-mvps");
  assert.equal(foundA.game.backgroundImage, undefined);
  assert.equal(foundA.game.pointsPerCorrect, 0);
  assert.ok(foundA.game.name.length <= 60);

  const gus = await player("Gus");
  const err = next(gus, "matchError");
  gus.emit("findMatch", { game: { id: "__proto__" } });
  assert.match((await err).message, /can't be played online/);
});

test("identify floods cost at most a handful of Django calls; huge tokens cost none", async () => {
  const s = await connect();
  const before = meCalls;
  for (let i = 0; i < 25; i++) s.emit("identify", { token: `junk-${i}-${Math.random()}` });
  await wait(600);
  assert.ok(meCalls - before <= 6, `${meCalls - before} /api/me/ calls`);

  const big = await connect();
  const before2 = meCalls;
  const refused = next(big, "identifyError");
  big.emit("identify", { token: "a".repeat(5000) });
  assert.equal((await refused).code, "invalid_token");
  assert.equal(meCalls, before2);
});

test("a score sent before the reconnect's identify is kept, and scores are clamped", async () => {
  const cat = await player("Cat");
  const dan = await player("Dan");
  const { code } = await matchUp(cat, dan, "starting-five");

  // Cat's connection is replaced; the new socket flushes the score before it identifies,
  // the way socket.io-client sends what it buffered while offline.
  const cat2 = await connect();
  const resumed = next(cat2, "resumeMatch");
  cat2.emit("submitScore", { code, score: 3, elapsedMs: 0 });
  cat2.emit("identify", { token: tok("Cat") });
  assert.equal((await resumed).phase, "waiting");

  const result = next(cat2, "matchResult");
  dan.emit("submitScore", { code, score: 1e9, elapsedMs: 10 });
  const r = await result;
  assert.equal(r.yourScore, 3);
  assert.equal(r.opponentScore, 3000);
});

test("re-identifying the same socket does not resume or tell the opponent", async () => {
  const eve = await player("Eve");
  const fay = await player("Fay");
  await matchUp(eve, fay, "fan-favorites");
  const resumes = record(eve, "resumeMatch");
  const reconnects = record(fay, "opponentReconnected");
  eve.emit("identify", { token: tok("Eve") });
  await wait(400);
  assert.equal(resumes.length, 0);
  assert.equal(reconnects.length, 0);
});

test("a score for a room that no longer exists ends the waiting screen", async () => {
  const jay = await player("Jay");
  const left = next(jay, "opponentLeft");
  jay.emit("submitScore", { code: 999999, score: 1 });
  assert.match((await left).message, /no longer running/);
});

test("teens show their real name, photo and id to strangers in random matches (no masking since 2026-10-19)", async () => {
  const tina = await player("Tina");
  const hank = await player("Hank");
  const { code, foundA, foundB } = await matchUp(tina, hank, "series-winner");
  // Hank's view of Tina (a teen): her real name and permanent id, never "Player".
  assert.equal(foundB.opponent.username, "Tina");
  assert.equal(foundB.opponent.id, "TINA00");
  assert.equal(foundB.opponent.masked, false);
  assert.equal(foundB.opponents[0].id, "TINA00");
  assert.equal(foundA.opponent.username, "Hank");
  assert.equal(foundA.you.id, "TINA00");

  // Presence events carry her id and name too.
  const progress = next(hank, "opponentProgress");
  tina.emit("reportProgress", { code, round: 1, total: 5 });
  const prog = await progress;
  assert.equal(prog.id, "TINA00");
  assert.equal(prog.username, "Tina");

  // Hank's connection is replaced mid-round: the resume snapshot shows Tina by name and id too.
  const hank2 = await connect();
  const resumed = next(hank2, "resumeMatch");
  hank2.emit("identify", { token: tok("Hank") });
  const snap = await resumed;
  assert.equal(snap.opponents[0].id, "TINA00");
  assert.equal(snap.opponents[0].username, "Tina");
  assert.equal(snap.opponents[0].masked, false);
  assert.equal(snap.opponent.id, "TINA00");

  const finished = next(hank2, "opponentFinished");
  const resultT = next(tina, "matchResult");
  const resultH = next(hank2, "matchResult");
  tina.emit("submitScore", { code, score: 30, elapsedMs: 9000 });
  const fin = await finished;
  assert.equal(fin.id, "TINA00");
  assert.equal(fin.username, "Tina");
  hank2.emit("submitScore", { code, score: 20, elapsedMs: 9500 });
  const [rT, rH] = await Promise.all([resultT, resultH]);
  // Both sides see both real rows.
  for (const r of [rT, rH]) {
    assert.deepEqual(r.standings.map((s) => s.id).sort(), ["HANK00", "TINA00"]);
    assert.equal(r.standings.find((s) => s.id === "TINA00").username, "Tina");
    assert.equal(r.standings.every((s) => s.masked === false), true);
  }

  // A resume on the results screen rebuilds the same standings, Tina included.
  const hank3 = await connect();
  const resumed2 = next(hank3, "resumeMatch");
  hank3.emit("identify", { token: tok("Hank") });
  const snap2 = await resumed2;
  assert.equal(snap2.phase, "results");
  assert.equal(snap2.standings.find((s) => s.username === "Tina").id, "TINA00");

  tina.emit("leaveMatch", { code });
  await wait(200);

  // Friend rooms show her by name and id, as before.
  const ivy = await player("Ivy");
  const created = next(tina, "friendRoomCreated");
  tina.emit("createFriendRoom", { game: { id: "name-logo" } });
  const lobby = await created;
  const joined = next(ivy, "friendRoomJoined");
  ivy.emit("joinFriendRoom", { code: lobby.code });
  await joined;
  const found = next(ivy, "matchFound");
  tina.emit("startRoomNow", { code: lobby.code });
  const friendView = (await found).opponent;
  assert.equal(friendView.username, "Tina");
  assert.equal(friendView.id, "TINA00");
  assert.equal(friendView.masked, false);
});

test("the join-code limit follows the player across reconnects", async () => {
  const a = await player("Gus");
  for (let i = 0; i < 8; i++) a.emit("joinFriendRoom", { code: 100000 + i });
  await wait(400);
  a.close();
  const b = await player("Gus");
  const err = next(b, "friendJoinError");
  b.emit("joinFriendRoom", { code: 123456 });
  assert.match((await err).message, /Too many attempts/);
});

test("a finished match credits both players' profiles once, through the relay key", async () => {
  const kim = await player("Kim");
  const lee = await player("Lee");
  const { code } = await matchUp(kim, lee, "wordle");
  const kimPts = next(kim, "pointsAwarded");
  const leePts = next(lee, "pointsAwarded");
  kim.emit("submitScore", { code, score: 120, elapsedMs: 9000 });
  lee.emit("submitScore", { code, score: 80, elapsedMs: 9500 });
  assert.equal((await kimPts).awarded, 120);
  assert.equal((await leePts).awarded, 80);
  const mine = credits.filter((c) => c.body.results.some((r) => r.public_id === USERS[tok("Kim")].id));
  assert.equal(mine.length, 1);
  assert.equal(mine[0].key, "relay-key");
  assert.equal(mine[0].body.mode, "match");
  assert.equal(mine[0].body.game, "wordle");
  // Leaving afterwards must not credit the same round again.
  kim.emit("leaveMatch", { code });
  await wait(300);
  assert.equal(credits.filter((c) => c.body.results.some((r) => r.public_id === USERS[tok("Kim")].id)).length, 1);
});

test("players far apart in rank are matched at once when nobody closer is waiting", async () => {
  const mo = await player("Mo");
  const ned = await player("Ned");
  mo.emit("findMatch", { game: { id: "who-would-win" } });
  await next(mo, "searching");
  const t0 = Date.now();
  const found = next(ned, "matchFound", 2000);
  ned.emit("findMatch", { game: { id: "who-would-win" } });
  const m = await found;
  assert.equal(m.opponent.username, "Mo");
  assert.ok(Date.now() - t0 < 1000, `took ${Date.now() - t0} ms`);
});
