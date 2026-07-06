// LeContexto — similarity guesser. Name any player; see how close (by rank) you
// are to a hidden daily secret. Pure engine below; component in the same file.
import { useEffect, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import AutocompleteInput from "../components/AutoCompleteInput";
import SubmitGuessPopup from "../components/SubmitGuessPopUp";
import { Button, CourtLoader } from "../components/ui";
import { BACKEND_ORIGIN } from "../configurations/backend";
import { apiFetch } from "../utils/Api";
import { normalizeAnswer } from "../utils/answerMatch";
import type { PlayerIndexEntry, OnGameEnd } from "../types/types";
import "../styles/Contexto.css";

export interface ContextoProps {
  gameInfo: PlayerIndexEntry[];
  onGameEnd: OnGameEnd;
  turn?: unknown;
  onTurnAction?: (a: unknown) => void;
  multiplayer?: boolean;
}

const MAX_SCORE = 200;
const CURRENT_YEAR = new Date().getFullYear();

// --- similarity components (all normalized to 0..1, weighted in similarity()) ---

/** Every year of every stint as an "ABBR:YEAR" token (shared franchise-seasons). */
function franchiseSeasons(p: PlayerIndexEntry): Set<string> {
  const s = new Set<string>();
  for (const t of p.teams) {
    const end = t.end_year ?? CURRENT_YEAR;
    for (let y = t.start_year; y <= end; y++) s.add(`${t.abbr}:${y}`);
  }
  return s;
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  const union = a.size + b.size - inter;
  return union === 0 ? 0 : inter / union;
}

/** Career [firstYear, lastYear] across all stints. */
function careerRange(p: PlayerIndexEntry): [number, number] {
  let lo = Infinity;
  let hi = -Infinity;
  for (const t of p.teams) {
    if (t.start_year < lo) lo = t.start_year;
    const end = t.end_year ?? CURRENT_YEAR;
    if (end > hi) hi = end;
  }
  if (lo === Infinity) return [CURRENT_YEAR, CURRENT_YEAR];
  return [lo, hi];
}

/** Interval intersection-over-union (era overlap). */
function eraOverlap(a: [number, number], b: [number, number]): number {
  const inter = Math.max(0, Math.min(a[1], b[1]) - Math.max(a[0], b[0]) + 1);
  const union = (a[1] - a[0] + 1) + (b[1] - b[0] + 1) - inter;
  return union <= 0 ? 0 : inter / union;
}

const POS_FAMILY: Record<PlayerIndexEntry["position"], string[]> = {
  G: ["G"], F: ["F"], C: ["C"], "G-F": ["G", "F"], "F-C": ["F", "C"],
};

/** 1 = exact position, 0.5 = overlapping family (e.g. G vs G-F), else 0. */
function positionFamily(a: PlayerIndexEntry, b: PlayerIndexEntry): number {
  if (a.position === b.position) return 1;
  const fb = POS_FAMILY[b.position];
  return POS_FAMILY[a.position].some((x) => fb.includes(x)) ? 0.5 : 0;
}

/** Undrafted matches undrafted (1); mixed = 0; both drafted scales by |pick diff|. */
function draftProximity(a: PlayerIndexEntry, b: PlayerIndexEntry): number {
  const ua = a.draft == null;
  const ub = b.draft == null;
  if (ua && ub) return 1;
  if (ua || ub) return 0;
  return Math.max(0, 1 - Math.abs(a.draft!.pick - b.draft!.pick) / 60);
}

function awardsVec(p: PlayerIndexEntry): number[] {
  return [p.awards.mvp.length, p.awards.allstar_count, p.awards.rings.length, p.awards.dpoy.length];
}

function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

/** Weighted 0..100 similarity of `p` to the `secret`. */
function similarity(secret: PlayerIndexEntry, p: PlayerIndexEntry): number {
  return (
    35 * jaccard(franchiseSeasons(secret), franchiseSeasons(p)) +
    20 * eraOverlap(careerRange(secret), careerRange(p)) +
    15 * positionFamily(secret, p) +
    10 * (secret.country === p.country ? 1 : 0) +
    10 * draftProximity(secret, p) +
    10 * cosine(awardsVec(secret), awardsVec(p))
  );
}

interface Ranking {
  rankById: Map<number, number>;
  nameToId: Map<string, number>;
  idToEntry: Map<number, PlayerIndexEntry>;
}

/** Rank every pool player against the secret (desc; ties broken by person_id). */
function buildRanking(secret: PlayerIndexEntry, pool: PlayerIndexEntry[]): Ranking {
  const scored = pool
    .map((p) => ({ p, s: similarity(secret, p) }))
    .sort((x, y) => y.s - x.s || x.p.person_id - y.p.person_id);
  const rankById = new Map<number, number>();
  const nameToId = new Map<string, number>();
  const idToEntry = new Map<number, PlayerIndexEntry>();
  scored.forEach((row, i) => {
    rankById.set(row.p.person_id, i + 1);
    idToEntry.set(row.p.person_id, row.p);
    const canon = normalizeAnswer(row.p.full_name);
    if (canon && !nameToId.has(canon)) nameToId.set(canon, row.p.person_id);
    for (const alias of row.p.aliases) {
      const k = normalizeAnswer(alias);
      if (k && !nameToId.has(k)) nameToId.set(k, row.p.person_id);
    }
  });
  return { rankById, nameToId, idToEntry };
}

/** FNV-1a hash -> deterministic daily index. */
function hashStr(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** The day's secret: fame tier 1-2, keyed by the UTC date so it's shared. */
function dailySecret(pool: PlayerIndexEntry[]): PlayerIndexEntry {
  const candidates = pool.filter((p) => p.fame_tier <= 2);
  const list = (candidates.length ? candidates : pool)
    .slice()
    .sort((a, b) => a.person_id - b.person_id);
  const key = new Date().toISOString().slice(0, 10); // YYYY-MM-DD (UTC)
  return list[hashStr(key) % list.length];
}

/** 200 - 5 per guess past the tenth, floor 50. */
function scoreFor(guesses: number): number {
  return Math.max(50, MAX_SCORE - 5 * Math.max(0, guesses - 10));
}

/** Row/bar color bucket. */
function rankColor(rank: number): "good" | "brand" | "bad" {
  if (rank <= 25) return "good";
  if (rank <= 100) return "brand";
  return "bad";
}

interface GuessRow {
  pid: number;
  name: string;
  rank: number;
}

interface GuessEntry {
  question_id: string;
  answer: string;
  correct: boolean;
  elapsed_ms: number;
}

export default function Contexto({ gameInfo, onGameEnd }: ContextoProps) {
  const reduce = useReducedMotion();
  const [rows, setRows] = useState<GuessRow[]>([]);
  const [guessedIds, setGuessedIds] = useState<Set<number>>(new Set());
  const [guess, setGuess] = useState("");
  const [won, setWon] = useState(false);
  const [gaveUp, setGaveUp] = useState(false);
  const [showPopup, setShowPopup] = useState(false);
  const [popup, setPopup] = useState({ Text: "", Color: "" });

  const startRef = useRef(Date.now());
  const guessLogRef = useRef<GuessEntry[]>([]);
  const timersRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  const endedRef = useRef(false); // hard guard: onGameEnd fires at most once

  // All delayed work goes through these so an exit/unmount can never fire a
  // stale onGameEnd (or setState) for an abandoned game.
  const later = (fn: () => void, ms: number) => {
    timersRef.current.push(setTimeout(fn, ms));
  };
  const clearTimers = () => {
    timersRef.current.forEach(clearTimeout);
    timersRef.current = [];
  };

  // Pick the daily secret + rank the whole pool once per gameInfo (heavy loop).
  const secret = useMemo(
    () => (gameInfo && gameInfo.length ? dailySecret(gameInfo) : null),
    [gameInfo],
  );
  const ranking = useMemo(
    () => (secret ? buildRanking(secret, gameInfo) : null),
    [secret, gameInfo],
  );
  const suggestions = useMemo(
    () => (gameInfo ?? []).map((p) => p.full_name),
    [gameInfo],
  );

  // Fire-and-forget guess log (the data flywheel). apiFetch only attaches the
  // JWT when one exists, so guests log anonymously and it never blocks the game.
  const sendGuessLog = () => {
    const entries = guessLogRef.current;
    guessLogRef.current = [];
    if (!entries.length) return;
    apiFetch(`${BACKEND_ORIGIN}/trivia/log-guesses/`, {
      method: "POST",
      body: JSON.stringify({ game: "contexto", entries }),
    }).catch(() => { /* analytics only */ });
  };

  // Fresh state whenever a new pool/secret loads (e.g. play-again).
  useEffect(() => {
    clearTimers();
    setRows([]);
    setGuessedIds(new Set());
    setGuess("");
    setWon(false);
    setGaveUp(false);
    setShowPopup(false);
    endedRef.current = false;
    startRef.current = Date.now();
    guessLogRef.current = [];
  }, [gameInfo]);

  // Unmount: cancel pending end-calls and flush any un-sent guesses
  // (abandoned sessions still feed the flywheel; no-op when already flushed).
  useEffect(() => {
    return () => {
      clearTimers();
      sendGuessLog();
    };
  }, []);

  const flash = (text: string, color: string) => {
    setPopup({ Text: text, Color: color });
    setShowPopup(true);
    later(() => setShowPopup(false), 1500);
  };

  const endOnce = (finalScore: number) => {
    if (endedRef.current) return;
    endedRef.current = true;
    onGameEnd?.(finalScore);
  };

  const handleGuess = (raw: string) => {
    if (!secret || !ranking || won || gaveUp) return;
    const norm = normalizeAnswer(raw);
    if (!norm) return;
    const pid = ranking.nameToId.get(norm);
    if (pid == null) {
      flash("Not a player in the index", "var(--bad)");
      return;
    }
    if (guessedIds.has(pid)) {
      flash("Already guessed", "var(--muted)");
      setGuess("");
      return;
    }
    const rank = ranking.rankById.get(pid)!;
    const entry = ranking.idToEntry.get(pid)!;
    const nextCount = guessedIds.size + 1;
    guessLogRef.current.push({
      question_id: String(secret.person_id),
      answer: entry.full_name,
      correct: rank === 1,
      elapsed_ms: Date.now() - startRef.current,
    });
    setGuessedIds((prev) => new Set(prev).add(pid));
    setRows((prev) => [...prev, { pid, name: entry.full_name, rank }].sort((a, b) => a.rank - b.rank));
    setGuess("");

    if (rank === 1) {
      setWon(true);
      const finalScore = scoreFor(nextCount);
      flash(`Got it in ${nextCount}! +${finalScore}`, "var(--good)");
      sendGuessLog();
      later(() => endOnce(finalScore), 1700);
    } else {
      flash(`#${rank}`, rank <= 25 ? "var(--good)" : rank <= 100 ? "var(--brand)" : "var(--bad)");
    }
  };

  const handleGiveUp = () => {
    if (!secret || won || gaveUp) return;
    setGaveUp(true);
    flash(`It was ${secret.full_name}`, "var(--muted)");
    sendGuessLog();
    later(() => endOnce(0), 1900);
  };

  // Loading / empty-invalid pool state.
  if (!secret || !ranking) {
    return (
      <div className="cx-wrap cx-center">
        <CourtLoader label="Calibrating the radar…" />
        {gameInfo && gameInfo.length === 0 && (
          <p className="cx-note">No player data available. Please try again later.</p>
        )}
      </div>
    );
  }

  const poolSize = gameInfo.length;
  const barWidth = (rank: number) =>
    `${Math.max(5, Math.round(100 * (1 - (rank - 1) / Math.max(1, poolSize - 1))))}%`;

  return (
    <div className="cx-wrap">
      <div className="cx-head">
        <span className="cx-eyebrow">Daily secret player — home in by similarity</span>
        <div className="cx-meta">
          <span className="cx-count tnum">{guessedIds.size}</span>
          <span className="cx-count-label">guesses</span>
        </div>
      </div>

      <div className="cx-list" role="log" aria-live="polite">
        {rows.length === 0 ? (
          <div className="cx-empty">
            <p className="cx-empty-title">Name any player to begin.</p>
            <p className="cx-empty-sub">#1 is the secret. Green is close, red is cold.</p>
          </div>
        ) : (
          <AnimatePresence initial={false}>
            {rows.map((r) => {
              const color = rankColor(r.rank);
              return (
                <motion.div
                  key={r.pid}
                  layout={!reduce}
                  initial={reduce ? false : { opacity: 0, y: -6 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.25 }}
                  className={`cx-row is-${color}${r.rank === 1 ? " is-win" : ""}`}
                >
                  <span className="cx-row-name">{r.name}</span>
                  <span className="cx-bar-track">
                    <span className="cx-bar-fill" style={{ width: barWidth(r.rank) }} />
                  </span>
                  <span className="cx-row-rank tnum">#{r.rank}</span>
                </motion.div>
              );
            })}
          </AnimatePresence>
        )}
      </div>

      {gaveUp && (
        <div className="cx-reveal is-brand">
          <span className="cx-row-name">{secret.full_name}</span>
          <span className="cx-row-rank tnum">#1</span>
        </div>
      )}

      <div className="cx-inputrow">
        <AutocompleteInput
          placeholder="Guess a player…"
          value={guess}
          setValue={setGuess}
          suggestions={suggestions}
          onSubmit={(v) => handleGuess(v)}
          customStyleInput={{ width: "100%", height: "44px", padding: "0 12px", fontSize: "0.9rem" }}
          customStyleSuggestion={{ fontSize: "0.82rem", maxHeight: "180px", minWidth: "100%" }}
        />
        <Button
          size="md"
          aria-label="Submit guess"
          onClick={() => handleGuess(guess)}
          disabled={won || gaveUp || guess.trim() === ""}
        >
          Guess
        </Button>
      </div>

      <button
        type="button"
        className="cx-giveup"
        onClick={handleGiveUp}
        disabled={won || gaveUp}
      >
        Give up
      </button>

      <SubmitGuessPopup show={showPopup} text={popup.Text} color={popup.Color} />
    </div>
  );
}
