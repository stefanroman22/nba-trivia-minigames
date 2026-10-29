// Guards the player photo map (public/photos/player-photos.json, written by scripts/player-photos/build.mjs):
//   - every player of the live pool (player-photos/players.mjs) is listed once, as an NBA headshot, a Commons photo or as `none`
//     (silhouette); an id the map doesn't list would show the silhouette without anyone deciding it;
//   - every Commons entry carries its face box, and has its row on /credits;
//   - NBA headshots are loaded only by utils/playerPhotos.ts, so every game frames them through <PlayerPhoto>.
//   npm run check:photos
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { loadPlayablePlayers } from "./player-photos/players.mjs";

const root = new URL("..", import.meta.url);
const read = (p) => JSON.parse(readFileSync(new URL(p, root), "utf8"));

const players = loadPlayablePlayers();
const map = read("public/photos/player-photos.json");
const credits = read("src/data/photo-credits.json");

const index = new Set(players.map((p) => p.person_id));
const nba = new Set(map.nba ?? []);
const commons = new Set(Object.keys(map.commons).map(Number));
const none = new Set(map.none);

function srcFiles(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...srcFiles(p));
    else if (/\.(tsx?|jsx?|mjs|css)$/.test(name)) out.push(p);
  }
  return out;
}
const rootDir = fileURLToPath(root);

const broken = {
  covered: [...index].filter((id) => nba.has(id) + commons.has(id) + none.has(id) !== 1),
  known: [...nba, ...commons, ...none].filter((id) => !index.has(id)),
  faces: Object.entries(map.commons).filter(([, e]) => e.length !== 7).map(([id]) => Number(id)),
  credits: credits.length === commons.size ? [] : [`${credits.length} credits for ${commons.size} Commons photos`],
  "one-loader": srcFiles(join(rootDir, "src"))
    .filter((f) => readFileSync(f, "utf8").includes("headshots/nba"))
    .map((f) => relative(rootDir, f).replace(/\\/g, "/"))
    .filter((f) => f !== "src/utils/playerPhotos.ts"),
};

console.log(`check-photos: ${index.size} players — ${nba.size} NBA, ${commons.size} Commons, ${none.size} silhouette`);
let failed = false;
for (const [rule, items] of Object.entries(broken)) {
  if (!items.length) continue;
  failed = true;
  const more = items.length > 20 ? ` … and ${items.length - 20} more` : "";
  console.error(`check-photos: ${rule} — ${items.length}: ${items.slice(0, 20).join(", ")}${more}`);
}
if (failed) process.exit(1);
console.log("check-photos: every player is covered, every Commons photo has a face box and a credit, NBA headshots only via PlayerPhoto");
