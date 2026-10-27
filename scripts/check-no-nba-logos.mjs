// Guard: no real NBA team logo is loaded or rendered. Teams show as TeamBadge / TeamNameGradient; the
// game data still carries logo URLs (*_logo, logo), which the UI ignores.
//   npm run check:no-nba-logos              scans src/**
//   node scripts/check-no-nba-logos.mjs --built   also scans .next/static/** and .next/server/app/**/*.html
//                                                 (run after `npm run build`)
// Ignored on purpose: public/data/*.json (data, not rendered) and public/logos/scrambled (the Name the
// NBA Club puzzle, kept by the owner). Neither is under the scanned roots.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const built = process.argv.includes("--built");

// Every cdn.nba.com URL in src/ (player photos left it on 2026-10-26, team logos on 2026-10-27), the
// removed CDN builders, and an image-backed TeamCrest.
const SRC_PATTERNS = [/cdn\.nba\.com/, /\blogoForId\b/, /\bcurrentLogoUrl\b/, /<TeamCrest\b[^>]*\bsrc=/];
// Built output: only the logo path (minified code renames the helpers).
const BUILT_PATTERNS = [/cdn\.nba\.com\/logos/];

function* walk(dir, accept) {
  if (!existsSync(dir)) return;
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) yield* walk(path, accept);
    else if (accept(path)) yield path;
  }
}

const hits = [];
function scan(path, patterns, lines = true) {
  const text = readFileSync(path, "utf8");
  if (!lines) {
    for (const re of patterns) if (re.test(text)) hits.push(`${relative(ROOT, path)}: ${re}`);
    return;
  }
  text.split("\n").forEach((line, i) => {
    for (const re of patterns) if (re.test(line)) hits.push(`${relative(ROOT, path)}:${i + 1}: ${line.trim().slice(0, 140)}`);
  });
}

for (const f of walk(join(ROOT, "src"), (p) => /\.(tsx?|jsx?|mjs|css|json|html)$/.test(p))) scan(f, SRC_PATTERNS);
if (built) {
  const next = join(ROOT, ".next");
  if (!existsSync(next)) {
    console.error("check-no-nba-logos: --built needs .next/ (run `npm run build` first)");
    process.exit(1);
  }
  for (const f of walk(join(next, "static"), (p) => /\.(js|css|html|json)$/.test(p))) scan(f, BUILT_PATTERNS, false);
  for (const f of walk(join(next, "server", "app"), (p) => p.endsWith(".html"))) scan(f, BUILT_PATTERNS, false);
}

if (hits.length) {
  console.error(`check-no-nba-logos: ${hits.length} hit(s) — teams must show as TeamBadge / TeamNameGradient, never a logo:`);
  for (const h of hits) console.error("  " + h);
  process.exit(1);
}
console.log(`check-no-nba-logos: no NBA logo in src/${built ? " or the built output" : ""}`);
