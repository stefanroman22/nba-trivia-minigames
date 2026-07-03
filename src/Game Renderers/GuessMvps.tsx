import { useState, useEffect } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import AutocompleteInput from "../components/AutoCompleteInput";
import CorrectAnswer from "../components/CorrectAnswer";
import SubmitGuessPopup from "../components/SubmitGuessPopUp";
import ProgressBar from "../components/ui/ProgressBar";
import { Button } from "../components/ui";
import { BACKEND_ORIGIN } from "../configurations/backend";
import type { MvpSeason, OnGameEnd } from "../types/types";
import "../styles/NameLogo.css";

interface GuessMvpsProps {
  seasonsList: MvpSeason[];
  pointsPerCorrect: number;
  onGameEnd: OnGameEnd;
}

function GuessMvps({ seasonsList, pointsPerCorrect, onGameEnd }: GuessMvpsProps) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [guess, setGuess] = useState("");
  const [showAnswer, setShowAnswer] = useState(false);
  const [showPointsAnimation, setShowPointsAnimation] = useState(false);
  const [score, setScore] = useState(0);
  const [allPlayers, setAllPlayers] = useState([]);
  const [playersError, setPlayersError] = useState(false);
  const reduce = useReducedMotion();

  const currentSeason = seasonsList[currentIndex];

  useEffect(() => {
    fetch(`${BACKEND_ORIGIN}/trivia/all-players/`)
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((data) => {
        if (data.players) setAllPlayers(data.players);
      })
      .catch((err) => {
        console.error("Failed to fetch players:", err);
        setPlayersError(true);
      });
  }, []);


  const handleGuessSubmit = (playerName : string) => {
  if (!playerName || typeof playerName !== "string" || playerName.trim() === "") {
    return; // don't run if no valid team
  }

  const isCorrect =
    playerName.trim().toLowerCase() === (currentSeason?.mvp || "").toLowerCase();

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


  const moveToNext = (wasCorrect : boolean) => {
    setShowPointsAnimation(false);
    setShowAnswer(false);
    setGuess("");

    if (currentIndex < seasonsList.length - 1) {
      setCurrentIndex((prev) => prev + 1);
    } else {
      if (onGameEnd) onGameEnd(score + (wasCorrect ? pointsPerCorrect : 0));
    }
  };

  if (!currentSeason) return null;


  return (
    <div style={{ position: "relative", width: "100%", maxWidth: 560, display: "flex", flexDirection: "column", gap: "clamp(10px, 2.2dvh, 20px)" }}>
      {/* progress + score */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 14 }}>
        <span style={{ fontSize: 11, letterSpacing: 1, color: "var(--muted)", fontWeight: 600 }}>
          ROUND {currentIndex + 1}/{seasonsList.length}
        </span>
        <span style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, fontWeight: 700 }}>
          <span style={{ color: "var(--muted)", fontWeight: 500, fontSize: 11, letterSpacing: 0.5 }}>SCORE</span>
          <span className="tnum" style={{ color: "var(--brand)", fontSize: 16 }}>{score}</span>
        </span>
      </div>
      <ProgressBar value={currentIndex + (showAnswer || showPointsAnimation ? 1 : 0)} max={seasonsList.length} />

      <div style={{ display: "flex", flexDirection: "column", gap: 8, alignItems: "center", textAlign: "center" }}>
        <span style={{ fontSize: 11, letterSpacing: 1.5, color: "var(--brand)", fontWeight: 600 }}>WHO WON MVP?</span>
        <AnimatePresence mode="wait">
          <motion.span
            key={currentSeason.season}
            className="font-display"
            initial={reduce ? false : { opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={reduce ? undefined : { opacity: 0, y: -12 }}
            transition={{ duration: 0.3 }}
            style={{ fontWeight: 800, fontSize: 30, color: "var(--text)", display: "inline-block" }}
          >
            {currentSeason.season}
          </motion.span>
        </AnimatePresence>
      </div>

      {/* Autocomplete Input and Confirm Button */}
      <div className="guess-container">
        <AutocompleteInput
          placeholder="Guess the Player..."
          value={guess}
          setValue={setGuess}
          suggestions={allPlayers}
          onSubmit={handleGuessSubmit}
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
      </div>

      {playersError && (
        <p style={{ color: "var(--brand)", fontSize: "0.8rem", textAlign: "center" }}>
          Couldn't load player suggestions — you can still type a name and submit.
        </p>
      )}

      <div style={{ minHeight: 34, display: "flex", justifyContent: "center" }}>
        <CorrectAnswer label="answer" value={showAnswer ? (currentSeason?.mvp || "Unknown") : undefined} />
      </div>

      <SubmitGuessPopup show={showPointsAnimation} text={`Correct! +${pointsPerCorrect}`} color={"var(--good)"} />
    </div>
  );
}

export default GuessMvps;
