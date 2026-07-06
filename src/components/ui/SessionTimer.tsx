import { useEffect, useRef, useState } from "react";

interface SessionTimerProps {
  /** Epoch ms the session started; defaults to when the timer mounted. */
  startedAt?: number;
}

/**
 * Small "how long have I been playing" pill — clock icon + elapsed m:ss,
 * ticking every second. Mounted over the stage while a game is in progress so
 * the player always knows how long the session has run.
 */
export default function SessionTimer({ startedAt }: SessionTimerProps) {
  const mountedAtRef = useRef(Date.now());
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const start = startedAt ?? mountedAtRef.current;
  const totalSec = Math.max(0, Math.floor((now - start) / 1000));
  const minutes = Math.floor(totalSec / 60);
  const seconds = String(totalSec % 60).padStart(2, "0");

  return (
    <span
      role="timer"
      aria-label={`Time played: ${minutes}:${seconds}`}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "4px 10px",
        background: "var(--surface2)",
        border: "1px solid var(--line2)",
        borderRadius: 999,
        fontSize: 12,
        lineHeight: 1,
        color: "var(--muted)",
      }}
    >
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <circle cx="12" cy="12" r="9" />
        <path d="M12 7v5l3 2" />
      </svg>
      <span className="tnum">{minutes}:{seconds}</span>
    </span>
  );
}
