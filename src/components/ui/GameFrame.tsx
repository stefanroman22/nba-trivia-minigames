import { Children, type ReactNode } from "react";

/** True when a slot was given nothing renderable. `Children.toArray` already
 *  drops null/undefined/booleans, so an empty result means "nothing to show". */
const isEmpty = (children: ReactNode) => Children.toArray(children).length === 0;

/**
 * The shared game layout. Every game renderer's root MUST be a <GameFrame>.
 *
 * Why this exists: the spec used to describe the layout in prose and each of the
 * 18 games re-implemented it, which produced 8 different root gaps and 7 different
 * widths — games that passed every static check still looked nothing alike.
 * GameFrame owns the rhythm so a game *cannot* express a different one:
 *
 *   - the root's width, max-width and 20px gap are not overridable by games
 *   - Status / Progress / Prompt are fixed slots you pass content into
 *   - Board is the ONLY free-form region (a hex grid and a 4x4 tile grid really
 *     are different; everything around them is not)
 *   - Action is the pinned bottom slot (input row, EndSequence, buttons)
 *
 * Games must not set gap/margin/padding on anything they pass in at the top level.
 */
interface GameFrameProps {
  /**
   * Fill games grow their Board to consume the stage height — use ONLY when the
   * Board genuinely scrolls internally (`overflow-y:auto`), e.g. a results feed.
   * A fixed-size board (hex grid, 3x3, 4x4) is NOT a fill game: flex:1 on a
   * non-scrolling board just strands it in dead space. See Rule 4.1.
   */
  fill?: boolean;
  children: ReactNode;
}

function GameFrame({ fill = false, children }: GameFrameProps) {
  return <div className={`gf${fill ? " gf--fill" : ""}`}>{children}</div>;
}

/**
 * Top row: a muted label on the left, the score group on the right.
 *
 * Empty slots are NOT rendered. That matters for alignment: a lone left label
 * centres itself, while a lone right group stays right-aligned (see the
 * `:only-child` rules in ui.css). Rendering an empty span instead would leave a
 * zero-width element plus the row's 14px gap, which pins the lone label to the
 * left edge and offsets any centring attempt by half the gap.
 */
function Status({ left, right }: { left?: ReactNode; right?: ReactNode }) {
  const hasLeft = !isEmpty(left);
  const hasRight = !isEmpty(right);
  return (
    <div className="gf-status">
      {hasLeft && <span className="gf-status-left">{left}</span>}
      {hasRight && <span className="gf-status-right">{right}</span>}
    </div>
  );
}

/** The standard `SCORE 120` group — same type, colour and spacing in every game. */
function Score({ value, label = "SCORE" }: { value: number; label?: string }) {
  return (
    <span className="gf-score">
      <span className="gf-score-label">{label}</span>
      <span className="gf-score-value tnum">{value}</span>
    </span>
  );
}

/** `ROUND 1/5`-style left label. Uppercase, muted, fixed type. */
function Label({ children }: { children: ReactNode }) {
  return <span className="gf-status-label">{children}</span>;
}

/** Context line + question. Same 6px stack, same colours, in every game. */
function Prompt({ eyebrow, title }: { eyebrow?: ReactNode; title?: ReactNode }) {
  if (!eyebrow && !title) return null;
  return (
    <div className="gf-prompt">
      {eyebrow && <span className="gf-eyebrow">{eyebrow}</span>}
      {title && <h3 className="gf-title font-display">{title}</h3>}
    </div>
  );
}

/** The only free-form region — your board, grid, cards, feed. */
function Board({ children }: { children: ReactNode }) {
  return <div className="gf-board">{children}</div>;
}

/**
 * Bottom slot: input row, EndSequence, action buttons.
 *
 * Games split into two families and each family must be internally identical:
 *   - WITH an action (input + Confirm, or a button row) — Board sits above a real
 *     Action block, one root gap below it.
 *   - WITHOUT one (Series Winner's VS cards, Connections' tile board) — the slot
 *     renders NOTHING so it contributes no node and no root gap. Rendering an
 *     empty div here would add a phantom 20px and make the two families
 *     mis-align against each other.
 *
 * So always mount <GameFrame.Action> unconditionally and let it decide; don't
 * wrap it in your own `{cond && …}`, or the two families drift apart again.
 */
function Action({ children }: { children: ReactNode }) {
  if (isEmpty(children)) return null;
  return <div className="gf-action">{children}</div>;
}

/**
 * The standard submission row: a growing input followed by its confirm button(s).
 * Every game that takes a typed answer uses this, so the with-input family all
 * share one width, one gap and one control height. Put it inside <Action>.
 */
function InputRow({ children }: { children: ReactNode }) {
  return <div className="gf-inputrow">{children}</div>;
}

GameFrame.Status = Status;
GameFrame.Score = Score;
GameFrame.Label = Label;
GameFrame.Prompt = Prompt;
GameFrame.Board = Board;
GameFrame.Action = Action;
GameFrame.InputRow = InputRow;

export default GameFrame;
