/**
 * Dev-only warning that the app is talking to the production backend.
 *
 * Gated on `VITE_BACKEND_URL` itself rather than the probe's `VITE_ENV_SOURCE_BACKEND` flag:
 * an inline env var (`VITE_BACKEND_URL=... npm run dev`, see .claude/skills/qa-protocol/SKILL.md)
 * outranks every .env file, so it can desync the two — the probe's flag would then no longer
 * describe the URL the app actually uses. A non-localhost URL means writes from here reach
 * real data (see scripts/dev-env.mjs).
 *
 * `process.env.NODE_ENV` is inlined at build time, so in a production build the
 * early return is a constant and this whole component is dropped — it can never ship.
 */
export default function EnvBadge() {
  if (process.env.NODE_ENV !== "development") return null;

  const url = process.env.VITE_BACKEND_URL ?? "";
  // Local hosts are safe; anything else is a deployed backend holding real data.
  // An empty URL means VITE_BACKEND_URL is unset and the app falls back to .env's
  // localhost default, so it must NOT trigger the badge either.
  // Case-insensitive with an explicit terminator (not `\b`, which `.`/`-` also satisfy) so
  // `localhost.evil.com` doesn't hide the badge and `[::1]`/`LOCALHOST` don't falsely show it.
  if (url === "" || /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])([:/?#]|$)/i.test(url)) return null;

  return (
    <div
      style={{
        position: "fixed",
        bottom: 10,
        left: 10,
        zIndex: 9999,
        padding: "4px 10px",
        borderRadius: 6,
        background: "#b3261e",
        color: "#fff",
        font: "600 11px/1.2 system-ui, sans-serif",
        letterSpacing: 0.4,
        pointerEvents: "none",
      }}
      title="Local frontend is using the production backend."
    >
      PROD DATA
    </div>
  );
}
