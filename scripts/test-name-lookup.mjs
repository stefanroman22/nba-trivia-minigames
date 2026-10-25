// Node test for the typed-name → player lookups (src/utils/questions.ts buildNameLookup and its relay mirror
// multiplayer_server/src/questions.js nameLookup): namesakes all reachable, suffix-less names, exact names first.
//   npm run test:name-lookup      (node --experimental-strip-types; Node >= 22.6)
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire, register } from "node:module";

// questions.ts imports its siblings without extensions (bundler style): add ".ts", as test-game-data.mjs does.
register("data:text/javascript," + encodeURIComponent(`
  export async function resolve(spec, ctx, next) {
    if (/^\\.\\.?\\//.test(spec) && !/\\.[cm]?[jt]s$/.test(spec) && ctx.parentURL?.includes("/src/")) return next(spec + ".ts", ctx);
    return next(spec, ctx);
  }`));
const { buildNameLookup } = await import("../src/utils/questions.ts");
const { nameLookup } = createRequire(import.meta.url)("../multiplayer_server/src/questions.js");

const NAMES = [
  { id: 698, full_name: "Eddie Johnson", aliases: [] },
  { id: 77144, full_name: "Eddie Johnson", aliases: [] },
  { id: 56, full_name: "Gary Payton", aliases: [] },
  { id: 1627780, full_name: "Gary Payton II", aliases: [] },
  { id: 1626171, full_name: "Bobby Portis Jr.", aliases: [] },
  { id: 3, full_name: "Steven Smith", aliases: ["Steve Smith"] },
];

for (const [label, lookup] of [["client buildNameLookup", buildNameLookup(NAMES)], ["relay nameLookup", nameLookup(NAMES)]]) {
  test(`${label}: every namesake is reachable, the first stays toId`, () => {
    assert.deepEqual(lookup.toIds("eddie johnson"), [698, 77144]);
    assert.equal(lookup.toId("Eddie Johnson"), 698);
  });
  test(`${label}: a name typed without its suffix finds the suffixed player, after exact names`, () => {
    assert.deepEqual(lookup.toIds("Bobby Portis"), [1626171]);
    assert.deepEqual(lookup.toIds("Gary Payton"), [56, 1627780]);
    assert.equal(lookup.toId("Gary Payton"), 56);
    assert.deepEqual(lookup.toIds("Gary Payton II"), [1627780]);
  });
  test(`${label}: aliases and unknown names`, () => {
    assert.deepEqual(lookup.toIds("Steve Smith"), [3]);
    assert.deepEqual(lookup.toIds("Nobody Here"), []);
    assert.equal(lookup.toId("Nobody Here"), null);
  });
}
