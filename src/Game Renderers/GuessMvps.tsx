import React, { useState, useEffect } from "react";
import PropTypes from "prop-types";
import { buttonStyle } from "../constants/styles"; 
import AutocompleteInput from "../components/AutoCompleteInput";
import { handleMouseEnter, handleMouseLeave } from "../constants/styles";
import CorrectAnswer from "../components/CorrectAnswer";
import SubmitGuessPopup from "../components/SubmitGuessPopUp";

function GuessMvps({ seasonsList, pointsPerCorrect, onGameEnd}) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [guess, setGuess] = useState("");
  const [showAnswer, setShowAnswer] = useState(false);
  const [showPointsAnimation, setShowPointsAnimation] = useState(false);
  const [score, setScore] = useState(0);
  const [allPlayers, setAllPlayers] = useState([]);

  const currentSeason = seasonsList[currentIndex];

  useEffect(() => {
    fetch("http://127.0.0.1:8000/trivia/all-players/")
      .then((res) => res.json())
      .then((data) => {
        if (data.players) setAllPlayers(data.players);
      })
      .catch((err) => console.error("Failed to fetch players:", err));
  }, []);


  const handleGuessSubmit = (playerName : String) => {
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
    <div style={{ textAlign: "center", marginTop: "2rem", position: "relative" }}>
      {/* Logo */}
      <h2 style={{ color: "#b1a9a9ff", marginBottom: "1.5rem" }}>
          Season: <span style={{ fontWeight: "800" }}>{currentSeason.season}</span>
      </h2>

      {/* Autocomplete Input and Confirm Button */}
      <div style={{ marginTop: "1.5rem", position: "relative", display: "flex", justifyContent: "center", alignItems: "center", gap: "30px"}}>
        
          <AutocompleteInput
            placeholder="Guess the Player..."
            value={guess}
            setValue={setGuess}
            suggestions={allPlayers}
            onSubmit={handleGuessSubmit}
          />

        <button
          style={{marginLeft: "10px", ...buttonStyle}}
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
      {/* Show correct team on wrong guess */}
      {showAnswer && ( <CorrectAnswer label="answer" value={currentSeason?.mvp || "Unknown"} />)}
    </div>
    {showPointsAnimation && (
          <SubmitGuessPopup text={`+${pointsPerCorrect}`} color={"#25a602ff"}/>
      )}
    </>
  );
}

GuessMvps.propTypes = {
  seasonsList: PropTypes.array.isRequired, // [{ season, player, team, team_logo_url}]
  pointsPerCorrect: PropTypes.number.isRequired,
  onGameEnd: PropTypes.func,
};

export default GuessMvps;