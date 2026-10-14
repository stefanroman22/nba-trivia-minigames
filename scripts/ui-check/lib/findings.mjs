// Findings: schema validation (findings.schema.json through a small JSON Schema subset), the acceptance DSL parser,
// fingerprints (rule|route|selector), merge/dedupe, accepted.json filtering, run-stable ids, and REPORT.md.
// Everything here is pure or file-only (no browser), so the selftest ([ST-FINDINGS], [ST-REPORT]) covers it directly.
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { VIEWPORTS, MP_PAIRS } from './viewports.mjs';
import { L } from './pagemap.mjs';
import { UIC_ROOT } from './run-id.mjs';

const UIC = fileURLToPath(new URL('../', import.meta.url));
export const SCHEMA_PATH = path.join(UIC, 'findings.schema.json');
export const ACCEPTED_PATH = path.join(UIC, 'accepted.json');

export const SEVERITIES = ['blocker', 'major', 'minor', 'polish'];
export const OWNERS = ['frontend', 'backend', 'ci'];
export const SUITES = ['guest', 'account', 'games', 'multiplayer'];
const VP_ORDER = [...Object.keys(VIEWPORTS), ...Object.keys(MP_PAIRS)];
const rank = (order, v) => { const i = order.indexOf(v); return i < 0 ? order.length : i; };

export const readJson = (file, fallback = null) => { try { return JSON.parse(readFileSync(file, 'utf8')); } catch { return fallback; } };
const writeJson = (file, data) => writeFileSync(file, JSON.stringify(data, null, 2) + '\n');

// ---------------------------------------------------------------------------------------------
// Schema: a JSON Schema subset (type, enum, required, properties, additionalProperties:false, items, minItems,
// minLength, pattern, minimum, anyOf with x-message, $ref to #/$defs/*). Errors read "<path>: <problem>".

let schemaCache = null;
export const loadSchema = () => (schemaCache ??= JSON.parse(readFileSync(SCHEMA_PATH, 'utf8')));

const isType = (t, v) => {
  switch (t) {
    case 'null': return v === null;
    case 'array': return Array.isArray(v);
    case 'object': return v !== null && typeof v === 'object' && !Array.isArray(v);
    case 'integer': return Number.isInteger(v);
    case 'number': return typeof v === 'number' && Number.isFinite(v);
    default: return typeof v === t;
  }
};
const join = (p, k) => (p ? `${p}.${k}` : k);

function check(schema, v, p, root, errs) {
  if (schema.$ref) {
    const def = root.$defs[schema.$ref.replace('#/$defs/', '')];
    if (!def) throw new Error(`findings schema: unknown $ref ${schema.$ref}`);
    const { $ref, ...rest } = schema;
    schema = { ...def, ...rest };
  }
  const at = p || 'finding';
  if (schema.type) {
    const types = [].concat(schema.type);
    if (!types.some((t) => isType(t, v))) { errs.push(`${at}: must be ${types.join(' or ')}`); return; }
  }
  if (schema.enum && !schema.enum.includes(v)) { errs.push(`${at}: must be one of ${schema.enum.join(', ')} (got ${JSON.stringify(v)})`); return; }
  if (typeof v === 'string') {
    if (schema.minLength !== undefined && v.length < schema.minLength) errs.push(`${at}: must not be empty`);
    if (schema.pattern && !new RegExp(schema.pattern).test(v)) errs.push(`${at}: ${JSON.stringify(v)} does not match ${schema.pattern}`);
  }
  if (typeof v === 'number' && schema.minimum !== undefined && v < schema.minimum) errs.push(`${at}: must be ≥ ${schema.minimum}`);
  if (Array.isArray(v)) {
    if (schema.minItems !== undefined && v.length < schema.minItems) errs.push(`${at}: needs at least ${schema.minItems} item(s)`);
    if (schema.items) v.forEach((x, i) => check(schema.items, x, `${p}[${i}]`, root, errs));
  }
  if (isType('object', v)) {
    for (const k of schema.required || []) if (v[k] === undefined) errs.push(`${join(p, k)}: required`);
    for (const [k, sub] of Object.entries(schema.properties || {})) if (v[k] !== undefined) check(sub, v[k], join(p, k), root, errs);
    if (schema.additionalProperties === false) {
      const known = Object.keys(schema.properties || {});
      for (const k of Object.keys(v)) if (!known.includes(k)) errs.push(`${join(p, k)}: unknown field (known: ${known.join(', ')})`);
    }
  }
  if (schema.anyOf && !schema.anyOf.some((s) => { const e = []; check(s, v, p, root, e); return !e.length; })) {
    errs.push(`${at}: ${schema['x-message'] || 'matches none of the allowed forms'}`);
  }
}

