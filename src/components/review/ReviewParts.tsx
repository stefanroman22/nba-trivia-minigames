import type { ReactNode } from "react";

/** Right / wrong mark for one round (authored SVG, one stroke weight). */
export function ReviewMark({ ok }: { ok: boolean }) {
  return (
    <span className={`ar-mark ${ok ? "is-good" : "is-bad"}`} role="img" aria-label={ok ? "Right" : "Wrong"}>
      {ok ? (
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5" /></svg>
      ) : (
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12" /></svg>
      )}
    </span>
  );
}

/** "Your answer: X", green when right, red when wrong; "No answer" when the round was skipped. */
export function ReviewPick({ pick, ok, verb = "Your answer" }: { pick: string | null; ok: boolean; verb?: string }) {
  return (
    <span className={`ar-pick ${ok ? "is-good" : "is-bad"}`}>
      {pick ? <>{verb}: <b>{pick}</b></> : "No answer"}
    </span>
  );
}

/** One numbered round: what was asked, the right answer, your pick, the verdict. */
export function ReviewRound({ no, label, answer, pick, ok }: {
  no: number;
  label?: ReactNode;
  answer: ReactNode;
  pick?: ReactNode;
  ok: boolean;
}) {
  return (
    <li className="ar-round">
      <span className="ar-round-no">{no}</span>
      <div className="ar-round-body">
        {label && <span className="ar-round-label">{label}</span>}
        <div className="ar-round-answer">{answer}</div>
        {pick}
      </div>
      <ReviewMark ok={ok} />
    </li>
  );
}

/** A one-line outcome under the game name. */
export function ReviewSummary({ children }: { children: ReactNode }) {
  return <p className="ar-summary">{children}</p>;
}
