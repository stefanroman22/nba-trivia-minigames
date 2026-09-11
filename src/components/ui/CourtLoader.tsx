import { useId, type CSSProperties } from "react";
import { useReducedMotionSafe } from "../../hooks/useReducedMotionSafe";

interface CourtLoaderProps {
  label?: string;
  scale?: number;
}

const CYCLE = "1.6s";

/** Basketball arcs up and swishes through the hoop — the brand loading state. */
export default function CourtLoader({ label = "Warming up the court…", scale = 1 }: CourtLoaderProps) {
  const reduce = useReducedMotionSafe();
  const s = scale;
  const gradId = useId();

  const netStyle: CSSProperties = {
    transformOrigin: "40px 27px",
    animation: reduce ? undefined : `clNetSwish ${CYCLE} ease-in-out infinite`,
  };
  const hoopSvgStyle: CSSProperties = {
    position: "absolute", top: 0, left: "50%", transform: "translateX(-50%)", overflow: "visible",
  };

  return (
    <div
      role="status"
      aria-live="polite"
      aria-label={label}
      style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 14 }}
    >
      <div style={{ position: "relative", width: 90 * s, height: 118 * s, "--s": s } as CSSProperties}>
        {/* Back layer: backboard, full rim, far side of the net. The ball renders on top of this. */}
        <svg viewBox="0 0 80 70" width={80 * s} height={70 * s} style={hoopSvgStyle} aria-hidden>
          <rect x="23" y="3" width="34" height="21" rx="2" fill="none" stroke="var(--line2)" strokeWidth="2" />
          <rect x="34" y="9" width="12" height="9" fill="none" stroke="var(--brand)" strokeWidth="2" />
          <ellipse cx="40" cy="26" rx="19" ry="4.5" fill="none" stroke="var(--brand)" strokeWidth="3" />
          <path
            d="M31 27 L35 50 M49 27 L45 50 M30 36 L50 36 M33 44 L47 44"
            stroke="var(--line2)" strokeWidth="1.2" fill="none" opacity=".35"
            style={netStyle}
          />
        </svg>

        {/* Ball: X runs at constant velocity, Y follows gravity, spin is linear backspin. */}
        <div
          style={{
            position: "absolute", left: "50%", top: 18 * s, marginLeft: -13 * s,
            width: 26 * s, height: 26 * s,
            animation: reduce ? undefined : `clBallX ${CYCLE} linear infinite`,
          }}
        >
          <div
            style={{
              width: "100%", height: "100%",
              filter: "drop-shadow(0 3px 3px rgba(0,0,0,.38))",
              animation: reduce ? undefined : `clBallY ${CYCLE} linear infinite`,
            }}
          >
            <svg
              viewBox="0 0 32 32" width={26 * s} height={26 * s}
              style={{ display: "block", animation: reduce ? undefined : `clBallSpin ${CYCLE} linear infinite` }}
              aria-hidden
            >
              <defs>
                <radialGradient id={gradId} cx="36%" cy="30%" r="72%">
                  <stop offset="0" stopColor="#ffb266" />
                  <stop offset=".5" stopColor="#ff7a1a" />
                  <stop offset="1" stopColor="#bf4a0b" />
                </radialGradient>
              </defs>
              <circle cx="16" cy="16" r="15" fill={`url(#${gradId})`} stroke="#7a3a0a" strokeWidth="1.4" />
              <path d="M1 16h30M16 1v30M5 5c6 5 6 17 0 22M27 5c-6 5-6 17 0 22" fill="none" stroke="#7a3a0a" strokeWidth="1.3" />
            </svg>
          </div>
        </div>

        {/* Front layer: near side of the rim and net, drawn over the ball so it visibly drops through. */}
        <svg viewBox="0 0 80 70" width={80 * s} height={70 * s} style={{ ...hoopSvgStyle, pointerEvents: "none" }} aria-hidden>
          <path d="M21 26 A19 4.5 0 0 0 59 26" fill="none" stroke="var(--brand)" strokeWidth="3" strokeLinecap="round" />
          <path
            d="M22 27 L29 49 M40 27 L40 51 M58 27 L51 49 M28 34 L52 34 M31 42 L49 42"
            stroke="var(--line2)" strokeWidth="1.3" fill="none" opacity=".8"
            style={netStyle}
          />
        </svg>
      </div>
      {label && (
        <p style={{ fontSize: 14, color: "var(--muted)", letterSpacing: ".3px", animation: reduce ? undefined : "loaderPulse 1.25s ease-in-out infinite" }}>
          {label}
        </p>
      )}
    </div>
  );
}