/** Schema errors plus DSL errors of every acceptance assertion → string[] (empty = valid). */
export function validateFinding(f) {
  const root = loadSchema();
  const errs = [];
  check(root, f, '', root, errs);
  const as = f && f.acceptance && Array.isArray(f.acceptance.assertions) ? f.acceptance.assertions : [];
  as.forEach((a, i) => errs.push(...assertionErrors(a, `acceptance.assertions[${i}]`)));
  return errs;
}

// ---------------------------------------------------------------------------------------------
// Acceptance DSL (spec §8, task 9 brief). <loc> = Playwright selector string, or "@area.key" (pagemap via L()).

export const STEP_KEYS = ['click', 'fill', 'press', 'hover', 'waitFor', 'wait', 'scroll'];
export const EXPECT_KEYS = ['visible', 'hidden', 'count', 'text', 'noOverflow', 'withinViewport', 'minSize', 'style', 'transition', 'noSnap', 'maxCls', 'maxLoafMs', 'status', 'url', 'noConsoleErrors', 'axe'];
const TOP_KEYS = ['persona', 'viewport', 'route', 'steps', 'watch', 'expect'];
const COUNT_OPS = ['>=', '<=', '=='];

// L() against a stub page: the same pagemap lookup and error text the browser side gets.
const STUB_PAGE = { getByRole: () => null, locator: () => null, getByText: () => null };

function locError(v) {
  if (typeof v !== 'string' || !v.trim()) return 'needs a locator string (Playwright selector or "@area.key")';
  if (!v.startsWith('@')) return null;
  const key = v.slice(1);
  if (!/^[A-Za-z][\w-]*\.[A-Za-z_][\w-]*$/.test(key)) return `"${v}" must look like "@area.key" (a pagemap/<area>.json entry)`;
  try { L(STUB_PAGE, key); return null; } catch (e) { return e.message; }
}
const regexError = (s) => { if (typeof s !== 'string') return 'needs a regex string'; try { new RegExp(s); return null; } catch (e) { return `invalid regex ${JSON.stringify(s)} (${e.message})`; } };
const num = (v) => typeof v === 'number' && Number.isFinite(v);

const STEP_CHECK = {
  click: locError, hover: locError, waitFor: locError,
  fill: (v) => (Array.isArray(v) && v.length === 2 && typeof v[1] === 'string' ? locError(v[0]) : 'needs ["<loc>", "text"]'),
  press: (v) => (typeof v === 'string' && v ? null : 'needs a key name such as "Escape"'),
  wait: (v) => (num(v) && v >= 0 && v <= 30_000 ? null : 'needs milliseconds 0–30000'),
  scroll: (v) => (v === 'bottom' || v === 'top' || (num(v) && v >= 0) || (typeof v === 'string' && /^\d+$/.test(v)) ? null : 'needs "bottom", "top" or a pixel offset'),
};
const isTrue = (v) => (v === true ? null : 'must be true');
const EXPECT_CHECK = {
  visible: locError, hidden: locError, withinViewport: locError,
  count: (v) => {
    if (!Array.isArray(v) || v.length !== 3) return 'needs ["<loc>", ">=|<=|==", n]';
    if (!COUNT_OPS.includes(v[1])) return `operator must be one of ${COUNT_OPS.join(', ')} (got ${JSON.stringify(v[1])})`;
    if (!Number.isInteger(v[2]) || v[2] < 0) return 'n must be a whole number ≥ 0';
    return locError(v[0]);
  },
  text: (v) => (Array.isArray(v) && v.length === 2 && typeof v[1] === 'string' ? locError(v[0]) : 'needs ["<loc>", "substring"]'),
  noOverflow: isTrue, noSnap: isTrue, noConsoleErrors: isTrue,
  minSize: (v) => (Array.isArray(v) && v.length === 3 && num(v[1]) && num(v[2]) ? locError(v[0]) : 'needs ["<loc>", width, height]'),
  style: (v) => (Array.isArray(v) && v.length === 3 && typeof v[1] === 'string' && v[1] && (typeof v[2] === 'string' || num(v[2])) ? locError(v[0]) : 'needs ["<loc>", "css-property", "value"]'),
  transition: (v) => (Array.isArray(v) && v.length === 2 && typeof v[1] === 'string' && v[1] ? locError(v[0]) : 'needs ["<loc>", "css-property"]'),
  maxCls: (v) => (num(v) && v >= 0 ? null : 'needs a number ≥ 0'),
  maxLoafMs: (v) => (num(v) && v >= 0 ? null : 'needs milliseconds ≥ 0'),
  status: (v) => (Array.isArray(v) && v.length === 2 && Number.isInteger(v[1]) && v[1] >= 100 && v[1] <= 599 ? regexError(v[0]) : 'needs ["urlRegex", httpStatus]'),
  url: regexError,
  axe: (v) => (Array.isArray(v) && v.length && v.every((x) => typeof x === 'string' && x) ? null : 'needs a list of axe rule ids, e.g. ["target-size"]'),
};

