import { useEffect, useRef, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import SubmitGuessPopup from "../components/SubmitGuessPopUp";
import { Button } from "../components/ui";
import { BACKEND_ORIGIN } from "../configurations/backend";
import { apiFetch } from "../utils/Api";
import { matchAnswer, normalizeAnswer } from "../utils/answerMatch";
import type { FanFavoritesQuestion, OnGameEnd } from "../types/types";
import "../styles/FanFavorites.css";

interface FanFavoritesProps {
  gameInfo: FanFavoritesQuestion[];
  onGameEnd: OnGameEnd;
}

const MAX_SCORE = 300;

interface GuessEntry {
  question_id: string;
  answer: string;
  correct: boolean;
  elapsed_ms: number;
}

function FanFavorites({ gameInfo, onGameEnd }: FanFavoritesProps) {
  const [revealed, setRevealed] = useState<Record<number, boolean>>({});
  const [lostReveal, setLostReveal] = useState<Record<number, boolean>>({});
  const [numberLifes, setNumberLifes] = useState(3);
  const [guess, setGuess] = useState("");
  const [finished, setFinished] = useState(false);
  const [showPointsAnimation, setShowPointsAnimation] = useState(false);
  const [popUpInfo, setPopUpInfo] = useState({ Text: "", Color: "" });
  const wrongTriesRef = useRef<Set<string>>(new Set());
  const guessLogRef = useRef<GuessEntry[]>([]);
  const startRef = useRef(Date.now());
  const inputRef = useRef<HTMLInputElement>(null);
  const timersRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  const reduce = useReducedMotion();

  // All delayed work goes through these so an exit/unmount can never fire a
  // stale onGameEnd (or setState) for an abandoned game.
  const later = (fn: () => void, ms: number) => {
    timersRef.current.push(setTimeout(fn, ms));
  };
  const clearTimers = () => {
    timersRef.current.forEach(clearTimeout);
    timersRef.current = [];
  };

  // Fresh state whenever a new survey loads (e.g. play-again).
  useEffect(() => {
    clearTimers();
    setRevealed({});
    setLostReveal({});
    setNumberLifes(3);
    setGuess("");
    setFinished(false);
    setShowPointsAnimation(false);
    wrongTriesRef.current = new Set();
    guessLogRef.current = [];
    startRef.current = Date.now();
  }, [gameInfo]);

  // Unmount: cancel pending reveals/end-calls and flush any un-sent guesses
  // (abandoned sessions still feed the flywheel; no-op when already flushed).
  useEffect(() => {
    return () => {
      clearTimers();
      sendGuessLog();
    };
  }, []);

  const question = gameInfo && gameInfo.length > 0 ? gameInfo[0] : null;

  const flashPopup = (text: string, color: string) => {
    setPopUpInfo({ Text: text, Color: color });
    setShowPointsAnimation(true);
    later(() => setShowPointsAnimation(false), 1500);
  };

  // Fire-and-forget guess log (the data flywheel). apiFetch adds the JWT only
  // when one exists, so guests log anonymously and it never blocks the game.
  const sendGuessLog = () => {
    const entries = guessLogRef.current;
    guessLogRef.current = [];
    if (!entries.length) return;
    apiFetch(`${BACKEND_ORIGIN}/trivia/log-guesses/`, {
      method: "POST",
      body: JSON.stringify({ game: "fan-favorites", entries }),
    }).catch(() => { /* analytics only */ });
  };

  const handleGuessSubmit = () => {
    if (!question?.answers?.length || finished) return;
    const raw = guess;
    setGuess("");
    inputRef.current?.focus();
    const normalized = normalizeAnswer(raw);
    if (!normalized) return;

    const idx = matchAnswer(raw, question.answers);
    const elapsedMs = Date.now() - startRef.current;

    if (idx >= 0) {
      // Guessing an already-revealed answer costs nothing.
      if (revealed[idx]) {
        flashPopup("Already on the board!", "var(--muted)");
        return;
      }
      const hit = question.answers[idx];
      guessLogRef.current.push({ question_id: question.qid, answer: hit.answer, correct: true, elapsed_ms: elapsedMs });
      const nextRevealed = { ...revealed, [idx]: true };
      setRevealed(nextRevealed);

      if (Object.keys(nextRevealed).length === question.answers.length) {
        setFinished(true);
        sendGuessLog();
        flashPopup("Board cleared! +300", "var(--good)");
        later(() => onGameEnd?.(MAX_SCORE), 1600);
      } else {
        flashPopup(`+${hit.count} fans said it!`, "var(--good)");
      }
      return;
    }

    // Not on the board — repeating the same wrong guess never costs twice.
    if (wrongTriesRef.current.has(normalized)) {
      flashPopup("Already tried", "var(--muted)");
      return;
    }
    wrongTriesRef.current.add(normalized);
    guessLogRef.current.push({ question_id: question.qid, answer: normalized, correct: false, elapsed_ms: elapsedMs });

    const newLifes = numberLifes - 1;
    setNumberLifes(newLifes);

    if (newLifes <= 0) {
      setFinished(true);
      sendGuessLog();
      const finalScore = Math.round((MAX_SCORE * Object.keys(revealed).length) / question.answers.length);
      flashPopup("Not on the board", "var(--bad)");

      // Reveal the remaining answers one after another, muted.
      const toReveal = question.answers.map((_, i) => i).filter((i) => !revealed[i]);
      toReveal.forEach((slot, i) => {
        later(() => setLostReveal((prev) => ({ ...prev, [slot]: true })), 450 + i * 450);
      });
      later(() => onGameEnd?.(finalScore), 450 + toReveal.length * 450 + 600);
    } else {
      flashPopup("Not on the board", "var(--bad)");
    }
  };

  if (!question) return <p style={{ color: "var(--muted)" }}>Loading survey…</p>;
  if (!question.answers || question.answers.length === 0)
    return <p style={{ color: "var(--muted)" }}>No survey data available.</p>;

  const surveyLabel = question.survey_date
    ? new Date(question.survey_date).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
    : "survey day";

  return (
    <div className="ff-wrap">
      {/* Prompt */}
      <div className="ff-head">
        <span className="ff-eyebrow">On {surveyLabel}, we asked 100 NBA fans to name…</span>
        <h2 className="ff-prompt font-display">{question.prompt}</h2>
      </div>

      {/* Lives */}
      <div className="ff-lives" aria-label={`${numberLifes} lives left`}>
        {[...Array(3)].map((_, i) => {
          const alive = i < numberLifes;
          return (
            <motion.svg
              key={i}
              width="20" height="20" viewBox="0 0 24 24"
              animate={reduce ? undefined : { scale: alive ? 1 : 0.82, rotate: alive ? 0 : [0, -14, 12, -6, 0] }}
              transition={{ duration: 0.45 }}
              fill={alive ? "var(--bad)" : "none"}
              stroke={alive ? "var(--bad)" : "var(--line2)"}
              strokeWidth="2"
              style={{ opacity: alive ? 1 : 0.55 }}
            >
              <path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.6l-1-1a5.5 5.5 0 0 0-7.8 7.8l1 1L12 21l7.8-7.6 1-1a5.5 5.5 0 0 0 0-7.8z" />
            </motion.svg>
          );
        })}
      </div>

      {/* Survey board — ranked slots, 1 = most popular */}
      <div className="ff-board">
        {question.answers.map((a, i) => {
          const hit = !!revealed[i];
          const missed = !hit && !!lostReveal[i];
          const shown = hit || missed;
          return (
            <motion.div
              key={i}
              className={`ff-slot${hit ? " is-hit" : missed ? " is-missed" : ""}`}
              animate={reduce ? undefined : { scale: shown ? [1, 1.07, 1] : 1 }}
              transition={{ duration: 0.35 }}
            >
              <span className="ff-rank tnum">{i + 1}</span>
              {shown ? (
                <>
                  <span className="ff-answer">{a.answer}</span>
                  <span className="ff-count tnum">{a.count}</span>
                </>
              ) : (
                <span className="ff-blank" aria-hidden="true" />
              )}
            </motion.div>
          );
        })}
      </div>

      {/* Free-text guess input — no autocomplete, recall is the game */}
      <div className="ff-inputrow">
        <input
          ref={inputRef}
          className="ff-input"
          type="text"
          value={guess}
          onChange={(e) => setGuess(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.nativeEvent.isComposing) handleGuessSubmit(); }}
          placeholder="Type an answer…"
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
          disabled={finished}
          aria-label="Your answer"
        />
        <Button
          size="sm"
          aria-label="Confirm answer"
          onClick={handleGuessSubmit}
          disabled={finished || guess.trim() === ""}
        >
          Confirm
        </Button>
      </div>

      <SubmitGuessPopup show={showPointsAnimation} text={popUpInfo.Text} color={popUpInfo.Color} />
    </div>
  );
}

export default FanFavorites;
