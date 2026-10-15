// Stage A (free, offline): turn an input picture into a finished on-brand card.
//
//   node scripts/game-cards/finish.mjs                 # all games, best available input
//   node scripts/game-cards/finish.mjs --ids wordle,mvp
//   node scripts/game-cards/finish.mjs --from existing # translate the current assets (preview)
//   node scripts/game-cards/finish.mjs --mix 0.15      # keep 15% of the original colour
//   node scripts/game-cards/finish.mjs --ids wordle --exposure 0.55   # tame a bright source
//
// Input priority per game: out/raw/<id>.png (AI stage) > sources/<id>.* (your photo)
// > the current asset (only with --from existing, or when it is a real picture).
import path from "node:path";
import fs from "node:fs/promises";
import { ASSETS, CARDS, RAW, SOURCES, finishCard, findFile, parseArgs } from "./lib.mjs";
import { pick } from "./manifest.mjs";

const args = parseArgs();
const games = pick(args.ids);
const from = args.from || "auto";
const opts = {};
for (const k of ["exposure", "mix", "glow", "vignette", "floor", "grain", "quality"]) if (args[k] !== undefined) opts[k] = Number(args[k]);
if (args.ramp !== undefined) opts.ramp = !["0", "false", "no"].includes(String(args.ramp));
if (args.position) opts.position = args.position;

await fs.mkdir(CARDS, { recursive: true });
let done = 0;
for (const g of games) {
  let input = null;
  let origin = "";
  if (from === "auto" || from === "raw") {
    input = await findFile(RAW, g.id);
    origin = "raw";
  }
  if (!input && (from === "auto" || from === "sources")) {
    input = await findFile(SOURCES, g.id);
    origin = "source";
  }
  if (!input && (from === "existing" || (from === "auto" && g.existing !== "generic"))) {
    const p = path.join(ASSETS, g.assetFile);
    input = (await fs.stat(p).catch(() => null)) ? p : null;
    origin = "existing";
  }
  if (!input) {
    console.log(`skip   ${g.id.padEnd(16)} no input (generic placeholder; run generate.mjs or add sources/${g.id}.jpg)`);
    continue;
  }
  const out = path.join(CARDS, `${g.id}.jpg`);
  await finishCard(input, out, opts);
  const kb = Math.round((await fs.stat(out)).size / 1024);
  console.log(`card   ${g.id.padEnd(16)} <- ${origin.padEnd(8)} ${kb} KB`);
  done++;
}
console.log(`\n${done}/${games.length} cards written to ${path.relative(process.cwd(), CARDS)}`);
