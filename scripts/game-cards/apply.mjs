// Copies finished cards over the assets GameUtils.tsx imports (backs the old ones up first).
//   node scripts/game-cards/apply.mjs [--ids a,b]
import path from "node:path";
import fs from "node:fs/promises";
import { ASSETS, BACKUP, CARDS, exists, parseArgs } from "./lib.mjs";
import { pick } from "./manifest.mjs";

const args = parseArgs();
await fs.mkdir(BACKUP, { recursive: true });
let n = 0;
for (const g of pick(args.ids)) {
  const card = path.join(CARDS, `${g.id}.jpg`);
  if (!(await exists(card))) continue;
  const target = path.join(ASSETS, g.assetFile);
  if (await exists(target)) await fs.copyFile(target, path.join(BACKUP, g.assetFile));
  await fs.copyFile(card, target);
  console.log(`apply  ${g.id.padEnd(16)} -> ${g.assetFile}`);
  n++;
}
console.log(`\n${n} asset(s) replaced; originals in ${path.relative(process.cwd(), BACKUP)}`);
