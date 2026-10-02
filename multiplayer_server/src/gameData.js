// multiplayer_server/src/gameData.js
//
// Manifest-v3 published game data for the five pool games, so a room is dealt from the same
// files single-player reads (docs/team/designs/2026-10-02-independent-game-data-publishing.md).
// CommonJS twin of src/utils/gameData.ts: keep the two in step. The publisher and the expand()
// contract live in backend/trivia/data_pipeline/publish_v3.py. Both loaders are tested against
// the publisher-generated fixture in scripts/fixtures/game-data-v3/ (scripts/test_game_data.js
// here, scripts/test-game-data.mjs at the repo root).
//
// manifest.json (60 s in-memory cache) -> random chunk(s) or the single file + lookups ->
// expand() -> n random rows in the exact shape the backend endpoints return, with playoff
// sides re-randomized once per deal (the room then sends that one payload to every member).
//
// DATA_PUBLIC_BASE unset, or the host failing, makes dealOrNull() return null so index.js falls
// back to the backend endpoints in gameEndpoints.js (logged once per game).
//
// Question games ("kind": "questions"): fetchQuestion(game) reads index -> the game's picker ->
// one question file, the exact payload the old Supabase questions store served, and
// fetchQuestionNames() the "question_names" list. questions.js uses them whenever the manifest
// publishes the game, and falls back to the store otherwise. The pickers live here and mirror
// src/utils/gameData.ts (contexto: same UTC day -> same question on the site and the relay).

const SCHEMA = 3;
const MANIFEST_TTL_MS = 60_000;

// Online game id -> [published game key, rows per room]. The counts match the backend
// endpoints and single-player's fetchGamePool(key, n) in src/utils/GameUtils.tsx.
const ROUND_GAMES = {
  "series-winner": ["playoff", 5],
  "name-logo": ["name-logo", 5],
  "guess-mvps": ["mvps", 5],
  "starting-five": ["starting-five", 1],
  "fan-favorites": ["fan-favorites", 1],
};

// The publisher writes a stable side per series (stable hashes); without re-randomizing, the
// answer would sit on the same side every time.
const SIDE_GAMES = new Set(["playoff"]);

let manifest = null;        // { at, base, value }
let manifestPromise = null;
const files = new Map();    // content-addressed path -> parsed file
const warned = new Set();

function base() {
  return (process.env.DATA_PUBLIC_BASE || "").trim().replace(/\/+$/, "");
}

function isConfigured() {
  return base() !== "";
}

function handles(gameId) {
  return Object.prototype.hasOwnProperty.call(ROUND_GAMES, gameId);
}

function isManifest(m) {
  return !!m && typeof m === "object" && m.schema === SCHEMA && !!m.games && typeof m.games === "object";
}

const questionPath = (game, qid, sha12) => `${game}/${qid}.${sha12}.json`;

function isPublishedIndex(v) {
  return !!v && typeof v === "object" && typeof v.game === "string" && Array.isArray(v.items) && !!v.files && typeof v.files === "object";
}

/** Files a manifest references, plus the question files listed by its already-cached indexes. */
function manifestFiles(m) {
  const paths = new Set();
  for (const entry of Object.values(m.games)) {
    if (entry.file) paths.add(entry.file);
    for (const c of entry.chunks || []) paths.add(c);
    for (const l of Object.values(entry.lookups || {})) paths.add(l);
    if (entry.index) {
      paths.add(entry.index);
      const index = files.get(entry.index);
      if (isPublishedIndex(index)) for (const [qid, sha] of Object.entries(index.files)) paths.add(questionPath(index.game, qid, sha));
    }
  }
  if (m.names) paths.add(m.names);
  if (m.question_names) paths.add(m.question_names);
  return paths;
}

// A hanging data host must not stall a room's deal: give up and fall back to the endpoint.
const FETCH_TIMEOUT_MS = 8_000;

async function getJson(url) {
  const r = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (!r.ok) throw new Error(`${url} ${r.status}`);
  return r.json();
}

/** The live manifest (60 s cache). An unreachable host reuses the last good one; schema != 3 throws. */
async function getManifest() {
  const b = base();
  if (!b) throw new Error("DATA_PUBLIC_BASE is not set");
  if (manifest && manifest.base === b && Date.now() - manifest.at < MANIFEST_TTL_MS) return manifest.value;
  if (!manifestPromise) {
    manifestPromise = getJson(`${b}/manifest.json`)
      .then(
        (m) => {
          if (!isManifest(m)) throw new Error(`manifest schema ${m && m.schema} is not ${SCHEMA}`);
          manifest = { at: Date.now(), base: b, value: m };
          const keep = manifestFiles(m);
          for (const k of [...files.keys()]) if (!keep.has(k)) files.delete(k);
          return m;
        },
        (err) => {
          if (manifest && manifest.base === b) return manifest.value;
          throw err;
        },
      )
      .finally(() => {
        manifestPromise = null;
      });
  }
  return manifestPromise;
}