function oneKey(item, where, known, kind, errs) {
  if (!isType('object', item)) { errs.push(`${where}: must be an object like {"${known[0]}": …}`); return null; }
  const keys = Object.keys(item);
  if (keys.length !== 1) { errs.push(`${where}: one key per ${kind}, got ${keys.join(', ') || 'none'}`); return null; }
  if (!known.includes(keys[0])) { errs.push(`${where}: unknown ${kind} key "${keys[0]}" (known: ${known.join(', ')})`); return null; }
  return keys[0];
}

/** DSL errors of one assertion → string[] ("<base>.<field>: <problem>"). */
export function assertionErrors(a, base = 'assertion') {
  const errs = [];
  if (!isType('object', a)) return [`${base}: must be an object`];
  for (const k of Object.keys(a)) if (!TOP_KEYS.includes(k)) errs.push(`${base}: unknown key "${k}" (known: ${TOP_KEYS.join(', ')})`);
  if (a.persona !== 'guest' && a.persona !== 'solo') errs.push(`${base}.persona: must be guest or solo (got ${JSON.stringify(a.persona)})`);
  if (!VIEWPORTS[a.viewport]) errs.push(`${base}.viewport: unknown viewport ${JSON.stringify(a.viewport)} (known: ${Object.keys(VIEWPORTS).join(', ')})`);
  if (typeof a.route !== 'string' || !a.route.startsWith('/')) errs.push(`${base}.route: must start with "/" (got ${JSON.stringify(a.route)})`);
  if (a.steps !== undefined && !Array.isArray(a.steps)) errs.push(`${base}.steps: must be a list`);
  (Array.isArray(a.steps) ? a.steps : []).forEach((s, i) => {
    const where = `${base}.steps[${i}]`;
    const k = oneKey(s, where, STEP_KEYS, 'step', errs);
    const e = k && STEP_CHECK[k](s[k]);
    if (e) errs.push(`${where}: ${k}: ${e}`);
  });
  if (a.watch !== undefined && !(Array.isArray(a.watch) && a.watch.every((w) => typeof w === 'string' && w.trim()))) errs.push(`${base}.watch: must be a list of CSS selectors`);
  if (!Array.isArray(a.expect) || !a.expect.length) errs.push(`${base}.expect: needs at least one item`);
  (Array.isArray(a.expect) ? a.expect : []).forEach((x, i) => {
    const where = `${base}.expect[${i}]`;
    const k = oneKey(x, where, EXPECT_KEYS, 'expect', errs);
    const e = k && EXPECT_CHECK[k](x[k]);
    if (e) errs.push(`${where}: ${k}: ${e}`);
  });
  return errs;
}

/** Validated, normalised assertion { persona, viewport, route, steps: [{kind, arg}], watch, expect: [{kind, arg}] }; throws with every problem. */
export function parseAssertion(a) {
  const errs = assertionErrors(a);
  if (errs.length) throw new Error(`invalid acceptance assertion:\n${errs.join('\n')}`);
  const pairs = (list) => (list || []).map((x) => { const kind = Object.keys(x)[0]; return { kind, arg: x[kind] }; });
  return { persona: a.persona, viewport: a.viewport, route: a.route, steps: pairs(a.steps), watch: a.watch || [], expect: pairs(a.expect) };
}

