// Animated success check: the badge pops in (popIn), the check draws itself, and one soft ring
// pulses out once. Shared by any "it worked" confirmation (feedback sent today; the auth card can
// reuse it). Brand-coloured from theme tokens. Decorative: the caller announces success in text
// (role="status"), so the badge is aria-hidden. Reduced motion: an opacity fade only, settled check,
// no ring.
import { motion } from "framer-motion";
import { useReducedMotionSafe } from "../../hooks/useReducedMotionSafe";
import { durations, easing } from "../../motion/tokens";
import { popIn, reducedFade } from "../../motion/variants";
import "../../styles/SuccessBadge.css";

interface SuccessBadgeProps {
  /** Diameter in px. */
  size?: number;
}

const DRAW = { duration: durations.slow, ease: easing.out, delay: durations.fast };

export default function SuccessBadge({ size = 64 }: SuccessBadgeProps) {
  // SSR-safe (UI-20): the markup (ring, motion vs plain path) is derived from the preference.
  const reduce = useReducedMotionSafe();

  return (
    <motion.div
      className="sbadge"
      style={{ width: size, height: size }}
      aria-hidden="true"
      variants={reduce ? reducedFade : popIn}
      initial="hidden"
      animate="visible"
    >
      {!reduce && (
        <motion.span
          className="sbadge-ring"
          initial={{ opacity: 0.5, scale: 1 }}
          animate={{ opacity: 0, scale: 1.45 }}
          transition={DRAW}
        />
      )}
      <svg className="sbadge-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
        {reduce ? (
          <path d="M5 12.5l4.5 4.5L19 7.5" />
        ) : (
          <motion.path
            d="M5 12.5l4.5 4.5L19 7.5"
            initial={{ pathLength: 0, opacity: 0 }}
            animate={{ pathLength: 1, opacity: 1 }}
            transition={{ pathLength: DRAW, opacity: { duration: durations.fast, ease: easing.out, delay: durations.fast } }}
          />
        )}
      </svg>
    </motion.div>
  );
}
