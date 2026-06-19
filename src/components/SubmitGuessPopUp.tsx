import { AnimatePresence, motion } from "framer-motion";

interface SubmitGuessPopupProps {
  /** controls mount/unmount so the exit animation actually plays */
  show: boolean;
  text: string;
  color: string;
}

/**
 * Floating score / feedback popup shown by every game renderer.
 * Springs in and fades out via AnimatePresence (no fragile cross-file keyframe).
 */
const SubmitGuessPopup = ({ show, text, color }: SubmitGuessPopupProps) => {
  return (
    <AnimatePresence>
      {show && (
        <motion.div
          key="score-popup"
          initial={{ opacity: 0, scale: 0.55, x: "-50%", y: -18 }}
          animate={{ opacity: 1, scale: 1, x: "-50%", y: 0 }}
          exit={{ opacity: 0, scale: 0.7, x: "-50%", y: -18 }}
          transition={{ type: "spring", stiffness: 420, damping: 18, mass: 0.6 }}
          className="font-accent tnum"
          style={{
            position: "fixed",
            top: "15%",
            left: "50%",
            backgroundColor: color,
            padding: "0.85rem 1.7rem",
            borderRadius: "12px",
            fontWeight: 800,
            color: "#fff",
            fontSize: "clamp(1rem, 4vw, 1.25rem)",
            maxWidth: "90vw",
            textAlign: "center",
            zIndex: 9999,
            boxShadow: "0 10px 28px rgba(0,0,0,0.45), 0 0 20px rgba(255,255,255,0.08)",
            pointerEvents: "none",
            whiteSpace: "nowrap",
          }}
        >
          {text}
        </motion.div>
      )}
    </AnimatePresence>
  );
};

export default SubmitGuessPopup;
