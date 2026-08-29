import { useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import ProgressBar from "../components/ui/ProgressBar";
import SubmitGuessPopup from "../components/SubmitGuessPopUp";
import TeamCrest from "../components/ui/TeamCrest";
import { GameFrame } from "../components/ui";
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
    }

    timeoutRef.current = setTimeout(() => {
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
      background, cursor: showWinner ? "default" : "pointer",
      height: "100%", justifyContent: "flex-start",
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
    <GameFrame>
      <GameFrame.Status
        left={<GameFrame.Label>ROUND <span className="tnum">{currentIndex + 1}/{seriesList.length}</span></GameFrame.Label>}
        right={<GameFrame.Score value={score} />}
      />
      <ProgressBar value={currentIndex + (showWinner ? 1 : 0)} max={seriesList.length} />

      {/* round body — keyed so the prompt + VS cards cross-fade together */}
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
          <GameFrame.Prompt
            eyebrow={`${currentSeries.round} · ${currentSeries.season}`}
            title="Who won the series?"
          />

          <div style={{ display: "grid", gridTemplateColumns: "1fr auto 1fr", gap: 10, alignItems: "stretch" }}>
            {teams.map((t, i) => (
              <div key={t.name} style={{ display: "contents" }}>
                {i === 1 && (
                  <span className="font-display" style={{ fontSize: 13, color: "var(--muted)", alignSelf: "center" }}>VS</span>
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
                    <TeamCrest src={t.logo} name={t.name} size={40} />
                  </span>
                  <span className="font-display" style={{ fontSize: 15, textAlign: "center", lineHeight: 1.25 }}>{t.name}</span>
                  {/* always rendered so the reveal cannot resize the card (Rule 6.2);
                      a non-breaking space reserves the exact line box without spoiling the winner */}
                  <span aria-hidden={!showWinner} className="tnum" style={{ marginTop: "auto", paddingTop: 6, fontSize: 12, fontWeight: 700, color: t.name === currentSeries.winner ? "var(--good)" : "var(--muted)" }}>
                    {showWinner ? `${t.wins} wins` : " "}
                  </span>
                </motion.button>
              </div>
            ))}
          </div>
        </motion.div>
      </AnimatePresence>
      </GameFrame.Board>

      {/* No input row: the slot renders nothing so this game stays aligned with
          the other no-input games (see GameFrame.Action's doc comment). */}
      <GameFrame.Action>{null}</GameFrame.Action>

      <SubmitGuessPopup
        show={!!feedback}
        text={feedback?.text ?? ""}
        color={feedback?.color ?? "var(--good)"}
      />
    </GameFrame>
  );
}

export default PlayOffSeries;
