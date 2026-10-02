// Manifest-v3 game data (docs/team/designs/2026-10-02-independent-game-data-publishing.md):
// manifest.json (60 s) -> content-addressed chunk / single files + lookups -> expand() ->
// rows in the exact shape the renderers got from the old whole-pool /data/<key>.json files.
//
// The publisher is backend/trivia/data_pipeline/publish_v3.py; its module docstring holds the
// expand() contract mirrored below. The multiplayer relay has a CommonJS twin,
// multiplayer_server/src/gameData.js: keep the two in step. Both are checked against the same
// publisher-generated fixture (multiplayer_server/scripts/fixtures/game-data-v3/) by
// scripts/test-game-data.mjs and multiplayer_server/scripts/test_game_data.js.
//
// Question games (kind "questions": index -> pick a qid -> one question file) are read through
// fetchQuestion() / fetchQuestionNames() below; the pickers (weighted, daily contexto, random)
// live here and are shared with utils/questions.ts.
//
// Callers (utils/pool.ts) fall back to the bundled /data copy when this module throws;
// utils/questions.ts falls back to the Supabase Storage questions store.
import type { GameData, NamesEntry, Question, QuestionIndex } from "../types/types";

export const SCHEMA = 3;
const BASE = (process.env.VITE_DATA_BASE || "").replace(/\/+$/, "");
const MANIFEST_TTL_MS = 60_000;
const LS_MANIFEST = "gamedata:manifest";
const LS_FILE = "gamedata:f:"; // + content-addressed path, e.g. "gamedata:f:mvps/all.3f9a1c2b7e04.json"

/** The pool games published under manifest v3 (pool.ts keys). */
export const POOL_GAMES = new Set(["playoff", "name-logo", "mvps", "starting-five", "fan-favorites"]);

/** The question games the publisher can put under manifest v3 (publish_v3.QUESTION_GAMES). */
export const QUESTION_GAMES = new Set(["career-path", "who-are-ya", "tictactoe", "contexto"]);

/**
 * Games whose rows carry a team_a / team_b pair the player picks between. The publisher writes
 * a stable side per series (stable hashes), so the client must re-randomize it every round or
 * the answer would sit on the same side every time.
 */
export const SIDE_GAMES = new Set(["playoff"]);

type Row = Record<string, unknown>;
export type Lookups = Record<string, Row[]>;

export interface GameEntry {
  kind: string; // "single" | "chunked" | "questions"
  rows: number;
  file?: string;
  chunks?: string[];
  chunk_size?: number;
  lookups?: Record<string, string>;
  index?: string; // kind "questions": "<game>/index.<sha12>.json"
}

export interface ManifestV3 {
  schema: number;
  version: string;
  published_at?: string;
  games: Record<string, GameEntry>;
  names?: string;
  question_names?: string;
}

/** A published question index: the snapshot index.json minus `version`, plus qid -> sha12. */
interface PublishedIndex {
  schema: number;
  game: string;
  dataset: { players: string };
  items: (string | number)[][];
  files: Record<string, string>;
}

export class GameDataUnavailable extends Error {}

let manifestCache: { at: number; value: ManifestV3 } | null = null;
let manifestPromise: Promise<ManifestV3> | null = null;
const mem = new Map<string, unknown>(); // content-addressed path -> parsed file

/** True when VITE_DATA_BASE points somewhere (whether it really is a v3 host is checked lazily). */
export function isConfigured(): boolean {
  return BASE !== "";
}

function isManifest(m: unknown): m is ManifestV3 {
  if (!m || typeof m !== "object") return false;
  const v = m as ManifestV3;
  return v.schema === SCHEMA && !!v.games && typeof v.games === "object";
}

function writeLs(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // quota / private mode / no localStorage: the memory cache still serves this session
  }
}

/** Parsed localStorage value, or null. A corrupt entry is removed so it gets refetched. */
function readLs(key: string): unknown {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(key);
  } catch {
    return null;
  }
  if (raw == null) return null;
  try {
    return JSON.parse(raw);
  } catch {
    try {
      localStorage.removeItem(key);
    } catch {
      // ignore
    }
    return null;
  }
}

/**
 * Every file path a manifest references (all games' files, chunks, lookups and question indexes,
 * plus both names files). Question files are listed in their index, not the manifest.
 */
export function manifestFiles(m: ManifestV3): Set<string> {
  const paths = new Set<string>();
  for (const entry of Object.values(m.games)) {
    if (entry.file) paths.add(entry.file);
    for (const c of entry.chunks ?? []) paths.add(c);
    for (const l of Object.values(entry.lookups ?? {})) paths.add(l);
    if (entry.index) paths.add(entry.index);
  }
  if (m.names) paths.add(m.names);
  if (m.question_names) paths.add(m.question_names);
  return paths;
}

