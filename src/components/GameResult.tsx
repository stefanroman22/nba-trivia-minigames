import { useEffect, useState } from 'react'
import { motion, useReducedMotion } from 'framer-motion'
import Confetti from 'react-confetti'
import Button from './ui/Button'
import AnimatedNumber from './motion/AnimatedNumber'

interface GameResultProps {
  score: number,
  maxPoints: number,
  /** Restarts and auto-launches the same game (no extra Play press). */
  onPlayAgain: () => void,
  /** Closes the game and returns to the generic no-game screen. */
  onClose: () => void,
}

function GameResult({ score, maxPoints, onPlayAgain, onClose }: GameResultProps) {
  const reduce = useReducedMotion();
  const [size, setSize] = useState({ w: 0, h: 0 });

  useEffect(() => {
    const update = () => setSize({ w: window.innerWidth, h: window.innerHeight });
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);

  const won = score > 0;
  const perfect = maxPoints > 0 && score >= maxPoints;
  const unscored = maxPoints <= 0; // opinion games (Who Would Win): no points to report
  const title = unscored ? "Thanks for voting!" : perfect ? "Perfect game!" : won ? "Nice run!" : "Good try!";
  const message = unscored
    ? "Your votes are in the community split. Run it back for a fresh set of matchups."
    : perfect
    ? "Flawless."
    : won
      ? "Solid hoops IQ. Run it back to beat your score."
      : "No points this round. Shake it off and try again.";

  return (
    <div style={{ position: "relative", width: "100%", maxWidth: 440, margin: "0 auto" }}>
      {won && !reduce && size.w > 0 && (
        <Confetti
          width={size.w} height={size.h} numberOfPieces={260} recycle={false} gravity={0.25}
          colors={["#ff6a1a", "#ff8a3d", "#ffd166", "#ffffff", "#2fc762"]}
          style={{ position: "fixed", inset: 0, pointerEvents: "none", zIndex: 9998 }}
        />
      )}

      {/* The score is already known the instant a game ends, so there is no
          "Calculating…" beat: the result springs in right after the Stage
          cross-fade. Points are awarded in the background (MiniGame.awardPoints)
          and never gate this reveal. */}
      <motion.div
        initial={{ opacity: 0, scale: 0.9, y: 10 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ type: "spring", stiffness: 240, damping: 22 }}
        style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8, textAlign: "center" }}
      >
        <div style={{ width: 64, height: 64, borderRadius: "50%", background: won ? "var(--good-soft)" : "var(--surface3)", display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 4 }}>
          {won ? (
            <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="var(--good)" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6L9 17l-5-5" /></svg>
          ) : (
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="var(--muted)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 12a9 9 0 1 0 3-6.7L3 8" /><path d="M3 3v5h5" /></svg>
          )}
        </div>
        <h2 className="font-display" style={{ fontSize: 24 }}>{title}</h2>
        {!unscored && (
          <div style={{ display: "flex", alignItems: "baseline", gap: 8, margin: "4px 0" }}>
            <span className="font-display tnum" style={{ fontSize: 48, color: "var(--brand)" }}><AnimatedNumber value={score} /></span>
            <span className="font-display" style={{ fontSize: 20, color: "var(--muted)" }}>/ {maxPoints}</span>
          </div>
        )}
        <p style={{ fontSize: 13.5, color: "var(--muted)", maxWidth: 300, lineHeight: 1.5 }}>{message}</p>
        <div style={{ display: "flex", gap: 10, marginTop: 14, width: "100%" }}>
          <Button block autoFocus onClick={onPlayAgain}>Play again</Button>
          <Button block variant="secondary" onClick={onClose}>Close game</Button>
        </div>
      </motion.div>
    </div>
  )
}

export default GameResult
