import { useState, useEffect, useMemo, useRef } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import AutocompleteInput from "../components/AutoCompleteInput";
import SubmitGuessPopup from "../components/SubmitGuessPopUp";
import AutoHeight from "../components/motion/AutoHeight";
import EndSequence, { type EndSequencePhase } from "../components/EndSequence";
import ScorePanel from "../components/ScorePanel";
import { Button, GameFrame, Spinner } from "../components/ui";
import TeamBadge from "../components/ui/TeamBadge";
import PlayerPhoto from "../components/ui/PlayerPhoto";
import { BACKEND_ORIGIN } from "../configurations/backend";
import { preloadPhotosByName, usePersonIdByName } from "../utils/playerPhotos";
import { lineupSlots, placeGuess } from "../utils/startingFive";
import { nameKey } from "../utils/answerMatch";
import { createGuessLogger } from "../utils/guessLog";
import type { StartingFiveGame, StartingFivePlayer, OnGameEnd } from "../types/types";
import type { AnswerReview } from "../types/review";
import "../styles/StartingFive.css";

interface StartingFiveProps {
  gameInfo: StartingFiveGame[];
  pointsPerCorrect: number;
  onGameEnd: OnGameEnd;
  onPlayAgain?: () => void;
  /** Closes the game and returns to the idle screen (Rule 7.3). */
  onClose?: () => void;
}

// Cards run left → right in this order (also the game-over reveal order).
const SLOTS = [
  { key: "PG", label: "Point Guard" },
  { key: "SG", label: "Shooting Guard" },
  { key: "SF", label: "Small Forward" },
  { key: "PF", label: "Power Forward" },
  { key: "C", label: "Center" },
];

/** Front of the card: a shaded, unknown player silhouette with a question mark. */
function UnknownFigure() {
  return (
    <div className="s5-unknown">
      <svg viewBox="0 0 64 72" className="s5-unknown-fig" aria-hidden="true">
        <circle cx="32" cy="26" r="13" />
        <path d="M8 72 C8 54 22 47 32 47 C42 47 56 54 56 72 Z" />
      </svg>
      <span className="s5-unknown-q font-display" aria-hidden="true">?</span>
    </div>
  );
}

/** Back of the card: the player's real photo (the data has names only, so it is looked
 *  up by name), app-toned; the shared silhouette when there is none. */
export function RevealedFace({ name }: { name: string }) {
  const personId = usePersonIdByName(name);
  return (
    <>
      <PlayerPhoto personId={personId} alt={name} className="s5-photo" fallbackClassName="s5-revealed-fallback" />
      <div className="s5-photo-overlay" />
    </>
  );
}

