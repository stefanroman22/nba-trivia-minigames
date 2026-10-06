// node --test scripts/test_identity.js — relay token verification (src/identity.js), no network.
const test = require("node:test");
const assert = require("node:assert/strict");
const { verifyToken, VERIFY_TTL_MS, _cache } = require("../src/identity");

function fakeFetch(status, body) {
  const calls = [];
  const fn = async (url, opts) => {
    calls.push({ url, opts });
    if (status instanceof Error) throw status;
    return { status, json: async () => body };
  };
  fn.calls = calls;
  return fn;
}

const opts = (fetchImpl, now = () => 1000) => ({ fetchImpl, now, apiBaseUrl: "http://api.test" });

test.beforeEach(() => _cache.clear());

test("200 -> ok with the server's user, sent as a Bearer token to /api/me/", async () => {
  const f = fakeFetch(200, { user: { id: "K7F3QD", username: "Baller" } });
  const v = await verifyToken("tok-a", opts(f));
  assert.deepEqual(v, { ok: true, user: { id: "K7F3QD", username: "Baller" } });
  assert.equal(f.calls[0].url, "http://api.test/api/me/");
  assert.equal(f.calls[0].opts.headers.Authorization, "Bearer tok-a");
});

test("403 account_banned -> account_banned", async () => {
  const v = await verifyToken("tok-b", opts(fakeFetch(403, { code: "account_banned", error: "This account has been banned." })));
  assert.equal(v.ok, false);
  assert.equal(v.code, "account_banned");
});

test("401 -> invalid_token", async () => {
  const v = await verifyToken("tok-c", opts(fakeFetch(401, { code: "token_not_valid" })));
  assert.equal(v.code, "invalid_token");
});

test("missing token -> invalid_token without a request", async () => {
  const f = fakeFetch(200, { user: { id: "X" } });
  assert.equal((await verifyToken(undefined, opts(f))).code, "invalid_token");
  assert.equal(f.calls.length, 0);
});

test("thrown fetch -> auth_unavailable (fails closed, not cached)", async () => {
  const f = fakeFetch(new Error("ECONNREFUSED"));
  assert.equal((await verifyToken("tok-d", opts(f))).code, "auth_unavailable");
  await verifyToken("tok-d", opts(f));
  assert.equal(f.calls.length, 2);
});

test("a second call within the TTL is served from cache; after it, fetch runs again", async () => {
  const f = fakeFetch(200, { user: { id: "K7F3QD" } });
  let t = 1000;
  const o = opts(f, () => t);
  await verifyToken("tok-e", o);
  t += VERIFY_TTL_MS - 1;
  await verifyToken("tok-e", o);
  assert.equal(f.calls.length, 1);
  t += 2;
  await verifyToken("tok-e", o);
  assert.equal(f.calls.length, 2);
});

// ---------------------------------------------------------------- the relay itself (src/index.js)
// Loaded with the same Module._load seam as scripts/sim_round_fanout.js: fake socket.io, and a
// global fetch that plays Django's /api/me/ for three tokens.
const Module = require("module");

function loadRelay() {
  const fakeIo = {
    handlers: {},
    sockets: { sockets: new Map() },
    on(event, fn) { this.handlers[event] = fn; },
    to() { return { emit() {} }; },
    adapter() {},
  };
  const stubs = {
    express: Object.assign(() => ({ use() {}, get() {} }), { json: () => () => {} }),
    cors: () => () => {},
    "socket.io": { Server: function Server() { return fakeIo; } },
    http: { createServer: () => ({ listen() {} }) },
  };
  const ME = {
    "good-token": { status: 200, body: { user: { id: "REAL01", username: "Real", email: "r@example.com", points: 10 } } },
    "banned-token": { status: 403, body: { code: "account_banned", error: "This account has been banned." } },
  };
  global.fetch = async (url, init) => {
    const token = init.headers.Authorization.slice("Bearer ".length);
    const r = ME[token] || { status: 401, body: { code: "token_not_valid" } };
    return { status: r.status, json: async () => r.body };
  };
  const originalLoad = Module._load;
  Module._load = function (request) {
    if (Object.prototype.hasOwnProperty.call(stubs, request)) return stubs[request];
    return originalLoad.apply(this, arguments);
  };
  const log = console.log;
  console.log = () => {};
  try {
    require("../src/index");
  } finally {
    Module._load = originalLoad;
    console.log = log;
  }
  let n = 0;
  return function makeSocket() {
    const socket = {
      id: `s${++n}`, handlers: {}, events: [], disconnected: false,
      on(e, fn) { this.handlers[e] = fn; },
      emit(e, p) { this.events.push([e, p]); },
      join() {}, leave() {},
      disconnect() { this.disconnected = true; this.handlers.disconnect?.(); },
      send(e, p) { return this.handlers[e]?.(p); },
    };
    fakeIo.sockets.sockets.set(socket.id, socket);
    fakeIo.handlers.connection(socket);
    return socket;
  };
}

const makeSocket = loadRelay();
const quiet = (fn) => async () => {
  const log = console.log;
  console.log = () => {};
  try { await fn(); } finally { console.log = log; }
};

test("relay: a banned token gets identifyError account_banned and the socket is dropped", quiet(async () => {
  _cache.clear();
  const s = makeSocket();
  s.send("identify", { user: { id: "REAL01" }, token: "banned-token" });
  await s.identifying;
  assert.deepEqual(s.events.find(([e]) => e === "identifyError")?.[1]?.code, "account_banned");
  assert.equal(s.disconnected, true);
  assert.equal(s.uid, undefined);
}));

test("relay: the player is keyed by the server's id, never the claimed one", quiet(async () => {
  _cache.clear();
  const s = makeSocket();
  s.send("identify", { user: { id: "VICTIM", username: "Someone" }, token: "good-token" });
  await s.identifying;
  assert.equal(s.uid, "REAL01");
}));

test("relay: identify without a token is refused, and gated actions say sign in", quiet(async () => {
  _cache.clear();
  const s = makeSocket();
  s.send("identify", { user: { id: "VICTIM" } });
  await s.identifying;
  assert.equal(s.events.find(([e]) => e === "identifyError")?.[1]?.code, "invalid_token");
  assert.equal(s.uid, undefined);
  await s.send("findMatch", { game: { id: "wordle" } });
  assert.match(s.events.find(([e]) => e === "matchError")?.[1]?.message, /signed in/);
}));
