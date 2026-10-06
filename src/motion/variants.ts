// Reusable framer-motion variants shared across the app for a cohesive feel.
import type { Variants } from "framer-motion";
import { durations, easing, springs } from "./tokens";

export const fadeIn: Variants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { duration: durations.base, ease: easing.out } },
  exit: { opacity: 0, transition: { duration: durations.fast, ease: easing.in } },
};

export const fadeInUp: Variants = {
  hidden: { opacity: 0, y: 16 },
  visible: { opacity: 1, y: 0, transition: { duration: durations.slow, ease: easing.out } },
  exit: { opacity: 0, y: -16, transition: { duration: durations.fast, ease: easing.in } },
};

export const scaleIn: Variants = {
  hidden: { opacity: 0, scale: 0.92 },
  visible: { opacity: 1, scale: 1, transition: springs.soft },
  exit: { opacity: 0, scale: 0.92, transition: { duration: durations.fast, ease: easing.in } },
};

// Snappy pop for score popups / badges
export const popIn: Variants = {
  hidden: { opacity: 0, scale: 0.5, y: -10 },
  visible: { opacity: 1, scale: 1, y: 0, transition: springs.pop },
  exit: { opacity: 0, scale: 0.7, y: -10, transition: { duration: durations.fast, ease: easing.in } },
};

// Container + item for staggered lists / grids
export const staggerContainer: Variants = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.04, delayChildren: 0.02 } },
  exit: {},
};

export const staggerItem: Variants = {
  hidden: { opacity: 0, y: 14 },
  visible: { opacity: 1, y: 0, transition: { duration: durations.slow, ease: easing.out } },
  exit: { opacity: 0, y: -12, transition: { duration: durations.fast, ease: easing.in } },
};

// Mutually-exclusive screen swaps (AnimatePresence mode="wait")
export const swap: Variants = {
  hidden: { opacity: 0, y: 14, scale: 0.985 },
  visible: { opacity: 1, y: 0, scale: 1, transition: { duration: durations.base, ease: easing.out } },
  exit: { opacity: 0, y: -14, scale: 0.985, transition: { duration: durations.fast, ease: easing.in } },
};

// End-of-game result entrance (GameResult's spring): the score springs in from slightly below
// and slightly smaller. In-place games use it on their result line too.
export const resultIn: Variants = {
  hidden: { opacity: 0, scale: 0.9, y: 10 },
  visible: { opacity: 1, scale: 1, y: 0, transition: springs.result },
};

// Two always-mounted panes sharing one grid cell: a view toggle that must not change the
// container's height (GAME_DESIGN_CONSTRAINTS Rule 6.2). The leaving pane fades/slides out on
// swap's exit timing and ends visibility:hidden; the arriving pane waits that long, enters on
// swap's entrance, and releases its own variant children (popIn / fadeInUp) at the same moment.
export const stackPane: Variants = {
  hidden: {
    opacity: 0, y: 14, scale: 0.985,
    transition: { duration: durations.fast, ease: easing.in },
    transitionEnd: { visibility: "hidden" },
  },
  visible: {
    opacity: 1, y: 0, scale: 1, visibility: "visible",
    transition: { duration: durations.base, ease: easing.out, delay: durations.fast, delayChildren: durations.fast },
  },
};

// The one error shake (6px, two oscillations): `errorIn` runs it on the message, and a form runs
// it on the offending field (`animate(el, errorShake.keyframes, errorShake.transition)`). Skip it
// entirely under reduced motion.
export const errorShake = {
  keyframes: { x: [0, -6, 6, -4, 4, 0] },
  transition: { duration: durations.slow, ease: easing.inOut },
};

// Inline form error (role="alert"): fades up, then a short horizontal shake of the message only so
// a repeat failure still reads as new. Key the element per error so the shake replays. Pair it
// with `reducedFade` under reduced motion.
export const errorIn: Variants = {
  hidden: { opacity: 0, y: 8 },
  visible: {
    opacity: 1,
    y: 0,
    ...errorShake.keyframes,
    transition: {
      duration: durations.slow,
      ease: easing.out,
      x: { ...errorShake.transition, delay: durations.fast },
    },
  },
  exit: { opacity: 0, transition: { duration: durations.fast, ease: easing.in } },
};

// Reduced-motion stand-in for any of the above: opacity only, short both ways, no travel/scale.
export const reducedFade: Variants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { duration: durations.fast, ease: easing.out } },
  exit: { opacity: 0, transition: { duration: durations.fast, ease: easing.in } },
};
