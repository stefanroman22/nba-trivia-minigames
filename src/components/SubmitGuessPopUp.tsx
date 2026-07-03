import { AnimatePresence, motion } from "framer-motion";

interface SubmitGuessPopupProps {
  /** controls mount/unmount so the exit animation actually plays */
  show: boolean;
  text: string;
  color: string;
}

/**
 * In-container feedback line shown by the game renderers. It sits *inside* the
 * game container, below the play area, and fades up into place — matching the
 * winner feedback in PlayOffSeries (never a popup coming from the top). A small
 * reserved row keeps the layout from jumping when it appears.
 */
const SubmitGuessPopup = ({ show, text, color }: SubmitGuessPopupProps) => {
  return (
    <div style={{ minHeight: 20, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <AnimatePresence>
        {show && (
          <motion.span
            key="score-feedback"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 6 }}
            className="font-accent"
            style={{ fontSize: 14, fontWeight: 700, color }}
          >
            {text}
          </motion.span>
        )}
      </AnimatePresence>
    </div>
  );
};

export default SubmitGuessPopup;
