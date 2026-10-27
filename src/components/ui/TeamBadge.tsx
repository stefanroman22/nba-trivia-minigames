import { useMemo } from "react";
import SwapText from "../motion/SwapText";
import { teamAbbr, teamBadgeColors, type BadgeSurface } from "../../utils/teamBadge";
import "../../styles/TeamBadge.css";

export type { BadgeSurface };

interface TeamBadgeProps {
  /** Full team name as in the data: colour lookup, abbreviation lookup and aria-label. */
  name: string;
  /** The row's own abbreviation (playoff team_x_abbreviation); TEAM_ABBR wins when it has the name. null = no text. */
  abbr?: string | null;
  teamId?: number | null;
  /** px; default 40. Ignored when className sizes the box (s5-team-badge, cp-card-logo). */
  size?: number;
  /** Reuse the slot's existing size class so the box is identical to the old crest. */
  className?: string;
  /** "circle" (default) or "tile" (rounded square, radius 26%: Series Winner's 54px/14px tile). */
  shape?: "circle" | "tile";
  /** What the badge sits on: picks the backgrounds the ring must clear at 3:1. */
  surface: BadgeSurface;
  /** aria-hidden when the full name is visible next to it; otherwise role="img" aria-label={name}. */
  decorative?: boolean;
}

// The abbreviation swaps in place when the team changes (Rule 5.1: media in a fixed box, opacity only).
const ABBR_FADE = { initial: { opacity: 0 }, animate: { opacity: 1 }, exit: { opacity: 0 } };

/**
 * A team shown by its abbreviation on its colours (src/utils/teamBadge.ts), in place of the team's
 * logo: never an image, never a network request. Both themes' colours are CSS custom properties
 * (TeamBadge.css), so a theme switch needs no re-render. Below 28px it draws a two-colour swatch
 * without text, so use that size only where the name is shown next to it. Fill and ring change with a
 * 0.25 s transition; the abbreviation cross-fades (SwapText) when the team changes.
 */
export default function TeamBadge({
  name, abbr, teamId, size, className, shape = "circle", surface, decorative = false,
}: TeamBadgeProps) {
  const style = useMemo(() => {
    const { dark, light } = teamBadgeColors(name, teamId, surface);
    const px = className ? undefined : (size ?? 40);
    return {
      "--tb-fill-dark": dark.fill, "--tb-text-dark": dark.text, "--tb-ring-dark": dark.ring,
      "--tb-fill-light": light.fill, "--tb-text-light": light.text, "--tb-ring-light": light.ring,
      ...(px !== undefined ? { width: px, height: px } : null),
    } as React.CSSProperties;
  }, [name, teamId, surface, size, className]);
  const text = teamAbbr(name, abbr);
  const a11y = decorative ? { "aria-hidden": true as const } : { role: "img", "aria-label": name };

  return (
    <span className={`tbadge tbadge--${shape}${className ? ` ${className}` : ""}`} style={style} {...a11y}>
      <span className="tbadge-face">
        <SwapText swapKey={text ?? ""} variants={ABBR_FADE}>
          {text && <span className="tbadge-abbr">{text}</span>}
        </SwapText>
      </span>
    </span>
  );
}
