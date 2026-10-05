const test = require("node:test");
const assert = require("node:assert/strict");
const { createVerifier, meUrlFrom } = require("../src/auth");

const TOKEN = "t".repeat(40);
const reply = (status, body) => async () => ({ status, ok: status >= 200 && status < 300, json: async () => body });

test("meUrlFrom accepts the backend root with or without /api", () => {
  assert.equal(meUrlFrom("https://b.example"), "https://b.example/api/me/");
  assert.equal(meUrlFrom("https://b.example/api"), "https://b.example/api/me/");
  assert.equal(meUrlFrom("https://b.example/api/"), "https://b.example/api/me/");
});

test("a token the backend accepts yields the backend's user, sent as a Bearer header", async () => {
  let seen;
  const verify = createVerifier({
    apiBaseUrl: "https://b.example/api",
    fetchImpl: async (url, init) => {
      seen = { url, auth: init.headers.Authorization };
      return reply(200, { user: { id: "K7F3QD", username: "Ann" } })();
    },
  });
  const out = await verify(TOKEN);
  assert.deepEqual(out, { ok: true, user: { id: "K7F3QD", username: "Ann" } });
  assert.deepEqual(seen, { url: "https://b.example/api/me/", auth: `Bearer ${TOKEN}` });
});

test("a 401 is invalid; a 500, a network error and a malformed body are unavailable", async () => {
  const run = (fetchImpl) => createVerifier({ apiBaseUrl: "x", fetchImpl })(TOKEN);
  assert.deepEqual(await run(reply(401, {})), { ok: false, reason: "invalid" });
  assert.deepEqual(await run(reply(500, {})), { ok: false, reason: "unavailable" });
  assert.deepEqual(await run(async () => { throw new Error("down"); }), { ok: false, reason: "unavailable" });
  assert.deepEqual(await run(reply(200, { nope: 1 })), { ok: false, reason: "unavailable" });
});

test("missing, short or oversized tokens never reach the backend", async () => {
  let calls = 0;
  const verify = createVerifier({ apiBaseUrl: "x", fetchImpl: async () => { calls++; return reply(200, {})(); } });
  for (const bad of [undefined, null, 5, "", "short", "x".repeat(5000)]) {
    assert.deepEqual(await verify(bad), { ok: false, reason: "invalid" });
  }
  assert.equal(calls, 0);
});

test("a verdict is reused until its ttl lapses, then re-checked", async () => {
  let calls = 0;
  let clock = 0;
  const verify = createVerifier({
    apiBaseUrl: "x",
    ttlMs: 1000,
    now: () => clock,
    fetchImpl: async () => { calls++; return reply(200, { user: { id: "A" } })(); },
  });
  await verify(TOKEN);
  await verify(TOKEN);
  assert.equal(calls, 1);
  clock = 1001;
  await verify(TOKEN);
  assert.equal(calls, 2);
});

test("rejections are not cached", async () => {
  let calls = 0;
  const verify = createVerifier({ apiBaseUrl: "x", fetchImpl: async () => { calls++; return reply(401, {})(); } });
  await verify(TOKEN);
  await verify(TOKEN);
  assert.equal(calls, 2);
});
