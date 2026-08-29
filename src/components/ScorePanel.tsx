import { Button } from "./ui";

interface ScorePanelProps {
  /** Final score (the big number). */
  score: number;
  /** Optional lead-in, e.g. "Board cleared!", "Out of guesses", "Found 5/8". */
  label?: string;
  /** Optional "/N" cap shown after the score. */
  outOf?: number;
  /** Tint the label green (a win / perfect finish). */
  won?: boolean;
  onPlayAgain?: () => void;
  /** Closes the game and returns to the idle screen. */
  onClose?: () => void;
}

/**
 * Standard end-of-game score line + Play again, shown in the EndSequence "score"
 * slot. Shared across every answers-shown game so their end screens match.
 */
export default function ScorePanel({ score, label, outOf, won, onPlayAgain, onClose }: ScorePanelProps) {
  return (
    <div className="scorepanel">
      <div className="scorepanel-line">
        {label && (
          <span className="scorepanel-label" style={won ? { color: "var(--good)" } : undefined}>
            {label}
          </span>
        )}
        <span className="scorepanel-pts tnum">
          {score}{outOf != null ? `/${outOf}` : ""} pts
        </span>
      </div>
      {(onPlayAgain || onClose) && (
        <div style={{ display: "flex", gap: 10 }}>
          {onPlayAgain && <Button size="sm" onClick={onPlayAgain}>Play again</Button>}
          {onClose && <Button size="sm" variant="secondary" onClick={onClose}>Close game</Button>}
        </div>
      )}
    </div>
  );
}
