import { AnimatePresence, motion } from "framer-motion";

interface CorrectAnswerProps {
  label: string;   // e.g., "answer" or "team"
  value?: string;  // optional — when present the banner reveals
}

const CorrectAnswer = ({ label, value }: CorrectAnswerProps) => {
  return (
    <AnimatePresence mode="wait">
      {value && (
        <motion.p
          key={value}
          initial={{ opacity: 0, y: 12, scale: 0.96 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: -10 }}
          transition={{ duration: 0.32, ease: [0.22, 1, 0.36, 1] }}
          className="font-accent"
          style={{ color: "#ff5a5a", fontWeight: 800, marginTop: "1rem" }}
        >
          Correct {label}: {value}
        </motion.p>
      )}
    </AnimatePresence>
  );
};

export default CorrectAnswer;
