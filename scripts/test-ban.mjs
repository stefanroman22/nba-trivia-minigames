// Node test for src/utils/ban.ts (403 `account_banned` detection + the reportBan chokepoint), no dependencies:
//   npm run test:ban      (node --experimental-strip-types; Node >= 22.6)
import { test } from "node:test";
import assert from "node:assert/strict";
import { BAN_CODE, banFromResponse, isBanPayload, reportBan, setBanHandler } from "../src/utils/ban.ts";

const BODY = {
  code: "account_banned",
  error: "This account has been banned.",
  public_id: "K7F3QD",
  strikes: 3,
  reason: "name_severe",
  banned_at: "2026-10-06T12:00:00Z",
};
const json = (status, body, type = "application/json") =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": type } });

test("isBanPayload keys on code only", () => {
  assert.equal(isBanPayload(BODY), true);
  assert.equal(isBanPayload({ code: BAN_CODE }), true);
  assert.equal(isBanPayload({ code: "token_not_valid" }), false);
  assert.equal(isBanPayload({ detail: "Forbidden" }), false);
  assert.equal(isBanPayload(null), false);
  assert.equal(isBanPayload("account_banned"), false);
});

test("banFromResponse reads a 403 ban body and leaves the original body readable", async () => {
  const res = json(403, BODY);
  assert.deepEqual(await banFromResponse(res), BODY);
  assert.deepEqual(await res.json(), BODY);
});

test("banFromResponse ignores other statuses, other 403s and non-JSON", async () => {
  assert.equal(await banFromResponse(json(401, BODY)), null);
  assert.equal(await banFromResponse(json(403, { detail: "You do not have permission." })), null);
  assert.equal(await banFromResponse(json(403, BODY, "text/html")), null);
  assert.equal(await banFromResponse(new Response("{not json", { status: 403, headers: { "content-type": "application/json" } })), null);
});

test("banFromResponse fills missing fields with safe defaults", async () => {
  assert.deepEqual(await banFromResponse(json(403, { code: BAN_CODE })), {
    code: BAN_CODE,
    error: "This account has been banned.",
    public_id: "",
    strikes: 0,
    reason: "",
    banned_at: null,
  });
});

test("reportBan reaches the registered handler; unregistering stops it", () => {
  const seen = [];
  const off = setBanHandler((info) => seen.push(info));
  reportBan(BODY);
  assert.deepEqual(seen, [BODY]);
  off();
  reportBan(BODY);
  assert.equal(seen.length, 1);
});

test("reportBan without a handler is a no-op", () => {
  assert.doesNotThrow(() => reportBan(BODY));
});
