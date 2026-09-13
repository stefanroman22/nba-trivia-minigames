// LeContexto — similarity guesser. Name any player; see how close (by rank) you
// are to a hidden daily secret. Pure engine below; component in the same file.
//
// Single-player is handed a precomputed ContextoQuestion as `gameInfo`: the
// day, the secret (a full PlayerIndexEntry) and the WHOLE ranking of every
// playable player against it, already computed server-side — it never
// downloads the player pool or runs the similarity engine itself, just looks
// a guessed player's id up in the precomputed ranking. Names are resolved
// against the shared names list (useNames / buildNameLookup).
//
// A MULTIPLAYER round is a one-element ContextoRoundConfig array instead — the
// day and the secret's person_id (backend/trivia/games/contexto.py) — and the
// renderer loads the same CDN pool single-player used to use (useRoundPool) to
// rank against. Multiplayer has no precomputed-ranking payload yet (a future
// phase will give it one), so the similarity engine below
// (similarity/buildRanking and friends) stays exactly as it was, for the
// multiplayer branch only. Online the sent secret is the ONLY one accepted: if
// this client's pool doesn't contain it, the round is unplayable rather than
// quietly ranked against a locally-chosen secret the opponent isn't solving for.
import { useEffect, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import AutocompleteInput from "../components/AutoCompleteInput";
import SubmitGuessPopup from "../components/SubmitGuessPopUp";
import { Button, GameFrame, Spinner } from "../components/ui";
import { BACKEND_ORIGIN } from "../configurations/backend";
import { useRoundPool } from "../hooks/useRoundPool";
import { useNames } from "../hooks/useNames";
import { apiFetch } from "../utils/Api";
import { normalizeAnswer } from "../utils/answerMatch";
import { buildNameLookup } from "../utils/questions";
import type { PlayerIndexEntry, OnGameEnd, ContextoQuestion, ContextoRoundConfig } from "../types/types";
import "../styles/Contexto.css";

export interface ContextoProps {
  /** Single-player: a ContextoQuestion. Multiplayer: [ContextoRoundConfig].
   *  PlayerIndexEntry[] stays in the union only so RenderGame's existing cast
   *  at the call site keeps type-checking — solo no longer receives it. */
  gameInfo: PlayerIndexEntry[] | ContextoQuestion[] | ContextoRoundConfig[];
  onGameEnd: OnGameEnd;
  turn?: unknown;
  onTurnAction?: (a: unknown) => void;
  multiplayer?: boolean;
}

const MAX_SCORE = 200;
const CURRENT_YEAR = new Date().getFullYear();

// Multiplayer's pool is fetched via useRoundPool; solo has no pool at all
// anymore, so it passes this stable empty array as `local` (truthy, so the
// hook never triggers a fetch — see hooks/useRoundPool.ts).
const NO_POOL: PlayerIndexEntry[] = [];

// --- similarity components (multiplayer only — all normalized to 0..1, weighted in similarity()) ---

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

function magnitude(v: number[]): number {
  let n = 0;
  for (const x of v) n += x * x;
  return Math.sqrt(n);
}

function cosine(a: number[], b: number[]): number {
  let dot = 0;
  for (let i = 0; i < a.length; i++) dot += a[i] * b[i];
  const na = magnitude(a);
  const nb = magnitude(b);
  if (na === 0 || nb === 0) return 0;
  return dot / (na * nb);
}

/**
 * Résumé similarity: cosine (the SHAPE of the trophy case) scaled by how
 * comparably decorated the two players are (the SIZE of it).
 *
 * Cosine alone is scale-invariant, which got both ends wrong: a one-time
 * all-star read as a ~9.4/10 match for a two-MVP secret (same direction,
 * a fraction of the magnitude), and the 28 pool players with no awards at
 * all scored the mathematical minimum against each other instead of a
 * perfect match. The min/max norm ratio is 1 for identical vectors, 0.5
 * for a résumé twice the size across the board, and 0 when only one side
 * has any hardware; two empty trophy cases are defined as a match.
 */
function awardsSimilarity(a: number[], b: number[]): number {
  const na = magnitude(a);
  const nb = magnitude(b);
  if (na === 0 && nb === 0) return 1;
  if (na === 0 || nb === 0) return 0;
  return cosine(a, b) * (Math.min(na, nb) / Math.max(na, nb));
}

/** Weighted 0..100 similarity of `p` to the `secret`. */
function similarity(secret: PlayerIndexEntry, p: PlayerIndexEntry): number {
  return (
    35 * jaccard(franchiseSeasons(secret), franchiseSeasons(p)) +
    20 * eraOverlap(careerRange(secret), careerRange(p)) +
    15 * positionFamily(secret, p) +
    10 * (secret.country === p.country ? 1 : 0) +
    10 * draftProximity(secret, p) +
    10 * awardsSimilarity(awardsVec(secret), awardsVec(p))
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

export default function Contexto({ gameInfo, onGameEnd, multiplayer }: ContextoProps) {
  // Online, the round IS the config, ranked against the live pool it loads
  // (useRoundPool) via the similarity engine above. Offline, gameInfo[0] is a
  // precomputed ContextoQuestion — no pool to fetch.
  const round = multiplayer ? (gameInfo[0] as ContextoRoundConfig | undefined) : undefined;
  const pool = useRoundPool(multiplayer ? null : NO_POOL, round?.pool);
  const question = multiplayer ? undefined : (gameInfo[0] as ContextoQuestion | undefined);

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

  // Multiplayer: find the server's secret in the loaded pool and rank the
  // whole pool against it (heavy loop) — untouched from before solo moved to
  // the precomputed ranking. Online the server decided the secret for the
  // whole room: use exactly that row or none at all. Falling back to a
  // locally-chosen secret when the id isn't in the pool this client loaded
  // would have the two players solving DIFFERENT puzzles and still be scored
  // against each other — the same reason SuperDraft refuses a slot constraint
  // it can't resolve.
  const mpSecret = useMemo(() => {
    if (!multiplayer || !pool || !pool.length) return null;
    return pool.find((p) => p.person_id === round?.secret_person_id) ?? null;
  }, [multiplayer, pool, round]);
  const mpRanking = useMemo(
    () => (mpSecret && pool ? buildRanking(mpSecret, pool) : null),
    [mpSecret, pool],
  );

  // Solo: the ranking is already computed server-side (Phase A); wrap the
  // [personId, rank] pairs in a Map for O(1) lookup, built once per question.
  const soloRankById = useMemo(() => new Map<number, number>(question?.ranking ?? []), [question]);
  // Shared names list: solo resolves a typed guess to a person_id (and back to
  // a display name) through it — multiplayer keeps resolving names against the
  // live pool it already loaded (mpRanking.nameToId/idToEntry), so it's unused there.
  const names = useNames();
  const lookup = useMemo(() => (names ? buildNameLookup(names) : null), [names]);

  const secret = multiplayer ? mpSecret : (question?.secret ?? null);
  const ready = multiplayer ? !!mpRanking : !!(lookup && soloRankById.size);
  const suggestions = useMemo(
    () => (multiplayer ? (pool ?? []).map((p) => p.full_name) : (lookup?.suggestions ?? [])),
    [multiplayer, pool, lookup],
  );

  // Resolve a typed guess to { pid, name, rank } via whichever source this
  // mode uses. Returns null for a name this game doesn't recognize.
  const resolveGuess = (raw: string): { pid: number; name: string; rank: number } | null => {
    if (multiplayer) {
      if (!mpRanking) return null;
      const norm = normalizeAnswer(raw);
      const pid = mpRanking.nameToId.get(norm);
      if (pid == null) return null;
      const rank = mpRanking.rankById.get(pid);
      const entry = mpRanking.idToEntry.get(pid);
      if (rank == null || !entry) return null;
      return { pid, name: entry.full_name, rank };
    }
    if (!lookup) return null;
    const pid = lookup.toId(raw);
    if (pid == null) return null;
    const rank = soloRankById.get(pid);
    if (rank == null) return null;
    return { pid, name: lookup.nameOf(pid) ?? raw, rank };
  };

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
    if (!secret || !ready || won || gaveUp) return;
    if (!normalizeAnswer(raw)) return;
    const resolved = resolveGuess(raw);
    if (!resolved) {
      flash("Not a player in the index", "var(--bad)");
      return;
    }
    const { pid, name, rank } = resolved;
    if (guessedIds.has(pid)) {
      flash("Already guessed", "var(--muted)");
      setGuess("");
      return;
    }
    const nextCount = guessedIds.size + 1;
    guessLogRef.current.push({
      question_id: String(secret.person_id),
      answer: name,
      correct: rank === 1,
      elapsed_ms: Date.now() - startRef.current,
    });
    setGuessedIds((prev) => new Set(prev).add(pid));
    setRows((prev) => [...prev, { pid, name, rank }].sort((a, b) => a.rank - b.rank));
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
    flash(`It was ${secret.full_name}`, "var(--bad)");
    sendGuessLog();
    later(() => endOnce(0), 1900);
  };

  // Loading / unplayable-round state. Once loading has resolved (the pool
  // online, the shared names list offline) and there is still no secret, the
  // round can't be played — either the pool/question is empty, or online the
  // pool doesn't contain the secret the room was given.
  const attempted = multiplayer ? pool !== null : names !== null;
  if (!secret || !ready) {
    return (
      <div className="cx-center">
        <Spinner label="Calibrating the radar…" />
        {attempted && (
          <p className="cx-note">No player data available. Please try again later.</p>
        )}
      </div>
    );
  }

  const poolSize = multiplayer ? pool!.length : soloRankById.size;
  const barWidth = (rank: number) =>
    `${Math.max(5, Math.round(100 * (1 - (rank - 1) / Math.max(1, poolSize - 1))))}%`;

  return (
    <GameFrame>
      <GameFrame.Status
        left={<GameFrame.Label>HOME IN BY SIMILARITY</GameFrame.Label>}
        right={<GameFrame.Score value={guessedIds.size} label="GUESSES" />}
      />

      <GameFrame.Board>
      <div className="cx-list" role="log" aria-live="polite">
        {rows.length === 0 ? (
          <div className="cx-empty">
            <p className="cx-empty-title font-display">Name any player to begin.</p>
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
                  <span className="cx-row-name font-display">{r.name}</span>
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
          <span className="cx-row-name font-display">{secret.full_name}</span>
          <span className="cx-row-rank tnum">#1</span>
        </div>
      )}
      </GameFrame.Board>

      <GameFrame.Action>
        <GameFrame.InputRow>
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
        </GameFrame.InputRow>

        <button
          type="button"
          className="cx-giveup"
          onClick={handleGiveUp}
          disabled={won || gaveUp}
        >
          Give up
        </button>
      </GameFrame.Action>

      <SubmitGuessPopup show={showPopup} text={popup.Text} color={popup.Color} />
    </GameFrame>
  );
}
