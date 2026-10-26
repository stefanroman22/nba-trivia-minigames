import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import SwapText from "../components/motion/SwapText";
import AutocompleteInput from "../components/AutoCompleteInput";
import SubmitGuessPopup from "../components/SubmitGuessPopUp";
import ProgressBar from "../components/ui/ProgressBar";
import { Button, GameFrame, Spinner } from "../components/ui";
import { BasketballCrest } from "../components/ui/TeamCrest";
import TeamNameGradient from "../components/ui/TeamNameGradient";
import { scrambledLogoUrl } from "../constants/teamLogos";
import { matchAnswer } from "../utils/answerMatch";
import { createGuessLogger } from "../utils/guessLog";
import type { NbaTeamLogo, OnGameEnd } from "../types/types";
import "../styles/NameLogo.css";

interface NameLogoProps {
  seriesList: NbaTeamLogo[];
  pointsPerCorrect: number;
  onGameEnd: OnGameEnd;
  allTeams: string[];
}

const LOGO_SIZE = "clamp(92px, 18dvh, 140px)";
const LOGO_IMG: React.CSSProperties = { display: "block", width: "100%", height: "100%", objectFit: "contain" };
// Reveal: a pure cross-fade, the puzzle out and the team name in. Opacity only: the name sits in the
// same fixed slot (NameLogo.css .nl-name-layer), so nothing grows or shrinks.
const LOGO_SHOWN = { opacity: 1 };
const LOGO_HIDDEN = { opacity: 0 };
const LOGO_REVEAL = { duration: 0.6, ease: [0.4, 0, 0.2, 1] as const };

