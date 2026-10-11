"use client";
import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { LEGAL } from "../configurations/legal";
import { nameNoteSlot } from "../utils/nameCheck";
import "../styles/LegalChangeNotice.css";

const DISMISS_KEY = `sq:legal-notice-${LEGAL.version}`;

/** The home-page notice of a significant Terms/Privacy change, promised by Terms section 12 and
 *  Privacy section 15 ("at least 14 days before it applies"; docs/legal/RUNBOOKS.md F). Shown until
 *  LEGAL.changeNotice.showUntilIso; a player can hide it (remembered per version in this browser).
 *  Decided after mount, so the server HTML never carries it and nothing mismatches on hydration. */
export default function LegalChangeNotice() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const decide = () => {
      if (new Date() >= new Date(`${LEGAL.changeNotice.showUntilIso}T00:00:00Z`)) return;
      try {
        if (localStorage.getItem(DISMISS_KEY)) return;
      } catch {
        // storage blocked: show it, it just can't be hidden for good
      }
      setVisible(true);
    };
    decide();
  }, []);

  const dismiss = () => {
    setVisible(false);
    try {
      localStorage.setItem(DISMISS_KEY, "1");
    } catch {
      // storage blocked: hidden for this visit only
    }
  };

  return (
    <AnimatePresence initial={false}>
      {visible && (
        <motion.aside
          key="legal-notice"
          className="lcn-wrap"
          aria-label="Changes to our Terms and Privacy Policy"
          style={{ overflow: "hidden" }}
          variants={nameNoteSlot}
          initial="hidden"
          animate="visible"
          exit="hidden"
        >
          <div className="lcn">
            <p className="lcn-text">
              <strong>Our <a href="/terms">Terms</a> and <a href="/privacy">Privacy Policy</a> change on {LEGAL.changeNotice.effective}.</strong>{" "}
              {LEGAL.changeNotice.summary}
            </p>
            <button type="button" className="lcn-close" onClick={dismiss} aria-label="Hide this notice">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12" /></svg>
            </button>
          </div>
        </motion.aside>
      )}
    </AnimatePresence>
  );
}
