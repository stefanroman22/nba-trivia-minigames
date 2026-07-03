import { useRef, useState } from "react";

interface CodeInputProps {
  length?: number;
  value: string;
  onChange: (v: string) => void;
  /** Fires once, the moment the last digit lands. */
  onComplete?: (v: string) => void;
  disabled?: boolean;
  hasError?: boolean;
}

/**
 * Segmented room-code input. One invisible native input drives all the boxes,
 * so focus, paste, backspace and the mobile numeric keyboard all just work.
 */
export default function CodeInput({
  length = 6, value, onChange, onComplete, disabled = false, hasError = false,
}: CodeInputProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [focused, setFocused] = useState(false);

  const handleChange = (raw: string) => {
    const v = raw.replace(/\D/g, "").slice(0, length);
    if (v === value) return;
    onChange(v);
    if (v.length === length) onComplete?.(v);
  };

  return (
    <div
      className={`fp-codein${hasError ? " is-error" : ""}${disabled ? " is-disabled" : ""}`}
      onClick={() => inputRef.current?.focus()}
    >
      <input
        ref={inputRef}
        className="fp-codein-input"
        type="text"
        value={value}
        onChange={(e) => handleChange(e.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        inputMode="numeric"
        pattern="[0-9]*"
        autoComplete="one-time-code"
        maxLength={length}
        disabled={disabled}
        aria-label={`${length}-digit room code`}
        autoFocus
      />
      {Array.from({ length }).map((_, i) => (
        <span
          key={i}
          aria-hidden="true"
          className={`fp-tile${value[i] ? " is-filled" : ""}${focused && i === value.length ? " is-active" : ""}`}
        >
          {value[i] ?? ""}
        </span>
      ))}
    </div>
  );
}
