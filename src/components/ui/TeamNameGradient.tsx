import { Fragment, useMemo } from "react";
import { teamNameGradients, type NameSurface } from "../../utils/teamNameGradient";
import "../../styles/TeamNameGradient.css";

interface TeamNameGradientProps {
  /** The team name: its colours and its text. */
  name: string;
  teamId?: number | null;
  /** What the name sits on: each stop is >= 4.5:1 against that surface's backgrounds in both themes. */
  surface: NameSurface;
  /** Keep the element (and its colours) but leave the text out of the DOM, e.g. before the answer. */
  blank?: boolean;
  className?: string;
}

/**
 * A team name filled with its team's two colours (src/utils/teamNameGradient.ts), in place of the
 * team's logo. Font, size and weight come from the parent; only the fill is set here
 * (TeamNameGradient.css). A "/" in a name ("New Orleans/Oklahoma City Hornets") may break the line.
 */
export default function TeamNameGradient({ name, teamId, surface, blank = false, className }: TeamNameGradientProps) {
  const style = useMemo(() => {
    const { dark, light } = teamNameGradients(name, teamId, surface);
    return {
      "--tng-a-dark": dark[0], "--tng-b-dark": dark[1], "--tng-a-light": light[0], "--tng-b-light": light[1],
    } as React.CSSProperties;
  }, [name, teamId, surface]);

  return (
    <span className={className ? `tng ${className}` : "tng"} style={style}>
      {!blank &&
        name.split("/").map((part, i) => (
          <Fragment key={i}>{i > 0 && <>/<wbr /></>}{part}</Fragment>
        ))}
    </span>
  );
}
