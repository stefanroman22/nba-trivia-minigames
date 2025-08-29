import React, { useState } from "react";
import PropTypes from "prop-types";
import SubmitGuessPopup from "../components/SubmitGuessPopUp";

function PlayOffSeries({
  seriesList,
  pointsPerCorrect,
  buttonTeamStyle,
  nbaTeamColors,
  getContrastColor,
  onGameEnd, 
}) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [selectedTeam, setSelectedTeam] = useState(null);
  const [showWinner, setShowWinner] = useState(false);
  const [showPointsAnimation, setShowPointsAnimation] = useState(false);
  const [score, setScore] = useState(0);
  const currentSeries = seriesList[currentIndex];

  const handlePickWinner = (picked) => {
    setSelectedTeam(picked);
    setShowWinner(true);

    const isCorrect = picked === currentSeries.winner;
    if (isCorrect) {
      setScore((prev) => prev + pointsPerCorrect);
      setShowPointsAnimation(true);
    }

    setTimeout(() => {
      setShowPointsAnimation(false);
      setShowWinner(false);
      setSelectedTeam(null);

      if (currentIndex < seriesList.length - 1) {
        setCurrentIndex((prev) => prev + 1);
      } else {
        // Tournament complete
        if (onGameEnd) onGameEnd(score + (isCorrect ? pointsPerCorrect : 0));
      }
    }, 1800);
  };

  if (!currentSeries) return null;

  return (
    <div style={{ marginTop: "2rem" }}>
      <div
        style={{
          marginBottom: "1.5rem",
          padding: "1rem",
          borderRadius: "10px",
          textAlign: "center",
        }}
      >
        {/* Teams & Score */}
        <div style={{ display: "flex", justifyContent: "center", gap: "1rem" }}>
          {/* Team A */}
          <div style={{ textAlign: "center" }}>
            <img
              src={currentSeries.team_a_logo}
              width="150"
              alt={currentSeries.team_a}
              style={{
                filter:
                  showWinner && currentSeries.team_a !== currentSeries.winner
                    ? "grayscale(100%)"
                    : "none",
                opacity:
                  showWinner && currentSeries.team_a !== currentSeries.winner
                    ? 0.4
                    : 1,
                transition: "all 1s ease-in-out",
              }}
            />
            <p style={{ color: "#fff", marginTop: "0.5rem", fontWeight: "bold" }}>
              {currentSeries.team_a}
            </p>
          </div>

          {/* VS or Score */}
          <span
            style={{
              marginTop: "4rem",
              fontWeight: "bold",
              color:
                selectedTeam != null
                  ? selectedTeam === currentSeries.winner
                    ? "limegreen"
                    : "#C8102E"
                  : "white",
              fontSize: "1.25rem",
              display: "inline-block",
              width: "60px",
              textAlign: "center",
              transition: "all 0.5s ease-in-out",
            }}
          >
            {showWinner
              ? `${currentSeries.team_a_wins}:${currentSeries.team_b_wins}`
              : "vs"}
          </span>

          {/* Team B */}
          <div style={{ textAlign: "center" }}>
            <img
              src={currentSeries.team_b_logo}
              width="150"
              alt={currentSeries.team_b}
              style={{
                filter:
                  showWinner && currentSeries.team_b !== currentSeries.winner
                    ? "grayscale(100%)"
                    : "none",
                opacity:
                  showWinner && currentSeries.team_b !== currentSeries.winner
                    ? 0.4
                    : 1,
                transition: "all 1s ease-in-out",
              }}
            />
            <p style={{ color: "#fff", marginTop: "0.5rem", fontWeight: "bold" }}>
              {currentSeries.team_b}
            </p>
          </div>
        </div>

        {/* Round & Season */}
        <p style={{ fontWeight: "bold", marginTop: "0.5rem" }}>
          {currentSeries.round}
          <br />
          {currentSeries.season}
        </p>

        {/* Buttons */}
        <div
  style={{
    marginTop: "1rem",
    display: "flex",
    justifyContent: "space-between", // spreads buttons evenly
    gap: "2vw", // responsive spacing based on viewport width
    flexWrap: "wrap", // allows wrapping on very small screens
  }}
>
  <button
    className="scaling-button"
    onClick={() => handlePickWinner(currentSeries.team_a)}
    disabled={showWinner}
    style={{
      ...buttonTeamStyle,
      flex: "1",        // lets button grow/shrink
      minWidth: "120px", // prevents too small buttons
      backgroundColor:
        showWinner && currentSeries.team_a !== currentSeries.winner
          ? "#999"
          : nbaTeamColors[currentSeries.team_a]?.primary || "#ccc",
      color:
        showWinner && currentSeries.team_a !== currentSeries.winner
          ? "#fff"
          : getContrastColor(nbaTeamColors[currentSeries.team_a]?.primary),
      opacity: showWinner && currentSeries.team_a !== currentSeries.winner ? 0.5 : 1,
      cursor: showWinner ? "default" : "pointer",
    }}
  >
    {currentSeries.team_a}
  </button>

  <button
    className="scaling-button"
    onClick={() => handlePickWinner(currentSeries.team_b)}
    disabled={showWinner}
    style={{
      ...buttonTeamStyle,
      flex: "1",
      minWidth: "120px",
      backgroundColor:
        showWinner && currentSeries.team_b !== currentSeries.winner
          ? "#999"
          : nbaTeamColors[currentSeries.team_b]?.primary || "#ccc",
      color:
        showWinner && currentSeries.team_b !== currentSeries.winner
          ? "#fff"
          : getContrastColor(nbaTeamColors[currentSeries.team_b]?.primary),
      opacity: showWinner && currentSeries.team_b !== currentSeries.winner ? 0.5 : 1,
      cursor: showWinner ? "default" : "pointer",
    }}
  >
    {currentSeries.team_b}
  </button>
  </div>
      </div>
      {/* Points Animation */}
          {showPointsAnimation && (
            <SubmitGuessPopup text={`+${pointsPerCorrect}`} color={"#25a602ff"} />
          )}
    </div>
  );
}

PlayOffSeries.propTypes = {
  seriesList: PropTypes.array.isRequired,
  pointsPerCorrect: PropTypes.number.isRequired,
  buttonTeamStyle: PropTypes.object.isRequired,
  nbaTeamColors: PropTypes.object.isRequired,
  getContrastColor: PropTypes.func.isRequired,
  onGameEnd: PropTypes.func,
};

export default PlayOffSeries;
