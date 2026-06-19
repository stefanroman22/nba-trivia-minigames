// Branded loading spinner: a glowing orange ring with a spinning basketball seam.
// Used for inline / button / panel loading states across the app.
import { motion, useReducedMotion } from "framer-motion";

interface SpinnerProps {
  size?: number;
  label?: string;
  /** show the text label below the ring */
  showLabel?: boolean;
}

const Spinner = ({ size = 48, label = "Loading…", showLabel = false }: SpinnerProps) => {
  const reduce = useReducedMotion();
  const ring = Math.max(3, Math.round(size / 11));

  return (
    <div
      role="status"
      aria-live="polite"
      aria-label={label}
      style={{
        display: "inline-flex",
        flexDirection: "column",
        alignItems: "center",
        gap: "0.7rem",
      }}
    >
      <motion.span
        style={{
          width: size,
          height: size,
          display: "block",
          borderRadius: "50%",
          border: `${ring}px solid rgba(255, 122, 26, 0.16)`,
          borderTopColor: "var(--brand, #ff7a1a)",
          borderRightColor: "var(--brand-strong, #ea750e)",
          boxShadow: "0 0 18px rgba(255, 122, 26, 0.35)",
        }}
        animate={reduce ? undefined : { rotate: 360 }}
        transition={{ repeat: Infinity, ease: "linear", duration: 0.8 }}
      />
      {showLabel && (
        <span style={{ color: "var(--text-muted, #a8a8a8)", fontSize: "0.85rem", fontWeight: 600 }}>
          {label}
        </span>
      )}
    </div>
  );
};

export default Spinner;
