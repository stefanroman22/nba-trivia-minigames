import { useState } from "react";
import { useSelector } from "react-redux";
import { apiFetch } from "../../utils/Api";
import { BACKEND_ORIGIN } from "../../configurations/backend";
import { games as gameCatalog } from "../../utils/GameUtils";
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

/** The game being played, when the modal is opened from a game route.
 *
 * Every game is routed at `/<id>` (App.tsx), so the first path segment IS the
 * game id — but it is checked against the catalogue rather than pattern-matched,
 * so non-game routes like /admin or / don't get recorded as games. */
function currentGame() {
  const segment = window.location.pathname.split("/")[1] ?? "";
  return gameCatalog.some((g) => g.id === segment) ? segment : "";
}

export default function FeedbackModal({ onClose }: { onClose: () => void }) {
  const user = useSelector((state: RootState) => state.user.user);
  const [rating, setRating] = useState(0);
  const [hover, setHover] = useState(0);
  const [text, setText] = useState("");
  const [email, setEmail] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  async function send() {
    if (!rating || sending) return;
    setSending(true);
    setError(null);
    try {
      const res = await apiFetch(`${BACKEND_ORIGIN}/trivia/feedback/`, {
        method: "POST",
        body: JSON.stringify({
          rating,
          message: text.trim(),
          page: window.location.pathname,
          game: currentGame(),
          ...(user ? {} : { email: email.trim() }),
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        // 429 is the submission throttle, which needs its own wording — "try
        // again" is wrong advice when the limit is hourly.
        throw new Error(
          res.status === 429
            ? "You've sent a lot of feedback just now — try again a little later."
            : body.error || "Could not send your feedback.",
        );
      }
      setSent(true);
    } catch (e) {
      // The text stays in state so a failed send never costs what they wrote.
      setError(e instanceof Error ? e.message : "Could not send your feedback.");
    } finally {
      setSending(false);
    }
  }

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

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <span className="fb-label">WHAT WOULD YOU CHANGE?</span>
        <textarea
          className="modal-textarea"
          rows={4}
          value={text}
          onChange={(e) => setText(e.target.value)}
          maxLength={2000}
          placeholder="More games? Faster rounds? Tell us anything…"
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
            placeholder="Only if you'd like a reply"
            style={{ height: 42 }}
          />
        </div>
      )}

      {error && (
        <p role="alert" style={{ fontSize: 13, color: "var(--bad)", margin: 0 }}>{error}</p>
      )}

      <button className="modal-primary-btn" onClick={send} disabled={!rating || sending}>
        {sending ? "Sending…" : "Send feedback"}
      </button>
      {!rating && (
        <p style={{ fontSize: 12, color: "var(--muted)", margin: "-8px 0 0", textAlign: "center" }}>
          Pick a star rating to send.
        </p>
      )}
    </div>
  );
}
