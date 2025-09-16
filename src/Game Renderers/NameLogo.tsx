import React, { useState } from "react";
import PropTypes from "prop-types";
import { handleMouseEnter, handleMouseLeave } from "../constants/styles";
import AutocompleteInput from "../components/AutoCompleteInput";
import CorrectAnswer from "../components/CorrectAnswer";
import SubmitGuessPopup from "../components/SubmitGuessPopUp";
import "../styles/NameLogo.css";

function NameLogo({ seriesList, pointsPerCorrect, onGameEnd, allTeams }) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [guess, setGuess] = useState("");
  const [suggestions, setSuggestions] = useState([]);
  const [showAnswer, setShowAnswer] = useState(false);
  const [showPointsAnimation, setShowPointsAnimation] = useState(false);
  const [score, setScore] = useState(0);

  const currentTeam = seriesList[currentIndex];

  const handleGuessSubmit = (teamName) => {
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


  const moveToNext = (wasCorrect) => {
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
      <div style={{ textAlign: "center", marginTop: "2rem", position: "relative" }}>
        {/* Logo */}
        <img
          key={currentTeam?.full_name}
          src={currentTeam.logo}
          alt="NBA Team"
          width="180"
          style={{
            filter:
              showAnswer && guess.toLowerCase() !== (currentTeam?.name || "").toLowerCase()
                ? "grayscale(100%)"
                : "",
            opacity: showAnswer && guess.toLowerCase() !== (currentTeam?.name || "").toLowerCase() ? 0.4 : 1,
            transition: "opacity 0.5s ease-in-out, filter 1s ease-in-out",
          }}
        />

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
            className="confirm-button"
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
        {showAnswer && (<CorrectAnswer label="answer" value={currentTeam?.full_name || "Unknown"} />)}
      </div>
      {showPointsAnimation && (<SubmitGuessPopup text={`+${pointsPerCorrect}`} color={"#25a602ff"} />)}
    </>
  );
}

NameLogo.propTypes = {
  seriesList: PropTypes.array.isRequired, // [{ name, logo }]
  pointsPerCorrect: PropTypes.number.isRequired,
  onGameEnd: PropTypes.func,
  allTeams: PropTypes.array.isRequired // ["Boston Celtics", "LA Lakers", ...]
};

export default NameLogo;