// Reusable framer-motion variants shared across the app for a cohesive feel.
import type { Variants } from "framer-motion";
import { durations, easing, springs } from "./tokens";

export const fadeIn: Variants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { duration: durations.base, ease: easing.out } },
  exit: { opacity: 0, transition: { duration: durations.fast, ease: easing.in } },
};

export const fadeInUp: Variants = {
  hidden: { opacity: 0, y: 26 },
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
  visible: { transition: { staggerChildren: 0.07, delayChildren: 0.05 } },
  exit: {},
};

export const staggerItem: Variants = {
  hidden: { opacity: 0, y: 22 },
  visible: { opacity: 1, y: 0, transition: { duration: durations.slow, ease: easing.out } },
  exit: { opacity: 0, y: -12, transition: { duration: durations.fast, ease: easing.in } },
};

// Mutually-exclusive screen swaps (AnimatePresence mode="wait")
export const swap: Variants = {
  hidden: { opacity: 0, y: 14, scale: 0.985 },
  visible: { opacity: 1, y: 0, scale: 1, transition: { duration: durations.base, ease: easing.out } },
  exit: { opacity: 0, y: -14, scale: 0.985, transition: { duration: durations.fast, ease: easing.in } },
};
