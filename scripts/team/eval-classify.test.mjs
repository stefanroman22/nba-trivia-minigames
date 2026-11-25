import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { cli, compare, modelIds, readVariant, rebased } from './eval-classify.mjs';

const registry = { aliases: { sonnet: { id: 'claude-sonnet-5-5' }, haiku: { id: 'claude-haiku-5-5' } } };
const row = (id, routing) => JSON.stringify({ prompt_id: id, rep: 0, model: 'm', cost_usd_reported: 0.1, latency_s: 20,
  grade: { routing, design: 1, engine: routing, risk: 1, difficulty: 1, format: 1 } });

function results() {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'eval-'));
  for (const [model, rows, errors] of [['sonnet', [row('r01', 1), row('r02', 1)], []], ['haiku', [row('r01', 1)], [JSON.stringify({ prompt_id: 'r02', rep: 0, failure_class: 'timeout' })]], ['empty', [], []]]) {
    mkdirSync(path.join(dir, model));
    if (rows.length) writeFileSync(path.join(dir, model, 'results.jsonl'), rows.join('\n') + '\n');
    if (errors.length) writeFileSync(path.join(dir, model, 'errors.jsonl'), errors.join('\n') + '\n');
  }
  return dir;
}

test('aliases resolve through the registry; a full id passes; anything else is refused', () => {
  assert.deepEqual(modelIds(['sonnet', 'claude-opus-5-5'], registry), [{ name: 'sonnet', id: 'claude-sonnet-5-5' }, { name: 'claude-opus-5-5', id: 'claude-opus-5-5' }]);
  assert.throws(() => modelIds(['gpt'], registry), /unknown model "gpt"/);
});

test('rebased moves every case to one commit and leaves the answer key alone', () => {
  const cases = [{ prompt_id: 'r01', baseSha: 'aaa', expected: { engineModel: 'haiku' } }, { prompt_id: 'r02', baseSha: 'bbb', expected: { engineModel: 'opus' } }];
  const out = rebased(cases.map((c) => JSON.stringify(c)).join('\n'), 'ccc').trim().split('\n').map((l) => JSON.parse(l));
  assert.deepEqual(out.map((c) => c.baseSha), ['ccc', 'ccc']);
  assert.deepEqual(out.map((c) => c.expected), cases.map((c) => c.expected));
});

test('a failed run counts against the model; a model with no runs is left out', () => {
  const dir = results();
  assert.deepEqual(readVariant(path.join(dir, 'haiku')).map((r) => r.status), ['ok', 'error']);
  const c = compare(dir);
  assert.deepEqual(c.summaries.map((s) => [s.model, s.runs, s.finished, s.metrics.routing.pct]), [['haiku', 2, 1, 50], ['sonnet', 2, 2, 100]]);
  assert.match(c.table, /\| sonnet \| 2\/2 \| 100% ±0 \|/);
});

test('cli: compare prints the table or JSON; bad input exits 2 without touching git', () => {
  const dir = results();
  const run = (...argv) => { const out = [], errs = []; return { code: cli(argv, { log: (l) => out.push(l), err: (l) => errs.push(l) }), out: out.join('\n'), errs: errs.join('\n') }; };
  assert.match(run('compare', '--dir', dir).out, /Verdict: /);
  assert.equal(JSON.parse(run('compare', '--dir', dir, '--json').out).summaries.length, 2);
  assert.equal(run('compare', '--dir', path.join(dir, 'nope')).code, 2);
  assert.match(run('run').errs, /--models/);
  assert.match(run('run', '--models', 'sonnet', '--reps', '0').errs, /whole numbers/);
  assert.equal(run('nonsense').code, 2);
});
