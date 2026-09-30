import { useRef, type ReactNode } from "react";
import { motion } from "framer-motion";
import SwapText from "../motion/SwapText";
import { useFocusTrap } from "../../hooks/useFocusTrap";
import "../../styles/Modal.css";

interface ModalProps {
  title: string;
  onClose: () => void;
  /** Wider panel (used by the full leaderboard). */
  wide?: boolean;
  children: ReactNode;
}

/**
 * Presentational modal shell. The mount/unmount is controlled by an
 * <AnimatePresence> in ModalHost, so the root motion elements get both an
 * enter (modalIn: fade + slide + scale) and an exit (reverse) animation.
 * Handles Escape-to-close, background scroll lock, initial focus, a focus
 * trap, and focus restore to the trigger on close.
 */
export default function Modal({ title, onClose, wide = false, children }: ModalProps) {
  const panelRef = useRef<HTMLDivElement>(null);

  useFocusTrap(panelRef, onClose);

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
        className={`modal-panel${wide ? " modal-panel--wide" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        initial={{ opacity: 0, y: 10, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 10, scale: 0.97 }}
        transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
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
