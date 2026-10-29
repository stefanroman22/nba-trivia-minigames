import { useContext } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import { FeedbackSlotContext } from "../context/FeedbackSlotContext";

interface SubmitGuessPopupProps {
  /** controls mount/unmount so the exit animation actually plays */
  show: boolean;
  text: string;
  color: string;
  /** Optional per-message id: a new value re-mounts the line so a second message while the first
      is still showing enters again (and replaces it) instead of only swapping its text. */
  popKey?: number | string;
}

/**
 * In-game feedback line ("Correct! +10", "Not on the board", …). It portals into
 * the shell's feedback slot — a fixed spot in the gap just above the Exit button
 * — so it renders in the SAME place for every game and, being an overlay there
 * (pointer-events:none, no flow), never shifts the container or any element,
 * regardless of message length. Falls back to a 0-height inline overlay for the
 * brief moment before the slot mounts.
 */
const SubmitGuessPopup = ({ show, text, color, popKey }: SubmitGuessPopupProps) => {
  const slot = useContext(FeedbackSlotContext);

  const content = (
    <AnimatePresence mode="wait">
      {show && (
        <motion.span
          key={popKey === undefined ? "score-feedback" : `score-feedback-${popKey}`}
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 6 }}
          className="font-accent"
          style={{ fontSize: 14, fontWeight: 700, color, whiteSpace: "nowrap" }}
        >
          {text}
        </motion.span>
      )}
    </AnimatePresence>
  );

  if (slot) return createPortal(content, slot);

  return (
    <div style={{ position: "relative", width: "100%", height: 0 }}>
      <div
        style={{
          position: "absolute",
          bottom: 0,
          left: 0,
          right: 0,
          display: "flex",
          justifyContent: "center",
          pointerEvents: "none",
        }}
      >
        {content}
      </div>
    </div>
  );
};

export default SubmitGuessPopup;
