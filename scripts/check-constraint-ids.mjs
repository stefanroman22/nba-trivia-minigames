// Enforces that constraint-rule ids stay unique and that every rule reference resolves, no dependencies:
//   npm run check:ids      (also run by `npm run lint`, so CI covers it)
//
// Id sources (one extractRules call each, from scripts/team/lib/rules.mjs):
//   docs/GAME_DESIGN_CONSTRAINTS.md                         -> "RULE 4.2a"
//   docs/constraints/{UI_SHELL,BACKEND,MULTIPLAYER,AUTH}_CONSTRAINTS.md -> "UI-4", "BE-2", "MP-12", "AUTH-3"
// Fails on: a duplicate id inside one doc; a `Rule x.y` / `RULE x.y` reference that is not a game-doc id;
// a `UI-n` / `BE-n` / `MP-n` / `AUTH-n` reference that is not an id of its doc; and the retired forms
// (the old section names "7a"/"7b" with Rule or the section sign, and the three-part id 4.2.1), which the mapping in
// docs/team/designs/2026-10-03-game-constraints-review.md replaced with 7.4 / 7.3 / 4.5.
// Known limit: in a slash list such as `Rules 1.1 / 4.2` only the first id is resolved.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { extractRules } from "./team/lib/rules.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const GAME_DOC = "docs/GAME_DESIGN_CONSTRAINTS.md";
const PREFIXED_DOCS = {
  UI: "docs/constraints/UI_SHELL_CONSTRAINTS.md",
  BE: "docs/constraints/BACKEND_CONSTRAINTS.md",
  MP: "docs/constraints/MULTIPLAYER_CONSTRAINTS.md",
  AUTH: "docs/constraints/AUTH_CONSTRAINTS.md",
};

// Dated records that describe the doc as it was keep the ids they were written with, so they are not scanned.
const EXCLUDED = [
  "docs/team/designs/",
  "docs/team/DECISIONS.md",
  "docs/team/RETRO.md",
  "docs/superpowers/",
  "node_modules/",
  ".next/",
  ".git/",
  ".team/",
];
// Scanned roots/extensions (a plain fs walk: no globbing dependency).
const SCAN_ROOT_FILES = ["CLAUDE.md", "README.md"];
const SCAN_DIRS = [
  { dir: "docs", exts: [".md"] },
  { dir: ".claude", exts: [".md"] },
  { dir: "src", exts: [".ts", ".tsx", ".css"] },
  { dir: "scripts", exts: [".mjs", ".js", ".json"] },
];

const problems = [];
const posix = (p) => p.split(sep).join("/");
const read = (rel) => readFileSync(join(root, rel), "utf8");

function loadIds(rel) {
  const seen = new Set();
  for (const r of extractRules(read(rel))) {
    if (seen.has(r.id)) problems.push(`${rel}: duplicate id ${r.id}`);
    seen.add(r.id);
  }
  return seen;
}

const gameIds = loadIds(GAME_DOC);
const prefixedIds = Object.fromEntries(Object.entries(PREFIXED_DOCS).map(([p, rel]) => [p, loadIds(rel)]));

function* walk(rel, exts) {
  let entries;
  try {
    entries = readdirSync(join(root, rel));
  } catch {
    return;
  }
  for (const name of entries) {
    const child = posix(join(rel, name));
    if (EXCLUDED.some((x) => (child + "/").startsWith(x) || child === x)) continue;
    const st = statSync(join(root, child));
    if (st.isDirectory()) yield* walk(child, exts);
    else if (exts.some((e) => name.endsWith(e))) yield child;
  }
}

const files = [...SCAN_ROOT_FILES];
for (const { dir, exts } of SCAN_DIRS) files.push(...walk(dir, exts));

const GAME_REF = /\b(?:RULE|Rule)s?\s+(\d+(?:\.\d+)?[a-z]?)\b/g;
const PREFIXED_REF = /\b(UI|BE|MP|AUTH)-(\d+)\b/g;
const RETIRED = /(?:Rule|RULE|§)\s*7[ab]\b|\bRULE\s+4\.2\.1\b/;

let resolved = 0;
for (const rel of files) {
  let text;
  try {
    text = read(rel);
  } catch {
    continue;
  }
  text.split(/\r?\n/).forEach((line, i) => {
    const at = `${rel}:${i + 1}`;
    const retired = line.match(RETIRED);
    if (retired) problems.push(`${at}: retired reference "${retired[0]}" (use Rule 7.3 / 7.4 / 4.5)`);
    for (const m of line.matchAll(GAME_REF)) {
      if (retired && m[1].match(/^(7[ab]|4\.2\.1)$/)) continue;
      if (gameIds.has(m[1])) resolved += 1;
      else problems.push(`${at}: Rule ${m[1]} does not resolve`);
    }
    for (const m of line.matchAll(PREFIXED_REF)) {
      const id = `${m[1]}-${m[2]}`;
      if (prefixedIds[m[1]].has(id)) resolved += 1;
      else problems.push(`${at}: ${id} does not resolve`);
    }
  });
}

if (problems.length) {
  console.error(problems.join("\n"));
  console.error(`check-constraint-ids: ${problems.length} problem(s)`);
  process.exit(1);
}
const total = gameIds.size + Object.values(prefixedIds).reduce((n, s) => n + s.size, 0);
console.log(
  `check-constraint-ids: ${gameIds.size} game-doc ids, ${total} ids in ${1 + Object.keys(PREFIXED_DOCS).length} docs, ${resolved} references resolved`,
);
