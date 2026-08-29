import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import AutocompleteInput from "../components/AutoCompleteInput";
import EndSequence, { type EndSequencePhase } from "../components/EndSequence";
import ScorePanel from "../components/ScorePanel";
import SubmitGuessPopup from "../components/SubmitGuessPopUp";
import { Button, GameFrame, ProgressBar, Spinner } from "../components/ui";
import TeamCrest from "../components/ui/TeamCrest";
import { BACKEND_ORIGIN } from "../configurations/backend";
import { apiFetch } from "../utils/Api";
import { fetchWholePool } from "../utils/pool";
import { matchAnswer } from "../utils/answerMatch";
import type { PlayerIndexEntry, PlayerTeamStint, OnGameEnd } from "../types/types";
import "../styles/CareerPath.css";

export interface CareerPathProps {
  gameInfo: PlayerIndexEntry[];
  onGameEnd: OnGameEnd;
  onPlayAgain?: () => void;
  onClose?: () => void;
  turn?: unknown;
  onTurnAction?: (a: unknown) => void;
  multiplayer?: boolean;
}

const POINTS_PER_CARD = 100;

interface GuessEntry {
  question_id: string;
  answer: string;
  correct: boolean;
  elapsed_ms: number;
}

/** Eligible mystery players: 3-7 stints (maxPoints 700 = 7 * 100). */
const isEligible = (p: PlayerIndexEntry) => p.teams.length >= 3 && p.teams.length <= 7;

/** Weighted pick: fame-tier 2-3 journeymen are 3x as likely as tiers 1/4. */
function pickMystery(pool: PlayerIndexEntry[]): PlayerIndexEntry | null {
  const eligible = pool.filter(isEligible);
  if (!eligible.length) return null;
  const weights = eligible.map((p) => (p.fame_tier === 2 || p.fame_tier === 3 ? 3 : 1));
  let r = Math.random() * weights.reduce((a, b) => a + b, 0);
  for (let i = 0; i < eligible.length; i++) {
    r -= weights[i];
    if (r <= 0) return eligible[i];
  }
  return eligible[eligible.length - 1];
}

/** "2019 – present" for a current stint; "2013" for a single-year stop. */
function stintYears(s: PlayerTeamStint): string {
  if (s.end_year === null) return `${s.start_year} – present`;
  if (s.end_year === s.start_year) return `${s.start_year}`;
  return `${s.start_year} – ${s.end_year}`;
}

const headshotUrl = (personId: number) =>
  `https://cdn.nba.com/headshots/nba/latest/1040x760/${personId}.png`;

/** Player photo with an orange silhouette fallback (never renders broken). */
function RevealHeadshot({ personId, name }: { personId: number; name: string }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [personId]);
  if (failed) {
    return (
      <svg viewBox="0 0 64 72" className="cp-reveal-fallback" aria-hidden="true">
        <defs>
          <linearGradient id="cprev" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="var(--brand)" />
            <stop offset="1" stopColor="var(--brand-deep)" />
          </linearGradient>
        </defs>
        <circle cx="32" cy="26" r="13" fill="url(#cprev)" />
        <path d="M8 72 C8 54 22 47 32 47 C42 47 56 54 56 72 Z" fill="url(#cprev)" />
      </svg>
    );
  }
  return (
    <img
      className="cp-reveal-photo"
      src={headshotUrl(personId)}
      alt={name}
      onError={() => setFailed(true)}
    />
  );
}

