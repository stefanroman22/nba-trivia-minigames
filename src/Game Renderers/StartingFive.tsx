import { useState, useEffect } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import AutocompleteInput from "../components/AutoCompleteInput";
import SubmitGuessPopup from "../components/SubmitGuessPopUp";
import EndSequence, { type EndSequencePhase } from "../components/EndSequence";
import ScorePanel from "../components/ScorePanel";
import { Button, GameFrame, Spinner } from "../components/ui";
import TeamCrest from "../components/ui/TeamCrest";
import { BACKEND_ORIGIN } from "../configurations/backend";
import type { StartingFiveGame, StartingFivePlayer, OnGameEnd } from "../types/types";
import "../styles/StartingFive.css";

interface StartingFiveProps {
  gameInfo: StartingFiveGame[];
  pointsPerCorrect: number;
  onGameEnd: OnGameEnd;
  /** Passed by RenderGame; the shell owns the exit control (spec §4). */
  onExit?: () => void;
  onPlayAgain?: () => void;
  /** Closes the game and returns to the idle screen (spec §7b). */
  onClose?: () => void;
}

const COMPLETION_BONUS = 50; // perfect lineup → 5 * pointsPerCorrect + bonus = maxPoints

// Cards run left → right in this order (also the game-over reveal order).
const SLOTS = [
  { key: "PG", label: "Point Guard" },
  { key: "SG", label: "Shooting Guard" },
  { key: "SF", label: "Small Forward" },
  { key: "PF", label: "Power Forward" },
  { key: "C", label: "Center" },
];

const normalizePosition = (pos: string) => {
  if (pos === "PF" || pos === "SF" || pos === "F") return "F";
  if (pos === "PG" || pos === "SG" || pos === "G") return "G";
  return pos; // "C"
};

// Placeholder portrait until real player photos are wired up. Deterministic per
// name so each revealed player gets a distinct face; the CSS overlay tones it to
// the app's dark + orange look. Swap this one line for the real photo source later.
const playerPhotoUrl = (name: string) => `https://i.pravatar.cc/240?u=${encodeURIComponent(name)}`;

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

/** Back of the card: the player's photo, app-toned. Falls back to an orange
 *  silhouette if the placeholder photo can't load (so it never breaks). */
function RevealedFace({ name }: { name: string }) {
  const [failed, setFailed] = useState(false);
  return (
    <>
      {failed ? (
        <svg viewBox="0 0 64 72" className="s5-revealed-fallback" aria-hidden="true">
          <defs>
            <linearGradient id="s5rev" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="var(--brand)" />
              <stop offset="1" stopColor="var(--brand-deep)" />
            </linearGradient>
          </defs>
          <circle cx="32" cy="26" r="13" fill="url(#s5rev)" />
          <path d="M8 72 C8 54 22 47 32 47 C42 47 56 54 56 72 Z" fill="url(#s5rev)" />
        </svg>
      ) : (
        <img className="s5-photo" src={playerPhotoUrl(name)} alt={name} onError={() => setFailed(true)} />
      )}
      <div className="s5-photo-overlay" />
    </>
  );
}

