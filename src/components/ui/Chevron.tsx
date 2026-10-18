/** A right-pointing chevron that sits vertically centred next to text. Use it inside an
 *  `inline-flex; align-items: center` link instead of a "›" / "→" glyph: text arrows ride the font's
 *  baseline and look low or high beside the label. */
export default function Chevron({ size = 14 }: { size?: number }) {
  return (
    <svg
      className="chev"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M9 6l6 6-6 6" />
    </svg>
  );
}