/** One-line description of an assertion for REPORT.md and verify output. */
export function describeAssertion(a) {
  const show = (v) => (Array.isArray(v) ? v.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' ') : v === true ? '' : String(v));
  const part = (x) => { const k = Object.keys(x)[0]; const s = show(x[k]); return s ? `${k} ${s}` : k; };
  const steps = (a.steps || []).map(part).join(' → ');
  return `${a.persona} · ${a.viewport} · \`${a.route}\`${steps ? ` · ${steps}` : ''} ⇒ ${(a.expect || []).map(part).join('; ')}`;
}

// ---------------------------------------------------------------------------------------------
// Fingerprint, merge, accepted, ids

const PARAM = (s) => /^\d+$/.test(s)
  || /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s)
  || /^[0-9a-f]{16,}$/i.test(s)
  || (/^[A-Z0-9]{4,}$/.test(s) && /\d/.test(s));

/** Route without query/hash/trailing slash; ids and codes (digits, uuids, hex, upper-case codes with a digit) → ':param'. */
export function normRoute(r) {
  const bare = String(r || '/').split(/[?#]/)[0];
  const segs = bare.split('/').filter(Boolean).map((s) => (PARAM(s) ? ':param' : s));
  return `/${segs.join('/')}`;
}

/** Selector with whitespace collapsed and one space around '>'. */
export function normSelector(s) {
  return String(s || '').replace(/\s+/g, ' ').replace(/\s*>\s*/g, ' > ').trim();
}

export function fingerprint(f) {
  return `${f.rule}|${normRoute(f.where && f.where.route)}|${normSelector(f.where && f.where.selector)}`;
}

/** A fingerprint string as written by hand (accepted.json) in its normalised form. */
export function normFingerprint(fp) {
  const [rule, route, ...sel] = String(fp).split('|');
  return `${rule}|${normRoute(route)}|${normSelector(sel.join('|'))}`;
}

/** JSON with sorted keys, so equal objects written in a different key order compare equal. */
export function canonical(v) {
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
  if (v && typeof v === 'object') return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canonical(v[k])}`).join(',')}}`;
  return JSON.stringify(v);
}
const unionBy = (lists, key) => {
  const seen = new Set(), out = [];
  for (const list of lists) for (const x of list || []) { const k = key(x); if (!seen.has(k)) { seen.add(k); out.push(x); } }
  return out;
};
const longest = (vals) => vals.reduce((a, b) => (String(b || '').length > String(a || '').length ? b : a), vals[0]);

/**
 * Merge findings with equal fingerprints: the highest-severity member is the base (ties: suite order, then input
 * order); viewports, shots, metrics, files (path:line), fix items, checks, assertions and criteria are unioned; the
 * longest current/expected wins. Adds `fingerprint` (and `mergedFrom`, the member suites, when several merged).
 */
export function mergeFindings(list) {
  const groups = new Map();
  for (const f of list) {
    const fp = fingerprint(f);
    if (!groups.has(fp)) groups.set(fp, []);
    groups.get(fp).push(f);
  }
  const out = [];
  for (const [fp, members] of groups) {
    const ordered = members.map((f, i) => ({ f, i }))
      .sort((a, b) => rank(SEVERITIES, a.f.severity) - rank(SEVERITIES, b.f.severity) || rank(SUITES, a.f.suite) - rank(SUITES, b.f.suite) || a.i - b.i)
      .map((x) => x.f);
    const base = ordered[0];
    const m = structuredClone(base);
    m.fingerprint = fp;
    if (members.length > 1) {
      m.where.viewports = unionBy(ordered.map((f) => f.where.viewports), String).sort((a, b) => rank(VP_ORDER, a) - rank(VP_ORDER, b));
      m.current = longest(ordered.map((f) => f.current));
      m.expected = longest(ordered.map((f) => f.expected));
      m.evidence.checkId = base.evidence.checkId || (ordered.find((f) => f.evidence.checkId) || {}).evidence?.checkId || null;
      m.evidence.shots = unionBy(ordered.map((f) => f.evidence.shots), String);
      m.evidence.metrics = unionBy(ordered.map((f) => f.evidence.metrics), canonical);
      m.files = unionBy(ordered.map((f) => f.files), (x) => `${x.path}:${x.line ?? ''}`);
      for (const k of ['change', 'reuse', 'build', 'rules']) {
        const u = unionBy(ordered.map((f) => (f.fix && f.fix[k]) || []), String);
        if (u.length || m.fix[k]) m.fix[k] = u;
      }
      m.acceptance.checks = unionBy(ordered.map((f) => f.acceptance.checks), canonical);
      m.acceptance.assertions = unionBy(ordered.map((f) => f.acceptance.assertions), canonical);
      m.acceptance.criteria = unionBy(ordered.map((f) => f.acceptance.criteria), String);
      m.mergedFrom = [...new Set(members.map((f) => f.suite))].sort();
    }
    out.push(m);
  }
  return out;
}

/** accepted: [fingerprint string | { fingerprint, reason }] → { kept, dropped }. */
export function dropAccepted(list, accepted) {
  const fps = new Set((accepted || []).map((a) => normFingerprint(typeof a === 'string' ? a : a.fingerprint)));
  const kept = [], dropped = [];
  for (const f of list) (fps.has(f.fingerprint || fingerprint(f)) ? dropped : kept).push(f);
  return { kept, dropped };
}

/** Severity, then suite, then fingerprint. */
export function sortFindings(list) {
  return [...list].sort((a, b) => rank(SEVERITIES, a.severity) - rank(SEVERITIES, b.severity)
    || rank(SUITES, a.suite) - rank(SUITES, b.suite)
    || (a.fingerprint < b.fingerprint ? -1 : a.fingerprint > b.fingerprint ? 1 : 0));
}

/**
 * Ids UIC-<runId>-NNN in list order. `known` maps fingerprint → { id } (this run's earlier findings.json /
 * rejected.json first, then the previous run's): a known fingerprint keeps its id (also one from an earlier run);
 * new ones number after the highest NNN this run already used.
 */
export function assignIds(list, runId, known) {
  const prefix = `UIC-${runId}-`;
  let max = 0;
  for (const { id } of known.values()) if (id && id.startsWith(prefix)) max = Math.max(max, Number(id.slice(prefix.length)) || 0);
  return list.map((f) => {
    const k = known.get(f.fingerprint);
    return { ...f, id: k && k.id ? k.id : `${prefix}${String(++max).padStart(3, '0')}` };
  });
}

/** Short hash of a finding's acceptance: re-validation is needed only when it changed. */
export function acceptanceHash(f) {
  return createHash('sha1').update(canonical(f.acceptance)).digest('hex').slice(0, 12);
}

// ---------------------------------------------------------------------------------------------
// Run directories

export const runsRoot = () => path.join(UIC_ROOT, 'runs');
export const runPath = (id) => path.join(runsRoot(), id);

/** Run ids (directory names) newest first. */
export function listRuns() {
  try { return readdirSync(runsRoot(), { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort().reverse(); } catch { return []; }
}

export function latestRunId() {
  try { return readFileSync(path.join(UIC_ROOT, 'latest'), 'utf8').trim() || null; } catch { return null; }
}

/** The findings document of a run: { runId, generatedAt, mode, findings: [] } (null when none). */
export function readFindingsDoc(runId) {
  return readJson(path.join(runPath(runId), 'findings.json'));
}

/** Newest run whose findings.json holds `id` (a carried id lives in later runs too). */
export function runOfFinding(id) {
  for (const r of listRuns()) {
    const doc = readFindingsDoc(r);
    if (doc && (doc.findings || []).some((f) => f.id === id)) return r;
  }
  return null;
}

/** Judge files <runDir>/findings/*.json → { items: [{ finding, source }], errors: [{ source, error }] }. */
export function loadJudgeFindings(dir) {
  const fdir = path.join(dir, 'findings');
  const items = [], errors = [];
  let files = [];
  try { files = readdirSync(fdir).filter((f) => f.endsWith('.json')).sort(); } catch { /* no judge output */ }
  for (const name of files) {
    let data;
    try { data = JSON.parse(readFileSync(path.join(fdir, name), 'utf8')); } catch (e) { errors.push({ source: name, error: `not JSON: ${e.message}` }); continue; }
    const list = Array.isArray(data) ? data : data && Array.isArray(data.findings) ? data.findings : null;
    if (!list) { errors.push({ source: name, error: 'expected an array of findings or { "findings": [...] }' }); continue; }
    list.forEach((finding, i) => items.push({ finding, source: `${name}[${i}]` }));
  }
  return { items, errors };
}

/** Mode of a run from its digest header ("· mode prod ·"). */
export function runMode(dir) {
  try { return /· mode (\w+)/.exec(readFileSync(path.join(dir, 'digest.md'), 'utf8'))?.[1] || '?'; } catch { return '?'; }
}

/** (Re)write <runDir>/REPORT.md from findings.json, results.json, run-meta.json, digest.md and rejected.json. */
export function writeReport(runId) {
  const dir = runPath(runId);
  const doc = readFindingsDoc(runId) || { findings: [] };
  const meta = readJson(path.join(dir, 'run-meta.json'), {});
  const md = buildReport({
    runId,
    mode: runMode(dir),
    date: Number.isFinite(meta.startedAt) ? fmtDate(meta.startedAt) : '?',
    findings: doc.findings || [],
    results: readJson(path.join(dir, 'results.json'), []),
    rejected: readJson(path.join(dir, 'rejected.json'), []),
  });
  const file = path.join(dir, 'REPORT.md');
  writeFileSync(file, md + '\n');
  return file;
}
export { writeJson };

const pad = (n) => String(n).padStart(2, '0');
function fmtDate(ms) {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// ---------------------------------------------------------------------------------------------
// REPORT.md

const isFail = (r) => r.status === 'failed' || r.status === 'timedOut';
const colOf = (r) => (VIEWPORTS[r.vp] ? r.vp : r.project || String(r.vp));
const sortCols = (cols) => [...cols].sort((a, b) => rank(Object.keys(VIEWPORTS), a) - rank(Object.keys(VIEWPORTS), b) || a.localeCompare(b));
const prefixRank = (id) => rank(['G-', 'AC-', 'GM-', 'MP-'], (/^[A-Z]+-/.exec(id) || [''])[0]);
const metricText = (m) => (typeof m === 'string' ? m : `${m.label} ${m.value}${m.unit || ''}${m.vp ? ` (${m.vp})` : ''}`);

/** The whole report as markdown. findings: merged + id'd (sorted here by severity, suite, fingerprint). */
export function buildReport({ runId, mode = '?', date = '?', findings = [], results = [], rejected = [] }) {
  const out = [];
  const suites = SUITES.filter((s) => results.some((r) => r.suite === s));
  const cols = sortCols([...new Set(results.filter((r) => r.checkId).map(colOf))]);
  const open = findings.filter((f) => f.status !== 'fixed').length;
  const bySev = SEVERITIES.map((s) => `${s} ${findings.filter((f) => f.severity === s).length}`).join(' · ');

  out.push(`# UI check report — run ${runId}`, '');
  out.push(`mode ${mode} · ${date} · ${results.length} test result(s)`, '');
  out.push(`- Suites: ${suites.join(', ') || '(none)'}`);
  out.push(`- Viewports: ${cols.join(', ') || '(none)'}`);
  out.push(`- Findings: ${findings.length} (${open} open, ${findings.length - open} fixed) · ${bySev}`);
  out.push(`- Rejected: ${rejected.length}${rejected.length ? ' (rejected.json: schema errors or acceptance that does not fail on the current code)' : ''}`);
  out.push('');

  // Summary: severity × owner and severity × suite.
  out.push('## Summary', '');
  const table = (dim, keys) => {
    out.push(`| severity | ${keys.join(' | ')} | total |`, `|---|${keys.map(() => '---').join('|')}|---|`);
    for (const s of [...SEVERITIES, 'total']) {
      const rows = findings.filter((f) => s === 'total' || f.severity === s);
      out.push(`| ${s} | ${keys.map((k) => rows.filter((f) => f[dim] === k).length).join(' | ')} | ${rows.length} |`);
    }
    out.push('');
  };
  table('owner', OWNERS);
  table('suite', SUITES);

  // Coverage matrix: check × column (viewport, or the mp pair project), compact symbols.
  out.push('## Coverage matrix', '', '✓ pass · ✗ fail · – skipped · blank: not run', '');
  const checks = [...new Set(results.map((r) => r.checkId).filter(Boolean))].sort((a, b) => prefixRank(a) - prefixRank(b) || a.localeCompare(b));
  if (!checks.length) out.push('- no results.json entries');
  else {
    out.push(`| check | ${cols.join(' | ')} |`, `|---|${cols.map(() => '---').join('|')}|`);
    for (const id of checks) {
      const cells = cols.map((c) => {
        const rs = results.filter((r) => r.checkId === id && colOf(r) === c);
        if (!rs.length) return '';
        if (rs.some(isFail)) return '✗';
        if (rs.some((r) => r.status === 'passed')) return '✓';
        return '–';
      });
      out.push(`| ${id} | ${cells.join(' | ')} |`);
    }
  }
  out.push('');

  // Coverage gaps: skipped tests with their reason (as in the digest).
  out.push('## Coverage gaps', '');
  const gaps = new Map();
  for (const r of results.filter((x) => x.status === 'skipped')) {
    const reason = r.skipReason || 'skipped (no reason given)';
    const key = `${r.checkId}|${r.title}|${reason}`;
    const g = gaps.get(key) || { r, reason, vps: [] };
    const c = colOf(r);
    if (c && !g.vps.includes(c)) g.vps.push(c);
    gaps.set(key, g);
  }
  if (!gaps.size) out.push('- none');
  for (const { r, reason, vps } of gaps.values()) out.push(`- ${r.checkId || '(no id)'} ${r.title}${vps.length ? ` (${sortCols(vps).join(', ')})` : ''}: ${reason}`);
  out.push('');

  // Findings.
  out.push('## Findings', '');
  if (!findings.length) out.push('- none');
  for (const f of sortFindings(findings)) {
    const w = f.where || {};
    const status = f.status === 'fixed' ? `fixed ${String(f.fixedAt || '').replace('T', ' ').slice(0, 16)}` : 'open';
    const checked = f.validatedAt ? 'acceptance proven to fail before the fix' : 'acceptance not validated (report.mjs --validate)';
    out.push(`### ${f.id} · ${f.title}`, '');
    out.push(`**${f.severity}** · ${f.owner} · ${f.category} · ${f.suite}${f.mergedFrom ? ` (merged: ${f.mergedFrom.join(', ')})` : ''} · persona ${f.persona} · viewports ${(w.viewports || []).join(', ')} · status ${status}`);
    out.push(`Where: \`${w.route}\`${w.state ? ` (${w.state})` : ''} · \`${w.selector}\` · rule \`${f.rule}\` · ${checked}`, '');
    out.push(`**Current** — ${f.current}`, '');
    out.push(`**Expected** — ${f.expected}`, '');
    const ev = f.evidence || {};
    const evParts = [];
    if (ev.checkId) evParts.push(`check \`${ev.checkId}\``);
    if ((ev.metrics || []).length) evParts.push(`metrics: ${ev.metrics.map(metricText).join('; ')}`);
    if ((ev.shots || []).length) evParts.push(`shots: ${ev.shots.map((s) => `[${path.posix.basename(s)}](${s})`).join(', ')}`);
    out.push(`**Evidence** — ${evParts.join(' · ') || 'none recorded'}`, '');
    out.push('**Files**');
    for (const x of f.files || []) out.push(`- \`${x.path}${x.line ? `:${x.line}` : ''}\` — ${x.why}`);
    out.push('');
    out.push('**How to fix**');
    const fx = f.fix || {};
    for (const [k, label] of [['change', 'Change'], ['reuse', 'Reuse'], ['build', 'Build'], ['rules', 'Rules']]) for (const s of fx[k] || []) out.push(`- ${label}: ${s}`);
    out.push('');
    out.push('**Acceptance criteria**');
    const ac = f.acceptance || {};
    for (const c of ac.criteria || []) out.push(`- ${c}`);
    for (const c of ac.checks || []) out.push(`- check \`${c.id}\` passes on ${c.projects.join(', ')}`);
    (ac.assertions || []).forEach((a, i) => out.push(`- assertion #${i + 1}: ${describeAssertion(a)}`));
    out.push(`- verify: \`node scripts/ui-check/verify.mjs ${f.id}\``, '');
  }
  while (out.length && out[out.length - 1] === '') out.pop();
  return out.join('\n');
}
