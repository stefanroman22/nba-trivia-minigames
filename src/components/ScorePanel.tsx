import type { CSSProperties } from "react";
import { Button } from "./ui";
import AnimatedNumber from "./motion/AnimatedNumber";

export interface ScoreLineProps {
  /** Final score (the big number). */
  score: number;
  /** Optional lead-in, e.g. "Board cleared!", "Out of guesses", "Found 5/8". */
  label?: string;
  /** Optional "/N" cap shown after the score. */
  outOf?: number;
  /** Tint the label green (a win / perfect finish). */
  won?: boolean;
}

export interface ScoreActionsProps {
  onPlayAgain?: () => void;
  /** Closes the game and returns to the idle screen. */
  onClose?: () => void;
}

/** The score line alone: optional label + the points, counted up via AnimatedNumber. */
export function ScoreLine({ score, label, outOf, won }: ScoreLineProps) {
  return (
    <div className="scorepanel-line">
      {label && (
        <span className="scorepanel-label" style={won ? { color: "var(--good)" } : undefined}>
          {label}
        </span>
      )}
      <span className="scorepanel-pts tnum">
        <span className="scorepanel-num" style={{ "--digits": (outOf ?? score).toLocaleString().length } as CSSProperties}>
          <AnimatedNumber value={score} />
        </span>
        {outOf != null ? `/${outOf.toLocaleString()}` : ""} pts
      </span>
    </div>
  );
}

/** Play again + Close game; renders nothing when neither handler is given. */
export function ScoreActions({ onPlayAgain, onClose }: ScoreActionsProps) {
  if (!onPlayAgain && !onClose) return null;
  return (
    <div className="scorepanel-actions">
      {onPlayAgain && <Button size="sm" onClick={onPlayAgain}>Play again</Button>}
      {onClose && <Button size="sm" variant="secondary" onClick={onClose}>Close game</Button>}
    </div>
  );
}

/**
 * Standard end-of-game score panel for the EndSequence "score" slot, shared across
 * every answers-shown game so their end screens match: `ScoreLine` + `ScoreActions`;
 * a game that puts its result at the top of the frame renders the two halves in
 * different slots (Career Path).
 */
export default function ScorePanel({ score, label, outOf, won, onPlayAgain, onClose }: ScoreLineProps & ScoreActionsProps) {
  return (
    <div className="scorepanel">
      <ScoreLine score={score} label={label} outOf={outOf} won={won} />
      <ScoreActions onPlayAgain={onPlayAgain} onClose={onClose} />
    </div>
  );
}
