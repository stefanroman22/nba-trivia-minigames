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
  /** Renders the tile as not-clickable (e.g. the "Coming soon" placeholder). */
  disabled?: boolean;
}

/** The game card used in grids. Image zooms on hover, lifts, presses on click. */
export default function GameTile({
  name,
  description,
  backgroundImage,
  cta = "Play now",
  onClick,
  index = 0,
  disabled = false,
}: GameTileProps) {
  const reduce = useReducedMotion();

  return (
    <motion.button
      className={`gtile${disabled ? " is-disabled" : ""}`}
      onClick={disabled ? undefined : onClick}
      disabled={disabled}
      aria-disabled={disabled}
      aria-label={disabled ? name : `Play ${name}`}
      initial={reduce ? false : { opacity: 0, y: 16 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, amount: 0.25 }}
      transition={{ duration: 0.38, ease: [0.22, 1, 0.36, 1], delay: Math.min(index * 0.04, 0.24) }}
      whileHover={reduce || disabled ? undefined : { y: -4 }}
      whileTap={reduce || disabled ? undefined : { scale: 0.98, y: 0 }}
    >
      <div className="gtile-img" style={{ backgroundImage }} />
      <div className="gtile-scrim" />
      <div className="gtile-body">
       
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
