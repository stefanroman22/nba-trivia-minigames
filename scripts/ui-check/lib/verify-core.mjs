// Re-runs findings' acceptance criteria (verify.mjs, report.mjs --validate, probe.mjs).
// - assertions of ALL given findings: one `accept` Playwright invocation (the spec groups them per persona + viewport);
// - checks: at most one invocation per finding (--project list, --grep of its check ids; one worker for mp or @perf).
// Each invocation writes into its own scratch run <runDir>/<area>/pw-<stamp>-<tag>/ (UI_CHECK_RUN = '<runId>/<area>/…'),
// so the audited run's results.json is never touched; the `latest` pointer is restored afterwards.
// The stack is ensured once by the caller (withStack); children get UI_CHECK_STACK_READY / UI_CHECK_KEEP_STACK.
import { appendFileSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { UIC_ROOT } from './run-id.mjs';
import { ensureStack, stopStack } from './stack.mjs';
import { UIC, grepFor, installEmergencyStop, playwright } from './runner.mjs';
import { readJson } from './findings.mjs';

const LATEST = path.join(UIC_ROOT, 'latest');
const isFail = (r) => r.status === 'failed' || r.status === 'timedOut';
const firstLine = (s) => String(s || '').split('\n').map((l) => l.trim()).find(Boolean) || '';
const pad = (n) => String(n).padStart(2, '0');

export function stamp() {
  const d = new Date();
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

const readLatest = () => { try { return readFileSync(LATEST, 'utf8'); } catch { return null; } };
const restoreLatest = (v) => { if (v !== null && readLatest() !== v) { try { writeFileSync(LATEST, v); } catch { /* best effort */ } } };

/** Run fn with console output diverted to `log` (stack helper chatter stays out of the compact output). */
async function quietly(log, fn) {
  const orig = { log: console.log, warn: console.warn, error: console.error };
  const lines = [];
  console.log = console.warn = console.error = (...a) => lines.push(a.map(String).join(' '));
  try { return await fn(); } finally {
    Object.assign(console, orig);
    mkdirSync(path.dirname(log), { recursive: true });
    appendFileSync(log, lines.join('\n') + '\n');
  }
}

/**
 * Ensure the stack for `mode` once (quietly, into `log`), run fn(), stop the stack unless keepStack.
 * Ctrl+C / errors also stop it and restore the `latest` pointer.
 */
export async function withStack({ mode, keepStack, log }, fn) {
  if (!['dev', 'prod'].includes(mode)) throw new Error(`--mode must be dev or prod (got ${mode})`);
  process.env.UI_CHECK_MODE = mode;
  const latest = readLatest();
  installEmergencyStop(keepStack, () => restoreLatest(latest));
  try {
    try { await quietly(log, () => ensureStack(mode)); } catch (e) { throw new Error(`stack (${mode}) did not come up: ${firstLine(e.message)} — see ${log}`); }
    return await fn();
  } finally {
    restoreLatest(latest);
    if (!keepStack) await quietly(log, () => stopStack()).catch(() => {});
  }
}

let perfCache = null;
/** Check ids whose test title carries @perf (they run on one worker, as run.mjs does). */
function perfIds() {
  if (perfCache) return perfCache;
  perfCache = new Set();
  const walk = (d) => {
    for (const n of readdirSync(d)) {
      const p = path.join(d, n);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.spec\.m?js$/.test(n)) for (const m of readFileSync(p, 'utf8').matchAll(/\[([A-Za-z][\w.-]*)\]\s*@perf\b/g)) perfCache.add(m[1]);
    }
  };
  walk(path.join(UIC, 'specs'));
  return perfCache;
}

const violationLine = (v) => `${v.rule} \`${v.selector}\` on ${v.route}: ${v.measured} (expected ${v.expected})`;

/** One check × project → a criterion { kind, label, outcome, lines, shot }. */
function checkCriterion(id, project, results, sdir) {
  const label = `check ${id} @ ${project}`;
  const rs = results.filter((r) => r.checkId === id && r.project === project);
  if (!rs.length) return { kind: 'check', label, outcome: 'error', lines: [{ ok: false, error: true, text: 'did not run (no test matched this id on this project)' }], shot: null };
  const bad = rs.find(isFail);
  if (bad) {
    const vs = bad.violations || [];
    const lines = vs.length ? vs.map((v) => ({ ok: false, error: false, text: violationLine(v) })) : [{ ok: false, error: false, text: firstLine(bad.error) || bad.status }];
    if (!vs.length && bad.status === 'timedOut') lines[0].text = `timed out: ${lines[0].text}`;
    const shot = (vs.find((v) => v.shot) || {}).shot || (bad.shots || [])[0];
    return { kind: 'check', label, outcome: 'fail', lines, shot: shot ? path.join(sdir, ...shot.split('/')) : null };
  }
  if (rs.every((r) => r.status === 'skipped')) return { kind: 'check', label, outcome: 'error', lines: [{ ok: false, error: true, text: `skipped: ${rs[0].skipReason || 'no reason given'}` }], shot: null };
  return { kind: 'check', label, outcome: 'pass', lines: [{ ok: true, error: false, text: 'passed' }], shot: null };
}

/**
 * Run the acceptance of `findings` ([{ id, acceptance }]) → [{ id, outcome, criteria, firstLine, asExpected, reason }].
 * outcome 'pass' when every criterion passes, 'error' when one could not run cleanly, else 'fail'.
 * asExpected: expectFail ? every criterion FAILS cleanly : every criterion passes.
 * The stack must be up (withStack). area: 'verify' | 'probe' (scratch folder name).
 */
export async function verifyFindings(findings, { runId, expectFail = false, log, area = 'verify', mode = process.env.UI_CHECK_MODE || 'dev' }) {
  const base = stamp();
  const env = { UI_CHECK_MODE: mode, UI_CHECK_KEEP_STACK: '1', UI_CHECK_STACK_READY: '1' };
  const scratch = (tag) => {
    const run = `${runId}/${area}/pw-${base}-${tag}`;
    const dir = path.join(UIC_ROOT, 'runs', ...run.split('/'));
    mkdirSync(dir, { recursive: true });
    return { run, dir };
  };
  const crit = new Map(findings.map((f) => [f.id, []]));
  const latest = readLatest();
  try {
    // 1. Every assertion of every finding: one invocation.
    const items = findings.flatMap((f) => (f.acceptance.assertions || []).map((assertion, i) => ({
      findingId: f.id, n: i + 1, assertion, label: `${assertion.persona} ${assertion.viewport} ${assertion.route}`,
    })));
    if (items.length) {
      const { run, dir } = scratch('accept');
      const file = path.join(dir, 'assertions.json');
      writeFileSync(file, JSON.stringify(items, null, 2));
      await playwright(['accept'], { workers: Math.min(4, items.length), env: { ...env, UI_CHECK_RUN: run, UI_CHECK_ASSERT_FILE: file }, log });
      const results = readJson(path.join(dir, 'results.json'), []);
      for (const it of items) {
        const label = `assertion #${it.n}`;
        const r = readJson(path.join(dir, 'accept', `${it.findingId}-${it.n}.json`));
        if (r) crit.get(it.findingId).push({ kind: 'assertion', label, outcome: r.outcome, lines: r.lines, shot: r.shot ? path.join(dir, ...r.shot.split('/')) : null, url: r.url });
        else {
          const entry = results.find((x) => x.title.startsWith(`[ACCEPT ${it.findingId}#${it.n}]`));
          const why = entry ? `${entry.status}: ${firstLine(entry.error) || 'no result written'}` : `did not run (see ${log})`;
          crit.get(it.findingId).push({ kind: 'assertion', label, outcome: 'error', lines: [{ ok: false, error: true, text: why }], shot: null });
        }
      }
    }
    // 2. Checks: at most one invocation per finding.
    for (const f of findings) {
      const checks = f.acceptance.checks || [];
      if (!checks.length) continue;
      const ids = [...new Set(checks.map((c) => c.id))];
      const projects = [...new Set(checks.flatMap((c) => c.projects))];
      const serial = projects.some((p) => p.startsWith('mp@')) || ids.some((id) => perfIds().has(id));
      const { run, dir } = scratch(`checks-${f.id}`);
      await playwright(projects, { workers: serial ? 1 : Math.min(4, projects.length), grep: grepFor(ids.join(',')), env: { ...env, UI_CHECK_RUN: run }, log });
      const results = readJson(path.join(dir, 'results.json'), []);
      for (const c of checks) for (const p of c.projects) crit.get(f.id).push(checkCriterion(c.id, p, results, dir));
    }
  } finally {
    restoreLatest(latest);
  }

  return findings.map((f) => {
    const criteria = crit.get(f.id);
    const outcome = criteria.length && criteria.every((c) => c.outcome === 'pass') ? 'pass' : criteria.some((c) => c.outcome === 'error') ? 'error' : 'fail';
    const bad = criteria.find((c) => c.outcome !== 'pass');
    const badLine = bad ? `${bad.label}: ${(bad.lines.find((l) => !l.ok) || bad.lines[0] || { text: '' }).text}` : `${criteria.length} criteria pass`;
    let asExpected, reason = null;
    if (expectFail) {
      const errored = criteria.find((c) => c.outcome === 'error');
      const passing = criteria.filter((c) => c.outcome === 'pass');
      asExpected = !errored && !passing.length && criteria.length > 0;
      if (errored) reason = `acceptance could not run cleanly — ${errored.label}: ${(errored.lines[0] || {}).text}`;
      else if (passing.length === criteria.length) reason = 'acceptance passes on current code — does not reproduce';
      else if (passing.length) reason = `${passing.map((c) => c.label).join(', ')} already pass${passing.length === 1 ? 'es' : ''} on current code — vacuous (every criterion must fail before the fix)`;
    } else {
      asExpected = outcome === 'pass';
    }
    return { id: f.id, outcome, firstLine: badLine, criteria, asExpected, reason };
  });
}

/** <runDir>/verify/<id>.json: everything about one verification. */
export function writeDetail(runId, r, extra = {}) {
  const file = path.join(UIC_ROOT, 'runs', runId, 'verify', `${r.id}.json`);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify({ ...r, ...extra, at: new Date().toISOString() }, null, 2));
  return file;
}
