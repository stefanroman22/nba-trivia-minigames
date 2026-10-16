// Playwright reporter: condenses a run into <runDir>/results.json and <runDir>/digest.md.
// buildDigest() is pure so the selftest can exercise it without running a suite.
// UI_CHECK_APPEND=1 merges into an existing results.json of the same run (several invocations, one run);
// <runDir>/run-meta.json keeps the run's first start so the digest header spans every invocation.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { VIEWPORTS } from './viewports.mjs';
import { runId, runDir } from './run-id.mjs';

const VP_ORDER = Object.keys(VIEWPORTS);
// Caps per section and suite, so one noisy suite or section never pushes the others out of the digest.
// Worst case with the 4 app suites: 8 header + 4 × (80 FAIL + 15 gaps + 20 warnings + 29 metrics) + 8 ≈ 600 lines.
const MAX_LINES_PER_CHECK = 20;
const MAX_FAIL_LINES_PER_SUITE = 80;
const MAX_GAP_LINES_PER_SUITE = 15;
const MAX_WARNING_LINES_PER_SUITE = 20;
const MAX_METRIC_ROWS_PER_SUITE = 25;
const MAX_LINES = 700; // safety net only (many suites); the per-section caps keep a normal run near 600
const WHERE = 'see results.json in the run dir (`node scripts/ui-check/run.mjs --where`)';
/** Trailer of a capped section: names the suite so each judge's digest slice keeps its own. */
const moreLine = (n, what, suite) => `- +${n} more ${what} (suite ${suite}) — ${WHERE}, filter by suite "${suite}"`;
/** At most `max` lines; the last kept slot becomes the trailer. */
const capLines = (list, max, what, suite) => (list.length > max ? [...list.slice(0, max - 1), moreLine(list.length - (max - 1), what, suite)] : list);

const idOf = (title) => { const m = /\[([A-Za-z][\w.-]*)\]/.exec(title || ''); return m ? m[1] : null; };
const measuredClass = (s) => String(s ?? '').replace(/-?\d+(\.\d+)?/g, '#');
const vpRank = (v) => { const i = VP_ORDER.indexOf(v); return i < 0 ? VP_ORDER.length : i; };
// Entries are a vp id, optionally followed by ' (<audit label>)' — rank by the vp id.
const sortVps = (vps) => [...vps].sort((a, b) => vpRank(String(a).split(' ')[0]) - vpRank(String(b).split(' ')[0]) || String(a).localeCompare(String(b)));
// Where a violation/metric was seen: its own audit's vp (several audits per test, e.g. multiplayer), else the test's;
// then its audit label and, when not the local stack, its env ('phone-390 (live)').
const envOf = (item, r) => (item && item.env) || r.env || 'local';
const whereOf = (item, r, auditLabel) => {
  const vp = (item && item.vp) || r.vp;
  const env = envOf(item, r);
  const tags = [auditLabel, env !== 'local' ? env : null].filter(Boolean);
  return vp && tags.length ? `${vp} (${tags.join(', ')})` : vp;
};
const firstLine = (s) => String(s || '').split('\n').find((l) => l.trim()) || '';
const isFail = (r) => r.status === 'failed' || r.status === 'timedOut';
const fmt = (v, unit) => (typeof v === 'number' ? `${Math.round(v * 1000) / 1000}${unit || ''}` : String(v));
const MAX_EXPECTED_GROUPS = 3;
/** One expected value as is; several (a threshold per viewport) as 'A [vps] | B [vps]', at most 3 then '+N more'. */
const expectedText = (byValue) => {
  const groups = [...byValue];
  if (groups.length === 1) return groups[0][0];
  const shown = groups.slice(0, MAX_EXPECTED_GROUPS).map(([e, vps]) => `${e} [${sortVps(vps).join(', ')}]`);
  if (groups.length > MAX_EXPECTED_GROUPS) shown.push(`+${groups.length - MAX_EXPECTED_GROUPS} more`);
  return shown.join(' | ');
};

