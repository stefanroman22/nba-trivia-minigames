import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import Confetti from 'react-confetti'
import Button from './ui/Button'
import AnimatedNumber from './motion/AnimatedNumber'
import CourtLoader from './ui/CourtLoader'

interface GameResultProps {
  showFinalResult: boolean,
  score: number,
  maxPoints: number,
  handleRestart: () => void,
}

function GameResult({ showFinalResult, score, maxPoints, handleRestart }: GameResultProps) {
  const reduce = useReducedMotion();
  const navigate = useNavigate();
  const [size, setSize] = useState({ w: 0, h: 0 });

  useEffect(() => {
    const update = () => setSize({ w: window.innerWidth, h: window.innerHeight });
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);

  const won = score > 0;
  const perfect = maxPoints > 0 && score >= maxPoints;
  const title = perfect ? "Perfect game!" : won ? "Nice run!" : "Good try!";
  const message = perfect
    ? "Flawless — you maxed it out."
    : won
      ? "Solid hoops IQ. Run it back to beat your score."
      : "No points this round. Shake it off and try again.";

  return (
    <div style={{ position: "relative", width: "100%", maxWidth: 440, margin: "0 auto" }}>
      {showFinalResult && won && !reduce && size.w > 0 && (
        <Confetti
          width={size.w} height={size.h} numberOfPieces={260} recycle={false} gravity={0.25}
          colors={["#ff6a1a", "#ff8a3d", "#ffd166", "#ffffff", "#2fc762"]}
          style={{ position: "fixed", inset: 0, pointerEvents: "none", zIndex: 9998 }}
        />
      )}

      <AnimatePresence mode="wait">
        {!showFinalResult ? (
          <motion.div key="calc" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 14 }}>
            <CourtLoader label="Calculating score…" scale={0.8} />
          </motion.div>
        ) : (
          <motion.div
            key="result"
            initial={{ opacity: 0, scale: 0.9, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.9 }}
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
            <div style={{ display: "flex", alignItems: "baseline", gap: 8, margin: "4px 0" }}>
              <span className="font-display tnum" style={{ fontSize: 48, color: "var(--brand)" }}><AnimatedNumber value={score} /></span>
              <span className="font-display" style={{ fontSize: 20, color: "var(--muted)" }}>/ {maxPoints}</span>
            </div>
            <p style={{ fontSize: 13.5, color: "var(--muted)", maxWidth: 300, lineHeight: 1.5 }}>{message}</p>
            <div style={{ display: "flex", gap: 10, marginTop: 14, width: "100%" }}>
              <Button block onClick={handleRestart}>Play again</Button>
              <Button block variant="secondary" onClick={() => navigate("/")}>Another game</Button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

export default GameResult
