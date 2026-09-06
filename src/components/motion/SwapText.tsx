// Animated inline text swap: when the label changes, the old text fades/slides
// out and the new one slides in (e.g. "Change" → "Saving…" → "Saved",
// "Copy" → "Copied!"). Respects reduced motion. Zero layout opinion — the
// parent keeps its own sizing, so reserve space for the widest state there if
// shifts matter.
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import type { ReactNode } from "react";

interface SwapTextProps {
  children: ReactNode;
  /** Identifies the current state; the swap animates when it changes.
      Defaults to the children themselves when they are a string/number. */
  swapKey?: string | number;
  /** Vertical travel in px of the outgoing/incoming text. */
  distance?: number;
  duration?: number;
}

const SwapText = ({ children, swapKey, distance = 5, duration = 0.18 }: SwapTextProps) => {
  const reduce = useReducedMotion();
  const key =
    swapKey ??
    (typeof children === "string" || typeof children === "number" ? String(children) : "static");

  return (
    <AnimatePresence mode="wait" initial={false}>
      <motion.span
        key={key}
        initial={{ opacity: 0, y: reduce ? 0 : distance }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: reduce ? 0 : -distance }}
        transition={{ duration, ease: "easeOut" }}
        style={{ display: "inline-block" }}
      >
        {children}
      </motion.span>
    </AnimatePresence>
  );
};

export default SwapText;
