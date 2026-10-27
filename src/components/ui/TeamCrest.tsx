/** A generated basketball crest (no team, no image request): Name the NBA Club's fallback when no
 *  scrambled puzzle image exists. Teams themselves show as TeamBadge. */
export function BasketballCrest({ label, size = 40, className, style }: {
  label: string;
  size?: number;
  className?: string;
  style?: React.CSSProperties;
}) {
  return (
    <svg
      className={className}
      width={className ? undefined : size}
      height={className ? undefined : size}
      viewBox="0 0 24 24"
      role="img"
      aria-label={label}
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
