interface ProgressBarProps {
  value: number;
  max?: number;
}

export default function ProgressBar({ value, max = 100 }: ProgressBarProps) {
  const pct = max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : 0;
  return (
    <div className="progress" role="progressbar" aria-valuenow={value} aria-valuemax={max}>
      <span style={{ width: `${pct}%` }} />
    </div>
  );
}
