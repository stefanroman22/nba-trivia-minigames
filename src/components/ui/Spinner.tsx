interface SpinnerProps {
  size?: number;
  label?: string;
}

/**
 * Minimal brand-orange ring spinner for compact/inline loading states — e.g. the
 * end-of-game score slot. (The full-screen brand loader is CourtLoader; use that
 * for whole-stage loading, this for small centered spots.)
 */
export default function Spinner({ size = 30, label }: SpinnerProps) {
  return (
    <div
      role="status"
      aria-live="polite"
      aria-label={label || "Loading"}
      style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 10 }}
    >
      <span className="spinner-ring" style={{ width: size, height: size }} />
      {label && (
        <span style={{ fontSize: 12.5, color: "var(--muted)", letterSpacing: "0.3px" }}>{label}</span>
      )}
    </div>
  );
}
