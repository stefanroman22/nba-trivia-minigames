// Copies finished cards over the assets GameUtils.tsx imports (backs the old ones up first).
//   node scripts/game-cards/apply.mjs [--ids a,b] [--to <other checkout's "Games Backrounds" dir>]
import path from "node:path";
import fs from "node:fs/promises";
import { ASSETS, BACKUP, CARDS, exists, parseArgs } from "./lib.mjs";
import { pick } from "./manifest.mjs";

const args = parseArgs();
const assetsDir = args.to ? path.resolve(args.to) : ASSETS;
await fs.mkdir(BACKUP, { recursive: true });
let n = 0;
for (const g of pick(args.ids)) {
  const card = path.join(CARDS, `${g.id}.jpg`);
  if (!(await exists(card))) continue;
  const target = path.join(assetsDir, g.assetFile);
  if (await exists(target)) await fs.copyFile(target, path.join(BACKUP, g.assetFile));
  await fs.copyFile(card, target);
  console.log(`apply  ${g.id.padEnd(16)} -> ${g.assetFile}`);
  n++;
}
console.log(`\n${n} asset(s) replaced; originals in ${path.relative(process.cwd(), BACKUP)}`);
