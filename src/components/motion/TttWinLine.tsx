// Tic-Tac-Toe strokes: the win line drawn across three cells of `TttBoard`, and the X / O marks of local multiplayer.
// Both draw themselves (pathLength 0 → 1) on the shared tokens, the way SuccessBadge draws its check; under reduced
// motion they are shown at once (UI-20). Decorative: the cell's and the board's labels carry the meaning.
import { useId, useLayoutEffect, useRef, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { durations, easing } from "../../motion/tokens";

/** The draw transition of the X / O marks. */
const DRAW = { duration: durations.slow, ease: easing.out };
/** The win line: two mark-lengths on the house ease-in-out, so it sets off softly, sweeps across and settles into
 *  its end (a spring token front-loads it: the line was nearly whole after a quarter of a second). */
const LINE_DRAW = { duration: durations.slow * 2, ease: easing.inOut };
/** How long the win line takes before what follows it (the result, Play again). */
export const TTT_DRAW_MS = LINE_DRAW.duration * 1000;

/** The win line's gradient stops along its length, from the theme tokens (no new hue): orange for X (deep → brand →
 *  light), near-white for the online duel and an O win (muted → text). */
const LINE_STOPS: Record<"brand" | "text", string[]> = {
  brand: ["var(--brand-deep)", "var(--brand)", "var(--brand2)"],
  text: ["var(--muted)", "var(--text)", "var(--text)"],
};

export type TttMarkKind = "X" | "O";

/** A stroke-drawn X (brand) or O (text colour): one accent (GAME_DESIGN Rule 0.1). `draw` = animate it in. */
export function TttMark({ mark, draw = true, className }: { mark: TttMarkKind; draw?: boolean; className?: string }) {
  const reduce = useReducedMotion();
  const animate = draw && !reduce;
  const paths = mark === "X" ? ["M6 6l12 12", "M18 6L6 18"] : ["M12 4.5a7.5 7.5 0 1 1 0 15a7.5 7.5 0 1 1 0-15"];
  return (
    <svg
      className={`ttt-mark ttt-mark--${mark === "X" ? "x" : "o"}${className ? ` ${className}` : ""}`}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.6"
      strokeLinecap="round"
      aria-hidden="true"
    >
      {paths.map((d, i) =>
        animate ? (
          <motion.path
            key={d}
            d={d}
            initial={{ pathLength: 0 }}
            animate={{ pathLength: 1 }}
            // The X's second stroke follows the first.
            transition={{ ...DRAW, delay: i * durations.fast }}
          />
        ) : (
          <path key={d} d={d} />
        ),
      )}
    </svg>
  );
}

interface Segment {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  w: number;
  h: number;
}

/**
 * The win line: an SVG stroke over the three cells of `line` (row-major indices into the board's nine
 * `[role="gridcell"]` buttons). It sits absolutely over the cell area of `.ttt-grid` (CSS `.ttt-winline`), measures
 * the cells it crosses (and again on resize), and runs a little past both end cells' centres.
 */
export default function TttWinLine({ line, tone = "text" }: { line: readonly number[]; tone?: "brand" | "text" }) {
  const ref = useRef<SVGSVGElement>(null);
  const [seg, setSeg] = useState<Segment | null>(null);
  const reduce = useReducedMotion();
  const gradientId = `ttt-winline-${useId().replace(/:/g, "")}`;
  const first = line[0];
  const last = line[line.length - 1];

  useLayoutEffect(() => {
    const svg = ref.current;
    const grid = svg?.parentElement;
    if (!svg || !grid) return;
    const measure = () => {
      const cells = grid.querySelectorAll<HTMLElement>('[role="gridcell"]');
      const a = cells[first]?.getBoundingClientRect();
      const b = cells[last]?.getBoundingClientRect();
      const box = svg.getBoundingClientRect();
      if (!a || !b || !box.width) return;
      const ax = a.left + a.width / 2 - box.left;
      const ay = a.top + a.height / 2 - box.top;
      const bx = b.left + b.width / 2 - box.left;
      const by = b.top + b.height / 2 - box.top;
      // Overshoot each end by a third of a cell along the line, so it reads as crossing the cells.
      const len = Math.hypot(bx - ax, by - ay) || 1;
      const ext = Math.min(a.width, a.height) / 3;
      const ux = ((bx - ax) / len) * ext;
      const uy = ((by - ay) / len) * ext;
      setSeg({ x1: ax - ux, y1: ay - uy, x2: bx + ux, y2: by + uy, w: box.width, h: box.height });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(grid);
    return () => ro.disconnect();
  }, [first, last]);

  return (
    <svg
      ref={ref}
      className={`ttt-winline ttt-winline--${tone}`}
      viewBox={seg ? `0 0 ${seg.w} ${seg.h}` : undefined}
      aria-hidden="true"
    >
      {seg && (
        <>
          {/* User-space gradient along the stroke: a bounding-box gradient breaks on a horizontal or vertical
              line (its box has zero height or width). */}
          <defs>
            <linearGradient id={gradientId} gradientUnits="userSpaceOnUse" x1={seg.x1} y1={seg.y1} x2={seg.x2} y2={seg.y2}>
              {LINE_STOPS[tone].map((color, i, all) => (
                <stop key={i} offset={i / (all.length - 1)} style={{ stopColor: color }} />
              ))}
            </linearGradient>
          </defs>
          <motion.line
            x1={seg.x1}
            y1={seg.y1}
            x2={seg.x2}
            y2={seg.y2}
            stroke={`url(#${gradientId})`}
            initial={reduce ? false : { pathLength: 0 }}
            animate={{ pathLength: 1 }}
            transition={LINE_DRAW}
          />
        </>
      )}
    </svg>
  );
}
