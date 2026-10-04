// Animated inline text swap: when the label changes, the old text fades/slides
// out and the new one slides in (e.g. "Change" → "Saving…" → "Saved",
// "Copy" → "Copied!"). The one swap component for any visible text that
// changes with state (UI_SHELL_CONSTRAINTS UI-21). Respects reduced motion
// (fade only, no travel). No layout opinion by default — the parent keeps its
// own sizing; pass `reserveWidth` to hold the slot at its largest state.
// Callers who need a different feel (or none at all) don't touch this file —
// see `transition`/`variants`/`disabled` below.
import { AnimatePresence, motion, useReducedMotion, type Transition, type TargetAndTransition } from "framer-motion";
import type { CSSProperties, ReactNode } from "react";
import { durations } from "../../motion/tokens";

/** The baseline distance/duration/ease, exported so a caller building a custom
 *  `transition` or `variants` can start from the same values instead of guessing.
 *  `ease` stays framer's "easeOut" keyword: no `easing` token matches it, and
 *  switching to `easing.out` would retune every existing caller. */
// eslint-disable-next-line react-refresh/only-export-components
export const SWAP_TEXT_DEFAULTS = { distance: 5, duration: durations.swap, ease: "easeOut" as const };

interface SwapTextVariants {
  initial?: TargetAndTransition;
  animate?: TargetAndTransition;
  exit?: TargetAndTransition;
}

interface SwapTextProps {
  children: ReactNode;
  /** Identifies the current state; the swap animates when it changes.
      Defaults to the children themselves when they are a string/number. Pass one
      per state (`"loading"`, `"empty"`, …) whenever the children aren't a plain
      string, or when the text may change without being a new state. */
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
  /** Every state this slot can show (e.g. `["Copy", "Copied!"]`). They are laid
      out invisibly in the same grid cell, so the slot keeps the widest state's
      box (and the tallest, if one wraps) and a button or line never resizes
      mid-swap. Off by default; the visible text is centred in the reserved box. */
  reserveWidth?: readonly ReactNode[];
}

const CELL: CSSProperties = { gridArea: "1 / 1" };

const SwapText = ({
  children,
  swapKey,
  distance = SWAP_TEXT_DEFAULTS.distance,
  duration = SWAP_TEXT_DEFAULTS.duration,
  transition,
  disabled = false,
  variants,
  className,
  reserveWidth,
}: SwapTextProps) => {
  const reduce = useReducedMotion();
  const key =
    swapKey ??
    (typeof children === "string" || typeof children === "number" ? String(children) : "static");

  const initial = variants?.initial ?? { opacity: 0, y: reduce ? 0 : distance };
  const animate = variants?.animate ?? { opacity: 1, y: 0 };
  const exit = variants?.exit ?? { opacity: 0, y: reduce ? 0 : -distance };

  const content = disabled ? (
    <span className={className} style={reserveWidth ? CELL : undefined}>{children}</span>
  ) : (
    <AnimatePresence mode="wait" initial={false}>
      <motion.span
        key={key}
        className={className}
        initial={initial}
        animate={animate}
        exit={exit}
        transition={transition ?? { duration, ease: SWAP_TEXT_DEFAULTS.ease }}
        style={reserveWidth ? { ...CELL, display: "inline-block" } : { display: "inline-block" }}
      >
        {children}
      </motion.span>
    </AnimatePresence>
  );

  if (!reserveWidth) return content;

  return (
    <span style={{ display: "inline-grid", justifyItems: "center", alignItems: "center" }}>
      {reserveWidth.map((state, i) => (
        <span key={i} aria-hidden="true" className={className} style={{ ...CELL, visibility: "hidden" }}>
          {state}
        </span>
      ))}
      {content}
    </span>
  );
};

export default SwapText;