/** Markdown digest for an array of result entries (see results.json shape). */
export function buildDigest(results, { runId: id = '?', mode = 'dev', durationMs = 0 } = {}) {
  const secs = Math.round(durationMs / 1000);
  // Env in the header only when some result is not from the local stack (`run.mjs --live`).
  const envs = [...new Set(results.map((r) => envOf(null, r)))].sort((a, b) => (a === 'local' ? -1 : b === 'local' ? 1 : a.localeCompare(b)));
  const envTag = envs.some((e) => e !== 'local') ? ` · env ${envs.join('+')}` : '';
  const lines = [`# UI check digest — run ${id} · mode ${mode}${envTag} · ${results.length} tests · ${Math.floor(secs / 60)}m${secs % 60}s`, ''];

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
  const failBySuite = new Map();
  for (const group of groups.values()) {
    const { checkId, title, suite } = group[0];
    if (!failBySuite.has(suite)) failBySuite.set(suite, []);
    const out = failBySuite.get(suite);
    out.push(`## FAIL ${checkId || '(no id)'} ${title}`);
    const rows = new Map();
    for (const r of group) {
      const vs = r.violations || [];
      const items = vs.map((v) => ({ v, key: [v.rule, v.selector, v.route, measuredClass(v.measured), measuredClass(v.expected)].join('\u0000') }));
      // The test's own error, unless it is just audit.done() restating the violations above.
      if (!vs.length || (r.error && !/UI violation\(s\) in /.test(r.error))) {
        items.push({ v: null, key: `error\u0000${measuredClass(firstLine(r.error) || r.status)}` });
      }
      for (const { v, key } of items) {
        let row = rows.get(key);
        if (!row) rows.set(key, (row = { v, r, vps: [], expected: new Map(), shot: null, fallback: null }));
        const where = whereOf(v, r, v && v.label);
        if (where && !row.vps.includes(where)) row.vps.push(where);
        if (v) { const e = row.expected.get(v.expected) || []; if (where && !e.includes(where)) e.push(where); row.expected.set(v.expected, e); }
        // The row's own crop from whichever member has one; another crop of the test only as a last resort.
        row.shot ||= (v && v.shot) || null;
        row.fallback ||= (r.shots && r.shots[0]) || null;
      }
    }
    const rendered = [...rows.values()].map(({ v, r, vps, expected, shot, fallback }) => {
      const s = shot || fallback;
      const tail = `${vps.length ? ` — ${sortVps(vps).join(', ')}` : ''}${s ? ` — shot: ${s}` : ''}`;
      if (!v) return `- ${r.status === 'timedOut' ? 'timed out' : 'error'}: ${firstLine(r.error) || r.status}${tail}`;
      return `- ${v.rule} \`${v.selector}\` on ${v.route}: ${v.measured} (expected ${expectedText(expected)})${v.note ? ` [${v.note}]` : ''}${tail}`;
    });
    if (rendered.length > MAX_LINES_PER_CHECK) {
      const extra = rendered.length - (MAX_LINES_PER_CHECK - 1);
      rendered.splice(MAX_LINES_PER_CHECK - 1, rendered.length, `- +${extra} more line(s) of ${checkId || 'this check'} — ${WHERE}`);
    }
    out.push(...rendered, '');
  }
  for (const [suite, out] of failBySuite) {
    while (out.length && out[out.length - 1] === '') out.pop();
    lines.push(...capLines(out, MAX_FAIL_LINES_PER_SUITE, 'FAIL line(s)', suite), '');
  }

  // Coverage gaps: skipped tests with their reason
  lines.push('## Coverage gaps');
  const gaps = new Map();
  for (const r of results.filter((x) => x.status === 'skipped')) {
    const reason = r.skipReason || 'skipped (no reason given)';
    const key = `${r.checkId}|${r.title}|${reason}`;
    const g = gaps.get(key) || { r, reason, vps: [], suite: r.suite };
    const where = whereOf(null, r);
    if (where && !g.vps.includes(where)) g.vps.push(where);
    gaps.set(key, g);
  }
  if (!gaps.size) lines.push('- none');
  const gapsBySuite = new Map();
  for (const { r, reason, vps, suite } of gaps.values()) {
    if (!gapsBySuite.has(suite)) gapsBySuite.set(suite, []);
    gapsBySuite.get(suite).push(`- ${r.checkId || '(no id)'} ${r.title}${vps.length ? ` (${sortVps(vps).join(', ')})` : ''}: ${reason}`);
  }
  for (const [suite, list] of gapsBySuite) lines.push(...capLines(list, MAX_GAP_LINES_PER_SUITE, 'coverage gap(s)', suite));
  lines.push('');

  // Warnings: soft rules (never fail a test), one line per rule+selector+route across checks and viewports
  lines.push('## Warnings');
  const warns = new Map();
  for (const r of results) {
    for (const w of r.warnings || []) {
      const key = [w.rule, w.selector, w.route].join('\u0000');
      let g = warns.get(key);
      if (!g) warns.set(key, (g = { w, vps: [], checks: [], suite: null, anySuite: r.suite }));
      const where = whereOf(w, r, w.label);
      if (where && !g.vps.includes(where)) g.vps.push(where);
      if (r.checkId && !g.checks.includes(r.checkId)) { g.checks.push(r.checkId); g.suite ||= r.suite; }
    }
  }
  // Grouped and capped per owning suite: the suite of the first check listed. A warning no check id saw is
  // tagged `(suite <s>)` with the suite of the result that saw it, so that suite's judge picks it up.
  const warnBySuite = new Map();
  for (const { w, vps, checks, suite, anySuite } of warns.values()) {
    const owner = suite || anySuite;
    if (!warnBySuite.has(owner)) warnBySuite.set(owner, []);
    warnBySuite.get(owner).push(`- ${w.rule} \`${w.selector}\` on ${w.route}: ${w.measured} (expected ${w.expected})${vps.length ? ` — ${sortVps(vps).join(', ')}` : ''} — ${checks.length ? checks.join(', ') : `(suite ${owner})`}`);
  }
  if (!warnBySuite.size) lines.push('- none');
  for (const [suite, list] of warnBySuite) lines.push(...capLines(list, MAX_WARNING_LINES_PER_SUITE, 'warning(s)', suite));
  lines.push('');

  // Metrics: perf/timing only, one table per suite, label → value per vp (worst value when repeated)
  lines.push('## Metrics');
  const bySuite = new Map();
  for (const r of results) {
    for (const m of r.metrics || []) {
      if (m.kind !== 'perf' && m.kind !== 'timing') continue;
      if (!bySuite.has(r.suite)) bySuite.set(r.suite, { vps: new Set(), rows: new Map() });
      const s = bySuite.get(r.suite);
      const vp = whereOf(m, r, m.auditLabel) || r.project;
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
    const rowLines = [...rows].map(([label, cells]) => `| ${label} | ${cols.map((c) => (cells.has(c) ? fmt(cells.get(c).value, cells.get(c).unit) : '')).join(' | ')} |`);
    if (rowLines.length > MAX_METRIC_ROWS_PER_SUITE) {
      const extra = rowLines.length - (MAX_METRIC_ROWS_PER_SUITE - 1);
      rowLines.splice(MAX_METRIC_ROWS_PER_SUITE - 1, rowLines.length, `| +${extra} more metric row(s) (suite ${suite}) — ${WHERE}, filter by suite "${suite}" |`);
    }
    lines.push(...rowLines);
    lines.push('');
  }

  while (lines.length && lines[lines.length - 1] === '') lines.pop();
  if (lines.length > MAX_LINES) {
    const extra = lines.length - (MAX_LINES - 1);
    lines.splice(MAX_LINES - 1, lines.length, `+${extra} more line(s) — ${WHERE}`);
  }
  return lines.join('\n');
}

/**
 * Merge this invocation into an earlier one of the same run (UI_CHECK_APPEND: run.mjs's second, multiplayer
 * invocation). Prior entries of the same project+title are replaced. The span runs from the first
 * invocation's start to this one's end, so the digest header covers the whole run.
 * → { results, meta: { startedAt, endedAt }, durationMs }
 */
export function mergeRun({ entries, prior = null, priorMeta = null, start, end }) {
  let results = entries;
  if (Array.isArray(prior)) {
    const mine = new Set(entries.map((r) => `${r.project}|${r.title}`));
    results = [...prior.filter((r) => !mine.has(`${r.project}|${r.title}`)), ...entries];
  }
  const startedAt = priorMeta && Number.isFinite(priorMeta.startedAt) && priorMeta.startedAt < start ? priorMeta.startedAt : start;
  return { results, meta: { startedAt, endedAt: end }, durationMs: end - startedAt };
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
    // stack-setup/-teardown are plumbing: only a failure of theirs belongs in the digest.
    if (project && /^stack-/.test(project.name) && result.status === 'passed') return;
    const use = (project && project.use) || {};
    const datas = result.attachments
      .filter((a) => a.name === 'uicheck' && a.body)
      .map((a) => { try { return JSON.parse(a.body.toString('utf8')); } catch { return null; } })
      .filter(Boolean);
    const annotations = [...(test.annotations || []), ...(result.annotations || [])];
    const skip = annotations.find((a) => (a.type === 'skip' || a.type === 'fixme') && a.description);
    const attVps = [...new Set(datas.map((d) => d.vp).filter(Boolean))];
    // Tag each audit's records with where it was seen, so several audits per test (multiplayer) keep their vp.
    // Metrics already use `label` for their own name, so their audit label goes in `auditLabel`.
    const tag = (d, labelKey) => (x) => ({ ...x, ...(d.vp ? { vp: d.vp } : {}), ...(d.label ? { [labelKey]: d.label } : {}) });
    const entry = {
      checkId: idOf(test.title),
      // Where the test ran: the audit's env, else the project's (`use.env`), else UI_CHECK_ENV, else the local stack.
      env: (datas.find((d) => d.env) || {}).env || use.env || process.env.UI_CHECK_ENV || 'local',
      title: test.title,
      project: project ? project.name : '',
      suite: use.suite || (project ? project.name.split('@')[0] : ''),
      vp: use.vpId || (attVps.length ? attVps.join('+') : null),
      status: STATUS[result.status] || 'failed',
      durationMs: result.duration,
      violations: datas.flatMap((d) => (d.violations || []).map(tag(d, 'label'))),
      warnings: datas.flatMap((d) => (d.warnings || []).map(tag(d, 'label'))),
      metrics: datas.flatMap((d) => (d.metrics || []).map(tag(d, 'auditLabel'))),
      shots: datas.flatMap((d) => d.shots || []),
    };
    // --live: the requests the guard saw on the live site (GET/HEAD vs anything else, which also fails the test).
    const live = datas.filter((d) => d.liveRequests);
    if (live.length) entry.liveRequests = { read: live.reduce((n, d) => n + d.liveRequests.read, 0), write: live.reduce((n, d) => n + d.liveRequests.write, 0) };
    if (entry.status === 'skipped') entry.skipReason = skip ? skip.description : null;
    if (result.error || (result.errors && result.errors.length)) {
      const err = result.error || result.errors[0];
      entry.error = stripAnsi(err.message || err.value || '').split('\n').slice(0, 6).join('\n').slice(0, 800);
    }
    // Keyed per test (and repeat), so a retry replaces its earlier attempt.
    this.entries.set(`${test.id}|${test.repeatEachIndex}`, entry);
  }

  onEnd() {
    const dir = runDir();
    mkdirSync(dir, { recursive: true });
    const file = path.join(dir, 'results.json');
    const metaFile = path.join(dir, 'run-meta.json');
    const append = process.env.UI_CHECK_APPEND === '1';
    const readJson = (f) => { try { return existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : null; } catch { return null; } };
    const { results, meta, durationMs } = mergeRun({
      entries: [...this.entries.values()],
      prior: append ? readJson(file) : null,
      priorMeta: append ? readJson(metaFile) : null,
      start: this.start,
      end: Date.now(),
    });
    writeFileSync(file, JSON.stringify(results, null, 2));
    writeFileSync(metaFile, JSON.stringify(meta, null, 2));
    const digest = buildDigest(results, {
      runId: runId(),
      mode: process.env.UI_CHECK_MODE || 'dev',
      durationMs,
    });
    writeFileSync(path.join(dir, 'digest.md'), digest + '\n');
    console.log(`ui-check: digest ${path.join(dir, 'digest.md')}`);
  }
}
