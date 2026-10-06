import { useCallback, useEffect, useRef } from "react";
import { useDispatch, useSelector } from "react-redux";
import { AnimatePresence, motion } from "framer-motion";
import type { AppDispatch, RootState } from "../store";
import { logout } from "../store/userSlice";
import { clearTokens } from "../utils/Api";
import { clearCachedUser } from "../utils/session";
import type { BanInfo } from "../utils/ban";
import { useModal } from "../context/ModalContext";
import { FOCUSABLE, useFocusTrap } from "../hooks/useFocusTrap";
import { fadeIn, swap } from "../motion/variants";
import Button from "./ui/Button";
import "../styles/BanNotice.css";

const MAX_STRIKES = 3;

/** Backend `ban_reason` code -> what the player is told. Unknown codes fall back to the generic line. */
const REASON_TEXT: Record<string, string> = {
  name_severe: "Your display name broke the rules three times.",
  photo: "Your profile photo broke the rules.",
  admin: "A moderator banned this account.",
};
const REASON_FALLBACK = "This account broke the community rules.";

/**
 * Blocking full-viewport ban screen, shown while `state.user.banned` is set (a 403
 * `account_banned` reported through utils/ban.ts). It is a page-level state, not a dismissible
 * overlay: Escape does nothing and the only ways out are Appeal (opens the feedback modal above
 * it, which is why it is mounted just before ModalHost and sits under `.modal-backdrop`) and
 * Log out. A deliberate, documented exception to UI-8.
 */
export default function BanNotice() {
  const banned = useSelector((state: RootState) => state.user.banned);

  return (
    <AnimatePresence>
      {banned && <BanScreen key="ban" info={banned} />}
    </AnimatePresence>
  );
}

const noop = () => {};

function BanScreen({ info }: { info: BanInfo }) {
  const dispatch = useDispatch<AppDispatch>();
  const { kind, open } = useModal();
  const panelRef = useRef<HTMLDivElement>(null);

  // Trap focus here unless the appeal modal is open on top (it traps its own). Escape is a no-op.
  const trapActive = kind === null;
  useFocusTrap(panelRef, noop, { active: trapActive });

  // The trap only wraps Tab. A closing modal (the auth form a ban closed, or the appeal modal)
  // restores focus to its trigger behind this screen ~one exit animation later; pull it back.
  // While a modal is still on screen (its exit included) focus belongs to it.
  useEffect(() => {
    if (!trapActive) return;
    const onFocusIn = (e: FocusEvent) => {
      const panel = panelRef.current;
      if (!panel || panel.contains(e.target as Node)) return;
      if (document.querySelector(".modal-backdrop")) return;
      (panel.querySelector<HTMLElement>(FOCUSABLE) ?? panel).focus();
    };
    document.addEventListener("focusin", onFocusIn);
    return () => document.removeEventListener("focusin", onFocusIn);
  }, [trapActive]);

  const strikes = Math.min(Math.max(info.strikes, 0), MAX_STRIKES);
  const reasonText = REASON_TEXT[info.reason] ?? REASON_FALLBACK;

  const appeal = useCallback(() => {
    open("feedback", { preset: "appeal", publicId: info.public_id });
  }, [open, info.public_id]);

  const signOut = useCallback(() => {
    // Tokens and cache are already gone (the ban handler cleared them); this clears the ban state.
    clearTokens();
    clearCachedUser();
    dispatch(logout());
  }, [dispatch]);

  return (
    <motion.div
      className="ban-notice"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="ban-title"
      aria-describedby="ban-desc"
      variants={fadeIn}
      initial="hidden"
      animate="visible"
      exit="exit"
    >
      <motion.div ref={panelRef} className="ban-card" tabIndex={-1} variants={swap}>
        <div className="ban-icon" aria-hidden="true">
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
            <circle cx="12" cy="12" r="9" />
            <path d="M5.6 5.6l12.8 12.8" />
          </svg>
        </div>

        <h2 id="ban-title" className="font-display ban-title">Your account has been banned</h2>
        <p id="ban-desc" className="ban-text">
          {reasonText} While the ban is in place you can&apos;t play, change your profile or use your
          account. Your points and history are kept, not deleted.
        </p>

        {strikes > 0 && (
          <div className="ban-strikes">
            <span className="ban-pips" aria-hidden="true">
              {Array.from({ length: MAX_STRIKES }, (_, i) => (
                <span key={i} className={`ban-pip${i < strikes ? " is-on" : ""}`} />
              ))}
            </span>
            <span>{`Strikes: ${strikes} of ${MAX_STRIKES}`}</span>
          </div>
        )}

        {info.public_id && <p className="ban-id tnum">Account #{info.public_id}</p>}

        <p className="ban-help">
          Think this is a mistake? Send an appeal and include anything that helps us review it.
        </p>

        <div className="ban-actions">
          <Button variant="primary" block onClick={appeal}>Appeal</Button>
          <Button variant="secondary" block onClick={signOut}>Log out</Button>
        </div>
      </motion.div>
    </motion.div>
  );
}
