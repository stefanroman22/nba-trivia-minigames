// multiplayer_server/src/questions.js
// Pre-generated questions. Mirrors src/utils/questions.ts.
//
// deal() / loadNames() read the manifest-v3 data host first (gameData.js, DATA_PUBLIC_BASE)
// whenever its manifest publishes the game / "question_names", so a room gets the same
// question files single-player reads; otherwise (not published yet, hidden games, host down)
// they fall back to the old Supabase Storage questions store below (QUESTIONS_PUBLIC_BASE),
// logged once per game. turnGames.js (tictactoe, imposter) and index.js both go through here.
const { normalizeAnswer } = require("./answerMatch");
const gameData = require("./gameData");

// The question games the publisher puts on the data host (publish_v3.QUESTION_GAMES).
const PUBLISHED_GAMES = new Set(["career-path", "who-are-ya", "tictactoe", "contexto"]);
const warned = new Set();
function warnOnce(key, message) {
  if (warned.has(key)) return;
  warned.add(key);
  console.warn(`[questions] ${message}`);
}

/** The published question, or null to use the store (DATA_PUBLIC_BASE unset = silent). */
async function publishedQuestion(gameId) {
  if (!gameData.isConfigured()) return null;
  try {
    const m = await gameData.getManifest();
    if (!gameData.hasQuestions(m, gameId)) {
      if (PUBLISHED_GAMES.has(gameId)) warnOnce(gameId, `${gameId}: not published on the data host yet, using the questions store`);
      return null;
    }
    return await gameData.fetchQuestion(gameId);
  } catch (err) {
    warnOnce(gameId, `${gameId}: data host unavailable (${err.message}), using the questions store`);
    return null;
  }
}

async function publishedNames() {
  if (!gameData.isConfigured()) return null;
  try {
    const m = await gameData.getManifest();
    if (!m.question_names) {
      warnOnce("names", "question names not published on the data host yet, using the questions store");
      return null;
    }
    return await gameData.fetchQuestionNames();
  } catch (err) {
    warnOnce("names", `data host unavailable for question names (${err.message}), using the questions store`);
    return null;
  }
}

const BASE = (process.env.QUESTIONS_PUBLIC_BASE || "").replace(/\/$/, "");
const SUPPORTED_SCHEMA = 1;
const MANIFEST_TTL_MS = 60_000;

let manifest = null;      // { at, value }
let testFiles = null;     // url -> object (test seam)
const files = new Map();  // `${version}:${key}` -> object

async function getJson(url) {
  if (testFiles) {
    if (!(url in testFiles)) throw new Error(`test file missing: ${url}`);
    return testFiles[url];
  }
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url} ${r.status}`);
  return r.json();
}

async function getManifest() {
  if (manifest && Date.now() - manifest.at < MANIFEST_TTL_MS) return manifest.value;
  const m = await getJson(`${BASE}/questions/manifest.json`);
  if (m.schema !== SUPPORTED_SCHEMA) throw new Error(`questions schema ${m.schema} unsupported`);
  manifest = { at: Date.now(), value: m };
  for (const k of files.keys()) if (!k.startsWith(`${m.version}:`)) files.delete(k);
  return m;
}

async function cached(version, key, url) {
  const k = `${version}:${key}`;
  if (files.has(k)) return files.get(k);
  const v = await getJson(url);
  files.set(k, v);
  return v;
}

async function loadNames() {
  const published = await publishedNames();
  if (published) return published;
  const m = await getManifest();
  return cached(m.version, "names", m.names);
}

async function loadIndex(game) {
  const m = await getManifest();
  const entry = m.games[game];
  if (!entry) throw new Error(`no questions for ${game}`);
  return cached(m.version, `${game}:index`, entry.index);
}

async function loadQuestion(game, qid) {
  const m = await getManifest();
  const url = m.games[game].index.replace(/index\.json$/, `${qid}.json`);
  return cached(m.version, `${game}:${qid}`, url);
}

// The pickers are shared with the published path (gameData.js mirrors src/utils/gameData.ts).
const { pickRandom, pickDaily, PICKERS } = gameData;

/** One question for a game id (a room deals once so every member plays the same one). */
async function deal(gameId) {
  const published = await publishedQuestion(gameId);
  if (published) return published;
  const index = await loadIndex(gameId);
  if (!index.items.length) throw new Error(`no questions for ${gameId}`);
  const qid = (PICKERS[gameId] || pickRandom)(index);
  return loadQuestion(gameId, qid);
}

// names is the manifest's players-names.json: an array of NamesEntry objects
// ({ id, full_name, aliases, ... }, mirrors src/types/types.tsx), not tuples —
// same shape src/utils/questions.ts's buildNameLookup consumes.
function nameLookup(names) {
  const toId = new Map();
  const nameOf = new Map();
  for (const n of names) {
    nameOf.set(n.id, n.full_name);
    const c = normalizeAnswer(n.full_name);
    if (c && !toId.has(c)) toId.set(c, n.id);
    for (const a of n.aliases || []) { const k = normalizeAnswer(a); if (k && !toId.has(k)) toId.set(k, n.id); }
  }
  return { toId: (g) => toId.get(normalizeAnswer(g)) ?? null, nameOf: (id) => nameOf.get(id) ?? null };
}

function _setForTest(fixture) { testFiles = fixture ? fixture.files : null; manifest = null; files.clear(); warned.clear(); }

module.exports = { getManifest, loadNames, loadIndex, loadQuestion, deal, nameLookup, pickDaily, _setForTest };
