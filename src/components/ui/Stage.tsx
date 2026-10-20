import { AnimatePresence, motion } from "framer-motion";
import type { ReactNode } from "react";
import AutoHeight from "../motion/AutoHeight";
import { stageEnter } from "../../motion/variants";

interface StageProps {
  /** changing this key cross-fades the stage content */
  phaseKey: string;
  children: ReactNode;
}

/** The bordered, gradient, dot-grid game shell that cross-fades between phases
 *  (idle / loading / playing / result). Content is centered and responsive.
 *  Its height glides (AutoHeight, UI-23) whenever the content's height changes — a phase
 *  swap or a game's own wait resolving — so the shell never snaps (Rule 3.2). */
export default function Stage({ phaseKey, children }: StageProps) {
  return (
    <div className="stage-shell">
      <div className="stage-dots" aria-hidden="true" />
      <AutoHeight>
        <div className="stage-inner">
          <AnimatePresence mode="wait">
            <motion.div
              key={phaseKey}
              initial={{ opacity: 0, y: stageEnter.y }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -stageEnter.y }}
              transition={{ duration: stageEnter.duration, ease: stageEnter.ease }}
              style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "center" }}
            >
              {children}
            </motion.div>
          </AnimatePresence>
        </div>
      </AutoHeight>
    </div>
  );
}
