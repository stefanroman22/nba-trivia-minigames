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
  { id: 1495, full_name: "Shaquille O'Neal", aliases: ["Shaq"] },
  { id: 1626164, full_name: "Karl-Anthony Towns", aliases: [] },
  { id: 920, full_name: "A.C. Green", aliases: [] },
  { id: 201144, full_name: "Mike Conley", aliases: [] },
  { id: 203077, full_name: "Nikola Jokić", aliases: ["Nikola Jokic"] },
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
  test(`${label}: a space typed for an apostrophe, hyphen or initials' dot still matches`, () => {
    for (const typed of ["Shaquille O Neal", "Shaquille ONeal", "shaquille o'neal", "Shaq"]) assert.deepEqual(lookup.toIds(typed), [1495], typed);
    for (const typed of ["Karl Anthony Towns", "Karl-Anthony Towns", "karlanthony towns"]) assert.deepEqual(lookup.toIds(typed), [1626164], typed);
    for (const typed of ["A C Green", "AC Green", "A.C. Green"]) assert.deepEqual(lookup.toIds(typed), [920], typed);
    assert.deepEqual(lookup.toIds("Nikola Jokic"), [203077]);
  });
  test(`${label}: a suffix the name does not carry falls back to the name without it`, () => {
    assert.deepEqual(lookup.toIds("Mike Conley Jr"), [201144]);
    assert.deepEqual(lookup.toIds("Mike Conley Jr."), [201144]);
  });
  test(`${label}: aliases and unknown names`, () => {
    assert.deepEqual(lookup.toIds("Steve Smith"), [3]);
    assert.deepEqual(lookup.toIds("Nobody Here"), []);
    assert.equal(lookup.toId("Nobody Here"), null);
  });
}
