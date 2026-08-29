import { type ReactNode } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Spinner } from "./ui";

export type EndSequencePhase = "input" | "loader" | "score";

interface EndSequenceProps {
  phase: EndSequencePhase;
  /** The submission container (input + confirm) shown during play. */
  input: ReactNode;
  /** The final score + Play again content, shown once the score settles. */
  score: ReactNode;
  loaderLabel?: string;
}

/**
 * Shared end-of-game bottom slot for every game that reveals correct answers at
 * the end. As the answers begin to appear the game flips `phase`
 * input → loader → score: the submission container fades out, a loader shows
 * while the score settles, then the score + Play again fade in. `mode="wait"`
 * guarantees the previous phase fully fades out before the next fades in — the
 * standard end-state structure across these games.
 */
export default function EndSequence({ phase, input, score, loaderLabel = "Calculating score…" }: EndSequenceProps) {
  return (
    <div className="endseq">
      <AnimatePresence mode="wait" initial={false}>
        {phase === "input" && (
          <motion.div
            key="input"
            className="endseq-slot"
            exit={{ opacity: 0, y: 3 }}
            transition={{ duration: 0.16, ease: "easeInOut" }}
          >
            {input}
          </motion.div>
        )}
        {phase === "loader" && (
          <motion.div
            key="loader"
            className="endseq-slot"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.16, ease: "easeInOut" }}
          >
            <Spinner label={loaderLabel} />
          </motion.div>
        )}
        {phase === "score" && (
          <motion.div
            key="score"
            className="endseq-slot"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.16, ease: [0.22, 1, 0.36, 1] }}
          >
            {score}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
