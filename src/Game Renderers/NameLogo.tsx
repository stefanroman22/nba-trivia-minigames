import { useState, useEffect, useMemo } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import SwapText from "../components/motion/SwapText";
import AutocompleteInput from "../components/AutoCompleteInput";
import SubmitGuessPopup from "../components/SubmitGuessPopUp";
import ProgressBar from "../components/ui/ProgressBar";
import { Button, GameFrame, Spinner } from "../components/ui";
import TeamCrest from "../components/ui/TeamCrest";
import { currentLogoUrl, scrambledLogoUrl } from "../constants/teamLogos";
import { matchAnswer } from "../utils/answerMatch";
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
// Reveal: a pure cross-fade, scrambled out and real in. Opacity only: the slot and both images keep
// their size (scrambled files are generated at their real logo's footprint), so nothing grows or shrinks.
const LOGO_SHOWN = { opacity: 1 };
const LOGO_HIDDEN = { opacity: 0 };
const LOGO_REVEAL = { duration: 0.6, ease: [0.4, 0, 0.2, 1] as const };

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

  // Logo sources tried in order: period-accurate (from the data) → current logo.
  const logoCandidates = useMemo(() => {
    const list: string[] = [];
    if (currentTeam?.logo) list.push(currentTeam.logo);
    const cur = currentLogoUrl(currentTeam?.full_name);
    if (cur && cur !== currentTeam?.logo) list.push(cur);
    return list;
  }, [currentTeam]);
  const [srcIdx, setSrcIdx] = useState(0);
  const [scrambleFailed, setScrambleFailed] = useState(false);

  // While guessing only the scrambled logo is shown; the real one waits underneath (preloaded) and
  // cross-fades in once the guess is in. Without a scrambled file, the real logo is the puzzle.
  const scrambledSrc = scrambleFailed ? null : scrambledLogoUrl(currentTeam?.team_id, currentTeam?.full_name);
  const originalSrc = logoCandidates[srcIdx];
  const puzzleSrc = scrambledSrc ?? originalSrc;
  const revealed = showAnswer || showPointsAnimation;

  // reset the logo sources + loader each round (and whenever the puzzle image changes)
  useEffect(() => { setSrcIdx(0); setScrambleFailed(false); }, [currentIndex]);
  useEffect(() => setImgLoaded(false), [currentIndex, puzzleSrc]);

  const handleGuessSubmit = (teamName: string) => {
    if (!teamName || typeof teamName !== "string" || teamName.trim() === "") {
      return; // don't run if no valid team
    }

    const isCorrect =
      matchAnswer(teamName, [{ answer: currentTeam?.full_name || "" }]) === 0;

    if (isCorrect) {
      setScore((prev) => prev + pointsPerCorrect);
      setShowPointsAnimation(true);
      setTimeout(() => {
        moveToNext(true);
      }, 1500);
    } else {
      setShowAnswer(true);
      setTimeout(() => {
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
      setCurrentIndex((prev) => prev + 1);
    } else {
      if (onGameEnd) onGameEnd(score + (wasCorrect ? pointsPerCorrect : 0));
    }
  };

  if (!currentTeam) return null;


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

          {/* Logo: the scrambled mark is the puzzle; on reveal the real logo cross-fades in over it */}
          <div style={{ position: "relative", display: "flex", justifyContent: "center", height: LOGO_SIZE, alignItems: "center" }}>
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
                      src={puzzleSrc}
                      alt={scrambledSrc ? "Scrambled team logo" : "NBA Team"}
                      ref={(el) => { if (el?.complete && el.naturalWidth > 0) setImgLoaded(true); }}
                      onLoad={() => setImgLoaded(true)}
                      onError={() => (scrambledSrc ? setScrambleFailed(true) : setSrcIdx((i) => i + 1))}
                      initial={false}
                      animate={revealed && scrambledSrc ? LOGO_HIDDEN : LOGO_SHOWN}
                      transition={LOGO_REVEAL}
                      style={LOGO_IMG}
                    />
                    {scrambledSrc && (
                      <motion.div
                        aria-hidden={!revealed}
                        initial={false}
                        animate={revealed ? LOGO_SHOWN : LOGO_HIDDEN}
                        transition={LOGO_REVEAL}
                        style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center" }}
                      >
                        {originalSrc ? (
                          <img
                            src={originalSrc}
                            alt={revealed ? `${currentTeam?.full_name} logo` : ""}
                            onError={() => setSrcIdx((i) => i + 1)}
                            style={LOGO_IMG}
                          />
                        ) : (
                          <TeamCrest src={null} name={currentTeam?.full_name || ""} size={120} />
                        )}
                      </motion.div>
                    )}
                  </motion.div>
                </AnimatePresence>
              </>
            ) : (
              <TeamCrest src={null} name={currentTeam?.full_name || ""} size={120} style={{ filter: showAnswer ? "grayscale(100%)" : "none", opacity: showAnswer ? 0.5 : 1 }} />
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
