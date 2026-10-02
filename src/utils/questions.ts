// Pre-generated questions: manifest (60 s) -> index -> one question file.
//
// Read from the manifest-v3 data host first (utils/gameData.ts, VITE_DATA_BASE) whenever its
// manifest publishes the game ("kind": "questions") / the "question_names" list; otherwise
// from the old Supabase Storage questions store below (VITE_QUESTIONS_BASE), logged once per
// game. The fallback keeps the switch safe before the first question publish, keeps the hidden
// games (superdraft, imposter) on the store, and covers a failing data host.
import type {
  FetchResult, NamesEntry, Question, QuestionIndex, QuestionsManifest,
} from "../types/types";
import { normalizeAnswer } from "./answerMatch";
import {
  PICKERS, QUESTION_GAMES, fetchQuestion as fetchV3Question, fetchQuestionNames, getManifest as getV3Manifest,
  hasQuestions, isConfigured as v3Configured, pickRandom,
} from "./gameData";

export { hashStr, pickDaily, pickRandom, pickWeighted, utcToday } from "./gameData";

const warnedFallback = new Set<string>();
function warnOnce(key: string, message: string, err?: unknown): void {
  if (warnedFallback.has(key)) return;
  warnedFallback.add(key);
  console.warn(`[questions] ${message}`, ...(err === undefined ? [] : [err]));
}

/** The v3 question for a game, or null to use the questions store (unset host = silent). */
async function v3Question(game: string): Promise<Question | null> {
  if (!v3Configured()) return null;
  try {
    const m = await getV3Manifest();
    if (!hasQuestions(m, game)) {
      // Hidden games (superdraft, imposter) are never published there: no log for them.
      if (QUESTION_GAMES.has(game)) warnOnce(game, `${game}: not published on the data host yet, using the questions store`);
      return null;
    }
    return await fetchV3Question(game);
  } catch (err) {
    warnOnce(game, `${game}: data host unavailable, using the questions store`, err);
    return null;
  }
}

/** The v3 question names, or null to use the questions store's players-names.json. */
async function v3Names(): Promise<NamesEntry[] | null> {
  if (!v3Configured()) return null;
  try {
    const m = await getV3Manifest();
    if (!m.question_names) {
      warnOnce("names", "question names not published on the data host yet, using the questions store");
      return null;
    }
    return await fetchQuestionNames();
  } catch (err) {
    warnOnce("names", "data host unavailable for question names, using the questions store", err);
    return null;
  }
}

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
  const published = await v3Names();
  if (published) return published;
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
    const published = await v3Question(game);
    if (published) return { success: true, data: [published] };
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
