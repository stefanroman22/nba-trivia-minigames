// Node test for src/utils/teamBadge.ts (the team badge shown in place of a team logo): for every team
// name the games can show, in both themes and on every surface, the abbreviation reaches WCAG 2.x
// contrast >= 4.5:1 against the fill, the ring >= 3:1 against every background of the surface
// (WCAG 1.4.11), and teamAbbr gives 2-3 upper-case letters.
//   npm run test:team-badge      (node --experimental-strip-types; Node >= 22.6)
import { register } from "node:module";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import assert from "node:assert/strict";

// The util imports "../constants/nbaTeamColors" (a .tsx file without JSX) and "../constants/teamLogos"
// bundler style, without extensions: a tiny hook adds the extension, and loads the .tsx as TypeScript.
register("data:text/javascript," + encodeURIComponent(`
  import { existsSync } from "node:fs";
  import { readFile } from "node:fs/promises";
  import { fileURLToPath } from "node:url";
  export async function resolve(spec, ctx, next) {
    if (/^\\.\\.?\\//.test(spec) && !/\\.[cm]?[jt]sx?$/.test(spec) && ctx.parentURL?.includes("/src/")) {
      for (const ext of [".ts", ".tsx"]) {
        const url = new URL(spec + ext, ctx.parentURL);
        if (existsSync(fileURLToPath(url))) return next(url.href, ctx);
      }
    }
    return next(spec, ctx);
  }
  export async function load(url, ctx, next) {
    if (url.endsWith(".tsx")) {
      return { format: "module-typescript", source: await readFile(fileURLToPath(url), "utf8"), shortCircuit: true };
    }
    return next(url, ctx);
  }
`));

const { nbaTeamColors } = await import("../src/constants/nbaTeamColors.tsx");
const { TEAM_NAME_TO_ID } = await import("../src/constants/teamLogos.ts");
const { TEAM_ABBR } = await import("../src/constants/teamAbbr.ts");
const { DISTINCT, contrastRatio, distance } = await import("../src/utils/teamNameGradient.ts");
const { BADGE_SURFACES, MIN_RING_CONTRAST, teamAbbr, teamBadgeColors, teamNickname } = await import("../src/utils/teamBadge.ts");

const dataNames = JSON.parse(readFileSync(new URL("../backend/trivia/data/name-logo.json", import.meta.url), "utf8"))
  .map((t) => t.full_name);
const NAMES = [...new Set([
  ...Object.keys(nbaTeamColors),
  ...Object.keys(TEAM_NAME_TO_ID),
  ...Object.keys(TEAM_ABBR),
  ...dataNames,
])];
const THEMES = ["dark", "light"];
const SURFACES = Object.keys(BADGE_SURFACES);

test("the abbreviation reads on the fill (>= 4.5:1), every name, theme and surface", () => {
  for (const name of NAMES) for (const surface of SURFACES) for (const theme of THEMES) {
    const c = teamBadgeColors(name, null, surface)[theme];
    if (c.fill.startsWith("var(")) continue; // no team colours: theme tokens (--surface3 / --text)
    const ratio = contrastRatio(c.text, c.fill);
    assert.ok(ratio >= 4.5, `${name} (${theme}, ${surface}): text ${c.text} on ${c.fill} = ${ratio.toFixed(2)}:1`);
  }
});

test("the ring clears every background of its surface (>= 3:1)", () => {
  for (const name of NAMES) for (const surface of SURFACES) for (const theme of THEMES) {
    const c = teamBadgeColors(name, null, surface)[theme];
    if (c.ring.startsWith("var(")) continue;
    for (const bg of BADGE_SURFACES[surface][theme]) {
      const ratio = contrastRatio(c.ring, bg);
      assert.ok(ratio >= MIN_RING_CONTRAST, `${name} (${theme}, ${surface}): ring ${c.ring} on ${bg} = ${ratio.toFixed(2)}:1`);
    }
  }
});

test("the ring stays distinct from the fill, so the badge always has a visible edge", () => {
  for (const name of NAMES) for (const surface of SURFACES) for (const theme of THEMES) {
    const c = teamBadgeColors(name, null, surface)[theme];
    if (c.ring.startsWith("var(")) continue;
    const d = distance(c.ring, c.fill);
    assert.ok(d >= DISTINCT, `${name} (${theme}, ${surface}): ring ${c.ring} vs fill ${c.fill} = ${d.toFixed(0)} RGB`);
  }
});

test("every known name has a 2-3 letter upper-case abbreviation", () => {
  for (const name of NAMES) assert.match(teamAbbr(name) ?? "", /^[A-Z]{2,3}$/, name);
  for (const name of Object.keys(TEAM_NAME_TO_ID)) assert.ok(TEAM_ABBR[name], `TEAM_ABBR misses ${name}`);
});

test("abbreviation and nickname fallbacks", () => {
  assert.equal(teamAbbr("Seattle SuperSonics", "OKC"), "SEA");
  assert.equal(teamAbbr("Some New Team", "snt"), "SNT");
  assert.equal(teamAbbr("Some New Team", null), null);
  assert.equal(teamAbbr("Some New Team"), "TEA");
  assert.equal(teamAbbr(""), null);
  assert.equal(teamAbbr(null), null);
  assert.equal(teamNickname("Portland Trail Blazers"), "Trail Blazers");
  assert.equal(teamNickname("Philadelphia 76ers"), "76ers");
  assert.equal(teamNickname("Milwaukee Bucks"), "Bucks");
});

test("a team with no colours falls back to the theme tokens", () => {
  const c = teamBadgeColors("Chicago Stags", null, "board").dark;
  assert.deepEqual(c, { fill: "var(--surface3)", text: "var(--text)", ring: "var(--line2)" });
});
