// Enforces GAME_DESIGN_CONSTRAINTS.md RULE 7.3, no dependencies:
//   npm run check:games      (also run by `npm run lint`, so CI covers it)
//
// A visible game that reveals an answer, solution or final board must end in place:
// every onGameEnd(...) call in its renderer carries { inPlace: true } (EndSequence + ScorePanel).
// A game that legitimately keeps the full-screen GameResult is listed, with a written reason, in
// scripts/game-result-allowlist.json. Fails on: a visible game with a non-in-place onGameEnd and no
// allowlist entry, and on a stale allowlist entry (not a visible game, empty reason, or the game
// already passes on its own so the entry should go).
//
// One call may be exempt: put `// game-results: online-duel` on the line where the call starts
// (TicTacToe's online duel ends through the multiplayer result flow, not the solo in-place one).
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => readFileSync(join(root, rel), "utf8");
const MARKER = "game-results: online-duel";

// (a) Visible games: same filter as `visibleGames` in GameUtils (no hidden: true, no coming-soon).
const utils = read("src/utils/GameUtils.tsx");
const idMatches = [...utils.matchAll(/^ {4}id: "([^"]+)"/gm)];
const visible = [];
idMatches.forEach((m, i) => {
  const block = utils.slice(m.index, i + 1 < idMatches.length ? idMatches[i + 1].index : utils.length);
  if (m[1] === "coming-soon" || /^\s*hidden:\s*true/m.test(block)) return;
  visible.push(m[1]);
});

// (b) Game id -> renderer file, through RenderGame's case blocks and import lines.
const renderGame = read("src/Game Renderers/RenderGame.tsx");
const imports = new Map(
  [...renderGame.matchAll(/^import\s+(\w+)\s+from\s+"\.\.\/Game Renderers\/([^"]+)"/gm)].map((m) => [m[1], m[2]]),
);
const caseMatches = [...renderGame.matchAll(/^\s*case "([^"]+)":/gm)];
const rendererOf = (id) => {
  const i = caseMatches.findIndex((m) => m[1] === id);
  if (i < 0) return null;
  const body = renderGame.slice(caseMatches[i].index, i + 1 < caseMatches.length ? caseMatches[i + 1].index : renderGame.length);
  const tag = body.match(/<([A-Z]\w*)/);
  const file = tag && imports.get(tag[1]);
  return file ? `src/Game Renderers/${file}.tsx` : null;
};

const allowlist = JSON.parse(read("scripts/game-result-allowlist.json"));

/** Blank out comments (keeping offsets and newlines) so prose mentioning onGameEnd never counts. */
const stripComments = (src) =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, " "))
    .replace(/(^|\s)\/\/[^\n]*/g, (c) => c.replace(/[^\n\s]/g, " "));

/** Every onGameEnd(...) call in a renderer: { line, inPlace, exempt }. */
function endCalls(file) {
  const src = read(file);
  const code = stripComments(src);
  const lines = src.split(/\r?\n/);
  const calls = [];
  for (const m of code.matchAll(/\bonGameEnd\s*(?:\?\.)?\(/g)) {
    let depth = 1;
    let j = m.index + m[0].length;
    for (; j < code.length && depth > 0; j++) {
      if (code[j] === "(") depth++;
      else if (code[j] === ")") depth--;
    }
    const line = code.slice(0, m.index).split("\n").length;
    calls.push({
      line,
      inPlace: /\binPlace\s*:\s*true\b/.test(code.slice(m.index, j)),
      exempt: (lines[line - 1] ?? "").includes(MARKER),
    });
  }
  return calls;
}

const failures = [];
for (const id of visible) {
  const file = rendererOf(id);
  const reason = allowlist[id];
  const listed = typeof reason === "string" && reason.trim() !== "";
  if (!file) {
    failures.push(`${id}: no renderer found in RenderGame.tsx`);
    console.log(`FAIL  ${id}  (no renderer found)`);
    continue;
  }
  const counted = endCalls(file).filter((c) => !c.exempt);
  const bad = counted.filter((c) => !c.inPlace);
  const passes = counted.length > 0 && bad.length === 0;
  if (passes && !(id in allowlist)) {
    console.log(`ok    ${id}  (in place)`);
  } else if (passes) {
    failures.push(`${id}: ends in place now, remove its entry from scripts/game-result-allowlist.json`);
    console.log(`FAIL  ${id}  (stale allowlist entry, it already ends in place)`);
  } else if (listed) {
    console.log(`ok    ${id}  (allowlisted, see scripts/game-result-allowlist.json)`);
  } else {
    const where = counted.length === 0
      ? "no onGameEnd call found"
      : `onGameEnd without { inPlace: true } at ${file}:${bad.map((c) => c.line).join(", ")}`;
    failures.push(`${id}: ${where} and no reason in scripts/game-result-allowlist.json`);
    console.log(`FAIL  ${id}  (${where})`);
  }
}

for (const [id, reason] of Object.entries(allowlist)) {
  if (!visible.includes(id)) failures.push(`${id}: allowlist entry is not a visible game`);
  else if (typeof reason !== "string" || reason.trim() === "") failures.push(`${id}: allowlist entry has an empty reason`);
}

if (failures.length) {
  console.error(`\ncheck-game-results: ${failures.length} problem(s) (GAME_DESIGN_CONSTRAINTS.md RULE 7.3)`);
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log(`\ncheck-game-results: ${visible.length} visible games OK`);
