// Pulls candidate real photos (Pexels, free licence, no attribution required) per game so you can
// pick one as the subject reference: sources/candidates/<id>/N.jpg + credits.json.
// Copy the one you like to sources/<id>.jpg; generate.mjs and finish.mjs pick it up.
//
//   node scripts/game-cards/fetch-sources.mjs [--ids a,b] [--per 6] [--query "custom search"]
// Needs PEXELS_API_KEY (free at pexels.com/api) in the environment, .env.local or scripts/game-cards/.env.
import path from "node:path";
import fs from "node:fs/promises";
import { CANDIDATES, loadEnv, parseArgs } from "./lib.mjs";
import { pick } from "./manifest.mjs";

await loadEnv();
const args = parseArgs();
const key = process.env.PEXELS_API_KEY;
if (!key) {
  console.error("Missing PEXELS_API_KEY (free key at https://www.pexels.com/api/).");
  process.exit(1);
}
const per = Number(args.per || 6);

for (const g of pick(args.ids)) {
  const query = args.query || g.keywords;
  const url = `https://api.pexels.com/v1/search?query=${encodeURIComponent(query)}&orientation=landscape&per_page=${per}`;
  const res = await fetch(url, { headers: { Authorization: key } });
  if (!res.ok) {
    console.error(`FAIL   ${g.id}: ${res.status} ${await res.text()}`);
    continue;
  }
  const json = await res.json();
  const dir = path.join(CANDIDATES, g.id);
  await fs.mkdir(dir, { recursive: true });
  const credits = [];
  let i = 0;
  for (const p of json.photos || []) {
    i++;
    const img = await fetch(p.src.large2x || p.src.large);
    await fs.writeFile(path.join(dir, `${i}.jpg`), Buffer.from(await img.arrayBuffer()));
    credits.push({ file: `${i}.jpg`, photographer: p.photographer, url: p.url, licence: "Pexels" });
  }
  await fs.writeFile(path.join(dir, "credits.json"), JSON.stringify(credits, null, 2));
  console.log(`${g.id.padEnd(16)} "${query}" -> ${i} photo(s) in sources/candidates/${g.id}/`);
}
