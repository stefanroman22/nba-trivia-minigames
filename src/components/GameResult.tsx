import { useEffect, useState } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import Confetti from 'react-confetti'
import MotionButton from './motion/MotionButton'
import AnimatedNumber from './motion/AnimatedNumber'
import Spinner from './motion/Spinner'

interface GameResultProps {
  showFinalResult: boolean,
  score: number,
  maxPoints: number,
  handleRestart: () => void,
}

function GameResult({ showFinalResult, score, maxPoints, handleRestart }: GameResultProps) {
  const reduce = useReducedMotion();
  const [size, setSize] = useState({ w: 0, h: 0 });

  useEffect(() => {
    const update = () => setSize({ w: window.innerWidth, h: window.innerHeight });
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);

  const win = score > 0;

  return (
    <div style={{ marginTop: "3rem", width: "100%" }}>
      {showFinalResult && win && !reduce && size.w > 0 && (
        <Confetti
          width={size.w}
          height={size.h}
          numberOfPieces={260}
          recycle={false}
          gravity={0.25}
          colors={["#ff7a1a", "#ea750e", "#ffd166", "#ffffff", "#28c24a"]}
          style={{ position: "fixed", inset: 0, pointerEvents: "none", zIndex: 9998 }}
        />
      )}

      <AnimatePresence mode="wait">
        {!showFinalResult ? (
          // Loading state
          <motion.div
            key="calculating"
            className="flex flex-col items-center"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <h3 className="font-display text-xl mb-3 animate-pulse">
              Calculating Score…
            </h3>
            <Spinner size={46} />
          </motion.div>
        ) : (
          // Result reveal
          <motion.div
            key="result"
            className="flex flex-col items-center"
            initial={{ opacity: 0, scale: 0.9, y: 12 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.9 }}
            transition={{ type: "spring", stiffness: 240, damping: 22 }}
          >
            <h3 className='font-display' style={{ fontSize: "1.6rem" }}>
              Your Score:{" "}
              <span className="tnum" style={{ color: "var(--brand, #ff7a1a)" }}>
                <AnimatedNumber value={score} />
              </span>{" "}
              / {maxPoints}
            </h3>
            {win && (
              <h4 className='font-semibold' style={{ marginTop: "0.5rem", color: "var(--text-muted, #a8a8a8)", maxWidth: "34ch" }}>
                If you are logged in, {score} points have been awarded to your profile.
              </h4>
            )}
            <MotionButton
              onClick={handleRestart}
              style={{ marginTop: "1.25rem" }}
            >
              Close
            </MotionButton>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

export default GameResult
