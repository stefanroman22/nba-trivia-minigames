import { useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { motion, useReducedMotion } from "framer-motion";
import ProgressBar from "../components/ui/ProgressBar";
import SubmitGuessPopup from "../components/SubmitGuessPopUp";
import TeamBadge from "../components/ui/TeamBadge";
import SwapText from "../components/motion/SwapText";
import { GameFrame } from "../components/ui";
import "../styles/PlayOffSeries.css";
import { createGuessLogger } from "../utils/guessLog";
import type { PlayoffSeries, OnGameEnd } from "../types/types";

interface PlayOffSeriesProps {
  seriesList: PlayoffSeries[];
  pointsPerCorrect: number;
  buttonTeamStyle: CSSProperties;
  getContrastColor: (hex: string) => string;
  onGameEnd: OnGameEnd;
}

function PlayOffSeries({
  seriesList,
  pointsPerCorrect,
  onGameEnd,
}: PlayOffSeriesProps) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [selectedTeam, setSelectedTeam] = useState<string | null>(null);
  const [showWinner, setShowWinner] = useState(false);
  const [score, setScore] = useState(0);
  const currentSeries = seriesList[currentIndex];
  const reduce = useReducedMotion();
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Each round's pick, for the answer review handed back with the score.
  const picksRef = useRef<(string | null)[]>([]);
  // Every answer, sent to the guess log on game end / unmount; the clock restarts each round.
  const [guessLog] = useState(() => createGuessLogger("series-winner"));
  const roundStartRef = useRef(Date.now());

  useEffect(() => { roundStartRef.current = Date.now(); }, [currentIndex]);

  useEffect(() => () => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    guessLog.flush();
  }, [guessLog]);

  const handlePickWinner = (picked: string) => {
    if (showWinner) return;
    setSelectedTeam(picked);
    setShowWinner(true);
    picksRef.current[currentIndex] = picked;

    const isCorrect = picked === currentSeries.winner;
    guessLog.add({
      question_id: currentSeries.match_id,
      answer: picked,
      correct: isCorrect,
      elapsed_ms: Date.now() - roundStartRef.current,
    });
    if (currentIndex === seriesList.length - 1) guessLog.flush();
    if (isCorrect) {
      setScore((prev) => prev + pointsPerCorrect);
    }

    timeoutRef.current = setTimeout(() => {
      setShowWinner(false);
      setSelectedTeam(null);
      if (currentIndex < seriesList.length - 1) {
        setCurrentIndex((prev) => prev + 1);
      } else if (onGameEnd) {
        onGameEnd(score + (isCorrect ? pointsPerCorrect : 0), {
          review: {
            game: "series-winner",
            rounds: seriesList.map((s, i) => ({
              matchId: s.match_id,
              label: `${s.round} · ${s.season}`,
              teams: [
                { name: s.team_a, abbr: s.team_a_abbreviation ?? null, wins: s.team_a_wins },
                { name: s.team_b, abbr: s.team_b_abbreviation ?? null, wins: s.team_b_wins },
              ],
              winner: s.winner,
              pick: picksRef.current[i] ?? null,
            })),
          },
        });
      }
    }, 1800);
  };

  if (!currentSeries) return null;

  const teams = [
    { name: currentSeries.team_a, abbr: currentSeries.team_a_abbreviation, wins: currentSeries.team_a_wins },
    { name: currentSeries.team_b, abbr: currentSeries.team_b_abbreviation, wins: currentSeries.team_b_wins },
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
        left={<GameFrame.Label>ROUND <SwapText className="tnum">{currentIndex + 1}</SwapText><span className="tnum">/{seriesList.length}</span></GameFrame.Label>}
        right={<GameFrame.Score value={score} />}
      />
      <ProgressBar value={currentIndex + (showWinner ? 1 : 0)} max={seriesList.length} />

      {/* The frame never re-mounts between rounds: only the pieces whose content
          changes (eyebrow, team names, crests) fade, so the title and cards hold still. */}
      <GameFrame.Board>
        <div style={{ width: "100%", display: "flex", flexDirection: "column", gap: 18 }}>
          <GameFrame.Prompt
            eyebrow={<SwapText>{`${currentSeries.round} · ${currentSeries.season}`}</SwapText>}
            title="Who won the series?"
          />

          <div style={{ display: "grid", gridTemplateColumns: "1fr auto 1fr", gap: 10, alignItems: "stretch" }}>
            {teams.map((t, i) => (
              <div key={i} style={{ display: "contents" }}>
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
                  {/* The 54px tile stays mounted; its fill and ring glide (0.25 s) and only the
                      abbreviation inside cross-fades, opacity only, when the team changes (Rule 5.1). */}
                  <span style={{
                    width: 54, height: 54, borderRadius: 14, display: "flex", flex: "none",
                    boxShadow: "0 6px 16px -6px rgba(0,0,0,.5)", overflow: "hidden",
                  }}>
                    <TeamBadge name={t.name} abbr={t.abbr} size={54} shape="tile" surface="card" decorative />
                  </span>
                  <span className="font-display pos-team-name" style={{ fontSize: 15, textAlign: "center", lineHeight: 1.25 }}>
                    <SwapText>{t.name}</SwapText>
                  </span>
                  {/* always rendered so the reveal cannot resize the card (Rule 6.2);
                      a non-breaking space reserves the exact line box without spoiling the winner */}
                  <span aria-hidden={!showWinner} className="tnum" style={{ marginTop: "auto", paddingTop: 6, fontSize: 12, fontWeight: 700, color: t.name === currentSeries.winner ? "var(--good)" : "var(--muted)" }}>
                    <SwapText swapKey={showWinner ? "wins" : "blank"}>{showWinner ? `${t.wins} wins` : " "}</SwapText>
                  </span>
                </motion.button>
              </div>
            ))}
          </div>
        </div>
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
