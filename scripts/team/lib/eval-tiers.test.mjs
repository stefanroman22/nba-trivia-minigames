import test from 'node:test';
import assert from 'node:assert/strict';
import { parseJsonl, rate, renderTable, summarize, verdict } from './eval-tiers.mjs';

const row = (id, routing, over = {}) => ({ prompt_id: id, model: 'm', status: 'ok', cost_usd_reported: 0.1, latency_s: 30,
  grade: { routing, design: 1, engine: routing, risk: 1, difficulty: 1, format: 1 }, ...over });
const rows = (n, right, over) => Array.from({ length: n }, (_, i) => row(`c${i}`, i < right ? 1 : 0, over));

test('rate: percentage and a 95% half-width', () => {
  assert.deepEqual(rate(18, 36), { pct: 50, ci: 16.3, n: 36 });
  assert.deepEqual(rate(36, 36), { pct: 100, ci: 0, n: 36 });
  assert.deepEqual(rate(0, 0), { pct: null, ci: null, n: 0 });
});

test('summarize: unfinished runs count against every metric; cost and misses come from finished runs', () => {
  const s = summarize('sonnet', [...rows(8, 6, { cost_usd_reported: 0.2 }), row('x', 1, { status: 'error', grade: undefined, cost_usd_reported: null })]);
  assert.equal(s.runs, 9);
  assert.equal(s.finished, 8);
  assert.equal(s.metrics.routing.pct, 66.7);
  assert.equal(s.metrics.format.pct, 88.9);
  assert.deepEqual([s.costTotal, s.costMedian, s.latencyMedian], [1.6, 0.2, 30]);
  assert.deepEqual(s.misses, ['c6', 'c7']);
});

test('verdict: the cheaper model wins when it is inside the best one\'s interval', () => {
  const v = verdict([summarize('fable', rows(72, 70, { cost_usd_reported: 0.7 })), summarize('sonnet', rows(72, 68, { cost_usd_reported: 0.15 }))]);
  assert.equal(v.best, 'fable');
  assert.equal(v.pick, 'sonnet');
  assert.match(v.reason, /does not justify the dearer model/);
  assert.doesNotMatch(v.reason, /Fewer than 60 runs/);
});

test('verdict: a model that is measurably worse is ruled out, whatever it costs', () => {
  const v = verdict([summarize('sonnet', rows(72, 70, { cost_usd_reported: 0.15 })), summarize('haiku', rows(72, 40, { cost_usd_reported: 0.01 }))]);
  assert.equal(v.pick, 'sonnet');
  assert.deepEqual(v.ruledOut, ['haiku']);
  assert.match(v.reason, /No cheaper model is within its interval\. Measurably worse: haiku\./);
});

test('verdict: small samples are called out, and one model is not a comparison', () => {
  assert.match(verdict([summarize('a', rows(4, 4)), summarize('b', rows(4, 3))]).reason, /Fewer than 60 runs/);
  assert.match(verdict([summarize('a', rows(4, 4))]).reason, /Nothing to compare/);
});

test('renderTable: one line per model, the verdict and the misses', () => {
  const text = renderTable([summarize('sonnet', rows(4, 4)), summarize('haiku', rows(4, 2))]);
  assert.match(text, /\| Model \| Runs \| Routing \|/);
  assert.match(text, /\| sonnet \| 4\/4 \| 100% ±0 \|/);
  assert.match(text, /Verdict: use /);
  assert.match(text, /Routing misses, haiku: c2, c3/);
});

test('parseJsonl skips blank lines', () => {
  assert.deepEqual(parseJsonl('{"a":1}\n\n{"a":2}\n'), [{ a: 1 }, { a: 2 }]);
});
