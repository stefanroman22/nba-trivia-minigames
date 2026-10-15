// API acceptance assertions (spec §6), the Logic Check form of a finding's acceptance:
//   { "api": { "persona": "guest|logic.actor|logic.peer|logic.admin", "method": "POST", "path": "/api/signup/", "body": {…}, "headers": {…} },
//     "expect": { "status": 400, "json": [["error", "==", "password_too_short"]], "headers": { "content-type": "json" } } }
// json paths use dot/bracket notation (`error`, `user.username`, `items[0].rank`); ops ==, !=, >, >=, <, <=, contains,
// exists. Header expectations: a case-insensitive substring of the response header, or null = header absent.
// Validation lives here (findings.mjs calls apiAssertionErrors); runApiAssertion executes one with node fetch against a
// Django origin, token injected by the caller (verify-core mints it per persona). A status mismatch or a path miss is a
// clean `fail` with one measured/expected line; only a request that cannot be made at all is an `error`.

export const API_PERSONAS = ['guest', 'logic.actor', 'logic.peer', 'logic.admin'];
export const API_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'];
export const JSON_OPS = ['==', '!=', '>', '>=', '<', '<=', 'contains', 'exists'];
const API_KEYS = ['persona', 'method', 'path', 'body', 'headers'];
const EXPECT_KEYS = ['status', 'json', 'headers'];

export const isApiAssertion = (a) => !!a && typeof a === 'object' && !Array.isArray(a) && 'api' in a;
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const show = (v) => (v === undefined ? 'missing' : JSON.stringify(v));

/** `items[0].rank` → ['items', 0, 'rank']; throws on a malformed path. */
export function jsonPathParts(p) {
  if (typeof p !== 'string' || !p.trim()) throw new Error('needs a path such as "error", "user.username" or "items[0].rank"');
  const parts = [];
  const re = /(?:^|\.)([A-Za-z_$][\w$-]*)|\[(\d+)\]|\["([^"\]]+)"\]/y;
  let i = 0;
  while (i < p.length) {
    re.lastIndex = i;
    const m = re.exec(p);
    if (!m || m[0].length === 0 || (m.index === 0 && p[0] === '.')) throw new Error(`invalid json path ${JSON.stringify(p)} (use dot/bracket notation: user.username, items[0].rank)`);
    parts.push(m[1] ?? (m[2] !== undefined ? Number(m[2]) : m[3]));
    i = re.lastIndex;
  }
  return parts;
}

/** { found, value } of a json path in a parsed body. */
export function getPath(obj, p) {
  let cur = obj;
  for (const k of jsonPathParts(p)) {
    if (cur === null || typeof cur !== 'object' || !(k in Object(cur))) return { found: false, value: undefined };
    cur = cur[k];
  }
  return { found: true, value: cur };
}

