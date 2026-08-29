/**
 * Dev-only warning that the app is talking to the production backend.
 *
 * Gated on `VITE_BACKEND_URL` itself rather than the probe's `VITE_ENV_SOURCE_BACKEND` flag:
 * Vite gives an inline `VITE_*` env var the highest precedence of all env sources, so someone
 * running e.g. `VITE_BACKEND_URL=... npm run dev` (see .claude/skills/qa-protocol/SKILL.md) can
 * desync the two — the probe's flag would then no longer describe the URL the app actually uses.
 * A non-localhost URL means writes from here reach real data (see scripts/dev-env.mjs).
 *
 * `import.meta.env.DEV` is statically false in a production build, so this whole
 * component is dropped at build time and can never ship.
 */
export default function EnvBadge() {
  if (!import.meta.env.DEV) return null;

  const url = import.meta.env.VITE_BACKEND_URL ?? "";
  // Local hosts are safe; anything else is a deployed backend holding real data.
  // An empty URL means VITE_BACKEND_URL is unset and the app falls back to .env's
  // localhost default, so it must NOT trigger the badge either.
  if (url === "" || /^https?:\/\/(localhost|127\.0\.0\.1)\b/.test(url)) return null;

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
      title="Local frontend is using the production backend — writes hit real data."
    >
      PROD DATA
    </div>
  );
}