function StartingFive({ gameInfo, pointsPerCorrect, onGameEnd, onPlayAgain, onClose }: StartingFiveProps) {
  const [guesses, setGuesses] = useState<Record<string, string>>({});
  const [correctGuesses, setCorrectGuesses] = useState<Record<string, string>>({});
  const [lostReveal, setLostReveal] = useState<Record<string, string>>({});
  // End-state: the lineup stays on screen while the bottom slot swaps
  // submission → loader → score (Rule 7.3 — see EndSequence).
  const [endState, setEndState] = useState<{ score: number; won: boolean } | null>(null);
  const [bottomPhase, setBottomPhase] = useState<EndSequencePhase>("input");
  const [showPointsAnimation, setShowPointsAnimation] = useState(false);
  const [score, setScore] = useState(0);
  const [allPlayers, setAllPlayers] = useState<string[]>([]);
  // Every player name's key: a suffix is forgiven only when the typed name is not another real player.
  const knownKeys = useMemo(() => (allPlayers.length ? new Set(allPlayers.map(nameKey)) : null), [allPlayers]);
  const [numberLifes, setNumberLifes] = useState(3);
  const [popUpInfo, setPopUpInfo] = useState({ Text: "", Color: "" });
  const reduce = useReducedMotion();
  // Every guess, sent to the guess log on game end / unmount; timed from when the lineup is shown.
  const [guessLog] = useState(() => createGuessLogger("starting-five"));
  const startRef = useRef(Date.now());

  useEffect(() => () => guessLog.flush(), [guessLog]);

  useEffect(() => {
    preloadPhotosByName();
    fetch(`${BACKEND_ORIGIN}/trivia/all-players/`)
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((data) => {
        if (data.players) setAllPlayers(data.players);
      })
      .catch((err) => console.error("Failed to fetch players:", err));
  }, []);

  // Fresh state whenever a new lineup loads (e.g. play-again).
  useEffect(() => {
    setGuesses({});
    setCorrectGuesses({});
    setLostReveal({});
    setEndState(null);
    setBottomPhase("input");
    setNumberLifes(3);
    setScore(0);
    startRef.current = Date.now();
  }, [gameInfo]);

  const currentGame = gameInfo && gameInfo.length > 0 ? gameInfo[0] : null;
  const maxPoints = 5 * pointsPerCorrect;

  /** The answer review handed back with the score: each card's player, found or revealed. */
  const reviewOf = (found: Record<string, string>, all: Record<string, string>): AnswerReview | undefined =>
    currentGame
      ? {
          game: "starting-five",
          matchup: {
            gameId: currentGame.game_id,
            teamA: currentGame.team_a, teamB: currentGame.team_b,
            winner: currentGame.winning_team, score: currentGame.final_score, date: currentGame.game_date,
          },
          slots: SLOTS.map((s) => ({ key: s.key, label: s.label, name: found[s.key] ?? all[s.key] ?? null, found: !!found[s.key] })),
        }
      : undefined;

  const handleGuessSubmit = (posKey: string) => {
    if (!currentGame?.starting_5) return;
    const playerName = guesses[posKey];
    if (!playerName) return;
    if (correctGuesses[posKey] === playerName) return;

    // Any starter still to find is right: on his own family's card he fills it, on another card he goes
    // to his card at the reveal (the typed card's input is cleared below).
    const match = placeGuess(currentGame.starting_5, posKey, playerName, correctGuesses, knownKeys);

    guessLog.add({
      question_id: currentGame.game_id,
      answer: playerName.trim(),
      correct: !!match,
      elapsed_ms: Date.now() - startRef.current,
    });

    if (match) {
      setCorrectGuesses((prev) => ({ ...prev, [match.slot]: match.name }));
      setScore((prev) => prev + pointsPerCorrect);
      setPopUpInfo({ Text: `Correct! +${pointsPerCorrect}`, Color: "var(--good)" });
      setShowPointsAnimation(true);

      if (Object.keys(correctGuesses).length + 1 === 5) {
        guessLog.flush();
        setTimeout(() => setShowPointsAnimation(false), 1500);
        // Win → in-place (Rule 7.3): the completed lineup stays in view while the
        // bottom slot runs loader → score.
        setBottomPhase("loader");
        const found = { ...correctGuesses, [match.slot]: match.name };
        setTimeout(() => {
          onGameEnd?.(maxPoints, { inPlace: true, review: reviewOf(found, found) });
          setEndState({ score: maxPoints, won: true });
          setBottomPhase("score");
        }, 1500);
      } else {
        setTimeout(() => setShowPointsAnimation(false), 1500);
      }
    } else {
      const newLifes = numberLifes - 1;
      setNumberLifes(newLifes);

      if (newLifes <= 0) {
        guessLog.flush();
        // Build the full correct lineup (the found players where they were found),
        // then reveal the still-unknown players one after another, left → right.
        // A lineup that doesn't fit the board's 2-2-1 shape (e.g. a third
        // guard) is filtered out of the pool, but if one ever slips through
        // the extra player is left out rather than clobbering another card.
        const revealAll = lineupSlots(currentGame.starting_5, correctGuesses, (p: StartingFivePlayer) =>
          console.warn(`StartingFive: no free ${p.position} card for ${p.name} — lineup is not 2-2-1`));

        const finalScore = score;
        // Only the players the user never found are staggered — the ones they got
        // are already face-up from play, so they cost no reveal time. The wait
        // therefore scales with how much they missed, not with lineup size.
        const toReveal = SLOTS.map((s) => s.key).filter((k) => !correctGuesses[k]);
        // Submission fades to a loader the moment the lineup begins revealing…
        setBottomPhase("loader");
        toReveal.forEach((key, i) => {
          setTimeout(() => setLostReveal((prev) => ({ ...prev, [key]: revealAll[key] })), 300 + i * 260);
        });
        const finishedAt = 300 + toReveal.length * 260 + 300;
        // …then the score settles in place (Rule 7.3), awarding what was earned
        // and logging the session — a loss used to award nothing at all.
        setTimeout(() => {
          onGameEnd?.(finalScore, { inPlace: true, review: reviewOf(correctGuesses, revealAll) });
          setEndState({ score: finalScore, won: false });
          setBottomPhase("score");
        }, finishedAt);
      } else {
        setPopUpInfo({ Text: "Not in this lineup", Color: "var(--bad)" });
        setShowPointsAnimation(true);
        setTimeout(() => setShowPointsAnimation(false), 1500);
      }
    }

    setGuesses((prev) => ({ ...prev, [posKey]: "" }));
  };

  if (!currentGame) return <Spinner label="Loading lineup…" />;
  if (!currentGame.starting_5) return <p style={{ color: "var(--muted)" }}>No lineup data available.</p>;

  const teamBlock = (name: string) => {
    const isWinner = currentGame.winning_team === name;
    return (
      <div className={`s5-team${isWinner ? " is-winner" : ""}`}>
        <TeamBadge name={name} surface="board" className="s5-team-badge" decorative />
        <span className="s5-team-name font-display">{name}</span>
      </div>
    );
  };

  return (
    <GameFrame>
      <GameFrame.Status
        left={<GameFrame.Label>FILL THE LINEUP</GameFrame.Label>}
        right={<GameFrame.Score value={score} />}
      />

      <GameFrame.Board>
      {/* Scoreboard */}
      <div className="s5-board">
        {teamBlock(currentGame.team_a)}
        <div className="s5-score">
          <span className="s5-score-num tnum font-display">{currentGame.final_score}</span>
          <span className="s5-score-date">
            {new Date(currentGame.game_date).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
          </span>
        </div>
        {teamBlock(currentGame.team_b)}
      </div>

      {/* Lives */}
      <div className="s5-lives" aria-label={`${numberLifes} lives left`}>
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

      {/* Player cards */}
      <div className="s5-cards">
        {SLOTS.map((slot) => {
          const correct = correctGuesses[slot.key];
          const revealedName = correct || lostReveal[slot.key];
          const flipped = !!revealedName;
          return (
            <div key={slot.key} className={`s5-card${correct ? " is-correct" : revealedName ? " is-revealed" : ""}`}>
              <span className="s5-card-pos">{slot.label}</span>

              <div className="s5-card-stage">
                <div className={`s5-flip${flipped ? " is-flipped" : ""}`}>
                  <div className="s5-face s5-face--front"><UnknownFigure /></div>
                  <div className="s5-face s5-face--back">{flipped && <RevealedFace name={revealedName} />}</div>
                </div>
              </div>

              <div className="s5-card-foot">
                <AnimatePresence mode="wait">
                  {revealedName ? (
                    <motion.span
                      key="name"
                      className="s5-card-name"
                      initial={reduce ? false : { opacity: 0, y: 6 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.3, delay: 0.25 }}
                    >
                      {revealedName}
                    </motion.span>
                  ) : (
                    <motion.div
                      key="input"
                      className="s5-card-input"
                      initial={reduce ? false : { opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={reduce ? undefined : { opacity: 0 }}
                    >
                      <AutocompleteInput
                        placeholder="Player…"
                        value={guesses[slot.key] || ""}
                        setValue={(val: string) => setGuesses((prev) => ({ ...prev, [slot.key]: val }))}
                        suggestions={allPlayers}
                        onSubmit={() => handleGuessSubmit(slot.key)}
                        customStyleInput={{ width: "100%", height: "38px", padding: "0 clamp(5px, 1.8vw, 12px)", fontSize: "clamp(0.68rem, 2.1vw, 0.82rem)" }}
                        customStyleSuggestion={{ fontSize: "0.78rem", maxHeight: "150px", minWidth: "max(100%, 150px)" }}
                      />
                      <Button
                        block
                        size="sm"
                        aria-label={`Confirm ${slot.label}`}
                        onClick={() => handleGuessSubmit(slot.key)}
                        disabled={!guesses[slot.key] || guesses[slot.key].trim() === ""}
                      >
                        Confirm
                      </Button>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </div>
          );
        })}
      </div>

      </GameFrame.Board>

      {/* Loader → score, in place beneath the lineup (shared answers-shown pattern).
          The submission controls live inside each card, so this slot holds nothing
          until the end sequence starts — GameFrame.Action renders nothing while
          empty, so no space is reserved during play. */}
      <GameFrame.Action>
        {bottomPhase !== "input" && (
          <AutoHeight style={{ width: "100%" }}>
            <EndSequence
              phase={bottomPhase}
              input={null}
              score={
                // No found-count label — the green/red player names already say who
                // was got and who wasn't.
                <ScorePanel
                  score={endState?.score ?? 0}
                  outOf={maxPoints}
                  won={endState?.won}
                  onPlayAgain={onPlayAgain}
                  onClose={onClose}
                />
              }
            />
          </AutoHeight>
        )}
      </GameFrame.Action>

      <SubmitGuessPopup show={showPointsAnimation} text={popUpInfo.Text} color={popUpInfo.Color} />
    </GameFrame>
  );
}

export default StartingFive;
