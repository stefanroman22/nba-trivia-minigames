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
          initial={{ opacity: 0, y: 10, scale: 0.97 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: -8 }}
          transition={{ duration: 0.32, ease: [0.22, 1, 0.36, 1] }}
          className="font-accent"
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            marginTop: "1rem",
            padding: "0.4rem 0.9rem",
            borderRadius: 999,
            border: "1px solid var(--bad)",
            background: "var(--bad-soft)",
            color: "var(--bad)",
            fontWeight: 700,
            fontSize: "0.85rem",
          }}
        >
          Correct {label}: {value}
        </motion.p>
      )}
    </AnimatePresence>
  );
};

export default CorrectAnswer;
