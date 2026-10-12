// Playwright reporter: condenses a run into <runDir>/results.json and <runDir>/digest.md.
// buildDigest() is pure so the selftest can exercise it without running a suite.
// UI_CHECK_APPEND=1 merges into an existing results.json of the same run (several invocations, one run).
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { VIEWPORTS } from './viewports.mjs';
import { runId, runDir } from './run-id.mjs';

const VP_ORDER = Object.keys(VIEWPORTS);
const MAX_LINES = 400;
const MAX_LINES_PER_CHECK = 20;

const idOf = (title) => { const m = /\[([A-Za-z][\w.-]*)\]/.exec(title || ''); return m ? m[1] : null; };
const measuredClass = (s) => String(s ?? '').replace(/-?\d+(\.\d+)?/g, '#');
const vpRank = (v) => { const i = VP_ORDER.indexOf(v); return i < 0 ? VP_ORDER.length : i; };
const sortVps = (vps) => [...vps].sort((a, b) => vpRank(a) - vpRank(b) || String(a).localeCompare(String(b)));
const firstLine = (s) => String(s || '').split('\n').find((l) => l.trim()) || '';
const isFail = (r) => r.status === 'failed' || r.status === 'timedOut';
const fmt = (v, unit) => (typeof v === 'number' ? `${Math.round(v * 1000) / 1000}${unit || ''}` : String(v));

/** Markdown digest for an array of result entries (see results.json shape). */
export function buildDigest(results, { runId: id = '?', mode = 'dev', durationMs = 0 } = {}) {
  const secs = Math.round(durationMs / 1000);
  const lines = [`# UI check digest — run ${id} · mode ${mode} · ${results.length} tests · ${Math.floor(secs / 60)}m${secs % 60}s`, ''];

  // Suite table
  const suites = new Map();
  for (const r of results) {
    const s = suites.get(r.suite) || { pass: 0, fail: 0, skip: 0 };
    if (r.status === 'passed') s.pass++; else if (r.status === 'skipped') s.skip++; else s.fail++;
    suites.set(r.suite, s);
  }
  lines.push('| suite | pass | fail | skip |', '|---|---|---|---|');
  for (const [name, s] of suites) lines.push(`| ${name} | ${s.pass} | ${s.fail} | ${s.skip} |`);
  lines.push('');

  // Failures, grouped per check, identical rule+selector+route+measured-class collapsed across viewports
  const groups = new Map();
  for (const r of results.filter(isFail)) {
    const key = `${r.checkId || ''}|${r.title}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(r);
  }
  for (const group of groups.values()) {
    const { checkId, title } = group[0];
    lines.push(`## FAIL ${checkId || '(no id)'} ${title}`);
    const rows = new Map();
    for (const r of group) {
      const vs = r.violations || [];
      const items = vs.map((v) => ({ v, key: [v.rule, v.selector, v.route, measuredClass(v.measured)].join('\u0000') }));
      // The test's own error, unless it is just audit.done() restating the violations above.
      if (!vs.length || (r.error && !/UI violation\(s\) in /.test(r.error))) {
        items.push({ v: null, key: `error\u0000${measuredClass(firstLine(r.error) || r.status)}` });
      }
      for (const { v, key } of items) {
        let row = rows.get(key);
        if (!row) rows.set(key, (row = { v, r, vps: [], shot: null }));
        if (r.vp && !row.vps.includes(r.vp)) row.vps.push(r.vp);
        row.shot ||= (v && v.shot) || (r.shots && r.shots[0]) || null;
      }
    }
    const rendered = [...rows.values()].map(({ v, r, vps, shot }) => {
      const tail = `${vps.length ? ` — ${sortVps(vps).join(', ')}` : ''}${shot ? ` — shot: ${shot}` : ''}`;
      if (!v) return `- ${r.status === 'timedOut' ? 'timed out' : 'error'}: ${firstLine(r.error) || r.status}${tail}`;
      return `- ${v.rule} \`${v.selector}\` on ${v.route}: ${v.measured} (expected ${v.expected})${v.note ? ` [${v.note}]` : ''}${tail}`;
    });
    if (rendered.length > MAX_LINES_PER_CHECK) {
      const extra = rendered.length - (MAX_LINES_PER_CHECK - 1);
      rendered.splice(MAX_LINES_PER_CHECK - 1, rendered.length, `+${extra} more (see results.json)`);
    }
    lines.push(...rendered, '');
  }

  // Coverage gaps: skipped tests with their reason
  lines.push('## Coverage gaps');
  const gaps = new Map();
  for (const r of results.filter((x) => x.status === 'skipped')) {
    const reason = r.skipReason || 'skipped (no reason given)';
    const key = `${r.checkId}|${r.title}|${reason}`;
    const g = gaps.get(key) || { r, reason, vps: [] };
    if (r.vp && !g.vps.includes(r.vp)) g.vps.push(r.vp);
    gaps.set(key, g);
  }
  if (!gaps.size) lines.push('- none');
  for (const { r, reason, vps } of gaps.values()) lines.push(`- ${r.checkId || '(no id)'} ${r.title}${vps.length ? ` (${sortVps(vps).join(', ')})` : ''}: ${reason}`);
  lines.push('');

  // Metrics: perf/timing only, one table per suite, label → value per vp (worst value when repeated)
  lines.push('## Metrics');
  const bySuite = new Map();
  for (const r of results) {
    for (const m of r.metrics || []) {
      if (m.kind !== 'perf' && m.kind !== 'timing') continue;
      if (!bySuite.has(r.suite)) bySuite.set(r.suite, { vps: new Set(), rows: new Map() });
      const s = bySuite.get(r.suite);
      const vp = r.vp || r.project;
      s.vps.add(vp);
      if (!s.rows.has(m.label)) s.rows.set(m.label, new Map());
      const cells = s.rows.get(m.label);
      const prev = cells.get(vp);
      if (!prev || (typeof m.value === 'number' && m.value > prev.value)) cells.set(vp, m);
    }
  }
  if (!bySuite.size) lines.push('- none');
  for (const [suite, { vps, rows }] of bySuite) {
    const cols = sortVps(vps);
    lines.push(`### ${suite}`, `| label | ${cols.join(' | ')} |`, `|---|${cols.map(() => '---').join('|')}|`);
    for (const [label, cells] of rows) lines.push(`| ${label} | ${cols.map((c) => (cells.has(c) ? fmt(cells.get(c).value, cells.get(c).unit) : '')).join(' | ')} |`);
    lines.push('');
  }

  while (lines.length && lines[lines.length - 1] === '') lines.pop();
  if (lines.length > MAX_LINES) {
    const extra = lines.length - (MAX_LINES - 1);
    lines.splice(MAX_LINES - 1, lines.length, `+${extra} more (see results.json)`);
  }
  return lines.join('\n');
}

