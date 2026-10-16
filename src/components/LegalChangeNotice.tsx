"use client";
// No-shift strategy: a fixed bottom banner (out of flow) entering by transform/opacity only, so it never moves painted content (CLS).
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion, type Variants } from "framer-motion";
import { LEGAL } from "../configurations/legal";
import { fadeInUp, reducedFade } from "../motion/variants";
import { durations, easing } from "../motion/tokens";
import { useReducedMotionSafe } from "../hooks/useReducedMotionSafe";
import { usePageTransition } from "../context/PageTransitionContext";
import "../styles/LegalChangeNotice.css";

const DISMISS_KEY = `sq:legal-notice-${LEGAL.version}`;

// fadeInUp, but a bottom banner leaves the way it came (back down), on the shared exit timing.
const bannerIn: Variants = {
  ...fadeInUp,
  exit: { opacity: 0, y: 16, transition: { duration: durations.fast, ease: easing.in } },
};

/** The home-page notice of a significant Terms/Privacy change, promised by Terms section 12 and
 *  Privacy section 15 ("at least 14 days before it applies"; docs/legal/RUNBOOKS.md F). Shown until
 *  LEGAL.changeNotice.showUntilIso; a player can hide it (remembered per version in this browser).
 *  Decided after mount, so the server HTML never carries it and nothing mismatches on hydration. */
export default function LegalChangeNotice() {
  const [visible, setVisible] = useState(false);
  // Portalled to <body> once mounted: the route template (app/template.tsx) scales its wrapper on
  // client-side enter/leave, and a transformed ancestor would pin this fixed banner to the wrapper.
  const [mounted, setMounted] = useState(false);
  // Opacity only under reduced motion; null (pre-hydration) counts as not reduced (UI-20).
  const reduced = useReducedMotionSafe();
  // Portalled out of the page, so it would not fade with it: exit while the page leaves (navigate()).
  const { leaving } = usePageTransition();

  useEffect(() => {
    setMounted(true);
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

  if (!mounted) return null;

  return createPortal(
    <AnimatePresence>
      {visible && !leaving && (
        <motion.aside
          key="legal-notice"
          className="lcn-wrap"
          aria-label="Changes to our Terms and Privacy Policy"
          variants={reduced ? reducedFade : bannerIn}
          initial="hidden"
          animate="visible"
          exit="exit"
        >
          <div className="lcn">
            <p className="lcn-text">
              <strong>
                We updated our <a href="/terms">Terms</a> and <a href="/privacy">Privacy Policy</a> on {LEGAL.updated}.
              </strong>{" "}
              New accounts accept them at sign-up; for existing accounts they apply from {LEGAL.changeNotice.effective}.{" "}
              {LEGAL.changeNotice.summary}
            </p>
            <button type="button" className="lcn-close" onClick={dismiss} aria-label="Hide this notice">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12" /></svg>
            </button>
          </div>
        </motion.aside>
      )}
    </AnimatePresence>,
    document.body,
  );
}
