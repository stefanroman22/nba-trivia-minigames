import { useEffect, useId, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { useSelector } from "react-redux";
import { apiFetch } from "../../utils/Api";
import { BACKEND_ORIGIN } from "../../configurations/backend";
import { games as gameCatalog } from "../../utils/GameUtils";
import { nameNoteSlot } from "../../utils/nameCheck";
import SwapText from "../motion/SwapText";
import SuccessBadge from "../motion/SuccessBadge";
import { errorIn, fadeInUp, reducedFade, staggerContainer, swap } from "../../motion/variants";
import type { RootState } from "../../store";

/**
 * Feedback form (rating + free text), stored via POST /trivia/feedback/ and read
 * back in the admin panel's Feedback tab.
 *
 * `apiFetch` attaches the JWT when there is one, which is what ties a rating to
 * an account; the endpoint takes the sender from that token and ignores any
 * identity in the body. Guests may leave an address so they can be replied to.
 */
const STAR_COLOR = "#f5b301";

/** An appeal (ban screen -> Appeal) is a feedback row: the endpoint requires a 1-5 rating, so it
 *  carries this fixed, neutral one and the star row is hidden. The admin Feedback tab finds
 *  appeals by game "appeal" or the "[Appeal #ID]" prefix. */
const APPEAL_RATING = 3;

/** The game being played, when the modal is opened from a game route.
 *
 * Every game is routed at `/<id>` (src/app/[game]/page.tsx), so the first path segment IS the
 * game id — but it is checked against the catalogue rather than pattern-matched,
 * so non-game routes like /admin or / don't get recorded as games. */
function currentGame() {
  const segment = window.location.pathname.split("/")[1] ?? "";
  return gameCatalog.some((g) => g.id === segment) ? segment : "";
}

const NETWORK_ERROR = "Could not reach the server. Check your connection and try again.";
// 429 is the hourly submission throttle, so "try again now" would be wrong advice.
const THROTTLE_ERROR = "You have sent a lot of feedback just now. Please try again in a while.";
const GENERIC_ERROR = "Could not send your feedback.";

/** Snapshot taken the moment a send succeeds: the form's height (so the confirmation holds it and
 *  the panel never jumps) and the game the note was about, if any. */
interface SentInfo {
  height: number;
  gameName?: string;
}

interface FeedbackModalProps {
  onClose: () => void;
  /** "appeal": the ban screen's Appeal — no stars, text pre-filled with the account id. */
  preset?: "appeal";
  publicId?: string;
}

export default function FeedbackModal({ onClose, preset, publicId }: FeedbackModalProps) {
  const isAppeal = preset === "appeal";
  const user = useSelector((state: RootState) => state.user.user);
  const reduce = useReducedMotion();
  const [rating, setRating] = useState(isAppeal ? APPEAL_RATING : 0);
  const [hover, setHover] = useState(0);
  const [text, setText] = useState(isAppeal ? `[Appeal #${publicId ?? ""}] ` : "");
  const [email, setEmail] = useState("");
  const [sending, setSending] = useState(false);
  // `id` keys the alert so a repeat of the same message still replays its entrance.
  const [error, setError] = useState<{ id: number; message: string } | null>(null);
  const [sent, setSent] = useState<SentInfo | null>(null);
  const formRef = useRef<HTMLDivElement>(null);
  const errorSeq = useRef(0);

  const showError = (message: string) => setError({ id: ++errorSeq.current, message });

  async function send() {
    if (!rating || sending) return;
    setSending(true);
    setError(null);
    const game = isAppeal ? "appeal" : currentGame();
    try {
      let res: Response;
      try {
        res = await apiFetch(`${BACKEND_ORIGIN}/trivia/feedback/`, {
          method: "POST",
          body: JSON.stringify({
            rating,
            message: text.trim(),
            page: isAppeal ? "/banned" : window.location.pathname,
            game,
            ...(user ? {} : { email: email.trim() }),
          }),
        });
      } catch {
        // fetch only throws when the request never got an answer (offline, DNS, aborted).
        showError(NETWORK_ERROR);
        return;
      }
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        showError(res.status === 429 ? THROTTLE_ERROR : body.error || GENERIC_ERROR);
        return;
      }
      setSent({
        height: formRef.current?.offsetHeight ?? 0,
        gameName: isAppeal ? undefined : gameCatalog.find((g) => g.id === game)?.name,
      });
    } finally {
      // The typed text, rating and email stay in state, so a failed send never costs what they wrote.
      setSending(false);
    }
  }

  const pane = reduce ? reducedFade : swap;
  const sendLabel = isAppeal ? "Send appeal" : "Send feedback";

  return (
    <div>
      <AnimatePresence mode="wait" initial={false}>
        {sent ? (
          <motion.div key="sent" variants={pane} initial="hidden" animate="visible" exit="exit">
            <SentView isAppeal={isAppeal} info={sent} reduce={!!reduce} onClose={onClose} />
          </motion.div>
        ) : (
          <motion.div
            key="form"
            ref={formRef}
            className="fb-stack"
            aria-busy={sending}
            variants={pane}
            initial="hidden"
            animate="visible"
            exit="exit"
          >
            <p className="fb-intro">
              {isAppeal
                ? "Tell us why the ban should be lifted. Keep the account tag at the start so we can find it."
                : "How's your experience so far? No account needed."}
            </p>

            {!isAppeal && (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <span className="fb-label">RATE IT</span>
                <div className="fb-stars" role="radiogroup" aria-label="Rating" onMouseLeave={() => setHover(0)}>
                  {[1, 2, 3, 4, 5].map((n) => {
                    const on = n <= (hover || rating);
                    return (
                      <button
                        key={n}
                        className="fb-star"
                        role="radio"
                        aria-checked={n === rating}
                        aria-label={`${n} star${n > 1 ? "s" : ""}`}
                        disabled={sending}
                        onClick={() => setRating(n)}
                        onMouseEnter={() => setHover(n)}
                        onFocus={() => setHover(n)}
                      >
                        <svg width="24" height="24" viewBox="0 0 24 24" fill={on ? STAR_COLOR : "none"} stroke={on ? STAR_COLOR : "var(--line2)"} strokeWidth="1.6" strokeLinejoin="round">
                          <path d="M12 2l2.9 6.3 6.9.7-5.1 4.6 1.4 6.8L12 17.8 5.9 20.4l1.4-6.8L2.2 9l6.9-.7z" />
                        </svg>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <span className="fb-label">{isAppeal ? "YOUR APPEAL" : "WHAT WOULD YOU CHANGE? (OPTIONAL)"}</span>
              <textarea
                className="modal-textarea"
                rows={4}
                value={text}
                onChange={(e) => setText(e.target.value)}
                maxLength={2000}
                disabled={sending}
                placeholder={isAppeal ? "What happened, and why should the ban be lifted?" : "More games? Faster rounds? Tell us anything…"}
              />
            </div>

            {!user && (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <span className="fb-label">EMAIL (OPTIONAL)</span>
                <input
                  className="modal-textarea"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  disabled={sending}
                  placeholder={isAppeal ? "So we can tell you the outcome" : "Only if you'd like a reply"}
                  style={{ height: 42 }}
                />
              </div>
            )}

            {/* Always-mounted slot (its negative margin cancels the stack gap while empty): only the
                clip's height and opacity glide, so the button below never jumps. One clip, one key,
                so a quick retry can never stack two alerts; the message inside is keyed per error
                so its fade-up + shake replays. */}
            <div className="fb-error-slot">
              <AnimatePresence initial={false}>
                {error && (
                  <motion.div
                    key="fb-error"
                    className="fb-error-clip"
                    variants={nameNoteSlot}
                    initial="hidden"
                    animate="visible"
                    exit="hidden"
                  >
                    <motion.p
                      key={error.id}
                      role="alert"
                      className="fb-error"
                      variants={reduce ? reducedFade : errorIn}
                      initial="hidden"
                      animate="visible"
                    >
                      {error.message}
                    </motion.p>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            <button className="modal-primary-btn" onClick={send} disabled={!rating || sending}>
              <SwapText reserveWidth={["Sending…", sendLabel]}>{sending ? "Sending…" : sendLabel}</SwapText>
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

interface SentViewProps {
  isAppeal: boolean;
  info: SentInfo;
  reduce: boolean;
  onClose: () => void;
}

/** The confirmation pane. Mounted only once the form has finished leaving (mode="wait"), so its
 *  mount effect is the right moment to move focus to Close; the Modal focus trap keeps it inside. */
function SentView({ isAppeal, info, reduce, onClose }: SentViewProps) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const statusId = useId();
  const item = reduce ? reducedFade : fadeInUp;

  useEffect(() => {
    closeRef.current?.focus({ preventScroll: true });
  }, []);

  return (
    <motion.div className="fb-sent" style={{ minHeight: info.height }} variants={staggerContainer}>
      <SuccessBadge />
      <div id={statusId} role="status" className="fb-sent-copy">
        <motion.h3 className="font-display fb-sent-title" variants={item}>
          {isAppeal ? "Appeal received." : "Thanks, we read every message."}
        </motion.h3>
        <motion.p className="fb-sent-line" variants={item}>
          {isAppeal
            ? "We will review the ban. If you left an email, we will reply there."
            : "Your feedback goes straight to the team and shapes what we build next."}
        </motion.p>
        {info.gameName && (
          <motion.p className="fb-sent-line" variants={item}>
            Thanks for the notes on {info.gameName}.
          </motion.p>
        )}
      </div>
      {/* The motion wrapper carries the entrance so the button keeps its CSS hover lift. */}
      <motion.div variants={item}>
        <button ref={closeRef} className="modal-primary-btn fb-sent-btn" aria-describedby={statusId} onClick={onClose}>
          Close
        </button>
      </motion.div>
    </motion.div>
  );
}
