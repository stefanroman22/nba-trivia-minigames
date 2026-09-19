// Animated inline text swap: when the label changes, the old text fades/slides
// out and the new one slides in (e.g. "Change" → "Saving…" → "Saved",
// "Copy" → "Copied!"). Respects reduced motion. Zero layout opinion — the
// parent keeps its own sizing, so reserve space for the widest state there if
// shifts matter. Callers who need a different feel (or none at all) don't
// touch this file — see `transition`/`variants`/`disabled` below.
import { AnimatePresence, motion, useReducedMotion, type Transition, type TargetAndTransition } from "framer-motion";
import type { ReactNode } from "react";

/** The baseline distance/duration/ease, exported so a caller building a custom
 *  `transition` or `variants` can start from the same values instead of guessing. */
// eslint-disable-next-line react-refresh/only-export-components
export const SWAP_TEXT_DEFAULTS = { distance: 5, duration: 0.18, ease: "easeOut" as const };

interface SwapTextVariants {
  initial?: TargetAndTransition;
  animate?: TargetAndTransition;
  exit?: TargetAndTransition;
}

interface SwapTextProps {
  children: ReactNode;
  /** Identifies the current state; the swap animates when it changes.
      Defaults to the children themselves when they are a string/number. */
  swapKey?: string | number;
  /** Vertical travel in px of the outgoing/incoming text (ignored if `variants` is given). */
  distance?: number;
  /** Duration in seconds, used only when `transition` is not given. */
  duration?: number;
  /** Replaces the default `{ duration, ease: "easeOut" }` transition entirely — tune ease, duration or use a spring. */
  transition?: Transition;
  /** Opt out entirely: renders `children` in a plain `<span>`, no AnimatePresence/motion. */
  disabled?: boolean;
  /** Override the default slide+fade initial/animate/exit values wholesale. */
  variants?: SwapTextVariants;
  /** Passed through to the inner span (Tailwind callers, or to hook into layout). */
  className?: string;
}

const SwapText = ({
  children,
  swapKey,
  distance = SWAP_TEXT_DEFAULTS.distance,
  duration = SWAP_TEXT_DEFAULTS.duration,
  transition,
  disabled = false,
  variants,
  className,
}: SwapTextProps) => {
  const reduce = useReducedMotion();
  const key =
    swapKey ??
    (typeof children === "string" || typeof children === "number" ? String(children) : "static");

  if (disabled) {
    return <span className={className}>{children}</span>;
  }

  const initial = variants?.initial ?? { opacity: 0, y: reduce ? 0 : distance };
  const animate = variants?.animate ?? { opacity: 1, y: 0 };
  const exit = variants?.exit ?? { opacity: 0, y: reduce ? 0 : -distance };

  return (
    <AnimatePresence mode="wait" initial={false}>
      <motion.span
        key={key}
        className={className}
        initial={initial}
        animate={animate}
        exit={exit}
        transition={transition ?? { duration, ease: SWAP_TEXT_DEFAULTS.ease }}
        style={{ display: "inline-block" }}
      >
        {children}
      </motion.span>
    </AnimatePresence>
  );
};

export default SwapText;