const canon = (v) => (Array.isArray(v) ? `[${v.map(canon).join(',')}]` : isObj(v) ? `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canon(v[k])}`).join(',')}}` : JSON.stringify(v));
const eq = (a, b) => canon(a) === canon(b);

/** DSL errors of one API assertion → string[] ("<base>.<field>: <problem>"). */
export function apiAssertionErrors(a, base = 'assertion') {
  const errs = [];
  if (!isObj(a)) return [`${base}: must be an object`];
  for (const k of Object.keys(a)) if (!['api', 'expect'].includes(k)) errs.push(`${base}: unknown key "${k}" (an API assertion has api, expect)`);
  const r = a.api;
  if (!isObj(r)) errs.push(`${base}.api: must be { persona, method, path, body?, headers? }`);
  else {
    for (const k of Object.keys(r)) if (!API_KEYS.includes(k)) errs.push(`${base}.api: unknown key "${k}" (known: ${API_KEYS.join(', ')})`);
    if (!API_PERSONAS.includes(r.persona)) errs.push(`${base}.api.persona: must be one of ${API_PERSONAS.join(', ')} (got ${JSON.stringify(r.persona)})`);
    if (!API_METHODS.includes(r.method)) errs.push(`${base}.api.method: must be one of ${API_METHODS.join(', ')} (got ${JSON.stringify(r.method)})`);
    if (typeof r.path !== 'string' || !r.path.startsWith('/') || r.path.startsWith('//')) errs.push(`${base}.api.path: must be a path on the Django origin starting with "/" (got ${JSON.stringify(r.path)})`);
    if (r.headers !== undefined && !(isObj(r.headers) && Object.values(r.headers).every((v) => typeof v === 'string'))) errs.push(`${base}.api.headers: must be { "Name": "value" }`);
    if (r.body !== undefined && ['GET', 'HEAD'].includes(r.method)) errs.push(`${base}.api.body: a ${r.method} request has no body`);
  }
  const x = a.expect;
  if (!isObj(x)) { errs.push(`${base}.expect: must be { status, json?, headers? }`); return errs; }
  for (const k of Object.keys(x)) if (!EXPECT_KEYS.includes(k)) errs.push(`${base}.expect: unknown key "${k}" (known: ${EXPECT_KEYS.join(', ')})`);
  if (!(Number.isInteger(x.status) && x.status >= 100 && x.status <= 599)) errs.push(`${base}.expect.status: needs an HTTP status 100–599 (got ${JSON.stringify(x.status)})`);
  if (x.json !== undefined) {
    if (!Array.isArray(x.json) || !x.json.length) errs.push(`${base}.expect.json: needs a list of ["path", "op", value]`);
    else x.json.forEach((t, i) => {
      const at = `${base}.expect.json[${i}]`;
      if (!Array.isArray(t) || t.length < 2 || t.length > 3) { errs.push(`${at}: needs ["path", "op", value]`); return; }
      try { jsonPathParts(t[0]); } catch (e) { errs.push(`${at}: ${e.message}`); }
      if (!JSON_OPS.includes(t[1])) { errs.push(`${at}: operator must be one of ${JSON_OPS.join(', ')} (got ${JSON.stringify(t[1])})`); return; }
      if (t[1] === 'exists') { if (t.length === 3 && typeof t[2] !== 'boolean') errs.push(`${at}: exists takes true/false (or nothing = true)`); return; }
      if (t.length !== 3) errs.push(`${at}: ${t[1]} needs a value`);
      else if (['>', '>=', '<', '<='].includes(t[1]) && !(typeof t[2] === 'number' && Number.isFinite(t[2]))) errs.push(`${at}: ${t[1]} needs a number`);
    });
  }
  if (x.headers !== undefined && !(isObj(x.headers) && Object.values(x.headers).every((v) => typeof v === 'string' || v === null))) errs.push(`${base}.expect.headers: must be { "name": "substring" | null }`);
  return errs;
}

/** One-line description for REPORT.md, cards and verify output. */
export function describeApiAssertion(a) {
  const r = a.api || {}, x = a.expect || {};
  const json = (x.json || []).map((t) => (t[1] === 'exists' ? `${t[0]} ${t[2] === false ? 'absent' : 'exists'}` : `${t[0]} ${t[1]} ${JSON.stringify(t[2])}`));
  const hdr = Object.entries(x.headers || {}).map(([k, v]) => (v === null ? `header ${k} absent` : `header ${k} ~ ${v}`));
  return `api ${r.persona} · ${r.method} \`${r.path}\`${r.body !== undefined ? ` ${JSON.stringify(r.body)}` : ''} ⇒ status ${x.status}${[...json, ...hdr].map((s) => `; ${s}`).join('')}`;
}

