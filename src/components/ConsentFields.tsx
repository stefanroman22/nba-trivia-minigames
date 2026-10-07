"use client";
import type { ConsentValue } from "../utils/consent";

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/** The age gate and Terms/Privacy tick-box shown when an account is created. The age question
 *  is neutral on purpose (month + year, nothing pre-selected, no hint of the cut-off), and the
 *  answer is only sent to the server to be checked, never stored there. */
export default function ConsentFields({
  value,
  onChange,
  disabled,
}: {
  value: ConsentValue;
  onChange: (next: ConsentValue) => void;
  disabled?: boolean;
}) {
  const thisYear = new Date().getFullYear();
  const years = Array.from({ length: 101 }, (_, i) => thisYear - i);

  return (
    <div className="auth-consent">
      <div className="auth-consent-row">
        <select
          className="modal-input"
          aria-label="Birth month"
          value={value.month}
          disabled={disabled}
          onChange={(e) => onChange({ ...value, month: e.target.value })}
        >
          <option value="" disabled>Birth month</option>
          {MONTHS.map((name, i) => <option key={name} value={String(i + 1)}>{name}</option>)}
        </select>
        <select
          className="modal-input"
          aria-label="Birth year"
          value={value.year}
          disabled={disabled}
          onChange={(e) => onChange({ ...value, year: e.target.value })}
        >
          <option value="" disabled>Birth year</option>
          {years.map((y) => <option key={y} value={String(y)}>{y}</option>)}
        </select>
      </div>
      <label className="auth-check">
        <input
          type="checkbox"
          checked={value.agreed}
          disabled={disabled}
          onChange={(e) => onChange({ ...value, agreed: e.target.checked })}
        />
        <span>
          I agree to the <a href="/terms" target="_blank" rel="noopener">Terms of Service</a> and have read the{" "}
          <a href="/privacy" target="_blank" rel="noopener">Privacy Policy</a>.
        </span>
      </label>
    </div>
  );
}
