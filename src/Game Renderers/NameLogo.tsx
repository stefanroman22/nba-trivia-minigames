import { useState, useEffect, useMemo } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import AutocompleteInput from "../components/AutoCompleteInput";
import SubmitGuessPopup from "../components/SubmitGuessPopUp";
import ProgressBar from "../components/ui/ProgressBar";
import { Button, GameFrame, Spinner } from "../components/ui";
import TeamCrest from "../components/ui/TeamCrest";
import { currentLogoUrl } from "../constants/teamLogos";
import type { NbaTeamLogo, OnGameEnd } from "../types/types";
import "../styles/NameLogo.css";

interface NameLogoProps {
  seriesList: NbaTeamLogo[];
  pointsPerCorrect: number;
  onGameEnd: OnGameEnd;
  allTeams: string[];
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

  // Logo sources tried in order: period-accurate (from the data) → current logo.
  const logoCandidates = useMemo(() => {
    const list: string[] = [];
    if (currentTeam?.logo) list.push(currentTeam.logo);
    const cur = currentLogoUrl(currentTeam?.full_name);
    if (cur && cur !== currentTeam?.logo) list.push(cur);
    return list;
  }, [currentTeam]);
  const [srcIdx, setSrcIdx] = useState(0);

  // reset the logo source + loader each round (and on each candidate switch)
  useEffect(() => { setSrcIdx(0); }, [currentIndex]);
  useEffect(() => setImgLoaded(false), [currentIndex, srcIdx]);

  const handleGuessSubmit = (teamName: string) => {
    if (!teamName || typeof teamName !== "string" || teamName.trim() === "") {
      return; // don't run if no valid team
    }

    const isCorrect =
      teamName.trim().toLowerCase() === (currentTeam?.full_name || "").toLowerCase();

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
        left={<GameFrame.Label>ROUND <span className="tnum">{currentIndex + 1}/{seriesList.length}</span></GameFrame.Label>}
        right={<GameFrame.Score value={score} />}
      />
      <ProgressBar value={currentIndex + (showAnswer || showPointsAnimation ? 1 : 0)} max={seriesList.length} />

      <GameFrame.Board>
      <AnimatePresence mode="wait">
        <motion.div
          key={currentIndex}
          initial={reduce ? false : { opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={reduce ? undefined : { opacity: 0, y: -10 }}
          transition={{ duration: 0.25 }}
          style={{ width: "100%", display: "flex", flexDirection: "column", gap: 18 }}
        >
          <GameFrame.Prompt eyebrow="GUESS THE TEAM" title="Which franchise is this?" />

          {/* Logo */}
          <div style={{ position: "relative", display: "flex", justifyContent: "center", minHeight: "clamp(84px, 17dvh, 140px)", alignItems: "center" }}>
            {logoCandidates[srcIdx] ? (
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
                  <motion.img
                    key={`${currentTeam?.full_name}-${srcIdx}`}
                    src={logoCandidates[srcIdx]}
                    alt="NBA Team"
                    ref={(el) => { if (el?.complete && el.naturalWidth > 0) setImgLoaded(true); }}
                    onLoad={() => setImgLoaded(true)}
                    onError={() => setSrcIdx((i) => i + 1)}
                    initial={reduce ? false : { opacity: 0, scale: 0.8, y: 10 }}
                    animate={{ opacity: imgLoaded ? (showAnswer ? 0.4 : 1) : 0, scale: 1, y: 0 }}
                    exit={reduce ? undefined : { opacity: 0, scale: 0.85 }}
                    transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
                    style={{
                      display: "block",
                      width: "clamp(92px, 18dvh, 140px)",
                      height: "auto",
                      maxHeight: "20dvh",
                      objectFit: "contain",
                      filter: showAnswer ? "grayscale(100%)" : "none",
                    }}
                  />
                </AnimatePresence>
              </>
            ) : (
              <TeamCrest src={null} name={currentTeam?.full_name || ""} size={120} style={{ filter: showAnswer ? "grayscale(100%)" : "none", opacity: showAnswer ? 0.5 : 1 }} />
            )}
          </div>
        </motion.div>
      </AnimatePresence>
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
