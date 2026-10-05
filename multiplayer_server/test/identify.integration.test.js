// End to end: a real multiplayer server process, a fake Django /me/, real socket.io clients.
const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { io } = require(path.join(__dirname, "..", "..", "node_modules", "socket.io-client"));

const GOOD = "good-token-".padEnd(40, "x");
const GOOD_2 = "good-token-2-".padEnd(40, "y");
const USERS = { [GOOD]: { id: "AAAAAA", username: "Ann", points: 10 }, [GOOD_2]: { id: "BBBBBB", username: "Bob", points: 12 } };
const GAME = { id: "name-logo", name: "Name Logo" };

let backend, server, port, serverPort;
const sockets = [];

const freePort = () => new Promise((resolve) => {
  const s = http.createServer().listen(0, () => { const p = s.address().port; s.close(() => resolve(p)); });
});

test.before(async () => {
  backend = http.createServer((req, res) => {
    const user = USERS[(req.headers.authorization || "").replace("Bearer ", "")];
    res.writeHead(user ? 200 : 401, { "Content-Type": "application/json" });
    res.end(JSON.stringify(user ? { user } : { detail: "bad token" }));
  });
  await new Promise((r) => backend.listen(0, r));
  port = backend.address().port;
  serverPort = await freePort();
  server = spawn(process.execPath, [path.join(__dirname, "..", "src", "index.js")], {
    env: { ...process.env, PORT: String(serverPort), API_BASE_URL: `http://127.0.0.1:${port}/api`, CORS_ORIGINS: "http://localhost:5173" },
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

const connect = () => new Promise((resolve) => {
  const s = io(`http://127.0.0.1:${serverPort}`, { transports: ["websocket"] });
  sockets.push(s);
  s.on("connect", () => resolve(s));
});
const next = (s, event) => new Promise((resolve) => s.once(event, resolve));

test("a bad token is rejected and the socket cannot queue for a match", async () => {
  const s = await connect();
  const rejected = next(s, "identifyRejected");
  const matchError = next(s, "matchError");
  s.emit("identify", { token: "forged-token".padEnd(40, "z"), user: { id: "AAAAAA", username: "Ann" } });
  s.emit("findMatch", { game: GAME });
  assert.deepEqual(await rejected, { reason: "invalid" });
  assert.match((await matchError).message, /signed in/);
});

test("a client-claimed user without a token gets nowhere", async () => {
  const s = await connect();
  const rejected = next(s, "identifyRejected");
  s.emit("identify", { user: { id: "AAAAAA", username: "Ann" } });
  assert.deepEqual(await rejected, { reason: "invalid" });
});

test("a valid token identifies the player, and an action sent right behind it waits for the verdict", async () => {
  const s = await connect();
  const searching = next(s, "searching");
  s.emit("identify", { token: GOOD });
  s.emit("findMatch", { game: GAME });
  assert.equal((await searching).inQueue, 1);
});

test("a browser origin that is not allowed cannot connect at all", async () => {
  const refused = await new Promise((resolve) => {
    const s = io(`http://127.0.0.1:${serverPort}`, {
      transports: ["websocket"],
      extraHeaders: { Origin: "http://localhost:3000" },
      reconnection: false,
    });
    sockets.push(s);
    s.on("connect", () => resolve(false));
    s.on("connect_error", () => resolve(true));
  });
  assert.equal(refused, true);
});
