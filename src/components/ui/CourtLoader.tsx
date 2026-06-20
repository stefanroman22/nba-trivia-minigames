import { useReducedMotion } from "framer-motion";

interface CourtLoaderProps {
  label?: string;
  scale?: number;
}

/** Basketball arcs up and swishes through the hoop — the brand loading state. */
export default function CourtLoader({ label = "Warming up the court…", scale = 1 }: CourtLoaderProps) {
  const reduce = useReducedMotion();
  const s = scale;

  return (
    <div
      role="status"
      aria-live="polite"
      aria-label={label}
      style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 14 }}
    >
      <div style={{ position: "relative", width: 90 * s, height: 118 * s }}>
        <svg viewBox="0 0 80 70" width={80 * s} height={70 * s} style={{ position: "absolute", top: 0, left: "50%", transform: "translateX(-50%)" }}>
          <rect x="23" y="3" width="34" height="21" rx="2" fill="none" stroke="var(--line2)" strokeWidth="2" />
          <rect x="34" y="9" width="12" height="9" fill="none" stroke="var(--brand)" strokeWidth="2" />
          <ellipse cx="40" cy="26" rx="19" ry="4.5" fill="none" stroke="var(--brand)" strokeWidth="3" />
          <path
            d="M22 27 L29 49 M40 27 L40 51 M58 27 L51 49 M28 34 L52 34 M31 42 L49 42"
            stroke="var(--line2)" strokeWidth="1.3" fill="none" opacity=".75"
            style={{ transformOrigin: "40px 27px", animation: reduce ? undefined : "netSway 1.45s ease-in-out infinite" }}
          />
        </svg>
        <div
          style={{
            position: "absolute", left: "50%", top: 18 * s, marginLeft: -13 * s,
            width: 26 * s, height: 26 * s,
            animation: reduce ? undefined : "shoot 1.45s cubic-bezier(.4,.05,.55,.95) infinite",
          }}
        >
          <svg viewBox="0 0 32 32" width={26 * s} height={26 * s}>
            <circle cx="16" cy="16" r="15" fill="#ff7a1a" stroke="#7a3a0a" strokeWidth="1.6" />
            <path d="M1 16h30M16 1v30M5 5c6 5 6 17 0 22M27 5c-6 5-6 17 0 22" fill="none" stroke="#7a3a0a" strokeWidth="1.3" />
          </svg>
        </div>
      </div>
      {label && (
        <p style={{ fontSize: 14, color: "var(--muted)", letterSpacing: ".3px", animation: reduce ? undefined : "loaderPulse 1.25s ease-in-out infinite" }}>
          {label}
        </p>
      )}
    </div>
  );
}