const STATUS = { passed: 'passed', failed: 'failed', timedOut: 'timedOut', skipped: 'skipped', interrupted: 'failed' };
const stripAnsi = (s) => String(s || '').replace(/\u001b\[[0-9;]*m/g, '');

export default class DigestReporter {
  constructor() {
    this.entries = new Map();
    this.start = Date.now();
  }

  printsToStdio() { return false; }

  onBegin() { this.start = Date.now(); }

  onTestEnd(test, result) {
    const project = test.parent.project();
    const use = (project && project.use) || {};
    const datas = result.attachments
      .filter((a) => a.name === 'uicheck' && a.body)
      .map((a) => { try { return JSON.parse(a.body.toString('utf8')); } catch { return null; } })
      .filter(Boolean);
    const annotations = [...(test.annotations || []), ...(result.annotations || [])];
    const skip = annotations.find((a) => (a.type === 'skip' || a.type === 'fixme') && a.description);
    const attVps = [...new Set(datas.map((d) => d.vp).filter(Boolean))];
    const entry = {
      checkId: idOf(test.title),
      title: test.title,
      project: project ? project.name : '',
      suite: use.suite || (project ? project.name.split('@')[0] : ''),
      vp: use.vpId || (attVps.length ? attVps.join('+') : null),
      status: STATUS[result.status] || 'failed',
      durationMs: result.duration,
      violations: datas.flatMap((d) => d.violations || []),
      metrics: datas.flatMap((d) => d.metrics || []),
      shots: datas.flatMap((d) => d.shots || []),
    };
    if (entry.status === 'skipped') entry.skipReason = skip ? skip.description : null;
    if (result.error || (result.errors && result.errors.length)) {
      const err = result.error || result.errors[0];
      entry.error = stripAnsi(err.message || err.value || '').split('\n').slice(0, 6).join('\n').slice(0, 800);
    }
    // Keyed per test (and repeat), so a retry replaces its earlier attempt.
    this.entries.set(`${test.id}|${test.repeatEachIndex}`, entry);
  }

  onEnd(result) {
    const dir = runDir();
    mkdirSync(dir, { recursive: true });
    const file = path.join(dir, 'results.json');
    let results = [...this.entries.values()];
    if (process.env.UI_CHECK_APPEND === '1' && existsSync(file)) {
      try {
        const mine = new Set(results.map((r) => `${r.project}|${r.title}`));
        const prior = JSON.parse(readFileSync(file, 'utf8')).filter((r) => !mine.has(`${r.project}|${r.title}`));
        results = [...prior, ...results];
      } catch { /* unreadable prior results: keep this invocation's */ }
    }
    writeFileSync(file, JSON.stringify(results, null, 2));
    const digest = buildDigest(results, {
      runId: runId(),
      mode: process.env.UI_CHECK_MODE || 'dev',
      durationMs: (result && result.duration) || Date.now() - this.start,
    });
    writeFileSync(path.join(dir, 'digest.md'), digest + '\n');
    console.log(`ui-check: digest ${path.join(dir, 'digest.md')}`);
  }
}
