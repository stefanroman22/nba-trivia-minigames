import { useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { handleMouseEnter, handleMouseLeave } from "../constants/styles";
import AutocompleteInput from "../components/AutoCompleteInput";
import CorrectAnswer from "../components/CorrectAnswer";
import SubmitGuessPopup from "../components/SubmitGuessPopUp";
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
  const reduce = useReducedMotion();

  const currentTeam = seriesList[currentIndex];

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
    <>
      <div className="game-box" style={{ textAlign: "center", marginTop: "2rem", position: "relative" }}>
        {/* Logo */}
        <AnimatePresence mode="wait">
          <motion.img
            key={currentTeam?.full_name}
            src={currentTeam.logo}
            alt="NBA Team"
            initial={reduce ? false : { opacity: 0, scale: 0.8, y: 10 }}
            animate={{ opacity: showAnswer ? 0.4 : 1, scale: 1, y: 0 }}
            exit={reduce ? undefined : { opacity: 0, scale: 0.85 }}
            transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
            style={{
              display: "block",
              margin: "0 auto",
              width: "clamp(120px, 40vw, 180px)",
              height: "auto",
              filter: showAnswer ? "grayscale(100%)" : "none",
            }}
          />
        </AnimatePresence>


        {/* Autocomplete Input and Confirm Button */}
        <div className="guess-container">
          <AutocompleteInput
            placeholder="Guess the Team..."
            value={guess}
            setValue={setGuess}
            suggestions={allTeams}
            onSubmit={handleGuessSubmit}
          />

          <button
            className="confirm-button text-sm"
            onClick={() => {
              if (guess.trim() !== "") {
                handleGuessSubmit(guess);
              }
            }}
            onMouseEnter={handleMouseEnter}
            onMouseLeave={handleMouseLeave}
            disabled={guess.trim() === ""}
          >
            Confirm
          </button>
        </div>
        <CorrectAnswer label="answer" value={showAnswer ? (currentTeam?.full_name || "Unknown") : undefined} />
      </div>
      <SubmitGuessPopup show={showPointsAnimation} text={`+${pointsPerCorrect}`} color={"#25a602"} />
    </>
  );
}

export default NameLogo;
