// Build the player photo map (public/photos/player-photos.json) and its credits
// (src/data/photo-credits.json). Run by hand after a data sync adds players:
//   node scripts/player-photos/build.mjs
//
// For every players-index row: the Wikidata image (P18) of the item whose NBA.com player
// id (P3647) matches, if that file is a free JPEG/PNG on Commons that passes the checks
// below, else the silhouette. No photo comes from cdn.nba.com (its headshots are NBA
// property). The map lists every player, as a Commons file or in `none`; an id it
// doesn't mention is a build error (npm run check:photos) and the app shows the
// silhouette for it.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const PLAYERS = join(root, "backend", "trivia", "data", "players-index.json");
const MAP_OUT = join(root, "public", "photos", "player-photos.json");
const IDS_OUT = join(root, "public", "photos", "player-ids.json");
const CREDITS_OUT = join(root, "src", "data", "photo-credits.json");
const EXTRA_IN = join(root, "scripts", "player-photos", "commons-extra.json");
const FACES_IN = join(root, "scripts", "player-photos", "faces.json");

const UA = "SwishQuest-photo-map/1.0 (https://swishquest.com)";

async function retry(fn, tries = 3) {
  for (let i = 1; ; i++) {
    try {
      return await fn();
    } catch (err) {
      if (i >= tries) throw err;
      await new Promise((r) => setTimeout(r, 1000 * i));
    }
  }
}

/** NBA.com player id -> Commons file name (spaces, not underscores). */
async function wikidataImages() {
  const query = "SELECT ?nba ?img WHERE { ?p wdt:P3647 ?nba . ?p wdt:P18 ?img }";
  const r = await retry(() =>
    fetch(`https://query.wikidata.org/sparql?query=${encodeURIComponent(query)}`, {
      headers: { Accept: "application/sparql-results+json", "User-Agent": UA },
    }).then((res) => {
      if (!res.ok) throw new Error(`Wikidata HTTP ${res.status}`);
      return res.json();
    }),
  );
  const byId = new Map();
  for (const b of r.results.bindings) {
    const file = decodeURIComponent(b.img.value.split("/Special:FilePath/")[1] ?? "");
    if (file && !byId.has(b.nba.value)) byId.set(b.nba.value, file);
  }
  return byId;
}