function CareerPath({ gameInfo, onGameEnd, onPlayAgain, onClose }: CareerPathProps) {
  const [player, setPlayer] = useState<PlayerIndexEntry | null>(null);
  const [flipped, setFlipped] = useState(1); // cards face-up (card 1 starts revealed)
  const [wrong, setWrong] = useState(0);
  const [guess, setGuess] = useState("");
  const [phase, setPhase] = useState<"playing" | "won" | "lost">("playing");
  const [bottomPhase, setBottomPhase] = useState<EndSequencePhase>("input");
  const [endState, setEndState] = useState<{ score: number; won: boolean } | null>(null);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [showPointsAnimation, setShowPointsAnimation] = useState(false);
  const [popUpInfo, setPopUpInfo] = useState({ Text: "", Color: "" });
  const guessLogRef = useRef<GuessEntry[]>([]);
  const startRef = useRef(Date.now());
  const railRef = useRef<HTMLDivElement>(null);
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

  // Fire-and-forget guess log (the data flywheel, contract #7).
  const sendGuessLog = () => {
    const entries = guessLogRef.current;
    guessLogRef.current = [];
    if (!entries.length) return;
    apiFetch(`${BACKEND_ORIGIN}/trivia/log-guesses/`, {
      method: "POST",
      body: JSON.stringify({ game: "career-path", entries }),
    }).catch(() => {
      /* analytics only */
    });
  };

  // Fresh state + mystery pick whenever a new payload loads (e.g. play-again).
  // gameInfo is the whole pool (single-player) or exactly one row (multiplayer).
  useEffect(() => {
    clearTimers();
    setFlipped(1);
    setWrong(0);
    setGuess("");
    setPhase("playing");
    setBottomPhase("input");
    setEndState(null);
    setShowPointsAnimation(false);
    guessLogRef.current = [];
    startRef.current = Date.now();
    if (!gameInfo?.length) {
      setPlayer(null);
    } else if (gameInfo.length === 1) {
      setPlayer(isEligible(gameInfo[0]) ? gameInfo[0] : null);
    } else {
      setPlayer(pickMystery(gameInfo));
    }
  }, [gameInfo]);

  // Autocomplete names: from the pool payload when we have it; multiplayer's
  // single-row payload pulls the shared players-index pool (cached) instead.
  // On fetch failure we degrade to free typing — answer matching still works.
  useEffect(() => {
    if (!gameInfo?.length) return;
    if (gameInfo.length > 1) {
      setSuggestions(gameInfo.map((p) => p.full_name));
      return;
    }
    let alive = true;
    fetchWholePool("players-index").then((res) => {
      if (alive && res.success && res.data) {
        setSuggestions((res.data as PlayerIndexEntry[]).map((p) => p.full_name));
      }
    });
    return () => {
      alive = false;
    };
  }, [gameInfo]);

  // Unmount: cancel pending reveals/end-calls and flush any un-sent guesses.
  useEffect(() => {
    return () => {
      clearTimers();
      sendGuessLog();
    };
  }, []);

  // Pan the rail so the newest face-up card is visible (in-container only).
  useEffect(() => {
    const rail = railRef.current;
    if (!rail || !rail.children.length) return;
    const card = rail.children[Math.min(flipped, rail.children.length) - 1] as HTMLElement;
    card.scrollIntoView({
      behavior: reduce ? "auto" : "smooth",
      inline: "center",
      block: "nearest",
    });
  }, [flipped, reduce]);

  const flashPopup = (text: string, color: string) => {
    setPopUpInfo({ Text: text, Color: color });
    setShowPointsAnimation(true);
    later(() => setShowPointsAnimation(false), 1500);
  };

  const handleGuessSubmit = () => {
    if (!player || phase !== "playing") return;
    const raw = guess.trim();
    setGuess("");
    if (!raw) return;

    const stints = player.teams.length;
    const correct =
      matchAnswer(raw, [{ answer: player.full_name, aliases: player.aliases }]) === 0;
    guessLogRef.current.push({
      question_id: String(player.person_id),
      answer: raw,
      correct,
      elapsed_ms: Date.now() - startRef.current,
    });

    if (correct) {
      const finalScore = (stints - wrong) * POINTS_PER_CARD;
      setPhase("won");
      setBottomPhase("loader");
      sendGuessLog();
      flashPopup(`Correct! +${finalScore}`, "var(--good)");
      // Reveal the rest of the trail as a cascade, then the score fades in.
      const remaining = stints - flipped;
      for (let i = 0; i < remaining; i++) {
        later(() => setFlipped((f) => f + 1), 260 + i * 260);
      }
      later(() => {
        onGameEnd?.(finalScore, { inPlace: true });
        setEndState({ score: finalScore, won: true });
        setBottomPhase("score");
      }, 260 + remaining * 260 + 700);
      return;
    }

    const newWrong = wrong + 1;
    setWrong(newWrong);

    if (newWrong >= stints) {
      // Out of guesses: 0 points, full reveal at the bottom, then the score.
      setPhase("lost");
      setBottomPhase("loader");
      sendGuessLog();
      flashPopup("Out of guesses", "var(--bad)");
      later(() => {
        onGameEnd?.(0, { inPlace: true });
        setEndState({ score: 0, won: false });
        setBottomPhase("score");
      }, 1500);
    } else {
      setFlipped(1 + newWrong); // each miss flips the next card
      flashPopup("Not him — next stop revealed", "var(--bad)");
    }
  };

  if (!gameInfo || gameInfo.length === 0)
    return <p style={{ color: "var(--muted)" }}>No career data available.</p>;
  if (!player) return <Spinner label="Tracing the career path…" />;

  const stints = player.teams.length;
  const guessesLeft = stints - wrong;
  const ended = phase !== "playing";
  const draftLabel = player.draft
    ? `Drafted ${player.draft.year} · Rd ${player.draft.round} · Pick ${player.draft.pick} (${player.draft.team_abbr})`
    : "Undrafted";

  return (
    <GameFrame>
      {/* Status: what you're doing + guesses left / stop count */}
      <GameFrame.Status
        left={<GameFrame.Label>TRACE THE CAREER</GameFrame.Label>}
        right={
          <span className="cp-counter tnum" aria-live="polite">
            {guessesLeft} {guessesLeft === 1 ? "guess" : "guesses"} left · {stints} stops
          </span>
        }
      />

      {/* Progress: career stops revealed so far */}
      <ProgressBar value={Math.min(flipped, stints)} max={stints} />

      <GameFrame.Prompt eyebrow="One career, card by card" />

      {/* Card rail — pans horizontally INSIDE this container (no page scroll) */}
      <GameFrame.Board>
      <div className="cp-rail" ref={railRef} role="list" aria-label="Career stops">
        {player.teams.map((stint, i) => {
          const faceUp = i < flipped;
          const isFinal = i === stints - 1;
          return (
            <div key={i} className="cp-card" role="listitem">
              <div className={`cp-flip${faceUp ? " is-flipped" : ""}`}>
                {/* Face-down: court-pattern back */}
                <div className="cp-face cp-face--back" aria-hidden={faceUp}>
                  <div className="cp-court" aria-hidden="true" />
                  <span className="cp-back-num tnum">{i + 1}</span>
                </div>
                {/* Face-up: the stint */}
                <div className="cp-face cp-face--front" aria-hidden={!faceUp}>
                  {faceUp && (
                    <>
                      <span className="cp-card-years tnum">{stintYears(stint)}</span>
                      <TeamCrest name={stint.name} className="cp-card-logo" />
                      <span className="cp-card-team font-display">{stint.name}</span>
                      <div className="cp-card-stats">
                        <span className="cp-stat">
                          <b className="tnum">{stint.gp ?? "—"}</b> GP
                        </span>
                        <span className="cp-stat">
                          <b className="tnum">{stint.ppg != null ? stint.ppg.toFixed(1) : "—"}</b> PPG
                        </span>
                      </div>
                      {/* Always rendered (hidden when not final) so every card reserves the
                          same content height — otherwise the draft line only on the last card
                          shifts that card's centered content relative to its siblings (Rule 4.4). */}
                      <span className={`cp-card-draft tnum${isFinal ? "" : " is-hidden"}`}>{draftLabel}</span>
                    </>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
      </GameFrame.Board>

      <GameFrame.Action>
      {/* Input → spinner → score (shared answers-shown end sequence) */}
      <EndSequence
        phase={bottomPhase}
        input={
          <GameFrame.InputRow>
            <AutocompleteInput
              placeholder="Who is it?…"
              value={guess}
              setValue={(val: string) => setGuess(val)}
              suggestions={suggestions}
              onSubmit={handleGuessSubmit}
              customStyleInput={{ width: "100%", height: "44px", padding: "0 12px", fontSize: "0.88rem" }}
              customStyleSuggestion={{ fontSize: "0.8rem", maxHeight: "160px", minWidth: "100%" }}
            />
            <Button
              size="md"
              aria-label="Confirm guess"
              onClick={handleGuessSubmit}
              disabled={ended || guess.trim() === ""}
            >
              Confirm
            </Button>
          </GameFrame.InputRow>
        }
        score={
          <ScorePanel
            score={endState?.score ?? 0}
            outOf={stints * POINTS_PER_CARD}
            label={endState?.won ? "That's him!" : "Out of guesses"}
            won={endState?.won}
            onPlayAgain={onPlayAgain}
            onClose={onClose}
          />
        }
      />

      {/* Loss reveal: name + headshot at the bottom */}
      <AnimatePresence>
        {phase === "lost" && (
          <motion.div
            className="cp-reveal"
            initial={reduce ? false : { opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.35 }}
          >
            <RevealHeadshot personId={player.person_id} name={player.full_name} />
            <div className="cp-reveal-text">
              <span className="cp-reveal-label">The journey belonged to</span>
              <span className="cp-reveal-name font-display">{player.full_name}</span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      </GameFrame.Action>

      <SubmitGuessPopup show={showPointsAnimation} text={popUpInfo.Text} color={popUpInfo.Color} />
    </GameFrame>
  );
}

export default CareerPath;
