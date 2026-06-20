import { useState } from "react";

/**
 * Lightweight, front-end-only feedback form (rating + free text). There's no
 * backend endpoint for feedback, so "Send" just shows a thank-you state.
 */
export default function FeedbackModal({ onClose }: { onClose: () => void }) {
  const [rating, setRating] = useState(0);
  const [text, setText] = useState("");
  const [sent, setSent] = useState(false);

  if (sent) {
    return (
      <div className="fb-sent">
        <div className="fb-sent-icon">✓</div>
        <h3 className="font-display" style={{ fontSize: 20 }}>Thank you!</h3>
        <p style={{ fontSize: 14, color: "var(--muted)", maxWidth: 280, lineHeight: 1.5 }}>
          Your feedback helps shape what we build next. Now back to the games.
        </p>
        <button className="modal-primary-btn" style={{ height: 44, padding: "0 26px" }} onClick={onClose}>Done</button>
      </div>
    );
  }

  return (
    <div className="fb-stack">
      <p style={{ fontSize: 14, color: "var(--muted)", lineHeight: 1.5 }}>How's your experience so far? No account needed.</p>

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <span className="fb-label">RATE IT</span>
        <div className="fb-stars" role="radiogroup" aria-label="Rating">
          {[1, 2, 3, 4, 5].map((n) => {
            const on = n <= rating;
            return (
              <button key={n} className="fb-star" role="radio" aria-checked={n === rating} aria-label={`${n} star${n > 1 ? "s" : ""}`} onClick={() => setRating(n)}>
                <svg width="22" height="22" viewBox="0 0 24 24" fill={on ? "var(--brand)" : "none"} stroke={on ? "var(--brand)" : "var(--line2)"} strokeWidth="1.6" strokeLinejoin="round">
                  <path d="M12 2l2.9 6.3 6.9.7-5.1 4.6 1.4 6.8L12 17.8 5.9 20.4l1.4-6.8L2.2 9l6.9-.7z" />
                </svg>
              </button>
            );
          })}
        </div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <span className="fb-label">WHAT WOULD YOU CHANGE?</span>
        <textarea
          className="modal-textarea"
          rows={4}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="More games? Faster rounds? Tell us anything…"
        />
      </div>

      <button className="modal-primary-btn" onClick={() => setSent(true)}>Send feedback</button>
    </div>
  );
}
