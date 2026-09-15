// multiplayer_server/src/questions.js
// Pre-generated questions from Supabase Storage (public CDN). Mirrors src/utils/questions.ts.
const { normalizeAnswer } = require("./answerMatch");

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

function utcToday() { return new Date().toISOString().slice(0, 10); }
function hashStr(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
function pickRandom(index) { return String(index.items[Math.floor(Math.random() * index.items.length)][0]); }
function pickWeighted(index) {
  const total = index.items.reduce((s, it) => s + (Number(it[1]) || 1), 0);
  let r = Math.random() * total;
  for (const it of index.items) { r -= Number(it[1]) || 1; if (r <= 0) return String(it[0]); }
  return String(index.items[index.items.length - 1][0]);
}
function pickDaily(index, today = utcToday()) {
  const hit = index.items.find((it) => it[1] === today);
  if (hit) return String(hit[0]);
  const sorted = [...index.items].sort((a, b) => String(a[0]).localeCompare(String(b[0])));
  return String(sorted[hashStr(today) % sorted.length][0]);
}
const PICKERS = { "career-path": pickWeighted, contexto: pickDaily, imposter: (i) => String(i.items[0][0]) };

/** One question for a game id (a room deals once so every member plays the same one). */
async function deal(gameId) {
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

function _setForTest(fixture) { testFiles = fixture ? fixture.files : null; manifest = null; files.clear(); }

module.exports = { getManifest, loadNames, loadIndex, loadQuestion, deal, nameLookup, pickDaily, _setForTest };
