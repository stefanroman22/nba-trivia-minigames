import { useEffect, useMemo, useRef, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import SubmitGuessPopup from "../components/SubmitGuessPopUp";
import AutoCompleteInput from "../components/AutoCompleteInput";
import EndSequence, { type EndSequencePhase } from "../components/EndSequence";
import ScorePanel from "../components/ScorePanel";
import { Button, GameFrame, Spinner } from "../components/ui";
import { BACKEND_ORIGIN } from "../configurations/backend";
import { apiFetch } from "../utils/Api";
import { fetchWholePool } from "../utils/pool";
import { matchAnswer, normalizeAnswer } from "../utils/answerMatch";
import { nbaTeams } from "../constants/nbaTeams";
import { nbaCoaches } from "../constants/nbaCoaches";
import { nbaSeasons } from "../utils/seasons";
import type { FanFavoritesQuestion, OnGameEnd } from "../types/types";
import "../styles/FanFavorites.css";

interface FanFavoritesProps {
  gameInfo: FanFavoritesQuestion[];
  onGameEnd: OnGameEnd;
  onPlayAgain?: () => void;
  onClose?: () => void;
}

const MAX_SCORE = 300;

interface GuessEntry {
  question_id: string;
  answer: string;
  correct: boolean;
  elapsed_ms: number;
}

function FanFavorites({ gameInfo, onGameEnd, onPlayAgain, onClose }: FanFavoritesProps) {
  const [revealed, setRevealed] = useState<Record<number, boolean>>({});
  const [lostReveal, setLostReveal] = useState<Record<number, boolean>>({});
  const [numberLifes, setNumberLifes] = useState(3);
  const [guess, setGuess] = useState("");
  const [finished, setFinished] = useState(false);
  const [showPointsAnimation, setShowPointsAnimation] = useState(false);
  const [popUpInfo, setPopUpInfo] = useState({ Text: "", Color: "" });
  // End-state: the board stays in view; the bottom slot fades submission → loader
  // → score (win and loss both play this in-place sequence — see EndSequence).
  const [endState, setEndState] = useState<{ score: number; found: number; total: number; win: boolean } | null>(null);
  const [bottomPhase, setBottomPhase] = useState<EndSequencePhase>("input");
  // Full ~5k NBA player names, loaded on demand for player-category boards.
  const [playerPool, setPlayerPool] = useState<string[]>([]);
  const wrongTriesRef = useRef<Set<string>>(new Set());
  const guessLogRef = useRef<GuessEntry[]>([]);
  const startRef = useRef(Date.now());
  const timersRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  const reduce = useReducedMotion();

  const question = gameInfo && gameInfo.length > 0 ? gameInfo[0] : null;

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
    setEndState(null);
    setBottomPhase("input");
    wrongTriesRef.current = new Set();
    guessLogRef.current = [];
    startRef.current = Date.now();
  }, [gameInfo]);

  // Player-category boards autocomplete from the full ~5k NBA player list;
  // other categories use small in-app lists (see `suggestions`).
  useEffect(() => {
    if (question?.category !== "player") return;
    let cancelled = false;
    fetchWholePool("all-players")
      .then((res) => {
        if (!cancelled && res.success) setPlayerPool((res.data as string[]) || []);
      })
      .catch(() => { /* falls back to free-text until/if it loads */ });
    return () => { cancelled = true; };
  }, [question?.category]);

  // Unmount: cancel pending reveals/end-calls and flush any un-sent guesses
  // (abandoned sessions still feed the flywheel; no-op when already flushed).
  useEffect(() => {
    return () => {
      clearTimers();
      sendGuessLog();
    };
  }, []);

  // Category-aware autocomplete pool. Always union this board's own answer
  // names so every correct answer is findable (covers relocated teams, etc.).
  // Unknown category — or the player pool still loading — falls back to
  // free-text (empty list => AutoCompleteInput shows no dropdown).
  const suggestions = useMemo(() => {
    if (!question) return [];
    let base: string[] | null = null;
    if (question.category === "player") base = playerPool.length ? playerPool : null;
    else if (question.category === "team") base = nbaTeams;
    else if (question.category === "coach") base = nbaCoaches;
    else if (question.category === "season") base = nbaSeasons;
    if (!base) return [];
    return Array.from(new Set([...base, ...question.answers.map((a) => a.answer)]));
  }, [question, playerPool]);

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
        // Win → in-place: submission fades out, a loader shows, then the score
        // + Play again fade in (same sequence as the loss).
        setBottomPhase("loader");
        later(() => {
          onGameEnd?.(MAX_SCORE, { inPlace: true });
          setEndState({ score: MAX_SCORE, found: question.answers.length, total: question.answers.length, win: true });
          setBottomPhase("score");
        }, 700);
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
      const found = Object.keys(revealed).length;
      const total = question.answers.length;
      const finalScore = Math.round((MAX_SCORE * found) / total);
      flashPopup("Not on the board", "var(--bad)");

      // Submission fades to a loader the moment the answers begin revealing…
      setBottomPhase("loader");
      const toReveal = question.answers.map((_, i) => i).filter((i) => !revealed[i]);
      toReveal.forEach((slot, i) => {
        later(() => setLostReveal((prev) => ({ ...prev, [slot]: true })), 260 + i * 260);
      });
      // …then the score + Play again fade in once they've all shown.
      later(() => {
        onGameEnd?.(finalScore, { inPlace: true });
        setEndState({ score: finalScore, found, total, win: false });
        setBottomPhase("score");
      }, 260 + toReveal.length * 260 + 380);
    } else {
      flashPopup("Not on the board", "var(--bad)");
    }
  };

  if (!question) return <Spinner label="Loading survey…" />;
  if (!question.answers || question.answers.length === 0)
    return <p style={{ color: "var(--muted)" }}>No survey data available.</p>;

  const surveyLabel = question.survey_date
    ? new Date(question.survey_date).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
    : "survey day";

  return (
    <GameFrame>
      <GameFrame.Status left={<GameFrame.Label>NAME THE TOP ANSWERS</GameFrame.Label>} />

      <GameFrame.Prompt
        eyebrow={`On ${surveyLabel}, we asked 100 NBA fans to name…`}
        title={question.prompt}
      />

      <GameFrame.Board>
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
      </GameFrame.Board>

      <GameFrame.Action>
      {/* Submission → loader → score, cross-faded (shared answers-shown pattern) */}
      <EndSequence
        phase={bottomPhase}
        input={
          <GameFrame.InputRow>
            <AutoCompleteInput
              value={guess}
              setValue={setGuess}
              suggestions={suggestions}
              maxResults={8}
              onSubmit={() => handleGuessSubmit()}
              placeholder="Type an answer…"
              customStyleInput={{ height: "40px", width: "100%", fontSize: "0.85rem" }}
            />
            <Button
              size="sm"
              aria-label="Confirm answer"
              onClick={handleGuessSubmit}
              disabled={finished || guess.trim() === ""}
            >
              Confirm
            </Button>
          </GameFrame.InputRow>
        }
        score={
          <ScorePanel
            score={endState?.score ?? 0}
            outOf={MAX_SCORE}
            label={endState?.win ? "Board cleared!" : `Found ${endState?.found ?? 0}/${endState?.total ?? 0}`}
            won={endState?.win}
            onPlayAgain={onPlayAgain}
            onClose={onClose}
          />
        }
      />
      </GameFrame.Action>

      <SubmitGuessPopup show={showPointsAnimation} text={popUpInfo.Text} color={popUpInfo.Color} />
    </GameFrame>
  );
}

export default FanFavorites;
