// Node test for src/utils/teamNameGradient.ts (the gradient Name the NBA Club fills the team name with,
// on the board and in the answer review): every stop, and every point of the gradient between them,
// keeps WCAG 2.x contrast >= 4.5:1 against each surface in both themes, for every team the game can show.
//   npm run test:team-name-gradient      (node --experimental-strip-types; Node >= 22.6)
import { register } from "node:module";
import { readFileSync } from "node:fs";
import { test, after } from "node:test";
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
const {
  MIN_CONTRAST, NAME_BACKGROUNDS, NAME_SURFACES, contrastRatio, legibleColor, teamNameGradient, teamNameGradients,
} = await import("../src/utils/teamNameGradient.ts");

const dataNames = JSON.parse(readFileSync(new URL("../backend/trivia/data/name-logo.json", import.meta.url), "utf8"))
  .map((t) => t.full_name);
const NAMES = [...new Set([
  ...Object.keys(nbaTeamColors),
  ...dataNames,
  ...Object.keys(TEAM_NAME_TO_ID),
  "Seattle SuperSonics", "New Jersey Nets", "Charlotte Bobcats", "Chicago Stags",
])];
const THEMES = ["dark", "light"];

const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const lerp = (a, b, t) => "#" + hex(a).map((c, i) => Math.round(c + (hex(b)[i] - c) * t).toString(16).padStart(2, "0")).join("");
const dist = (a, b) => Math.hypot(...hex(a).map((c, i) => c - hex(b)[i]));

const lowestBy = {};
after(() => {
  for (const [surface, l] of Object.entries(lowestBy)) {
    if (Number.isFinite(l.ratio)) console.log(`lowest contrast (${surface}): ${l.ratio.toFixed(2)}:1 (${l.name}, ${l.theme}, ${l.stop} on ${l.bg})`);
  }
});

// Points checked along each gradient: the browser renders every shade between the stops, and a blend
// can dip below 4.5:1 between coarse samples (tenths missed Phoenix Suns at ~4.48 around the middle).
const SAMPLES = 200;

