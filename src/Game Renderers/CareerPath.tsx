import { useEffect, useMemo, useRef, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import AutocompleteInput from "../components/AutoCompleteInput";
import EndSequence, { type EndSequencePhase } from "../components/EndSequence";
import { ScoreLine, ScoreActions } from "../components/ScorePanel";
import SwapText from "../components/motion/SwapText";
import SubmitGuessPopup from "../components/SubmitGuessPopUp";
import { resultIn, stackPane, popIn, fadeInUp } from "../motion/variants";
import { Button, GameFrame, ProgressBar, Spinner } from "../components/ui";
import TeamCrest from "../components/ui/TeamCrest";
import { BACKEND_ORIGIN } from "../configurations/backend";
import { apiFetch } from "../utils/Api";
import { useNames } from "../hooks/useNames";
import { buildNameLookup } from "../utils/questions";
import { matchAnswer } from "../utils/answerMatch";
import type { PlayerIndexEntry, PlayerTeamStint, OnGameEnd, CareerPathQuestion } from "../types/types";
import "../styles/CareerPath.css";

export interface CareerPathProps {
  gameInfo: (CareerPathQuestion | PlayerIndexEntry)[];
  onGameEnd: OnGameEnd;
  onPlayAgain?: () => void;
  onClose?: () => void;
  turn?: unknown;
  onTurnAction?: (a: unknown) => void;
  multiplayer?: boolean;
}

const POINTS_PER_CARD = 100;

/** Which pane the end-of-game stage shows: the card rail or the name + headshot. */
type View = "career" | "answer";

interface GuessEntry {
  question_id: string;
  answer: string;
  correct: boolean;
  elapsed_ms: number;
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
  // Career Path uses only "input" and "score": the reveal is player-driven, so there
  // is no loader beat (no button waits more than 400 ms).
  const [bottomPhase, setBottomPhase] = useState<EndSequencePhase>("input");
  const [view, setView] = useState<View>("career");
  const [endState, setEndState] = useState<{ score: number; won: boolean } | null>(null);
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

  // The shared name list: autocomplete suggestions + name->id/id->name lookup.
  const names = useNames();
  const lookup = useMemo(() => (names ? buildNameLookup(names) : null), [names]);
  const suggestions = lookup?.suggestions ?? [];

  // Fresh state + mystery whenever a new payload loads (e.g. play-again). The
  // server now guarantees eligibility, so gameInfo[0] is always playable.
  // Single-player sends the new { schema, game, qid, player } question shape;
  // multiplayer still sends the legacy one-row payload until Phase E — handle
  // both shapes here as a temporary compatibility bridge.
  useEffect(() => {
    clearTimers();
    setFlipped(1);
    setWrong(0);
    setGuess("");
    setPhase("playing");
    setBottomPhase("input");
    setView("career");
    setEndState(null);
    setShowPointsAnimation(false);
    guessLogRef.current = [];
    startRef.current = Date.now();
    const q = gameInfo?.[0];
    setPlayer(q ? (("player" in q ? q.player : q) as PlayerIndexEntry) : null);
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
      sendGuessLog();
      flashPopup(`Correct! +${finalScore}`, "var(--good)");
      finish(finalScore, true);
      return;
    }

    const newWrong = wrong + 1;
    setWrong(newWrong);

    if (newWrong >= stints) {
      // Out of guesses: 0 points. Every card is already face-up (each miss flipped
      // one). Rule 6.3: the popup never announces the loss — the result line does.
      setPhase("lost");
      sendGuessLog();
      flashPopup("Not him.", "var(--bad)");
      finish(0, false);
    } else {
      setFlipped(1 + newWrong); // each miss flips the next card
      flashPopup("Not him.", "var(--bad)");
    }
  };

  /** Flip every still-face-down card with the existing 260 ms cascade (Rule 7.2: only the unearned ones). */
  const revealRest = () => {
    if (!player) return;
    const stints = player.teams.length;
    const remaining = stints - flipped;
    for (let i = 0; i < remaining; i++) later(() => setFlipped((f) => Math.min(f + 1, stints)), 260 + i * 260);
  };

  /** The end, synchronous (no `later`): result line, default pane, buttons — all in one render. */
  const finish = (score: number, won: boolean) => {
    onGameEnd?.(score, { inPlace: true });
    setEndState({ score, won });
    setView(won ? "answer" : "career");
    setBottomPhase("score");
  };

  const toggleView = () => {
    if (!player) return;
    if (view === "answer") {
      setView("career");
      revealRest();
    } else {
      setView("answer");
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

  const toggle = (
    <button type="button" className="chip cp-toggle" onClick={toggleView}>
      <SwapText>{view === "answer" ? "See full career" : "See the answer"}</SwapText>
    </button>
  );

  return (
    <GameFrame>
      {/* Status: the label + guesses left during play; the result line (centred,
          lone-left) once the game ends. Both boxes are 22px so the row never resizes. */}
      <GameFrame.Status
        left={
          ended ? (
            <motion.div
              className="cp-result"
              variants={resultIn}
              initial={reduce ? "visible" : "hidden"}
              animate="visible"
            >
              <ScoreLine
                score={endState?.score ?? 0}
                outOf={stints * POINTS_PER_CARD}
                label={endState?.won ? "That's him!" : "Out of guesses"}
                won={endState?.won}
              />
            </motion.div>
          ) : (
            <GameFrame.Label>TRACE THE CAREER</GameFrame.Label>
          )
        }
        right={
          ended ? undefined : (
            <span className="cp-counter tnum" aria-live="polite">
              <SwapText>{`${guessesLeft} ${guessesLeft === 1 ? "guess" : "guesses"} left`}</SwapText>
            </span>
          )
        }
      />

      {/* Progress: career cards revealed so far */}
      <ProgressBar value={Math.min(flipped, stints)} max={stints} />

      {/* Eyebrow during play; the career/answer toggle at the end (same 22px box) */}
      <GameFrame.Prompt
        eyebrow={
          <SwapText swapKey={ended ? "toggle" : "eyebrow"}>
            {ended ? toggle : <span className="cp-eyebrow">One career, card by card</span>}
          </SwapText>
        }
      />

      {/* Stage: the card rail and the answer share one grid cell, so swapping
          between them never changes the board's height (Rule 6.2). */}
      <GameFrame.Board>
      <div className="cp-stage">
        {/* Card rail — pans horizontally INSIDE this container (no page scroll) */}
        <motion.div
          className={`cp-rail cp-pane${view === "career" ? " is-active" : ""}`}
          ref={railRef}
          role="list"
          aria-label="Career stops"
          aria-hidden={view !== "career"}
          variants={stackPane}
          initial={false}
          animate={view === "career" ? "visible" : "hidden"}
        >
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
        </motion.div>

        {/* The answer: name + headshot (default on a win, behind the toggle on a loss).
            Its children mount only once the game ends, so the name isn't in the DOM and the
            headshot isn't requested during play; the stage height comes from the rail pane.
            `initial` flips to "hidden" at the end so children mounting then start hidden and
            take the pane's orchestrated popIn / fadeInUp instead of snapping to visible. */}
        <motion.div
          className={`cp-answer cp-pane${view === "answer" ? " is-active" : ""}`}
          aria-hidden={view !== "answer"}
          variants={stackPane}
          initial={ended ? "hidden" : false}
          animate={view === "answer" ? "visible" : "hidden"}
        >
          {ended && (
            <>
              <motion.div className="cp-answer-photo" variants={popIn}>
                <RevealHeadshot personId={player.person_id} name={player.full_name} />
              </motion.div>
              <motion.div className="cp-answer-text" variants={fadeInUp}>
                <span className="cp-reveal-label">The journey belonged to</span>
                <span className="cp-reveal-name font-display">{player.full_name}</span>
              </motion.div>
            </>
          )}
        </motion.div>
      </div>
      </GameFrame.Board>

      <GameFrame.Action>
      {/* Input → score (shared answers-shown end sequence; no loader beat here) */}
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
        score={<ScoreActions onPlayAgain={onPlayAgain} onClose={onClose} />}
      />
      </GameFrame.Action>

      <SubmitGuessPopup show={showPointsAnimation} text={popUpInfo.Text} color={popUpInfo.Color} />
    </GameFrame>
  );
}

export default CareerPath;
