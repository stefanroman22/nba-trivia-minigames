import { useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import SubmitGuessPopup from "../components/SubmitGuessPopUp";
import { swap } from "../motion/variants";
import type { PlayoffSeries, OnGameEnd } from "../types/types";
import type { TeamColor } from "../constants/nbaTeamColors";

interface PlayOffSeriesProps {
  seriesList: PlayoffSeries[];
  pointsPerCorrect: number;
  buttonTeamStyle: CSSProperties;
  nbaTeamColors: Record<string, TeamColor>;
  getContrastColor: (hex: string) => string;
  onGameEnd: OnGameEnd;
}

function PlayOffSeries({
  seriesList,
  pointsPerCorrect,
  buttonTeamStyle,
  nbaTeamColors,
  getContrastColor,
  onGameEnd,
}: PlayOffSeriesProps) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [selectedTeam, setSelectedTeam] = useState<string | null>(null);
  const [showWinner, setShowWinner] = useState(false);
  const [showPointsAnimation, setShowPointsAnimation] = useState(false);
  const [score, setScore] = useState(0);
  const currentSeries = seriesList[currentIndex];
  const reduce = useReducedMotion();
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Avoid setState/onGameEnd firing on an unmounted component
  useEffect(() => () => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
  }, []);

  const handlePickWinner = (picked: string) => {
    if (showWinner) return; // re-entrancy guard against rapid double-clicks

    setSelectedTeam(picked);
    setShowWinner(true);

    const isCorrect = picked === currentSeries.winner;
    if (isCorrect) {
      setScore((prev) => prev + pointsPerCorrect);
      setShowPointsAnimation(true);
    }

    timeoutRef.current = setTimeout(() => {
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

  const logoStyle = (teamName: string): CSSProperties => ({
    width: "clamp(84px, 26vw, 150px)",
    height: "auto",
    filter: showWinner && teamName !== currentSeries.winner ? "grayscale(100%)" : "none",
    opacity: showWinner && teamName !== currentSeries.winner ? 0.4 : 1,
    transition: "all 0.8s ease-in-out",
  });

  return (
    <div style={{ marginTop: "2rem", width: "100%" }}>
      <AnimatePresence mode="wait">
        <motion.div
          key={currentIndex}
          variants={swap}
          initial="hidden"
          animate="visible"
          exit="exit"
          style={{
            marginBottom: "1.5rem",
            padding: "1rem",
            borderRadius: "10px",
            textAlign: "center",
          }}
        >
          {/* Teams & Score */}
          <div style={{ display: "flex", justifyContent: "center", alignItems: "flex-start", gap: "1rem", flexWrap: "nowrap" }}>
            {/* Team A */}
            <div style={{ textAlign: "center", flex: "0 1 auto" }}>
              <motion.img
                src={currentSeries.team_a_logo}
                alt={currentSeries.team_a}
                style={logoStyle(currentSeries.team_a)}
                animate={!reduce && showWinner && currentSeries.team_a === currentSeries.winner ? { scale: [1, 1.12, 1] } : { scale: 1 }}
                transition={{ duration: 0.5 }}
              />
              <p style={{ color: "#fff", marginTop: "0.5rem", fontWeight: "bold" }}>
                {currentSeries.team_a}
              </p>
            </div>

            {/* VS or Score */}
            <motion.span
              key={showWinner ? "score" : "vs"}
              className="font-display tnum"
              animate={!reduce ? { scale: showWinner ? [1, 1.3, 1] : 1 } : undefined}
              transition={{ duration: 0.45 }}
              style={{
                marginTop: "3rem",
                fontWeight: "bold",
                color:
                  selectedTeam != null
                    ? selectedTeam === currentSeries.winner
                      ? "limegreen"
                      : "#ff5a5a"
                    : "white",
                fontSize: "1.4rem",
                display: "inline-block",
                minWidth: "60px",
                textAlign: "center",
              }}
            >
              {showWinner
                ? `${currentSeries.team_a_wins}:${currentSeries.team_b_wins}`
                : "vs"}
            </motion.span>

            {/* Team B */}
            <div style={{ textAlign: "center", flex: "0 1 auto" }}>
              <motion.img
                src={currentSeries.team_b_logo}
                alt={currentSeries.team_b}
                style={logoStyle(currentSeries.team_b)}
                animate={!reduce && showWinner && currentSeries.team_b === currentSeries.winner ? { scale: [1, 1.12, 1] } : { scale: 1 }}
                transition={{ duration: 0.5 }}
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
              justifyContent: "center",
              gap: "1rem",
              flexWrap: "wrap",
            }}
            className="flex flex-col gap-2 sm:flex-row"
          >
            {[currentSeries.team_a, currentSeries.team_b].map((team) => (
              <motion.button
                key={team}
                onClick={() => handlePickWinner(team)}
                disabled={showWinner}
                whileHover={!reduce && !showWinner ? { scale: 1.04 } : undefined}
                whileTap={!reduce && !showWinner ? { scale: 0.96 } : undefined}
                style={{
                  ...buttonTeamStyle,
                  flex: "1 1 140px",
                  minWidth: "120px",
                  maxWidth: "260px",
                  minHeight: "44px",
                  cursor: showWinner ? "default" : "pointer",
                  backgroundColor:
                    showWinner && team !== currentSeries.winner
                      ? "#999"
                      : nbaTeamColors[team]?.primary || "#ccc",
                  color:
                    showWinner && team !== currentSeries.winner
                      ? "#fff"
                      : getContrastColor(nbaTeamColors[team]?.primary || "#ccc"),
                  opacity: showWinner && team !== currentSeries.winner ? 0.5 : 1,
                  transition: "background-color 0.4s ease, opacity 0.4s ease",
                }}
              >
                {team}
              </motion.button>
            ))}
          </div>
        </motion.div>
      </AnimatePresence>

      {/* Points Animation */}
      <SubmitGuessPopup show={showPointsAnimation} text={`+${pointsPerCorrect}`} color={"#25a602"} />
    </div>
  );
}

export default PlayOffSeries;
