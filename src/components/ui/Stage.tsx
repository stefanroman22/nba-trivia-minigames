import { AnimatePresence, motion } from "framer-motion";
import type { ReactNode } from "react";

interface StageProps {
  /** changing this key cross-fades the stage content */
  phaseKey: string;
  children: ReactNode;
}

/** The bordered, gradient, dot-grid game shell that cross-fades between phases
 *  (idle / loading / playing / result). Content is centered and responsive. */
export default function Stage({ phaseKey, children }: StageProps) {
  return (
    <div className="stage-shell">
      <div className="stage-dots" aria-hidden="true" />
      <div className="stage-inner">
        <AnimatePresence mode="wait">
          <motion.div
            key={phaseKey}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -12 }}
            transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
            style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "center" }}
          >
            {children}
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}