function StartingFive({ gameInfo, pointsPerCorrect, onGameEnd, onPlayAgain, onClose }: StartingFiveProps) {
  const [guesses, setGuesses] = useState<Record<string, string>>({});
  const [correctGuesses, setCorrectGuesses] = useState<Record<string, string>>({});
  const [lostReveal, setLostReveal] = useState<Record<string, string>>({});
  // End-state: the lineup stays on screen while the bottom slot swaps
  // submission → loader → score (spec §7b — see EndSequence).
  const [endState, setEndState] = useState<{ score: number; won: boolean } | null>(null);
  const [bottomPhase, setBottomPhase] = useState<EndSequencePhase>("input");
  const [showPointsAnimation, setShowPointsAnimation] = useState(false);
  const [score, setScore] = useState(0);
  const [allPlayers, setAllPlayers] = useState([]);
  const [numberLifes, setNumberLifes] = useState(3);
  const [popUpInfo, setPopUpInfo] = useState({ Text: "", Color: "" });
  const reduce = useReducedMotion();

  useEffect(() => {
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
  }, [gameInfo]);

  const currentGame = gameInfo && gameInfo.length > 0 ? gameInfo[0] : null;
  const maxPoints = 5 * pointsPerCorrect + COMPLETION_BONUS;

  const handleGuessSubmit = (posKey: string) => {
    if (!currentGame?.starting_5) return;
    const playerName = guesses[posKey];
    if (!playerName) return;
    if (correctGuesses[posKey] === playerName) return;

    const normalizedStarting5 = currentGame.starting_5.map((p: StartingFivePlayer) => ({
      ...p,
      position: normalizePosition(p.position),
    }));
    const expectedPos = posKey === "C" ? "C" : normalizePosition(posKey);

    let match;
    if (posKey === "C") {
      match = normalizedStarting5.find(
        (p: StartingFivePlayer) =>
          p.position === "C" && p.name.toLowerCase() === playerName.trim().toLowerCase()
      );
    } else {
      match = normalizedStarting5.find(
        (p: StartingFivePlayer) =>
          p.position === expectedPos &&
          !Object.values(correctGuesses).includes(p.name) &&
          p.name.toLowerCase() === playerName.trim().toLowerCase()
      );
    }

    if (match) {
      setCorrectGuesses((prev) => ({ ...prev, [posKey]: match.name }));
      setScore((prev) => prev + pointsPerCorrect);
      setPopUpInfo({ Text: `Correct! +${pointsPerCorrect}`, Color: "var(--good)" });
      setShowPointsAnimation(true);

      if (Object.keys(correctGuesses).length + 1 === 5) {
        setTimeout(() => setShowPointsAnimation(false), 1500);
        // Win → in-place (spec §7b): the completed lineup stays in view while the
        // bottom slot runs loader → score.
        setBottomPhase("loader");
        setTimeout(() => {
          onGameEnd?.(maxPoints, { inPlace: true });
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
        // Build the full correct lineup, then reveal the still-unknown players
        // one after another, left → right.
        const revealAll: Record<string, string> = {};
        currentGame.starting_5.forEach((p: StartingFivePlayer) => {
          const normPos = normalizePosition(p.position);
          if (normPos === "C") revealAll["C"] = p.name;
          else if (normPos === "F") { if (!revealAll["PF"]) revealAll["PF"] = p.name; else revealAll["SF"] = p.name; }
          else if (normPos === "G") { if (!revealAll["PG"]) revealAll["PG"] = p.name; else revealAll["SG"] = p.name; }
        });

        setPopUpInfo({ Text: "Out of lives", Color: "var(--bad)" });
        setShowPointsAnimation(true);
        setTimeout(() => setShowPointsAnimation(false), 1400);

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
        // …then the score settles in place (spec §7b), awarding what was earned
        // and logging the session — a loss used to award nothing at all.
        setTimeout(() => {
          onGameEnd?.(finalScore, { inPlace: true });
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

  const teamBlock = (name: string, logo: string) => {
    const isWinner = currentGame.winning_team === name;
    return (
      <div className={`s5-team${isWinner ? " is-winner" : ""}`}>
        <TeamCrest src={logo} name={name} className="s5-team-badge" />
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
        {teamBlock(currentGame.team_a, currentGame.team_a_logo)}
        <div className="s5-score">
          <span className="s5-score-num tnum font-display">{currentGame.final_score}</span>
          <span className="s5-score-date">
            {new Date(currentGame.game_date).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
          </span>
        </div>
        {teamBlock(currentGame.team_b, currentGame.team_b_logo)}
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
        )}
      </GameFrame.Action>

      <SubmitGuessPopup show={showPointsAnimation} text={popUpInfo.Text} color={popUpInfo.Color} />
    </GameFrame>
  );
}

export default StartingFive;
