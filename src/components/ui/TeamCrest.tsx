import { useEffect, useMemo, useState } from "react";
import { currentLogoUrl } from "../../constants/teamLogos";

interface TeamCrestProps {
  /** The period-accurate logo from the game data (tried first). */
  src?: string | null;
  name: string;
  /** Rendered size in px (ignored when `className` drives sizing). */
  size?: number;
  className?: string;
  style?: React.CSSProperties;
}

/**
 * A team logo that degrades gracefully and never renders blank/broken:
 *   1. the period-accurate logo from the data,
 *   2. the team's current logo (NBA CDN, incl. relocated/renamed franchises),
 *   3. a generated basketball crest (last resort, e.g. a defunct franchise).
 * Each candidate is tried in turn on load error.
 */
export default function TeamCrest({ src, name, size = 40, className, style }: TeamCrestProps) {
  const candidates = useMemo(() => {
    const list: string[] = [];
    if (src) list.push(src);
    const current = currentLogoUrl(name);
    if (current && current !== src) list.push(current);
    return list;
  }, [src, name]);

  const [idx, setIdx] = useState(0);
  // Restart the chain whenever the team (or its data logo) changes.
  useEffect(() => setIdx(0), [src, name]);

  const url = candidates[idx];

  if (!url) {
    // Generated basketball crest.
    return (
      <svg
        className={className}
        width={className ? undefined : size}
        height={className ? undefined : size}
        viewBox="0 0 24 24"
        role="img"
        aria-label={name}
        style={style}
      >
        <circle cx="12" cy="12" r="9.5" fill="#e8743b" />
        <g stroke="rgba(0,0,0,0.55)" strokeWidth="1.3" fill="none" strokeLinecap="round">
          <circle cx="12" cy="12" r="9.5" stroke="rgba(0,0,0,0.45)" strokeWidth="1" />
          <line x1="2.6" y1="12" x2="21.4" y2="12" />
          <line x1="12" y1="2.6" x2="12" y2="21.4" />
          <path d="M5.4 5.4C9 8.2 9 15.8 5.4 18.6" />
          <path d="M18.6 5.4C15 8.2 15 15.8 18.6 18.6" />
        </g>
      </svg>
    );
  }

  return (
    <img
      key={url}
      src={url}
      alt={name}
      className={className}
      width={className ? undefined : size}
      height={className ? undefined : size}
      style={className ? style : { width: size, height: size, objectFit: "contain", ...style }}
      onError={() => setIdx((i) => i + 1)}
    />
  );
}
