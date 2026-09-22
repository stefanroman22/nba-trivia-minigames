// LeContexto — similarity guesser. Name any player; see how close (by rank) you
// are to a hidden daily secret.
//
// Both modes are handed ONE precomputed ContextoQuestion as gameInfo[0]: the
// day, the secret (a full PlayerIndexEntry) and the WHOLE ranking of every
// playable player against it, computed server-side
// (backend/trivia/questions/games/contexto.py). Single-player fetches it from
// the questions store (utils/questions.ts fetchQuestion); a multiplayer room is
// dealt one by the relay (multiplayer_server/src/questions.js deal) and every
// member receives the same object, so two players can never rank against
// different secrets. The renderer never downloads the player pool and has no
// similarity engine of its own — it looks a guessed player's id up in the
// precomputed ranking. Names are resolved against the shared names list
// (useNames / buildNameLookup). Spec:
// docs/superpowers/specs/2026-09-10-questions-store-design.md §10.3.
import { useEffect, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import AutocompleteInput from "../components/AutoCompleteInput";
import SubmitGuessPopup from "../components/SubmitGuessPopUp";
import { Button, GameFrame, Spinner } from "../components/ui";
import { BACKEND_ORIGIN } from "../configurations/backend";
import { useNames } from "../hooks/useNames";
import { apiFetch } from "../utils/Api";
import { normalizeAnswer } from "../utils/answerMatch";
import { buildNameLookup } from "../utils/questions";
import type { OnGameEnd, ContextoQuestion } from "../types/types";
import "../styles/Contexto.css";

export interface ContextoProps {
  /** One precomputed ContextoQuestion — the same shape in single-player and multiplayer. */
  gameInfo: ContextoQuestion[];
  onGameEnd: OnGameEnd;
  turn?: unknown;
  onTurnAction?: (a: unknown) => void;
}

const MAX_SCORE = 200;

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
  // The round IS the question, however it arrived (fetched solo, dealt online).
  const question = gameInfo[0] as ContextoQuestion | undefined;

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

  // The ranking is already computed server-side; wrap the [personId, rank]
  // pairs in a Map for O(1) lookup, built once per question.
  const rankById = useMemo(() => new Map<number, number>(question?.ranking ?? []), [question]);
  // Shared names list: a typed guess resolves to a person_id (and back to a
  // display name) through it.
  const names = useNames();
  const lookup = useMemo(() => (names ? buildNameLookup(names) : null), [names]);

  const secret = question?.secret ?? null;
  const ready = !!(lookup && rankById.size);
  const suggestions = useMemo(() => lookup?.suggestions ?? [], [lookup]);

  // Resolve a typed guess to { pid, name, rank }. Returns null for a name this
  // game doesn't recognize.
  const resolveGuess = (raw: string): { pid: number; name: string; rank: number } | null => {
    if (!lookup) return null;
    const pid = lookup.toId(raw);
    if (pid == null) return null;
    const rank = rankById.get(pid);
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

  // Fresh state whenever a new question arrives (e.g. play-again).
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

  // Loading / unplayable-round state. Once the shared names list has resolved
  // and there is still no secret or no ranking, the round can't be played —
  // the question is missing or empty.
  const attempted = names !== null;
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

  const poolSize = rankById.size;
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
