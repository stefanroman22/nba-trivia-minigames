import { motion, useReducedMotion } from "framer-motion";

interface GameTileProps {
  name: string;
  description: string;
  backgroundImage: string; // already a CSS url(...) value
  tag?: string;
  pointLabel?: string;
  cta?: string;
  onClick?: () => void;
  index?: number;
}

/** The game card used in grids. Image zooms on hover, lifts, presses on click. */
export default function GameTile({
  name,
  description,
  backgroundImage,
  tag = "GAME",
  pointLabel,
  cta = "Play now",
  onClick,
  index = 0,
}: GameTileProps) {
  const reduce = useReducedMotion();

  return (
    <motion.button
      className="gtile"
      onClick={onClick}
      aria-label={`Play ${name}`}
      initial={reduce ? false : { opacity: 0, y: 18 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1], delay: Math.min(index * 0.06, 0.36) }}
      whileHover={reduce ? undefined : { y: -4 }}
      whileTap={reduce ? undefined : { scale: 0.98, y: 0 }}
    >
      <div className="gtile-img" style={{ backgroundImage }} />
      <div className="gtile-scrim" />
      <div className="gtile-body">
        <div style={{ display: "flex", justifyContent: "space-between", width: "100%", alignItems: "flex-start" }}>
          <span style={{ padding: "4px 9px", borderRadius: 6, background: "rgba(0,0,0,.45)", backdropFilter: "blur(4px)", fontSize: 10, letterSpacing: 1, fontWeight: 600, color: "#fff", border: "1px solid rgba(255,255,255,.18)" }}>
            {tag}
          </span>
          {pointLabel && (
            <span style={{ padding: "4px 9px", borderRadius: 6, background: "rgba(255,106,26,.9)", color: "#fff", fontSize: 10, fontWeight: 700, letterSpacing: 0.5 }}>
              {pointLabel}
            </span>
          )}
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 5, width: "100%" }}>
          <h3 className="font-display" style={{ fontSize: 18, color: "#fff" }}>{name}</h3>
          <p style={{ fontSize: 12.5, color: "rgba(255,255,255,.78)", lineHeight: 1.4 }}>{description}</p>
          <span className="gtile-cta" style={{ marginTop: 6 }}>
            {cta}
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
          </span>
        </div>
      </div>
    </motion.button>
  );
}
