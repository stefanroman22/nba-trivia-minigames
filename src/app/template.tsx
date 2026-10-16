"use client";
import { motion, useMotionValue } from "framer-motion";
import type { ReactNode } from "react";
import { usePageTransition } from "../context/PageTransitionContext";
import { durations } from "../motion/tokens";

/**
 * Simple fade-in/fade-out page transition. A template remounts on every route
 * change, which is what runs the enter animation; the exit is driven by
 * `leaving` (see PageTransitionContext). The very first page paints immediately
 * — it's the LCP — so it only animates after a client-side navigation.
 *
 * One dip per route change: opacity is an external motion value in `style`, so
 * framer-motion drives it on the main thread and commits every frame (the final
 * one included) to the inline style. A WAAPI-accelerated opacity is cancelled on
 * finish a frame before the style catches up, which flashed the pre-animation
 * value back in and read as extra fades.
 */
const enter = { opacity: 1, scale: 1, transition: { duration: 0.4, ease: "easeOut" } } as const;
// durations.slow (0.3s) is the exit; EXIT_MS in PageTransitionContext derives from it.
const exit = { opacity: 0, scale: 0.98, transition: { duration: durations.slow, ease: "easeIn" } } as const;

export default function Template({ children }: { children: ReactNode }) {
  const { leaving, hasNavigated } = usePageTransition();
  const opacity = useMotionValue(hasNavigated ? 0 : 1);
  return (
    <motion.div
      initial={hasNavigated ? { opacity: 0, scale: 0.98 } : false} // start slightly smaller and faded
      animate={leaving ? exit : enter}
      style={{ opacity }}
      className="w-full h-full"
    >
      {children}
    </motion.div>
  );
}
