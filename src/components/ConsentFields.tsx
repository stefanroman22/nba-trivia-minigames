"use client";
import type { Ref } from "react";

/** The one sign-up tick-box: the 13+ confirmation and the Terms/Privacy agreement together. It sits
 *  above "Create account" and the Google button, and covers both. `invalid` marks it when the player
 *  tries to continue without it (or a Google log-in found no account yet). */
export default function ConsentFields({
  checked,
  onChange,
  disabled,
  invalid,
  boxRef,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
  invalid?: boolean;
  boxRef?: Ref<HTMLLabelElement>;
}) {
  return (
    <label ref={boxRef} className={`auth-check${invalid ? " is-invalid" : ""}`}>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        aria-invalid={invalid || undefined}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span>
        I&apos;m 13 or older and agree to the <a href="/terms" target="_blank" rel="noopener">Terms of Service</a> and{" "}
        <a href="/privacy" target="_blank" rel="noopener">Privacy Policy</a>
      </span>
    </label>
  );
}