function isPublishedIndex(v: unknown): v is PublishedIndex {
  if (!v || typeof v !== "object") return false;
  const i = v as PublishedIndex;
  return typeof i.game === "string" && Array.isArray(i.items) && !!i.files && typeof i.files === "object";
}

const questionPath = (game: string, qid: string, sha12: string) => `${game}/${qid}.${sha12}.json`;

/** The question files of the manifest's question indexes that are already cached (memory or localStorage). */
function cachedQuestionFiles(m: ManifestV3): Set<string> {
  const paths = new Set<string>();
  for (const entry of Object.values(m.games)) {
    if (entry.kind !== "questions" || !entry.index) continue;
    const index = mem.get(entry.index) ?? readLs(LS_FILE + entry.index);
    if (!isPublishedIndex(index)) continue;
    for (const [qid, sha] of Object.entries(index.files)) paths.add(questionPath(index.game, qid, sha));
  }
  return paths;
}

/** Drop cached files the current manifest no longer references (memory + localStorage). */
function prune(m: ManifestV3): void {
  const keep = manifestFiles(m);
  for (const p of cachedQuestionFiles(m)) keep.add(p);
  for (const k of [...mem.keys()]) if (!keep.has(k)) mem.delete(k);
  try {
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i);
      if (k && k.startsWith(LS_FILE) && !keep.has(k.slice(LS_FILE.length))) localStorage.removeItem(k);
    }
  } catch {
    // ignore
  }
}

// A hanging data host must not hold the game's loader forever: give up and fall back to /data.
const FETCH_TIMEOUT_MS = 8_000;

async function getJson(url: string): Promise<unknown> {
  const signal = typeof AbortSignal.timeout === "function" ? AbortSignal.timeout(FETCH_TIMEOUT_MS) : undefined;
  const res = await fetch(url, { signal });
  if (!res.ok) throw new GameDataUnavailable(`${url} ${res.status}`);
  return res.json();
}

/**
 * The live manifest (60 s in-memory cache). Unreachable host -> the last good manifest from
 * localStorage (offline play from cached files); a reachable host that isn't schema 3 throws.
 */
export async function getManifest(): Promise<ManifestV3> {
  if (!BASE) throw new GameDataUnavailable("VITE_DATA_BASE is not set");
  if (manifestCache && Date.now() - manifestCache.at < MANIFEST_TTL_MS) return manifestCache.value;
  if (!manifestPromise) {
    manifestPromise = getJson(`${BASE}/manifest.json`)
      .then(
        (m) => {
          if (!isManifest(m)) {
            const schema = m && typeof m === "object" ? (m as { schema?: unknown }).schema : undefined;
            throw new GameDataUnavailable(`manifest schema ${String(schema)} is not ${SCHEMA}`);
          }
          manifestCache = { at: Date.now(), value: m };
          writeLs(LS_MANIFEST, m);
          prune(m);
          return m;
        },
        (err) => {
          const stale = readLs(LS_MANIFEST);
          if (isManifest(stale)) return stale;
          throw err;
        },
      )
      .finally(() => {
        manifestPromise = null;
      });
  }
  return manifestPromise;
}

/** One published file, cached by its content-addressed path; `valid` rejects a wrong shape. */
async function cachedJson<T>(path: string, valid: (v: unknown) => v is T, what: string): Promise<T> {
  const hit = mem.get(path);
  if (valid(hit)) return hit;
  const stored = readLs(LS_FILE + path);
  if (valid(stored)) {
    mem.set(path, stored);
    return stored;
  }
  const value = await getJson(`${BASE}/${path}`);
  if (!valid(value)) throw new GameDataUnavailable(`${path} is not ${what}`);
  mem.set(path, value);
  writeLs(LS_FILE + path, value);
  return value;
}

const isArray = (v: unknown): v is unknown[] => Array.isArray(v);

/** One published data file (always a JSON array). */
function cachedFile(path: string): Promise<unknown[]> {
  return cachedJson(path, isArray, "a JSON array");
}

/**
 * THE expand() contract (publish_v3.py): a key "<prefix>@<lookup>" holding an index is replaced
 * by every {suffix: value} of lookups[<lookup>][<index>] written as row[prefix + suffix]; other
 * keys are copied as is; rows that are not objects (e.g. name strings) pass through.
 */