// Every stop and SAMPLES + 1 points of the blend between them, on every background of `surface`, in both themes.
function assertLegible(surface) {
  const lowest = (lowestBy[surface] ??= { ratio: Infinity });
  const failures = new Map(); // "name theme" -> its lowest failing point, so one run lists every name
  for (const name of NAMES) {
    const both = teamNameGradients(name, undefined, surface);
    for (const theme of THEMES) {
      const stops = both[theme];
      assert.equal(stops.length, 2, `${name} ${theme}`);
      assert.deepEqual(stops, teamNameGradient(name, NAME_SURFACES[surface][theme]), `${name} ${theme}`);
      for (const stop of stops) assert.match(stop, /^#[0-9a-f]{6}$/, `${name} ${theme}`);
      for (const bg of NAME_SURFACES[surface][theme]) {
        for (let i = 0; i <= SAMPLES; i++) {
          const color = lerp(stops[0], stops[1], i / SAMPLES);
          const ratio = contrastRatio(color, bg);
          if (ratio < lowest.ratio) Object.assign(lowest, { ratio, name, theme, stop: color, bg });
          const key = `${name} ${theme}`;
          if (ratio < MIN_CONTRAST && !(failures.get(key)?.ratio <= ratio)) {
            failures.set(key, { ratio, text: `${surface} ${key}: ${color} (${(i / SAMPLES * 100).toFixed(1)}%) on ${bg} is ${ratio.toFixed(3)}:1` });
          }
        }
      }
    }
  }
  assert.deepEqual([...failures.values()].map((f) => f.text), [], `${failures.size} gradient(s) dip below ${MIN_CONTRAST}:1`);
}

// theme.css token values: the dark ones on :root, the light ones on .light.
const themeCss = readFileSync(new URL("../src/styles/theme.css", import.meta.url), "utf8");
function token(selector, name) {
  const block = themeCss.slice(themeCss.indexOf(`${selector} {`));
  const m = new RegExp(`${name}:\\s*(#[0-9a-fA-F]{6})`).exec(block.slice(0, block.indexOf("}")));
  return m && m[1].toLowerCase();
}

test("contrastRatio matches WCAG 2.x reference values", () => {
  assert.equal(contrastRatio("#000000", "#ffffff").toFixed(2), "21.00");
  assert.equal(contrastRatio("#ffffff", "#ffffff").toFixed(2), "1.00");
  assert.equal(contrastRatio("#777777", "#ffffff").toFixed(2), "4.48");
  assert.equal(contrastRatio("#ff6a1a", "#1c1c1e"), contrastRatio("#1c1c1e", "#ff6a1a"));
});

test("both theme backgrounds are listed, dark ones for dark and light ones for light", () => {
  for (const backgrounds of Object.values(NAME_SURFACES)) {
    for (const bg of backgrounds.dark) assert.ok(contrastRatio(bg, "#000000") < contrastRatio(bg, "#ffffff"), bg);
    for (const bg of backgrounds.light) assert.ok(contrastRatio(bg, "#ffffff") < contrastRatio(bg, "#000000"), bg);
  }
});

test(`every stop and the gradient between them is >= ${MIN_CONTRAST}:1 for ${NAMES.length} names in both themes`, () => {
  assert.equal(MIN_CONTRAST, 4.5);
  assert.equal(NAME_SURFACES.board, NAME_BACKGROUNDS);
  for (const name of NAMES) assert.deepEqual(teamNameGradients(name, undefined, "board"), teamNameGradients(name), name);
  assertLegible("board");
});

test("the review surfaces are the answer review's row and modal panel tokens (theme.css)", () => {
  // .ar-round rows (AnswerReview.css: --surface2) inside the modal panel (Modal.css: --surface).
  assert.deepEqual([...NAME_SURFACES.review.dark], [token(":root", "--surface2"), token(":root", "--surface")]);
  assert.deepEqual([...NAME_SURFACES.review.light], [token(".light", "--surface2"), token(".light", "--surface")]);
});

test(`in the answer review every stop and the gradient between them is >= ${MIN_CONTRAST}:1 for ${NAMES.length} names in both themes`, () => {
  assertLegible("review");
});

test("the hex surface is the Heatmap hex: --surface2, and --brand-soft over it when active (theme.css)", () => {
  assert.equal(NAME_SURFACES.hex.dark[0], token(":root", "--surface2"));
  assert.equal(NAME_SURFACES.hex.light[0], token(".light", "--surface2"));
  // --brand-soft composited over --surface2 (dark .14, light .12).
  assert.deepEqual([NAME_SURFACES.hex.dark[1], NAME_SURFACES.hex.light[1]], [lerp("#232327", "#ff6a1a", 0.14), lerp("#f4f1ea", "#ff6a1a", 0.12)]);
});

test(`on a Heatmap hex every stop and the gradient between them is >= ${MIN_CONTRAST}:1 for ${NAMES.length} names in both themes`, () => {
  assertLegible("hex");
});

test("a black primary is lightened on the dark board, a white one darkened on the light board", () => {
  const dark = legibleColor("#000000", NAME_BACKGROUNDS.dark);
  assert.notEqual(dark, "#000000");
  assert.ok(hex(dark).every((c) => c > 0), dark);
  for (const bg of NAME_BACKGROUNDS.dark) assert.ok(contrastRatio(dark, bg) >= MIN_CONTRAST);

  const light = legibleColor("#FFFFFF", NAME_BACKGROUNDS.light);
  assert.notEqual(light, "#ffffff");
  assert.ok(hex(light).every((c) => c < 255), light);
  for (const bg of NAME_BACKGROUNDS.light) assert.ok(contrastRatio(light, bg) >= MIN_CONTRAST);

  // A colour that already passes is left exactly as it is.
  assert.equal(legibleColor("#FEC524", NAME_BACKGROUNDS.dark), "#fec524");
});

test("the hue is kept: a dark navy is lightened toward white, not swapped for another colour", () => {
  const navy = legibleColor("#0E2240", NAME_BACKGROUNDS.dark); // Denver Nuggets primary
  const [r, g, b] = hex(navy);
  assert.ok(b > g && g > r, navy);
});

test("historical names use the current franchise's colours", () => {
  assert.deepEqual(teamNameGradients("Seattle SuperSonics"), teamNameGradients("Oklahoma City Thunder"));
  assert.deepEqual(teamNameGradients("New Jersey Nets"), teamNameGradients("Brooklyn Nets"));
  assert.deepEqual(teamNameGradients("Charlotte Bobcats"), teamNameGradients("Charlotte Hornets"));
  assert.deepEqual(teamNameGradients("LA Clippers"), teamNameGradients("Los Angeles Clippers"));
  assert.deepEqual(teamNameGradients("new orleans/oklahoma city hornets"), teamNameGradients("New Orleans Pelicans"));
});

test("a name without colours falls back to the brand orange gradient", () => {
  const brand = teamNameGradients("Chicago Stags");
  assert.deepEqual(brand, teamNameGradients(""));
  for (const theme of THEMES) {
    for (const stop of brand[theme]) {
      const [r, g, b] = hex(stop);
      assert.ok(r > g && g > b, `${theme} ${stop}`);
    }
  }
});

test("the two stops stay visibly different where the team has two distinct colours", () => {
  for (const theme of THEMES) {
    for (const name of ["Los Angeles Lakers", "Denver Nuggets", "Phoenix Suns", "New York Knicks", "Golden State Warriors"]) {
      const [a, b] = teamNameGradients(name)[theme];
      assert.ok(dist(a, b) >= 60, `${name} ${theme}: ${a} vs ${b}`);
    }
  }
});
