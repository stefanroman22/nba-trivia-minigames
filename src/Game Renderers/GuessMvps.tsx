import { useState, useEffect } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import AutocompleteInput from "../components/AutoCompleteInput";
import { handleMouseEnter, handleMouseLeave } from "../constants/styles";
import CorrectAnswer from "../components/CorrectAnswer";
import SubmitGuessPopup from "../components/SubmitGuessPopUp";
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
    <>
    <div style={{ textAlign: "center", marginTop: "2rem", position: "relative", width: "100%" }}>
      <h2 style={{ color: "#cfc9c9", marginBottom: "1.5rem" }}>
          Season:{" "}
          <AnimatePresence mode="wait">
            <motion.span
              key={currentSeason.season}
              className="font-display"
              initial={reduce ? false : { opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={reduce ? undefined : { opacity: 0, y: -12 }}
              transition={{ duration: 0.3 }}
              style={{ fontWeight: "800", color: "#ff9d3c", display: "inline-block" }}
            >
              {currentSeason.season}
            </motion.span>
          </AnimatePresence>
      </h2>

      {/* Autocomplete Input and Confirm Button */}
      <div className="guess-container">

          <AutocompleteInput
            placeholder="Guess the Player..."
            value={guess}
            setValue={setGuess}
            suggestions={allPlayers}
            onSubmit={handleGuessSubmit}
          />

        <button className="confirm-button"

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
      {playersError && (
        <p style={{ color: "#ff9d3c", fontSize: "0.8rem", marginTop: "0.5rem" }}>
          Couldn't load player suggestions — you can still type a name and submit.
        </p>
      )}
      {/* Show correct player on wrong guess */}
      <CorrectAnswer label="answer" value={showAnswer ? (currentSeason?.mvp || "Unknown") : undefined} />
    </div>
    <SubmitGuessPopup show={showPointsAnimation} text={`+${pointsPerCorrect}`} color={"#25a602"} />
    </>
  );
}

export default GuessMvps;