export function expand(rows: unknown[], lookups: Lookups): unknown[] {
  return rows.map((row) => {
    if (row === null || typeof row !== "object" || Array.isArray(row)) return row;
    const out: Row = {};
    for (const [key, value] of Object.entries(row as Row)) {
      const at = key.indexOf("@");
      if (at < 0) {
        out[key] = value;
        continue;
      }
      const prefix = key.slice(0, at);
      const name = key.slice(at + 1);
      const entry = lookups[name]?.[value as number];
      if (!entry || typeof entry !== "object") throw new GameDataUnavailable(`missing lookup ${name}[${String(value)}]`);
      for (const [suffix, v] of Object.entries(entry)) out[prefix + suffix] = v;
    }
    return out;
  });
}

/**
 * Swap every paired team_a* / team_b* field (name, abbreviation, logo, wins, ...) with
 * probability 1/2. Returns a copy; the winner field is untouched, so it still names the winner.
 */
export function randomizeSides<T>(row: T, rand: () => number = Math.random): T {
  if (row === null || typeof row !== "object") return row;
  const src = row as Row;
  const out: Row = { ...src };
  if (rand() < 0.5) return out as T;
  for (const key of Object.keys(src)) {
    if (!key.startsWith("team_a")) continue;
    const other = `team_b${key.slice("team_a".length)}`;
    if (!(other in src)) continue;
    out[key] = src[other];
    out[other] = src[key];
  }
  return out as T;
}

function shuffle<T>(arr: T[], rand: () => number): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

async function loadLookups(entry: GameEntry): Promise<Lookups> {
  const pairs = await Promise.all(
    Object.entries(entry.lookups ?? {}).map(async ([name, path]) => [name, await cachedFile(path)] as const),
  );
  return Object.fromEntries(pairs) as Lookups;
}

/** Encoded rows of an entry: the single file, all chunks (n undefined), or random chunks covering n rows. */
async function loadEncoded(entry: GameEntry, n: number | undefined, rand: () => number): Promise<unknown[]> {
  if (entry.kind === "single") {
    if (!entry.file) throw new GameDataUnavailable("single entry without a file");
    return cachedFile(entry.file);
  }
  if (entry.kind !== "chunked" || !entry.chunks?.length) throw new GameDataUnavailable(`unsupported entry kind ${entry.kind}`);
  const order = shuffle([...entry.chunks], rand);
  if (n == null) return (await Promise.all(order.map(cachedFile))).flat();
  const perChunk = Math.max(1, Math.floor(entry.rows / entry.chunks.length));
  const first = Math.min(order.length, Math.max(1, Math.ceil(n / perChunk)));
  const rows = (await Promise.all(order.slice(0, first).map(cachedFile))).flat();
  // Chunks are near-equal (round-robin at publish), so this rarely runs.
  for (let i = first; i < order.length && rows.length < n; i++) rows.push(...(await cachedFile(order[i])));
  return rows;
}

async function loadRowsFrom(m: ManifestV3, game: string, n: number | undefined, rand: () => number): Promise<unknown[]> {
  const entry = m.games[game];
  if (!entry) throw new GameDataUnavailable(`no ${game} in manifest ${m.version}`);
  const [encoded, lookups] = await Promise.all([loadEncoded(entry, n, rand), loadLookups(entry)]);
  return expand(encoded, lookups);
}

/**
 * Rows for a game: `n` random rows (all rows when n is undefined), in the renderers' shape,
 * with team sides re-randomized for SIDE_GAMES. Throws GameDataUnavailable (or a fetch error).
 */
export async function fetchGameRows(game: string, n?: number, rand: () => number = Math.random): Promise<GameData[]> {
  const m = await getManifest();
  let rows: unknown[];
  try {
    rows = await loadRowsFrom(m, game, n, rand);
  } catch (err) {
    // A manifest up to 60 s old can point at files a publish just retired: retry once on a fresh one.
    manifestCache = null;
    const fresh = await getManifest().catch(() => m);
    if (fresh === m || JSON.stringify(fresh.games[game]) === JSON.stringify(m.games[game])) throw err;
    rows = await loadRowsFrom(fresh, game, n, rand);
  }
  const picked = n == null ? [...rows] : shuffle([...rows], rand).slice(0, n);
  return (SIDE_GAMES.has(game) ? picked.map((r) => randomizeSides(r, rand)) : picked) as GameData[];
}

/** The shared autocomplete names (manifest "names": the all-players list of strings). */
export async function fetchNames(): Promise<string[]> {
  const m = await getManifest();
  if (!m.names) throw new GameDataUnavailable(`no names in manifest ${m.version}`);
  return (await cachedFile(m.names)) as string[];
}

// ------------------------------------------------------------------ question games

/** Index pickers (moved here from utils/questions.ts, which re-exports them). Items: [qid, ...]. */
export function pickRandom(index: QuestionIndex, rand: () => number = Math.random): string {
  const items = index.items;
  return String(items[Math.floor(rand() * items.length)][0]);
}

