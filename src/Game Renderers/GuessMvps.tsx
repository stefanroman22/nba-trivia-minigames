import { useState, useEffect } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import AutocompleteInput from "../components/AutoCompleteInput";
import SubmitGuessPopup from "../components/SubmitGuessPopUp";
import ProgressBar from "../components/ui/ProgressBar";
import { Button, GameFrame } from "../components/ui";
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
    <GameFrame>
      <GameFrame.Status
        left={<GameFrame.Label>ROUND <span className="tnum">{currentIndex + 1}/{seasonsList.length}</span></GameFrame.Label>}
        right={<GameFrame.Score value={score} />}
      />
      <ProgressBar value={currentIndex + (showAnswer || showPointsAnimation ? 1 : 0)} max={seasonsList.length} />

      <GameFrame.Board>
      <AnimatePresence mode="wait">
        <motion.div
          key={currentIndex}
          initial={reduce ? false : { opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={reduce ? undefined : { opacity: 0, y: -10 }}
          transition={{ duration: 0.25 }}
          style={{ width: "100%" }}
        >
          <GameFrame.Prompt
            eyebrow={<span className="tnum">{currentSeason.season}</span>}
            title="Who won MVP?"
          />
        </motion.div>
      </AnimatePresence>
      </GameFrame.Board>

      {/* Autocomplete Input and Confirm Button */}
      <GameFrame.Action>
        <GameFrame.InputRow>
          <AutocompleteInput
            placeholder="Guess the Player..."
            value={guess}
            setValue={setGuess}
            suggestions={allPlayers}
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

        {playersError && (
          <p style={{ color: "var(--brand)", fontSize: "0.8rem", textAlign: "center" }}>
            Couldn't load player suggestions — you can still type a name and submit.
          </p>
        )}
      </GameFrame.Action>

      <SubmitGuessPopup
        show={showPointsAnimation || showAnswer}
        text={showAnswer ? `It was ${currentSeason?.mvp || "Unknown"}` : `Correct! +${pointsPerCorrect}`}
        color={showAnswer ? "var(--bad)" : "var(--good)"}
      />
    </GameFrame>
  );
}

export default GuessMvps;