/** One json expectation against a parsed body → { ok, text }. */
function checkJson(body, [p, op, want = true]) {
  const { found, value } = getPath(body, p);
  const exp = `${p} ${op}${op === 'exists' ? (want === false ? ' false' : '') : ` ${JSON.stringify(want)}`}`;
  if (op === 'exists') { const ok = found === (want !== false); return { ok, text: ok ? exp : `${p}: ${found ? `present (${show(value)})` : 'missing'} (expected ${want === false ? 'absent' : 'present'})` }; }
  if (!found) return { ok: false, text: `${p}: missing (expected ${op} ${JSON.stringify(want)})` };
  let ok;
  switch (op) {
    case '==': ok = eq(value, want); break;
    case '!=': ok = !eq(value, want); break;
    case '>': ok = typeof value === 'number' && value > want; break;
    case '>=': ok = typeof value === 'number' && value >= want; break;
    case '<': ok = typeof value === 'number' && value < want; break;
    case '<=': ok = typeof value === 'number' && value <= want; break;
    case 'contains': ok = typeof value === 'string' ? typeof want === 'string' && value.includes(want) : Array.isArray(value) ? value.some((v) => eq(v, want)) : isObj(value) && typeof want === 'string' && want in value; break;
    default: ok = false;
  }
  return { ok, text: ok ? exp : `${p}: ${show(value)} (expected ${op} ${JSON.stringify(want)})` };
}

/**
 * The expectations of an API assertion against a response { status, headers: {lower-case name: value}, text } →
 * { outcome: 'pass'|'fail', lines: [{ ok, error: false, text }] }. Pure.
 */
export function evaluateApi(expect, res) {
  const lines = [];
  const st = res.status === expect.status;
  lines.push({ ok: st, error: false, text: st ? `status ${res.status}` : `status ${res.status} (expected ${expect.status})${res.text ? ` — body ${String(res.text).replace(/\s+/g, ' ').slice(0, 160)}` : ''}` });
  if (expect.json) {
    let body;
    try { body = JSON.parse(res.text); } catch { body = undefined; }
    if (body === undefined) lines.push({ ok: false, error: false, text: `body is not JSON (expected ${expect.json.length} json check(s)): ${String(res.text || '').replace(/\s+/g, ' ').slice(0, 120) || 'empty'}` });
    else for (const t of expect.json) lines.push({ ...checkJson(body, t), error: false });
  }
  for (const [name, want] of Object.entries(expect.headers || {})) {
    const got = res.headers[name.toLowerCase()];
    const ok = want === null ? got === undefined : got !== undefined && got.toLowerCase().includes(String(want).toLowerCase());
    lines.push({ ok, error: false, text: ok ? `header ${name}` : `header ${name}: ${got === undefined ? 'absent' : JSON.stringify(got)} (expected ${want === null ? 'absent' : `~ ${JSON.stringify(want)}`})` });
  }
  return { outcome: lines.every((l) => l.ok) ? 'pass' : 'fail', lines };
}

/**
 * Run one API assertion: `origin` = the Django base (any URL on it; the path replaces its path), `token` = the
 * persona's access token (null for guest). → { outcome: 'pass'|'fail'|'error', lines, url, status }.
 * Never throws: a request that cannot be made (connection refused, timeout) is an `error`.
 */
export async function runApiAssertion(a, { origin, token = null, fetchImpl = fetch, timeoutMs = 15_000 }) {
  const r = a.api;
  const url = new URL(r.path, origin).href;
  const headers = { Accept: 'application/json', ...(r.body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(r.headers || {}) };
  let res;
  try {
    res = await fetchImpl(url, { method: r.method, headers, body: r.body !== undefined ? JSON.stringify(r.body) : undefined, redirect: 'manual', signal: AbortSignal.timeout(timeoutMs) });
  } catch (e) {
    return { outcome: 'error', url, status: null, lines: [{ ok: false, error: true, text: `${r.method} ${r.path} could not be sent: ${e.cause?.code || e.name}: ${String(e.cause?.message || e.message).split('\n')[0]}` }] };
  }
  const text = r.method === 'HEAD' ? '' : await res.text().catch(() => '');
  const hdrs = {};
  res.headers.forEach((v, k) => { hdrs[k.toLowerCase()] = v; });
  const { outcome, lines } = evaluateApi(a.expect, { status: res.status, headers: hdrs, text });
  return { outcome, url, status: res.status, lines };
}
