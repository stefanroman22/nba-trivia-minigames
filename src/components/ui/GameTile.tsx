import { useEffect, useState, type MouseEvent } from "react";
import { motion } from "framer-motion";
import { useReducedMotionSafe } from "../../hooks/useReducedMotionSafe";
import { backgroundUrl } from "../../utils/GameUtils";
import SwapText from "../motion/SwapText";

interface GameTileProps {
  name: string;
  description: string;
  backgroundImage: string; // already a CSS url(...) value
  tag?: string;
  pointLabel?: string;
  cta?: string;
  onClick?: () => void;
  /** Renders the tile as a real link to this path (crawlable, opens in a new tab with a modified
   *  click); a plain click still runs `onClick` so the page transition plays. */
  href?: string;
  index?: number;
  /** Renders the tile as not-clickable (e.g. the "Coming soon" placeholder). */
  disabled?: boolean;
  /** Grey, desaturated "already played" look. Pair with `disabled` to block clicks. */
  dimmed?: boolean;
  /** "muted" paints the CTA in the neutral text token instead of the brand orange. */
  ctaTone?: "default" | "muted";
  /** Identifies the CTA state for the text swap (defaults to `cta`): pass a stable
   *  key so a ticking label (a countdown) updates in place and only a real state
   *  change animates. */
  ctaSwapKey?: string;
}

/** The game card used in grids. Image zooms on hover, lifts, presses on click. */
export default function GameTile({
  name,
  description,
  backgroundImage,
  cta = "Play now",
  onClick,
  href,
  index = 0,
  disabled = false,
  dimmed = false,
  ctaTone = "default",
  ctaSwapKey,
}: GameTileProps) {
  const reduce = useReducedMotionSafe();

  // The photo mounts only client-side, post-hydration. In the server-rendered
  // markup even loading="lazy" images fetch immediately (Chrome's lazy
  // threshold spans kilopixels), and 18 tile JPGs would crowd the bandwidth
  // the first paint needs. Until then the tile shows its scrim + text.
  const [showImg, setShowImg] = useState(false);
  useEffect(() => setShowImg(true), []);

  // A link when it leads somewhere and is playable; otherwise the original button.
  const asLink = Boolean(href) && !disabled;
  const Tag = asLink ? motion.a : motion.button;
  const tagProps = asLink
    ? {
        href,
        onClick: (e: MouseEvent<HTMLElement>) => {
          // Let the browser handle new-tab / new-window clicks; a plain click uses the app transition.
          if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0 || !onClick) return;
          e.preventDefault();
          onClick();
        },
      }
    : { onClick: disabled ? undefined : onClick, disabled, "aria-disabled": disabled };

  return (
    <Tag
      {...tagProps}
      className={`gtile${disabled ? " is-disabled" : ""}${dimmed ? " is-dimmed" : ""}`}
      initial={reduce ? false : { opacity: 0, y: 16 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, amount: 0.25 }}
      transition={{ duration: 0.38, ease: [0.22, 1, 0.36, 1], delay: Math.min(index * 0.04, 0.24) }}
      whileHover={reduce || disabled ? undefined : { y: -4 }}
      whileTap={reduce || disabled ? undefined : { scale: 0.98, y: 0 }}
    >
      {showImg && (
        <img
          className="gtile-img"
          src={backgroundUrl(backgroundImage)}
          alt=""
          loading="lazy"
          decoding="async"
          draggable={false}
        />
      )}
      <div className="gtile-scrim" />
      <div className="gtile-body">
       
        <div style={{ display: "flex", flexDirection: "column", gap: 5, width: "100%" }}>
          <h3 className="font-display" style={{ fontSize: 18, color: "#fff" }}>{name}</h3>
          <p style={{ fontSize: 12.5, color: "rgba(255,255,255,.78)", lineHeight: 1.4 }}>{description}</p>
          <span className={`gtile-cta${ctaTone === "muted" ? " gtile-cta--muted" : ""}`} style={{ marginTop: 6 }}>
            <SwapText className="gtile-cta-text" swapKey={ctaSwapKey ?? cta}>{cta}</SwapText>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
          </span>
        </div>
      </div>
    </Tag>
  );
}
