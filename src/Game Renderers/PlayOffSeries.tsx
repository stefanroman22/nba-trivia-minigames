import { useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import SubmitGuessPopup from "../components/SubmitGuessPopUp";
import ProgressBar from "../components/ui/ProgressBar";
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
  nbaTeamColors,
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

  useEffect(() => () => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
  }, []);

  const handlePickWinner = (picked: string) => {
    if (showWinner) return;
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
      } else if (onGameEnd) {
        onGameEnd(score + (isCorrect ? pointsPerCorrect : 0));
      }
    }, 1800);
  };

  if (!currentSeries) return null;

  const teams = [
    { name: currentSeries.team_a, logo: currentSeries.team_a_logo, wins: currentSeries.team_a_wins },
    { name: currentSeries.team_b, logo: currentSeries.team_b_logo, wins: currentSeries.team_b_wins },
  ];

  const pickStyle = (teamName: string): CSSProperties => {
    const isWinner = teamName === currentSeries.winner;
    const isPicked = selectedTeam === teamName;
    let border = "var(--line2)";
    let background = "var(--surface2)";
    if (showWinner) {
      if (isWinner) { border = "var(--good)"; background = "var(--good-soft)"; }
      else if (isPicked) { border = "var(--bad)"; background = "var(--bad-soft)"; }
    }
    return {
      display: "flex", flexDirection: "column", alignItems: "center", gap: 10,
      padding: "18px 14px", borderRadius: 14, border: `1px solid ${border}`,
      background, cursor: showWinner ? "default" : "pointer", minHeight: 44,
      transition: "background 0.35s ease, border-color 0.35s ease, opacity 0.35s ease",
      opacity: showWinner && !isWinner && !isPicked ? 0.55 : 1,
    };
  };

  const feedback = !showWinner
    ? null
    : selectedTeam === currentSeries.winner
      ? { text: `Correct! +${pointsPerCorrect}`, color: "var(--good)" }
      : { text: `It was the ${currentSeries.winner}`, color: "var(--bad)" };

  return (
    <div style={{ width: "100%", maxWidth: 560, display: "flex", flexDirection: "column", gap: 20 }}>
      {/* progress + score */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 14 }}>
        <span style={{ fontSize: 11, letterSpacing: 1, color: "var(--muted)", fontWeight: 600 }}>
          ROUND {currentIndex + 1}/{seriesList.length}
        </span>
        <span style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, fontWeight: 700 }}>
          <span style={{ color: "var(--muted)", fontWeight: 500, fontSize: 11, letterSpacing: 0.5 }}>SCORE</span>
          <span className="tnum" style={{ color: "var(--brand)", fontSize: 16 }}>{score}</span>
        </span>
      </div>
      <ProgressBar value={currentIndex + (showWinner ? 1 : 0)} max={seriesList.length} />

      {/* round header */}
      <AnimatePresence mode="wait">
        <motion.div
          key={currentIndex}
          initial={reduce ? false : { opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={reduce ? undefined : { opacity: 0, y: -10 }}
          transition={{ duration: 0.25 }}
          style={{ display: "flex", flexDirection: "column", gap: 18 }}
        >
          <div style={{ display: "flex", flexDirection: "column", gap: 6, alignItems: "center", textAlign: "center" }}>
            <span style={{ fontSize: 11, letterSpacing: 1.5, color: "var(--brand)", fontWeight: 600 }}>
              {currentSeries.round} · {currentSeries.season}
            </span>
            <h3 className="font-display" style={{ fontSize: 19 }}>Who won the series?</h3>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr auto 1fr", gap: 10, alignItems: "center" }}>
            {teams.map((t, i) => (
              <div key={t.name} style={{ display: "contents" }}>
                {i === 1 && (
                  <span className="font-display" style={{ fontSize: 13, color: "var(--muted)" }}>VS</span>
                )}
                <motion.button
                  onClick={() => handlePickWinner(t.name)}
                  disabled={showWinner}
                  whileHover={!reduce && !showWinner ? { y: -2 } : undefined}
                  whileTap={!reduce && !showWinner ? { scale: 0.96 } : undefined}
                  style={pickStyle(t.name)}
                >
                  <span style={{
                    width: 54, height: 54, borderRadius: 14, display: "flex", alignItems: "center", justifyContent: "center",
                    background: nbaTeamColors[t.name]?.primary || "var(--surface3)",
                    boxShadow: "0 6px 16px -6px rgba(0,0,0,.5)", overflow: "hidden",
                  }}>
                    <img src={t.logo} alt={t.name} style={{ width: 40, height: 40, objectFit: "contain" }} />
                  </span>
                  <span className="font-display" style={{ fontSize: 15, textAlign: "center" }}>{t.name}</span>
                  {showWinner && (
                    <span className="tnum" style={{ fontSize: 12, fontWeight: 700, color: t.name === currentSeries.winner ? "var(--good)" : "var(--muted)" }}>
                      {t.wins} wins
                    </span>
                  )}
                </motion.button>
              </div>
            ))}
          </div>

          <div style={{ height: 20, display: "flex", alignItems: "center", justifyContent: "center" }}>
            {feedback && (
              <motion.span
                initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}
                className="font-accent" style={{ fontSize: 14, fontWeight: 700, color: feedback.color }}
              >
                {feedback.text}
              </motion.span>
            )}
          </div>
        </motion.div>
      </AnimatePresence>

      <SubmitGuessPopup show={showPointsAnimation} text={`+${pointsPerCorrect}`} color={"#25a602"} />
    </div>
  );
}

export default PlayOffSeries;
