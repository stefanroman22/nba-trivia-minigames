// Pre-generated questions: manifest (60 s) -> index -> one question file, all from
// Supabase Storage's public CDN. Same caching shape as utils/pool.ts.
import type {
  FetchResult, NamesEntry, Question, QuestionIndex, QuestionsManifest,
} from "../types/types";
import { normalizeAnswer } from "./answerMatch";

export const SUPPORTED_SCHEMA = 1;
const BASE = (process.env.VITE_QUESTIONS_BASE || "").replace(/\/$/, "");
const MANIFEST_TTL_MS = 60_000;
const LS_MANIFEST = "questions:manifest";

let manifestCache: { at: number; value: QuestionsManifest } | null = null;
let manifestPromise: Promise<QuestionsManifest> | null = null;
const mem = new Map<string, unknown>();

class QuestionsUnavailable extends Error {}

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new QuestionsUnavailable(`${url} ${res.status}`);
  return (await res.json()) as T;
}

function readLs<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function writeLs(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // quota / private mode: memory cache still serves this session
  }
}

function pruneOtherVersions(keep: string): void {
  try {
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i);
      if (k && k.startsWith("questions:v:") && !k.startsWith(`questions:v:${keep}:`)) localStorage.removeItem(k);
    }
  } catch {
    // ignore
  }
}

export async function getManifest(): Promise<QuestionsManifest> {
  if (manifestCache && Date.now() - manifestCache.at < MANIFEST_TTL_MS) return manifestCache.value;
  if (!manifestPromise) {
    manifestPromise = getJson<QuestionsManifest>(`${BASE}/questions/manifest.json`)
      .then((m) => {
        if (m.schema !== SUPPORTED_SCHEMA) throw new QuestionsUnavailable(`schema ${m.schema}`);
        manifestCache = { at: Date.now(), value: m };
        writeLs(LS_MANIFEST, m);
        pruneOtherVersions(m.version);
        return m;
      })
      .catch((err) => {
        const stale = readLs<QuestionsManifest>(LS_MANIFEST);
        if (stale && stale.schema === SUPPORTED_SCHEMA) return stale;
        throw err;
      })
      .finally(() => {
        manifestPromise = null;
      });
  }
  return manifestPromise;
}

async function cached<T>(version: string, key: string, url: string): Promise<T> {
  const k = `questions:v:${version}:${key}`;
  const inMem = mem.get(k);
  if (inMem) return inMem as T;
  const stored = readLs<T>(k);
  if (stored) {
    mem.set(k, stored);
    return stored;
  }
  const value = await getJson<T>(url);
  mem.set(k, value);
  writeLs(k, value);
  return value;
}

export async function loadNames(): Promise<NamesEntry[]> {
  const m = await getManifest();
  return cached<NamesEntry[]>(m.version, "names", m.names);
}

export async function loadIndex(game: string): Promise<QuestionIndex> {
  const m = await getManifest();
  const entry = m.games[game];
  if (!entry) throw new QuestionsUnavailable(`no questions for ${game}`);
  return cached<QuestionIndex>(m.version, `${game}:index`, entry.index);
}

export async function loadQuestion<T extends Question>(game: string, qid: string): Promise<T> {
  const m = await getManifest();
  const entry = m.games[game];
  if (!entry) throw new QuestionsUnavailable(`no questions for ${game}`);
  const url = entry.index.replace(/index\.json$/, `${qid}.json`);
  try {
    return await cached<T>(m.version, `${game}:${qid}`, url);
  } catch (err) {
    // Retention race: the manifest we hold may point at a version that was just pruned.
    manifestCache = null;
    const fresh = await getManifest();
    const freshUrl = fresh.games[game].index.replace(/index\.json$/, `${qid}.json`);
    if (freshUrl === url) throw err;
    return cached<T>(fresh.version, `${game}:${qid}`, freshUrl);
  }
}

export function pickRandom(index: QuestionIndex): string {
  const items = index.items;
  return String(items[Math.floor(Math.random() * items.length)][0]);
}

export function pickWeighted(index: QuestionIndex): string {
  const items = index.items;
  const total = items.reduce((s, it) => s + (Number(it[1]) || 1), 0);
  let r = Math.random() * total;
  for (const it of items) {
    r -= Number(it[1]) || 1;
    if (r <= 0) return String(it[0]);
  }
  return String(items[items.length - 1][0]);
}

export function utcToday(): string {
  return new Date().toISOString().slice(0, 10);
}

/** FNV-1a over the date — the existing Contexto dailySecret rule, used only as a fallback. */
function hashStr(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function pickDaily(index: QuestionIndex, today = utcToday()): string {
  const scheduled = index.items.find((it) => it[1] === today);
  if (scheduled) return String(scheduled[0]);
  const sorted = [...index.items].sort((a, b) => String(a[0]).localeCompare(String(b[0])));
  return String(sorted[hashStr(today) % sorted.length][0]);
}

const PICKERS: Record<string, (i: QuestionIndex) => string> = {
  "career-path": pickWeighted,
  "who-are-ya": pickRandom,
  tictactoe: pickRandom,
  superdraft: pickRandom,
  contexto: (i) => pickDaily(i),
  imposter: (i) => String(i.items[0][0]),
};

const UNAVAILABLE = {
  success: false,
  error: {
    title: "Unable to connect to the server",
    message: "Please check your internet connection or try again later.",
  },
} as const;

/** One question for a game, in the { success, data: [question] } shape MiniGame expects. */
export async function fetchQuestion(game: string): Promise<FetchResult> {
  try {
    const index = await loadIndex(game);
    if (!index.items.length) return { success: false, error: { title: "No data available", message: "Please try again later." } };
    const qid = (PICKERS[game] ?? pickRandom)(index);
    const q = await loadQuestion<Question>(game, qid);
    return { success: true, data: [q] };
  } catch {
    return UNAVAILABLE;
  }
}

export function buildNameLookup(names: NamesEntry[]) {
  const toIdMap = new Map<string, number>();
  const byId = new Map<number, NamesEntry>();
  for (const n of names) {
    byId.set(n.id, n);
    const canon = normalizeAnswer(n.full_name);
    if (canon && !toIdMap.has(canon)) toIdMap.set(canon, n.id);
    for (const a of n.aliases) {
      const k = normalizeAnswer(a);
      if (k && !toIdMap.has(k)) toIdMap.set(k, n.id);
    }
  }
  return {
    suggestions: names.map((n) => n.full_name),
    toId: (guess: string) => toIdMap.get(normalizeAnswer(guess)) ?? null,
    nameOf: (id: number) => byId.get(id)?.full_name ?? null,
    getEntry: (id: number) => byId.get(id) ?? null,
  };
}