async function cachedJson(path, valid, what) {
  if (files.has(path)) return files.get(path);
  const value = await getJson(`${base()}/${path}`);
  if (!valid(value)) throw new Error(`${path} is not ${what}`);
  files.set(path, value);
  return value;
}

function cachedFile(path) {
  return cachedJson(path, Array.isArray, "a JSON array");
}

/** THE expand() contract (publish_v3.py), mirrored from src/utils/gameData.ts. */
function expand(rows, lookups) {
  return rows.map((row) => {
    if (row === null || typeof row !== "object" || Array.isArray(row)) return row;
    const out = {};
    for (const [key, value] of Object.entries(row)) {
      const at = key.indexOf("@");
      if (at < 0) {
        out[key] = value;
        continue;
      }
      const prefix = key.slice(0, at);
      const name = key.slice(at + 1);
      const entry = lookups[name] && lookups[name][value];
      if (!entry || typeof entry !== "object") throw new Error(`missing lookup ${name}[${value}]`);
      for (const [suffix, v] of Object.entries(entry)) out[prefix + suffix] = v;
    }
    return out;
  });
}

/** Copy of row with every paired team_a* / team_b* field swapped with probability 1/2; winner untouched. */
function randomizeSides(row, rand = Math.random) {
  if (row === null || typeof row !== "object") return row;
  const out = { ...row };
  if (rand() < 0.5) return out;
  for (const key of Object.keys(row)) {
    if (!key.startsWith("team_a")) continue;
    const other = `team_b${key.slice("team_a".length)}`;
    if (!(other in row)) continue;
    out[key] = row[other];
    out[other] = row[key];
  }
  return out;
}

function shuffle(arr, rand) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

async function loadLookups(entry) {
  const pairs = await Promise.all(
    Object.entries(entry.lookups || {}).map(async ([name, path]) => [name, await cachedFile(path)]),
  );
  return Object.fromEntries(pairs);
}

async function loadEncoded(entry, n, rand) {
  if (entry.kind === "single") {
    if (!entry.file) throw new Error("single entry without a file");
    return cachedFile(entry.file);
  }
  if (entry.kind !== "chunked" || !entry.chunks || !entry.chunks.length) throw new Error(`unsupported entry kind ${entry.kind}`);
  const order = shuffle([...entry.chunks], rand);
  if (n == null) return (await Promise.all(order.map(cachedFile))).flat();
  const perChunk = Math.max(1, Math.floor(entry.rows / entry.chunks.length));
  const first = Math.min(order.length, Math.max(1, Math.ceil(n / perChunk)));
  const rows = (await Promise.all(order.slice(0, first).map(cachedFile))).flat();
  for (let i = first; i < order.length && rows.length < n; i++) rows.push(...(await cachedFile(order[i])));
  return rows;
}

async function loadRowsFrom(m, game, n, rand) {
  const entry = m.games[game];
  if (!entry) throw new Error(`no ${game} in manifest ${m.version}`);
  const [encoded, lookups] = await Promise.all([loadEncoded(entry, n, rand), loadLookups(entry)]);
  return expand(encoded, lookups);
}

/** n random rows of a published game (all when n is undefined), sides randomized for SIDE_GAMES. */
async function fetchGameRows(game, n, rand = Math.random) {
  const m = await getManifest();
  let rows;
  try {
    rows = await loadRowsFrom(m, game, n, rand);
  } catch (err) {
    // A manifest up to 60 s old can point at files a publish just retired: retry once on a fresh one.
    manifest = null;
    const fresh = await getManifest().catch(() => m);
    if (fresh === m || JSON.stringify(fresh.games[game]) === JSON.stringify(m.games[game])) throw err;
    rows = await loadRowsFrom(fresh, game, n, rand);
  }
  const picked = n == null ? [...rows] : shuffle([...rows], rand).slice(0, n);
  return SIDE_GAMES.has(game) ? picked.map((r) => randomizeSides(r, rand)) : picked;
}

/** One room's round for an online game id (see ROUND_GAMES). Throws on any failure. */
async function deal(gameId, rand = Math.random) {
  if (!handles(gameId)) throw new Error(`${gameId} is not a published pool game`);
  const [game, n] = ROUND_GAMES[gameId];
  const rows = await fetchGameRows(game, n, rand);
  if (!rows.length) throw new Error(`no ${game} rows`);
  return rows;
}

