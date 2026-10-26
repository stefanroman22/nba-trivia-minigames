// The two-colour gradient Name the NBA Club fills the team name with (the revealed answer on the board,
// and each round in the answer review). Team colours are often too dark (Nets #000000, Nuggets #0E2240)
// or too light (Spurs #C4CED4, Bucks cream) for the surface, so each stop is tinted toward white on the
// dark theme or shaded toward black on the light one, in small steps and keeping its hue, until it
// reaches WCAG 2.x contrast >= 4.5:1 against every background of the surface the name sits on.
// Pure: no DOM. Tested by `npm run test:team-name-gradient`.
import { nbaTeamColors, type TeamColor } from "../constants/nbaTeamColors";
import { franchiseIdForName } from "../constants/teamLogos";

export type NameTheme = "dark" | "light";
/** Where the name sits: the game board, or a row of the answer review modal. */
export type NameSurface = "board" | "review";
export type GradientStops = [string, string];

export const MIN_CONTRAST = 4.5;

/**
 * What the name sits on in each theme: the game stage (`.stage-shell` in ui.css), `--surface` under a
 * translucent `--brand-soft` glow from the top and the faint `--line` dot grid (`.stage-dots`, 0.4).
 * Each list is the plain surface plus the worst case (full glow and a dot on top), so a stop that
 * clears both reads anywhere on the board.
 *   dark:  #1c1c1e; + rgba(255,106,26,.14) + rgba(255,255,255,.09 x .4) = #432f26
 *   light: #ffffff; + rgba(255,106,26,.12) + rgba(20,18,15,.10 x .4)    = #f6e4db
 */
export const NAME_BACKGROUNDS: Record<NameTheme, readonly string[]> = {
  dark: ["#1c1c1e", "#432f26"],
  light: ["#ffffff", "#f6e4db"],
};

/**
 * Every surface's backgrounds per theme. The review: the round row (`.ar-round` in AnswerReview.css,
 * opaque `--surface2`) inside the modal panel (`.modal-panel` in Modal.css, `--surface`).
 *   dark:  #232327, #1c1c1e        light: #f4f1ea, #ffffff
 */
export const NAME_SURFACES: Record<NameSurface, Record<NameTheme, readonly string[]>> = {
  board: NAME_BACKGROUNDS,
  review: {
    dark: ["#232327", "#1c1c1e"],
    light: ["#f4f1ea", "#ffffff"],
  },
};

// --brand into --brand2 (theme.css), for a name with no team colours. Two shades of one orange are
// meant to be close, so there is no third colour to swap in.
const BRAND: TeamColor = { primary: "#ff6a1a", secondary: "#ff8a3d", tertiary: "#ff8a3d" };

// Below this RGB distance two stops read as one colour, and the tertiary is tried instead.
const DISTINCT = 60;
// Tint/shade step: 2% toward white or black per try.
const STEPS = 50;

type RGB = [number, number, number];

function toRgb(hex: string): RGB {
  let h = hex.replace("#", "").trim();
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) || 0) as RGB;
}

function toHex(rgb: readonly number[]): string {
  return "#" + rgb.map((c) => Math.round(Math.min(255, Math.max(0, c))).toString(16).padStart(2, "0")).join("");
}

function mix(a: RGB, b: RGB, t: number): RGB {
  return [0, 1, 2].map((i) => a[i] + (b[i] - a[i]) * t) as RGB;
}

function luminance(hex: string): number {
  const [r, g, b] = toRgb(hex).map((c) => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG 2.x contrast ratio between two hex colours (1 to 21). */
export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

function minContrast(hex: string, backgrounds: readonly string[]): number {
  return Math.min(...backgrounds.map((bg) => contrastRatio(hex, bg)));
}

/**
 * `hex` as is when it already reaches `min` contrast against every background; otherwise tinted toward
 * white (dark backgrounds) or shaded toward black (light ones) in 2% steps until it does.
 */
export function legibleColor(hex: string, backgrounds: readonly string[], min = MIN_CONTRAST): string {
  const target: RGB = minContrast("#ffffff", backgrounds) >= minContrast("#000000", backgrounds) ? [255, 255, 255] : [0, 0, 0];
  const rgb = toRgb(hex);
  for (let step = 0; step <= STEPS; step++) {
    const c = toHex(mix(rgb, target, step / STEPS));
    if (minContrast(c, backgrounds) >= min) return c;
  }
  return toHex(target);
}

function distance(a: string, b: string): number {
  const [x, y] = [toRgb(a), toRgb(b)];
  return Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]);
}

// The browser blends the stops in sRGB, and the blend of two passing colours can dip below them
// (two saturated hues meet in a darker middle): check the gradient itself at 200 points, against a
// small margin over 4.5:1 so no shade the browser renders between two samples falls under it.
const GRADIENT_SAMPLES = 200;
const GRADIENT_TARGET = 4.55;
function gradientPasses(a: string, b: string, backgrounds: readonly string[]): boolean {
  for (let i = 0; i <= GRADIENT_SAMPLES; i++) {
    if (minContrast(toHex(mix(toRgb(a), toRgb(b), i / GRADIENT_SAMPLES)), backgrounds) < GRADIENT_TARGET) return false;
  }
  return true;
}

/** The team's colours, following relocations and renames ("Seattle SuperSonics" → the Thunder's). */
export function teamColorsFor(name?: string | null, teamId?: number | null): TeamColor | null {
  if (name && nbaTeamColors[name]) return nbaTeamColors[name];
  const id = franchiseIdForName(name) ?? teamId;
  if (!id) return null;
  const current = Object.keys(nbaTeamColors).find((key) => franchiseIdForName(key) === id);
  return current ? nbaTeamColors[current] : null;
}

/**
 * The name's gradient stops against `background` (one colour or every colour it may sit on): the
 * team's primary then secondary (the tertiary when the secondary ends up indistinct from the primary),
 * each made legible. The brand gradient for a name without colours.
 */
export function teamNameGradient(
  name: string | null | undefined,
  background: string | readonly string[],
  teamId?: number | null,
): GradientStops {
  const backgrounds = typeof background === "string" ? [background] : background;
  const colors = teamColorsFor(name, teamId) ?? BRAND;
  let stops: GradientStops = ["#000000", "#000000"];
  // Raise the bar a quarter step at a time only when the blend between the stops dips below the target.
  for (let min = GRADIENT_TARGET; min <= 21; min += 0.25) {
    const [p, s, t] = [colors.primary, colors.secondary, colors.tertiary].map((c) => legibleColor(c, backgrounds, min));
    stops = [p, distance(p, s) < DISTINCT && distance(p, t) > distance(p, s) ? t : s];
    if (gradientPasses(stops[0], stops[1], backgrounds)) break;
  }
  return stops;
}

/** Both themes' stops on `surface`, for the two CSS custom properties the name picks between. */
export function teamNameGradients(
  name: string | null | undefined,
  teamId?: number | null,
  surface: NameSurface = "board",
): Record<NameTheme, GradientStops> {
  return {
    dark: teamNameGradient(name, NAME_SURFACES[surface].dark, teamId),
    light: teamNameGradient(name, NAME_SURFACES[surface].light, teamId),
  };
}