/** Characters on the longer line of the name's best two-line split: the font size is fitted to it. */
function longestLineChars(name: string): number {
  const words = name.replace(/\//g, "/ ").split(/\s+/).filter(Boolean);
  if (words.length < 2) return Math.max(1, name.length);
  let best = Infinity;
  for (let i = 1; i < words.length; i++) {
    best = Math.min(best, Math.max(words.slice(0, i).join(" ").length, words.slice(i).join(" ").length));
  }
  return best;
}

function NameLogo({ seriesList, pointsPerCorrect, onGameEnd, allTeams }: NameLogoProps) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [guess, setGuess] = useState("");
  const [, setSuggestions] = useState([]);
  const [showAnswer, setShowAnswer] = useState(false);
  const [showPointsAnimation, setShowPointsAnimation] = useState(false);
  const [score, setScore] = useState(0);
  const [imgLoaded, setImgLoaded] = useState(false);
  const reduce = useReducedMotion();

  const currentTeam = seriesList[currentIndex];

  const [scrambleFailed, setScrambleFailed] = useState(false);
  // The round whose name is in the DOM: set on the answer, so the name is never on the page (find in
  // page, copy) before the guess, and still there while it fades out after the last round.
  const [answeredIdx, setAnsweredIdx] = useState(-1);

  // While guessing only the scrambled logo is shown; once the guess is in it cross-fades into the team
  // name, filled with the team's colours (never the real logo). Without a scrambled file (or when it
  // fails to load), a generic basketball badge is the puzzle: the game never loads a real NBA logo.
  const puzzleSrc = scrambleFailed ? null : scrambledLogoUrl(currentTeam?.team_id, currentTeam?.full_name);
  const revealed = showAnswer || showPointsAnimation;
  const answerName = currentTeam?.full_name || "";
  const answerId = currentTeam?.team_id;
  const nameStyle = useMemo(() => ({
    "--nl-chars": longestLineChars(answerName), "--nl-slot": LOGO_SIZE,
  } as React.CSSProperties), [answerName]);

  // retry the scrambled file each round
  useEffect(() => { setScrambleFailed(false); }, [currentIndex]);
  // The loader tracks the puzzle <img> itself (keyed by src, so a new round or a fallback src mounts
  // a fresh one): it reads "loaded" the moment the element mounts. Resetting on currentIndex instead
  // would flip the spinner on while the previous logo is still fading out (AnimatePresence "wait").
  const onPuzzleImgRef = useCallback((el: HTMLImageElement | null) => {
    if (el) setImgLoaded(el.complete && el.naturalWidth > 0);
  }, []);

  // The round's one pending advance. The input stays live during the reveal, so a second Enter or
  // Confirm would queue another advance that later fires mid-round and swaps in the next logo.
  const advanceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Each round's guess and verdict, for the answer review handed back with the score.
  const picksRef = useRef<{ pick: string; correct: boolean }[]>([]);
  // Every answer, sent to the guess log on game end / unmount; the clock restarts each round.
  const [guessLog] = useState(() => createGuessLogger("name-logo"));
  const roundStartRef = useRef(Date.now());
  useEffect(() => { roundStartRef.current = Date.now(); }, [currentIndex]);
  useEffect(() => () => {
    if (advanceTimer.current) clearTimeout(advanceTimer.current);
    guessLog.flush();
  }, [guessLog]);

  const handleGuessSubmit = (teamName: string) => {
    if (!teamName || typeof teamName !== "string" || teamName.trim() === "") {
      return; // don't run if no valid team
    }
    if (advanceTimer.current) return; // this round is already answered

    const isCorrect =
      matchAnswer(teamName, [{ answer: currentTeam?.full_name || "" }]) === 0;
    picksRef.current[currentIndex] = { pick: teamName.trim(), correct: isCorrect };
    setAnsweredIdx(currentIndex);
    guessLog.add({
      question_id: String(currentTeam.team_id),
      answer: teamName.trim(),
      correct: isCorrect,
      elapsed_ms: Date.now() - roundStartRef.current,
    });
    if (currentIndex === seriesList.length - 1) guessLog.flush();

    if (isCorrect) {
      setScore((prev) => prev + pointsPerCorrect);
      setShowPointsAnimation(true);
      advanceTimer.current = setTimeout(() => {
        moveToNext(true);
      }, 1500);
    } else {
      setShowAnswer(true);
      advanceTimer.current = setTimeout(() => {
        moveToNext(false);
      }, 1800);
    }
  };


  const moveToNext = (wasCorrect: boolean) => {
    setShowPointsAnimation(false);
    setShowAnswer(false);
    setGuess("");
    setSuggestions([]);

    if (currentIndex < seriesList.length - 1) {
      advanceTimer.current = null;
      setCurrentIndex((prev) => prev + 1);
    } else {
      if (onGameEnd) onGameEnd(score + (wasCorrect ? pointsPerCorrect : 0), {
        review: {
          game: "name-logo",
          rounds: seriesList.map((t, i) => ({
            team: t.full_name,
            teamId: t.team_id,
            pick: picksRef.current[i]?.pick ?? null,
            correct: !!picksRef.current[i]?.correct,
          })),
        },
      });
    }
  };

  if (!currentTeam) return null;

  // The answer: the team name as real text, in the team's colours, over the puzzle in the same slot.
  // Hidden (and out of the accessibility tree) until the guess is in.
  const nameLayer = (
    <motion.div
      className="nl-name-layer"
      aria-hidden={!revealed}
      initial={false}
      animate={revealed ? LOGO_SHOWN : LOGO_HIDDEN}
      transition={LOGO_REVEAL}
      style={nameStyle}
    >
      <p className="nl-name font-display">
        <TeamNameGradient name={answerName} teamId={answerId} surface="board" blank={answeredIdx !== currentIndex} />
      </p>
    </motion.div>
  );

  return (
    <GameFrame>
      <GameFrame.Status
        left={<GameFrame.Label>ROUND <SwapText className="tnum">{currentIndex + 1}</SwapText><span className="tnum">/{seriesList.length}</span></GameFrame.Label>}
        right={<GameFrame.Score value={score} />}
      />
      <ProgressBar value={currentIndex + (showAnswer || showPointsAnimation ? 1 : 0)} max={seriesList.length} />

      <GameFrame.Board>
        {/* Not keyed per round: prompt and logo box hold still, the logo image
            below swaps on its own key (team) so only the changing crest fades. */}
        <div style={{ width: "100%", display: "flex", flexDirection: "column", gap: 18 }}>
          <GameFrame.Prompt eyebrow="GUESS THE TEAM" title="Which franchise is this?" />

          {/* Logo: the scrambled mark is the puzzle; on reveal the team name cross-fades in over it */}
          <div className="nl-slot" style={{ position: "relative", display: "flex", justifyContent: "center", height: LOGO_SIZE, alignItems: "center" }}>
            {puzzleSrc ? (
              <>
                <AnimatePresence>
                  {!imgLoaded && (
                    <motion.div
                      key="logo-loader"
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      transition={{ duration: 0.25 }}
                      style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center" }}
                    >
                      <Spinner size={24} />
                    </motion.div>
                  )}
                </AnimatePresence>
                <AnimatePresence mode="wait">
                  <motion.div
                    key={currentTeam?.full_name}
                    initial={reduce ? false : { opacity: 0 }}
                    animate={{ opacity: imgLoaded ? 1 : 0 }}
                    exit={reduce ? undefined : { opacity: 0 }}
                    transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
                    style={{ position: "relative", width: LOGO_SIZE, height: LOGO_SIZE, maxHeight: "20dvh" }}
                  >
                    <motion.img
                      key={puzzleSrc}
                      src={puzzleSrc}
                      alt="Scrambled team logo"
                      ref={onPuzzleImgRef}
                      onLoad={() => setImgLoaded(true)}
                      onError={() => setScrambleFailed(true)}
                      initial={false}
                      animate={revealed ? LOGO_HIDDEN : LOGO_SHOWN}
                      transition={LOGO_REVEAL}
                      style={LOGO_IMG}
                    />
                    {nameLayer}
                  </motion.div>
                </AnimatePresence>
              </>
            ) : (
              <>
                <motion.div initial={false} animate={revealed ? LOGO_HIDDEN : LOGO_SHOWN} transition={LOGO_REVEAL} style={{ display: "flex" }}>
                  <BasketballCrest label="NBA Team" size={120} />
                </motion.div>
                {nameLayer}
              </>
            )}
          </div>
        </div>
      </GameFrame.Board>

      {/* Autocomplete Input and Confirm Button */}
      <GameFrame.Action>
        <GameFrame.InputRow>
          <AutocompleteInput
            placeholder="Guess the Team..."
            value={guess}
            setValue={setGuess}
            suggestions={allTeams}
            onSubmit={handleGuessSubmit}
            customStyleInput={{ width: "100%" }}
          />

          <Button
            size="md"
            onClick={() => {
              if (guess.trim() !== "") {
                handleGuessSubmit(guess);
              }
            }}
            disabled={guess.trim() === ""}
          >
            Confirm
          </Button>
        </GameFrame.InputRow>
      </GameFrame.Action>

      <SubmitGuessPopup
        show={showPointsAnimation || showAnswer}
        text={showAnswer ? `It was the ${currentTeam?.full_name || "Unknown"}` : `Correct! +${pointsPerCorrect}`}
        color={showAnswer ? "var(--bad)" : "var(--good)"}
      />
    </GameFrame>
  );
}

export default NameLogo;