function warnOnce(key, message) {
  if (warned.has(key)) return;
  warned.add(key);
  console.warn(`[gameData] ${message}`);
}

/**
 * The round from the published files, or null when index.js should use the backend endpoint
 * instead: not a pool game, DATA_PUBLIC_BASE unset, or the data host failing (logged once).
 */
async function dealOrNull(gameId) {
  if (!handles(gameId)) return null;
  if (!isConfigured()) {
    warnOnce("unset", "DATA_PUBLIC_BASE is not set; pool games use the backend endpoints");
    return null;
  }
  try {
    return await deal(gameId);
  } catch (err) {
    warnOnce(gameId, `${gameId}: published data unavailable (${err.message}); using the backend endpoint`);
    return null;
  }
}

// ------------------------------------------------------------------ question games

function utcToday() { return new Date().toISOString().slice(0, 10); }
/** FNV-1a: contexto's daily fallback and SuperDraft's online objective. Same as src/utils/gameData.ts. */
function hashStr(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
function pickRandom(index, rand = Math.random) { return String(index.items[Math.floor(rand() * index.items.length)][0]); }
function pickWeighted(index, rand = Math.random) {
  const total = index.items.reduce((s, it) => s + (Number(it[1]) || 1), 0);
  let r = rand() * total;
  for (const it of index.items) { r -= Number(it[1]) || 1; if (r <= 0) return String(it[0]); }
  return String(index.items[index.items.length - 1][0]);
}
function pickDaily(index, today = utcToday()) {
  const hit = index.items.find((it) => it[1] === today);
  if (hit) return String(hit[0]);
  const sorted = [...index.items].sort((a, b) => String(a[0]).localeCompare(String(b[0])));
  return String(sorted[hashStr(today) % sorted.length][0]);
}
const PICKERS = { "career-path": pickWeighted, contexto: (i) => pickDaily(i), imposter: (i) => String(i.items[0][0]) };

function hasQuestions(m, game) {
  const entry = m && m.games && m.games[game];
  return !!entry && entry.kind === "questions" && !!entry.index;
}

async function loadIndexFrom(m, game) {
  if (!hasQuestions(m, game)) throw new Error(`no ${game} questions in manifest ${m.version}`);
  return cachedJson(m.games[game].index, isPublishedIndex, "a question index");
}

async function loadQuestionFrom(m, game, rand, qid) {
  const index = await loadIndexFrom(m, game);
  if (!index.items.length) throw new Error(`no ${game} questions`);
  const pick = qid || (PICKERS[game] || pickRandom)(index, rand);
  const sha = index.files[pick];
  if (!sha) throw new Error(`${game}/${pick} is not in the index`);
  return cachedJson(questionPath(game, pick, sha), (v) => !!v && typeof v === "object" && !Array.isArray(v) && typeof v.qid === "string", "a question");
}

/** One question for a game from the published files (`qid` skips the picker). Throws on any failure. */
async function fetchQuestion(game, rand = Math.random, qid) {
  const m = await getManifest();
  try {
    return await loadQuestionFrom(m, game, rand, qid);
  } catch (err) {
    // A manifest up to 60 s old can point at an index a publish just retired: retry once on a fresh one.
    manifest = null;
    const fresh = await getManifest().catch(() => m);
    if (fresh === m || JSON.stringify(fresh.games[game]) === JSON.stringify(m.games[game])) throw err;
    return loadQuestionFrom(fresh, game, rand, qid);
  }
}

/** The question games' NamesEntry list (manifest "question_names"). Throws when absent. */
async function fetchQuestionNames() {
  const m = await getManifest();
  if (!m.question_names) throw new Error(`no question_names in manifest ${m.version}`);
  return cachedJson(m.question_names, Array.isArray, "a names list");
}

function _resetForTest() {
  manifest = null;
  manifestPromise = null;
  files.clear();
  warned.clear();
}

/** Test seam: age the cached manifest past its TTL (the file cache is kept). */
function _expireManifestForTest() {
  if (manifest) manifest.at = 0;
}

module.exports = {
  ROUND_GAMES, SIDE_GAMES, isConfigured, handles, getManifest, expand, randomizeSides,
  fetchGameRows, deal, dealOrNull, _resetForTest, _expireManifestForTest,
  hasQuestions, fetchQuestion, fetchQuestionNames, pickRandom, pickWeighted, pickDaily, hashStr, utcToday, PICKERS,
};