const stripHtml = (s) =>
  (s ?? "")
    .replace(/<[^>]*>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();

/** Commons file name -> { width, mime, artist, license, license_url }, 50 titles a call. */
async function commonsInfo(files) {
  const info = new Map();
  for (let i = 0; i < files.length; i += 50) {
    const batch = files.slice(i, i + 50);
    const params = new URLSearchParams({
      action: "query",
      format: "json",
      formatversion: "2",
      prop: "imageinfo",
      iiprop: "size|mime|extmetadata",
      iiextmetadatafilter: "Artist|LicenseShortName|LicenseUrl",
      titles: batch.map((f) => `File:${f}`).join("|"),
    });
    const r = await retry(() =>
      fetch(`https://commons.wikimedia.org/w/api.php?${params}`, { headers: { "User-Agent": UA } }).then((res) => {
        if (!res.ok) throw new Error(`Commons HTTP ${res.status}`);
        return res.json();
      }),
    );
    // The API normalizes titles (e.g. first letter, underscores); map answers back.
    const alias = new Map(batch.map((f) => [`File:${f}`, f]));
    for (const n of r.query.normalized ?? []) alias.set(n.to, alias.get(n.from));
    for (const page of r.query.pages ?? []) {
      const ii = page.imageinfo?.[0];
      const file = alias.get(page.title);
      if (!ii || !file) continue;
      const meta = ii.extmetadata ?? {};
      info.set(file, {
        width: ii.width,
        height: ii.height,
        mime: ii.mime,
        artist: stripHtml(meta.Artist?.value) || "Unknown author",
        license: stripHtml(meta.LicenseShortName?.value) || "See file page",
        license_url: meta.LicenseUrl?.value ?? "",
      });
    }
  }
  return info;
}

/** "a/ab" — Commons' storage directory for a file name (md5 of the underscored name). */
function hashDir(underscored) {
  const h = createHash("md5").update(underscored, "utf8").digest("hex");
  return `${h[0]}/${h.slice(0, 2)}`;
}

const players = JSON.parse(readFileSync(PLAYERS, "utf8"));
console.log(`[player-photos] ${players.length} players — reading Wikidata…`);

const wd = await wikidataImages();
// Hand-verified finds (identity, license, a clear face), which win over Wikidata:
// { "<person_id>": { file, face_x, face_y } }, or { exclude: true, reason } to drop a player's
// photo (a jersey, a back view, a group shot) — see the README.
const extra = existsSync(EXTRA_IN) ? JSON.parse(readFileSync(EXTRA_IN, "utf8")) : {};
// Face boxes per Commons photo (detect_faces.py; hand-fixed ones are marked manual):
// { "<person_id>": { file, aspect, box: [x, y, w, h] | null } }, fractions of the image.
const faces = existsSync(FACES_IN) ? JSON.parse(readFileSync(FACES_IN, "utf8")) : {};
const fileFor = (p) => (extra[p.person_id]?.exclude ? undefined : (extra[p.person_id]?.file ?? wd.get(String(p.person_id))));
const wanted = [...new Set(players.map(fileFor).filter(Boolean))];
console.log(`[player-photos] Wikidata images for players: ${wanted.length} — reading Commons metadata…`);
const info = await commonsInfo(wanted);

// A Wikidata image is sometimes a team photo or a game shot starring someone else (e.g.
// "Michael_Jordan_vs_Bullets.jpg" for a Bullets player); a wrong face is worse than the
// silhouette. Keep a file only if its name mentions the player (surname, or first name +
// the surname's first 4 letters for misspellings) and no other player uses it.
const ascii = (s) =>
  s.normalize("NFKD").replace(/[^\x00-\x7f]/g, "").toLowerCase().replace(/[^a-z]/g, "");
function namesPlayer(fullName, file) {
  const parts = fullName.replace(/\b(Jr|Sr)\.?$|\b(II|III|IV)$/g, "").trim().split(/\s+/);
  const first = ascii(parts[0]);
  const last = ascii(parts[parts.length - 1]);
  const f = ascii(file);
  return f.includes(last) || (first.length > 2 && f.includes(first) && f.includes(last.slice(0, 4)));
}
const fileUses = new Map();
for (const p of players) {
  const file = fileFor(p);
  if (file) fileUses.set(file, (fileUses.get(file) ?? 0) + 1);
}

const commons = {};
const none = [];
const credits = [];
let rejected = 0;
let excluded = 0;
const noFaceData = [];
for (const p of players) {
  if (extra[p.person_id]?.exclude) {
    excluded++;
    none.push(p.person_id);
    continue;
  }
  const file = fileFor(p);
  const meta = file && info.get(file);
  const picked = extra[p.person_id];
  const trusted = file && (picked || (fileUses.get(file) === 1 && namesPlayer(p.full_name, file)));
  if (meta && !trusted) rejected++;
  if (!meta || !trusted || !/^image\/(jpeg|png)$/.test(meta.mime)) {
    none.push(p.person_id);
    continue;
  }
  const underscored = file.replace(/ /g, "_");
  // [path, width, height] + the face (centre x, y, box w, h in % of the image) so every game can
  // place the photo on it (utils/playerPhotos placePhoto). A face recorded for another file is stale.
  const entry = [`${hashDir(underscored)}/${underscored}`, meta.width, meta.height];
  const fc = faces[p.person_id]?.file === underscored ? faces[p.person_id] : null;
  const pct = (v) => Math.round(v * 1000) / 10;
  if (fc?.box) {
    const [x, y, w, h] = fc.box;
    entry.push(pct(x + w / 2), pct(y + h / 2), pct(w), pct(h));
  } else if (!fc && picked?.face_y != null) {
    entry.push(Math.round(picked.face_x ?? 50), Math.round(picked.face_y));
  }
  if (!fc) noFaceData.push(p.person_id);
  commons[p.person_id] = entry;
  credits.push({
    player: p.full_name,
    file: underscored,
    artist: meta.artist,
    license: meta.license,
    license_url: meta.license_url,
  });
}
none.sort((a, b) => a - b);
credits.sort((a, b) => a.player.localeCompare(b.player));

mkdirSync(dirname(MAP_OUT), { recursive: true });
mkdirSync(dirname(CREDITS_OUT), { recursive: true });
writeFileSync(MAP_OUT, JSON.stringify({ generated: new Date().toISOString().slice(0, 10), commons, none }));
writeFileSync(CREDITS_OUT, JSON.stringify(credits, null, 1) + "\n");

// Name (and alias) -> person_id, for data that only carries names (Starting Five). A name
// shared by two players resolves to the one who played most recently.
const lastSeason = (p) => Math.max(0, ...(p.teams ?? []).map((t) => t.end_year ?? 9999));
const ids = {};
for (const p of [...players].sort((a, b) => lastSeason(a) - lastSeason(b))) {
  for (const name of [p.full_name, ...(p.aliases ?? [])]) ids[name] = p.person_id;
}
writeFileSync(IDS_OUT, JSON.stringify(ids));
const covered = players.length - none.length;
console.log(
  `[player-photos] done: ${covered}/${players.length} with a photo (Commons), ${none.length} silhouette; ` +
    `${rejected} Commons files skipped as possibly someone else, ${excluded} excluded by review`,
);
if (noFaceData.length) {
  console.log(
    `[player-photos] ${noFaceData.length} Commons photos have no face data yet — run ` +
      `py -3.11 scripts/player-photos/detect_faces.py, review, then this build again: ${noFaceData.join(", ")}`,
  );
}
