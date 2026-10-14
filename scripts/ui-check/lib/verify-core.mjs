// Re-runs findings' acceptance criteria (verify.mjs, report.mjs --validate, probe.mjs).
// - assertions of ALL given findings: one `accept` Playwright invocation (the spec groups them per persona + viewport);
// - checks: one invocation per distinct project set of a finding (--project list, --grep of the ids that use exactly
//   that set; one worker for mp or @perf), so ids never run on projects nobody asked for.
// Each invocation writes into its own scratch run <runDir>/<area>/pw-<stamp>-<tag>/ (UI_CHECK_RUN = '<runId>/<area>/…'),
// so the audited run's results.json is never touched. After reading it, the evidence crops are copied to
// <runDir>/<area>/shots/ and the scratch dir is deleted; the `latest` pointer is restored.
// An invocation that fails before producing any result (stack, mint or setup failure) throws: such an infra error
// must never turn into a verdict. The stack is ensured once by the caller (withStack), which stops only what it started.
import { appendFileSync, copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { UIC_ROOT } from './run-id.mjs';
import { ensureStack, readStack, stopStack } from './stack.mjs';
import { UIC, grepFor, installEmergencyStop, playwright } from './runner.mjs';
import { checkLabel, expectFailVerdict, readJson } from './findings.mjs';

const LATEST = path.join(UIC_ROOT, 'latest');
const isFail = (r) => r.status === 'failed' || r.status === 'timedOut';
const firstLine = (s) => String(s || '').split('\n').map((l) => l.trim()).find(Boolean) || '';
const pad = (n) => String(n).padStart(2, '0');
const safe = (s) => String(s).replace(/[^\w.-]+/g, '-').replace(/^-+|-+$/g, '');

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
 * Ensure the stack for `mode` once (quietly, into `log`), run fn(), then — unless keepStack — stop ONLY the processes
 * this call started (ensureStack().started; while it is still starting, the stack.json entries that appeared since).
 * A stack kept by an earlier --keep-stack call, or started by anyone else, keeps running. Ctrl+C / errors do the same
 * and restore the `latest` pointer.
 */
export async function withStack({ mode, keepStack, log }, fn) {
  if (!['dev', 'prod'].includes(mode)) throw new Error(`--mode must be dev or prod (got ${mode})`);
  process.env.UI_CHECK_MODE = mode;
  const latest = readLatest();
  const before = new Set(((readStack() || {}).started || []).map((e) => e.pid));
  let mine = null;
  const ours = () => mine || ((readStack() || {}).started || []).filter((e) => !before.has(e.pid));
  const stopOurs = () => { const only = ours(); return only.length ? stopStack({ only }) : []; };
  installEmergencyStop(keepStack, () => restoreLatest(latest), stopOurs);
  try {
    try { mine = (await quietly(log, () => ensureStack(mode))).started; } catch (e) { throw new Error(`stack (${mode}) did not come up: ${firstLine(e.message)} — see ${log}`); }
    return await fn();
  } finally {
    restoreLatest(latest);
    if (!keepStack) await quietly(log, stopOurs).catch(() => {});
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
  const label = checkLabel(id, project);
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

/** Copy a criterion's crop out of a scratch dir (deleted afterwards) to <runDir>/<area>/shots/. */
function keepShot(file, runId, area, name) {
  if (!file || !existsSync(file)) return null;
  const out = path.join(UIC_ROOT, 'runs', runId, area, 'shots', `${safe(name)}.jpg`);
  mkdirSync(path.dirname(out), { recursive: true });
  copyFileSync(file, out);
  return out;
}

/**
 * Run the acceptance of `findings` ([{ id, acceptance, guards? }]) → [{ id, outcome, criteria, firstLine, asExpected,
 * kind, reason, guards }].
 * outcome 'pass' when every criterion passes, 'error' when one could not run cleanly, else 'fail'.
 * asExpected: expectFail ? expectFailVerdict (≥ 1 clean FAIL and no error; passing criteria become guards)
 *                        : every criterion passes (guards included — the fix-loop exit is all-pass).
 * Throws when an invocation produced no result at all (infra), so callers never record a verdict for it.
 * The stack must be up (withStack). area: 'verify' | 'probe' (scratch folder name).
 */
export async function verifyFindings(findings, { runId, expectFail = false, log, area = 'verify', mode = process.env.UI_CHECK_MODE || 'dev', keepScratch = false }) {
  const base = stamp();
  const env = { UI_CHECK_MODE: mode, UI_CHECK_KEEP_STACK: '1', UI_CHECK_STACK_READY: '1' };
  const scratches = [];
  const scratch = (tag) => {
    const run = `${runId}/${area}/pw-${base}-${safe(tag)}`;
    const dir = path.join(UIC_ROOT, 'runs', ...run.split('/'));
    mkdirSync(dir, { recursive: true });
    scratches.push(dir);
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
      const code = await playwright(['accept'], { workers: Math.min(4, items.length), env: { ...env, UI_CHECK_RUN: run, UI_CHECK_ASSERT_FILE: file }, log });
      const written = existsSync(path.join(dir, 'accept')) ? readdirSync(path.join(dir, 'accept')).filter((n) => n.endsWith('.json')).length : 0;
      if (code !== 0 && !written) {
        const setup = readJson(path.join(dir, 'results.json'), []).find((r) => /^stack-/.test(r.project) && isFail(r));
        throw new Error(`the accept invocation failed before any assertion ran (exit ${code}${setup ? `; ${setup.project}: ${firstLine(setup.error)}` : ''}) — infra, no verdict recorded; see ${log}`);
      }
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
    // 2. Checks: one invocation per distinct project set of each finding.
    for (const f of findings) {
      const sets = new Map();
      for (const c of f.acceptance.checks || []) {
        const key = [...new Set(c.projects)].sort().join(',');
        if (!sets.has(key)) sets.set(key, { projects: key.split(','), checks: [] });
        sets.get(key).checks.push(c);
      }
      let k = 0;
      for (const { projects, checks } of sets.values()) {
        const ids = [...new Set(checks.map((c) => c.id))];
        const serial = projects.some((p) => p.startsWith('mp@')) || ids.some((id) => perfIds().has(id));
        const { run, dir } = scratch(`checks-${f.id}-${++k}`);
        const code = await playwright(projects, { workers: serial ? 1 : Math.min(4, projects.length * ids.length), grep: grepFor(ids.join(',')), env: { ...env, UI_CHECK_RUN: run }, log });
        const results = readJson(path.join(dir, 'results.json'), []);
        if (code !== 0 && !results.some((r) => ids.includes(r.checkId))) {
          const setup = results.find((r) => /^stack-/.test(r.project) && isFail(r));
          throw new Error(`the check invocation for ${f.id} (${ids.join(', ')}) failed before any check ran (exit ${code}${setup ? `; ${setup.project}: ${firstLine(setup.error)}` : ''}) — infra, no verdict recorded; see ${log}`);
        }
        for (const c of checks) for (const p of c.projects) crit.get(f.id).push(checkCriterion(c.id, p, results, dir));
      }
    }
    // 3. Keep the evidence, drop the scratch runs.
    for (const [id, list] of crit) for (const c of list) c.shot = keepShot(c.shot, runId, area, `${id}-${c.label}`);
  } finally {
    restoreLatest(latest);
    if (!keepScratch) for (const d of scratches) { try { rmSync(d, { recursive: true, force: true }); } catch { /* a locked file: leave it */ } }
  }

  return findings.map((f) => {
    const guardSet = new Set(f.guards || []);
    const criteria = crit.get(f.id).map((c) => (guardSet.has(c.label) ? { ...c, guard: true } : c));
    const outcome = criteria.length && criteria.every((c) => c.outcome === 'pass') ? 'pass' : criteria.some((c) => c.outcome === 'error') ? 'error' : 'fail';
    const bad = criteria.find((c) => c.outcome !== 'pass');
    const badLine = bad ? `${bad.label}${bad.guard ? ' (guard)' : ''}: ${(bad.lines.find((l) => !l.ok) || bad.lines[0] || { text: '' }).text}` : `${criteria.length} criteria pass`;
    if (expectFail) {
      const v = expectFailVerdict(criteria);
      const marked = criteria.map((c) => (v.guards.includes(c.label) ? { ...c, guard: true, note: 'guard (passes before fix)' } : c));
      return { id: f.id, outcome, firstLine: badLine, criteria: marked, ...v };
    }
    return { id: f.id, outcome, firstLine: badLine, criteria, asExpected: outcome === 'pass', kind: null, reason: null, guards: [...guardSet] };
  });
}

/** <runDir>/verify/<id>.json: everything about one verification. */
export function writeDetail(runId, r, extra = {}) {
  const file = path.join(UIC_ROOT, 'runs', runId, 'verify', `${r.id}.json`);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify({ ...r, ...extra, at: new Date().toISOString() }, null, 2));
  return file;
}
