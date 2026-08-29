/**
 * Dev-only warning that the app is talking to the production backend.
 *
 * Shown when `npm run dev` could not reach a local backend and fell back to the
 * deployed one (see scripts/dev-env.mjs) — writes from here reach real data.
 *
 * `import.meta.env.DEV` is statically false in a production build, so this whole
 * component is dropped at build time and can never ship.
 */
export default function EnvBadge() {
  if (!import.meta.env.DEV) return null;
  if (import.meta.env.VITE_ENV_SOURCE_BACKEND !== "remote") return null;

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