/** career-path: items [qid, weight]; a missing / non-numeric weight counts as 1. */
export function pickWeighted(index: QuestionIndex, rand: () => number = Math.random): string {
  const items = index.items;
  const total = items.reduce((s, it) => s + (Number(it[1]) || 1), 0);
  let r = rand() * total;
  for (const it of items) {
    r -= Number(it[1]) || 1;
    if (r <= 0) return String(it[0]);
  }
  return String(items[items.length - 1][0]);
}

export function utcToday(): string {
  return new Date().toISOString().slice(0, 10);
}

/** FNV-1a over a string — the Contexto daily fallback, and SuperDraft's online objective (hashStr(qid)). */
export function hashStr(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** contexto: the item scheduled for `today` (UTC), else a stable FNV pick over the sorted qids. */
export function pickDaily(index: QuestionIndex, today = utcToday()): string {
  const scheduled = index.items.find((it) => it[1] === today);
  if (scheduled) return String(scheduled[0]);
  const sorted = [...index.items].sort((a, b) => String(a[0]).localeCompare(String(b[0])));
  return String(sorted[hashStr(today) % sorted.length][0]);
}

/** Per-game picker; anything not listed picks uniformly. Mirrored in multiplayer_server/src/gameData.js. */
export const PICKERS: Record<string, (i: QuestionIndex, rand?: () => number) => string> = {
  "career-path": pickWeighted,
  "who-are-ya": pickRandom,
  tictactoe: pickRandom,
  superdraft: pickRandom,
  contexto: (i) => pickDaily(i),
  imposter: (i) => String(i.items[0][0]),
};

/** True when the manifest publishes this question game. */
export function hasQuestions(m: ManifestV3, game: string): boolean {
  const entry = m.games[game];
  return !!entry && entry.kind === "questions" && !!entry.index;
}

async function loadIndexFrom(m: ManifestV3, game: string): Promise<PublishedIndex> {
  if (!hasQuestions(m, game)) throw new GameDataUnavailable(`no ${game} questions in manifest ${m.version}`);
  return cachedJson(m.games[game].index as string, isPublishedIndex, "a question index");
}

/** A game's question index in the QuestionIndex shape the pickers take (version = manifest version). */
export async function fetchQuestionIndex(game: string): Promise<QuestionIndex> {
  const m = await getManifest();
  const index = await loadIndexFrom(m, game);
  return { schema: index.schema, game: index.game, version: m.version, dataset: index.dataset, items: index.items };
}

const isQuestion = (v: unknown): v is Question =>
  !!v && typeof v === "object" && !Array.isArray(v) && typeof (v as Question).qid === "string";

async function loadQuestionFrom(m: ManifestV3, game: string, rand: () => number, qid?: string): Promise<Question> {
  const index = await loadIndexFrom(m, game);
  if (!index.items.length) throw new GameDataUnavailable(`no ${game} questions`);
  const view: QuestionIndex = { schema: index.schema, game, version: m.version, dataset: index.dataset, items: index.items };
  const pick = qid ?? (PICKERS[game] ?? pickRandom)(view, rand);
  const sha = index.files[pick];
  if (!sha) throw new GameDataUnavailable(`${game}/${pick} is not in the index`);
  return cachedJson(questionPath(game, pick, sha), isQuestion, "a question");
}

/**
 * One question for a game: manifest -> index -> the game's picker -> the question file, exactly
 * the payload the old questions store served. `qid` skips the picker. Throws GameDataUnavailable
 * (or a fetch error) when the host or the game isn't available; callers fall back.
 */
export async function fetchQuestion(game: string, rand: () => number = Math.random, qid?: string): Promise<Question> {
  const m = await getManifest();
  try {
    return await loadQuestionFrom(m, game, rand, qid);
  } catch (err) {
    // A manifest up to 60 s old can point at an index a publish just retired: retry once on a fresh one.
    manifestCache = null;
    const fresh = await getManifest().catch(() => m);
    if (fresh === m || JSON.stringify(fresh.games[game]) === JSON.stringify(m.games[game])) throw err;
    return loadQuestionFrom(fresh, game, rand, qid);
  }
}

const isNamesList = (v: unknown): v is NamesEntry[] =>
  Array.isArray(v) && (v.length === 0 || (!!v[0] && typeof v[0] === "object"));

/** The question games' autocomplete list (manifest "question_names": NamesEntry objects with ids). */
export async function fetchQuestionNames(): Promise<NamesEntry[]> {
  const m = await getManifest();
  if (!m.question_names) throw new GameDataUnavailable(`no question_names in manifest ${m.version}`);
  return cachedJson(m.question_names, isNamesList, "a names list");
}
