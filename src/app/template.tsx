"use client";
import { motion } from "framer-motion";
import type { ReactNode } from "react";
import { usePageTransition } from "../context/PageTransitionContext";

/**
 * Simple fade-in/fade-out page transition. A template remounts on every route
 * change, which is what runs the enter animation; the exit is driven by
 * `leaving` (see PageTransitionContext). The very first page paints immediately
 * — it's the LCP — so it only animates after a client-side navigation.
 */
export default function Template({ children }: { children: ReactNode }) {
  const { leaving, hasNavigated } = usePageTransition();
  return (
    <motion.div
      initial={hasNavigated ? { opacity: 0, scale: 0.98 } : false} // start slightly smaller and faded
      animate={
        leaving
          ? { opacity: 0, scale: 0.98, transition: { duration: 0.3, ease: "easeIn" } }
          : { opacity: 1, scale: 1, transition: { duration: 0.4, ease: "easeOut" } }
      }
      className="w-full h-full"
    >
      {children}
    </motion.div>
  );
}
