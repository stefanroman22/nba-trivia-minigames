// Model-tier comparison over the classify eval's result rows (pure functions; the runner is scripts/team/eval-classify.mjs).
// A row is one (case, rep): { prompt_id, model, status, grade: { routing, design, engine, risk, difficulty, format },
// cost_usd_reported, latency_s }. `routing` is the headline: the design-round call and the model tier both right.
export const METRICS = ['routing', 'design', 'engine', 'risk', 'difficulty', 'format'];
export const LABELS = { routing: 'Routing', design: 'Design round', engine: 'Model tier', risk: 'Risk', difficulty: 'Difficulty', format: 'Valid JSON' };

const median = (xs) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b), m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/** Share of rows that pass, with the 95 % half-width of a proportion (normal approximation), in percentage points. */
export function rate(passes, n) {
  if (!n) return { pct: null, ci: null, n: 0 };
  const p = passes / n;
  return { pct: +(100 * p).toFixed(1), ci: +(100 * 1.96 * Math.sqrt((p * (1 - p)) / n)).toFixed(1), n };
}

/** One model's scores. Rows that did not finish (status !== 'ok') count as failures of every metric. */
export function summarize(model, rows) {
  const n = rows.length;
  const ok = rows.filter((r) => r.status === 'ok');
  const metrics = Object.fromEntries(METRICS.map((m) => [m, rate(ok.filter((r) => r.grade?.[m] === 1).length, n)]));
  const costs = ok.map((r) => r.cost_usd_reported).filter((c) => typeof c === 'number');
  return {
    model, runs: n, finished: ok.length, cases: new Set(rows.map((r) => r.prompt_id)).size, metrics,
    costTotal: costs.length ? +costs.reduce((a, b) => a + b, 0).toFixed(2) : null,
    costMedian: costs.length ? +median(costs).toFixed(3) : null,
    latencyMedian: ok.length ? +median(ok.map((r) => r.latency_s || 0)).toFixed(1) : null,
    misses: ok.filter((r) => r.grade?.routing !== 1).map((r) => r.prompt_id).sort(),
  };
}

/**
 * Which model to use: the cheapest one whose routing is not measurably worse than the best.
 * "Not measurably worse" = its 95 % interval overlaps the best model's. With a few dozen cases that interval is
 * wide, and the verdict says so instead of pretending a two-point gap is a finding.
 */
export function verdict(summaries) {
  const scored = summaries.filter((s) => s.metrics.routing.pct != null && s.finished);
  if (scored.length < 2) return { pick: scored[0]?.model ?? null, reason: 'Nothing to compare: fewer than two models have results.' };
  const best = scored.reduce((a, b) => (b.metrics.routing.pct > a.metrics.routing.pct ? b : a));
  const floor = best.metrics.routing.pct - best.metrics.routing.ci;
  const close = scored.filter((s) => s.metrics.routing.pct + s.metrics.routing.ci >= floor);
  const priced = close.filter((s) => s.costMedian != null);
  const pick = (priced.length ? priced : close).reduce((a, b) => ((b.costMedian ?? Infinity) < (a.costMedian ?? Infinity) ? b : a));
  const ruledOut = scored.filter((s) => !close.includes(s)).map((s) => s.model);
  const small = Math.min(...scored.map((s) => s.runs)) < 60;
  return {
    pick: pick.model, best: best.model, ruledOut,
    reason: [
      `${best.model} routes best (${best.metrics.routing.pct}% ± ${best.metrics.routing.ci}).`,
      pick.model === best.model
        ? 'No cheaper model is within its interval.'
        : `${pick.model} is inside that interval (${pick.metrics.routing.pct}% ± ${pick.metrics.routing.ci}) at a lower cost per run, so the data does not justify the dearer model.`,
      ruledOut.length ? `Measurably worse: ${ruledOut.join(', ')}.` : '',
      small ? 'Fewer than 60 runs per model: the intervals are wide, so treat this as a direction, not a result. Raise --reps before changing the policy.' : '',
    ].filter(Boolean).join(' '),
  };
}

const cell = (r) => (r.pct == null ? 'n/a' : `${r.pct}% ±${r.ci}`);

/** The comparison as a markdown table plus the verdict line. */
export function renderTable(summaries) {
  const head = ['Model', 'Runs', ...METRICS.map((m) => LABELS[m]), 'Median $/run', 'Total $', 'Median s'];
  const rows = summaries.map((s) => [s.model, `${s.finished}/${s.runs}`, ...METRICS.map((m) => cell(s.metrics[m])),
    s.costMedian ?? 'n/a', s.costTotal ?? 'n/a', s.latencyMedian ?? 'n/a']);
  const line = (cols) => `| ${cols.join(' | ')} |`;
  const v = verdict(summaries);
  return [
    line(head), line(head.map(() => '---')), ...rows.map(line), '',
    `Verdict: ${v.pick ? `use ${v.pick}. ` : ''}${v.reason}`,
    ...summaries.filter((s) => s.misses.length).map((s) => `Routing misses, ${s.model}: ${[...new Set(s.misses)].join(', ')}`),
    '', 'Dollars are the CLI\'s reported API-equivalent cost; a subscription is not billed per run.',
  ].join('\n');
}

export const parseJsonl = (text) => String(text || '').split(/\r?\n/).filter((l) => l.trim()).map((l) => JSON.parse(l));
