import { useRef, type ReactNode } from "react";
import { motion, useReducedMotion } from "framer-motion";
import SwapText from "../motion/SwapText";
import { useFocusTrap } from "../../hooks/useFocusTrap";
import { durations, easing } from "../../motion/tokens";
import "../../styles/Modal.css";

/** The bottom-sheet breakpoint — must match the `max-width: 560px` block in Modal.css (UI-13). */
export const SHEET_QUERY = "(max-width: 560px)";

/** The one height animation of a success takeover: the sheet grows to the viewport. */
const TAKEOVER = { duration: durations.slow, ease: easing.inOut };

interface ModalProps {
  title: string;
  onClose: () => void;
  /** Wider panel (used by the full leaderboard). */
  wide?: boolean;
  /** Success takeover (auth): on a sheet viewport the panel expands to the full screen and then
   *  fades into the page; on desktop it scales/fades out. Off = the default enter/exit. */
  takeover?: boolean;
  children: ReactNode;
}

/**
 * Presentational modal shell. The mount/unmount is controlled by an
 * <AnimatePresence> in ModalHost, so the root motion elements get both an
 * enter (modalIn: fade + slide + scale) and an exit (reverse) animation.
 * Handles Escape-to-close, background scroll lock, initial focus, a focus
 * trap, and focus restore to the trigger on close.
 */
export default function Modal({ title, onClose, wide = false, takeover = false, children }: ModalProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const reduce = useReducedMotion();

  useFocusTrap(panelRef, onClose);

  // `takeover` is only ever set after a user action, so this never reads `window` on the server.
  const sheet = takeover && typeof window !== "undefined" && window.matchMedia(SHEET_QUERY).matches;
  // Reduced motion: no expansion movement; the success pane just fades out with the panel.
  const expand = sheet && !reduce;

  return (
    <motion.div
      className="modal-backdrop"
      onClick={onClose}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.2, ease: "easeOut" }}
    >
      <motion.div
        ref={panelRef}
        className={`modal-panel${wide ? " modal-panel--wide" : ""}${expand ? " modal-panel--takeover" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        initial={{ opacity: 0, y: 10, scale: 0.97 }}
        animate={
          expand
            ? { opacity: 1, y: 0, scale: 1, height: window.innerHeight, borderTopLeftRadius: 0, borderTopRightRadius: 0 }
            : { opacity: 1, y: 0, scale: 1 }
        }
        exit={
          !takeover
            ? { opacity: 0, y: 10, scale: 0.97 }
            : reduce
              ? { opacity: 0, transition: { duration: durations.fast, ease: easing.in } }
              : sheet
                ? { opacity: 0, transition: { duration: durations.base, ease: easing.in } }
                : { opacity: 0, scale: 0.92, transition: { duration: durations.base, ease: easing.in } }
        }
        transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1], height: TAKEOVER, borderTopLeftRadius: TAKEOVER, borderTopRightRadius: TAKEOVER }}
      >
        <div className="modal-head">
          <h3 className="font-display modal-title"><SwapText>{title}</SwapText></h3>
          <button className="modal-close" aria-label="Close" onClick={onClose}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div className="modal-body">{children}</div>
      </motion.div>
    </motion.div>
  );
}
