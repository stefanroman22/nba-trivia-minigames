import { useEffect, useId, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { apiFetch } from "../../utils/Api";
import { BACKEND_ORIGIN } from "../../configurations/backend";
import { nameNoteSlot } from "../../utils/nameCheck";
import type { ReviewRound } from "../../utils/reviewRounds";
import SwapText from "../motion/SwapText";
import SuccessBadge from "../motion/SuccessBadge";
import { errorIn, fadeInUp, reducedFade, staggerContainer, swap } from "../../motion/variants";

/**
 * "Report a problem" (ModalKind "reportQuestion"), opened from a finished single-player game's end
 * screen. The player picks one question the game dealt (src/utils/reviewRounds), may add a note, and
 * it is stored via POST /trivia/report-question/ for the question doctor. Guests can report too;
 * `apiFetch` attaches the JWT when there is one. Closing returns to the end screen underneath.
 * Same form, error slot and confirmation pattern as FeedbackModal.
 */
const MAX_NOTE = 500;
const NETWORK_ERROR = "Could not reach the server. Check your connection and try again.";
// 429 is the hourly report throttle, so "try again now" would be wrong advice.
const THROTTLE_ERROR = "You have sent a lot of reports just now. Please try again in a while.";
const GENERIC_ERROR = "Could not send your report.";
const SEND_LABEL = "Send report";

interface ReportQuestionModalProps {
  game: string;
  rounds: ReviewRound[];
  onClose: () => void;
}

export default function ReportQuestionModal({ game, rounds, onClose }: ReportQuestionModalProps) {
  const reduce = useReducedMotion();
  // One question: nothing to choose, it is picked already.
  const [picked, setPicked] = useState<string | null>(rounds.length === 1 ? rounds[0].question_id : null);
  const [note, setNote] = useState("");
  const [sending, setSending] = useState(false);
  // `id` keys the alert so a repeat of the same message still replays its entrance.
  const [error, setError] = useState<{ id: number; message: string } | null>(null);
  // The form's height at the moment the send succeeded, so the thanks pane holds it (no jump).
  const [sentHeight, setSentHeight] = useState<number | null>(null);
  const formRef = useRef<HTMLDivElement>(null);
  const errorSeq = useRef(0);
  const listLabel = useId();

  const showError = (message: string) => setError({ id: ++errorSeq.current, message });

  async function send() {
    if (!picked || sending) return;
    setSending(true);
    setError(null);
    try {
      let res: Response;
      try {
        res = await apiFetch(`${BACKEND_ORIGIN}/trivia/report-question/`, {
          method: "POST",
          body: JSON.stringify({ game, question_id: picked, note: note.trim() }),
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
      setSentHeight(formRef.current?.offsetHeight ?? 0);
    } finally {
      // The pick and the note stay in state, so a failed send never costs what they wrote.
      setSending(false);
    }
  }

  const pane = reduce ? reducedFade : swap;

  return (
    <div>
      <AnimatePresence mode="wait" initial={false}>
        {sentHeight !== null ? (
          <motion.div key="sent" variants={pane} initial="hidden" animate="visible" exit="exit">
            <SentView height={sentHeight} reduce={!!reduce} onClose={onClose} />
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
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <span className="fb-label" id={listLabel}>{rounds.length === 1 ? "QUESTION" : "WHICH QUESTION?"}</span>
              <div className="rq-list" role="radiogroup" aria-labelledby={listLabel}>
                {rounds.map((r, i) => (
                  <button
                    key={`${i}-${r.question_id}`}
                    type="button"
                    role="radio"
                    aria-checked={picked === r.question_id}
                    className={`rq-item${picked === r.question_id ? " is-picked" : ""}`}
                    disabled={sending}
                    onClick={() => setPicked(r.question_id)}
                  >
                    {r.label}
                  </button>
                ))}
              </div>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <span className="fb-label">WHAT'S WRONG? (OPTIONAL)</span>
              <textarea
                className="modal-textarea"
                rows={3}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                maxLength={MAX_NOTE}
                disabled={sending}
                placeholder="Wrong answer, wrong team, a typo…"
              />
            </div>

            {/* Always-mounted slot, as in FeedbackModal: only the clip's height and opacity glide. */}
            <div className="fb-error-slot">
              <AnimatePresence initial={false}>
                {error && (
                  <motion.div
                    key="rq-error"
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

            <button className="modal-primary-btn" onClick={send} disabled={!picked || sending}>
              <SwapText reserveWidth={["Sending…", SEND_LABEL]}>{sending ? "Sending…" : SEND_LABEL}</SwapText>
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

interface SentViewProps {
  height: number;
  reduce: boolean;
  onClose: () => void;
}

/** The thanks pane. Mounted once the form has left (mode="wait"), so focus moves to Close here. */
function SentView({ height, reduce, onClose }: SentViewProps) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const statusId = useId();
  const item = reduce ? reducedFade : fadeInUp;

  useEffect(() => {
    closeRef.current?.focus({ preventScroll: true });
  }, []);

  return (
    <motion.div className="fb-sent" style={{ minHeight: height }} variants={staggerContainer}>
      <SuccessBadge />
      <div id={statusId} role="status" className="fb-sent-copy">
        <motion.h3 className="font-display fb-sent-title" variants={item}>
          Thanks for the report.
        </motion.h3>
        <motion.p className="fb-sent-line" variants={item}>
          We check every report and fix the question if it is wrong.
        </motion.p>
      </div>
      <motion.div variants={item}>
        <button ref={closeRef} className="modal-primary-btn fb-sent-btn" aria-describedby={statusId} onClick={onClose}>
          Close
        </button>
      </motion.div>
    </motion.div>
  );
}
