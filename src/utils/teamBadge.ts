// What a team badge (components/ui/TeamBadge) shows in place of a team logo: the team's abbreviation
// on its primary colour, with a ring in its secondary. Every colour is computed per theme and surface:
// the text reaches WCAG 2.x 4.5:1 against the fill, and the ring 3:1 (WCAG 1.4.11) against every
// background the badge sits on, because many fills (Nuggets, Wolves, Pelicans, Nets) all but vanish
// on the dark stage. Pure: no DOM. Tested by `npm run test:team-badge`.
import { TEAM_ABBR } from "../constants/teamAbbr";
import {
  DISTINCT, MIN_CONTRAST, NAME_SURFACES, contrastRatio, distance, legibleColor, teamColorsFor, type NameTheme,
} from "./teamNameGradient";

/** What the badge sits on: the game board, a choice button or card, or a row of the answer review. */
export type BadgeSurface = "board" | "card" | "review";

/** Contrast a badge's ring keeps against its surface (WCAG 1.4.11, non-text contrast). */
export const MIN_RING_CONTRAST = 3;

/**
 * Every background each surface puts under a badge, per theme. board and review are the team name's
 * (teamNameGradient.ts). card: the Series pick button and the Career Path card, `--surface2`, the
 * stage `--surface` around it, and the reveal states `--good-soft` / `--bad-soft` composited over
 * `--surface2` (the values below; the Series pick button paints them over `--surface` instead).
 *   dark:  #232327, #1c1c1e; + rgba(47,199,98,.16) = #253d30; + rgba(255,77,77,.16) = #462a2d
 *   light: #f4f1ea, #ffffff; + rgba(47,199,98,.14) = #d8ebd7; + rgba(255,77,77,.12) = #f5ddd7
 */
export const BADGE_SURFACES: Record<BadgeSurface, Record<NameTheme, readonly string[]>> = {
  board: NAME_SURFACES.board,
  card: {
    dark: ["#232327", "#1c1c1e", "#253d30", "#462a2d"],
    light: ["#f4f1ea", "#ffffff", "#d8ebd7", "#f5ddd7"],
  },
  review: NAME_SURFACES.review,
};

export interface BadgeColors {
  fill: string;
  text: string;
  ring: string;
}

// A team with no colours (defunct, unknown, ""): the inert surface fill, body text and a strong line.
const NEUTRAL: BadgeColors = { fill: "var(--surface3)", text: "var(--text)", ring: "var(--line2)" };

/**
 * The abbreviation to show: the curated TEAM_ABBR entry, else the row's own code (2-3 letters), else
 * the first three letters of the nickname. null for no name, or when the row passes `null` and the
 * name is not curated (the badge then shows no text).
 */
export function teamAbbr(name?: string | null, dataAbbr?: string | null): string | null {
  const key = name?.trim();
  if (!key) return null;
  if (TEAM_ABBR[key]) return TEAM_ABBR[key];
  if (dataAbbr === null) return null;
  if (dataAbbr && /^[a-z]{2,3}$/i.test(dataAbbr.trim())) return dataAbbr.trim().toUpperCase();
  const letters = teamNickname(key).replace(/[^a-z]/gi, "");
  return letters.length >= 2 ? letters.slice(0, 3).toUpperCase() : null;
}

/** The team's nickname: the last word ("Bucks", "76ers"), "Trail Blazers" kept whole. */
export function teamNickname(name: string): string {
  const key = name.trim();
  if (/trail blazers$/i.test(key)) return "Trail Blazers";
  const words = key.split(/[\s/]+/);
  return words[words.length - 1] || key;
}

function badgeColors(name: string | null | undefined, teamId: number | null | undefined, backgrounds: readonly string[]): BadgeColors {
  const colors = teamColorsFor(name, teamId);
  if (!colors) return NEUTRAL;
  const fill = colors.primary;
  // A team colour when it reads on the fill (identity first); white or black always does (>= 4.58:1).
  const text = [colors.secondary, colors.tertiary, "#ffffff", "#000000"].find((c) => contrastRatio(c, fill) >= MIN_CONTRAST) ?? "#ffffff";
  // The ring must clear the surface (3:1) and stay distinct from the fill, or it draws no visible edge
  // (Memphis: the tertiary ends at #7b7d7c on #5D76A9). Team colours first, then the text colour, white, black.
  const candidates = [colors.secondary, colors.tertiary, text, "#ffffff", "#000000"];
  const rings = candidates.map((c) => legibleColor(c, backgrounds, MIN_RING_CONTRAST));
  const ring = rings.find((c) => distance(c, fill) >= DISTINCT) ?? rings[0];
  return { fill, text, ring };
}

/** Both themes' badge colours on `surface`, for the CSS custom properties the badge picks between. */
export function teamBadgeColors(
  name: string | null | undefined,
  teamId: number | null | undefined,
  surface: BadgeSurface,
): Record<NameTheme, BadgeColors> {
  return {
    dark: badgeColors(name, teamId, BADGE_SURFACES[surface].dark),
    light: badgeColors(name, teamId, BADGE_SURFACES[surface].light),
  };
}
