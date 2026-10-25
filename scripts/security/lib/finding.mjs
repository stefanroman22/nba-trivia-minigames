// One finding shape for every detector (gitleaks, osv-scanner, the Claude review), so the weekly ticket, the PR gate and
// the state store never care where a finding came from. Design: docs/security/README.md.
//
//   { fingerprint, tool, rule, category, priority, severity, confidence, title, file, line, snippet, commit,
//     exploitPath, fix: [step], acceptance, verify, rootCause, area }
//
// fingerprint = sha256(rule \n file \n sha256(normalised code context)) cut to 16 hex: the line number is not in it, so
// a finding keeps its fingerprint when code above it moves. Context: the sink line (Claude), the package@version (osv),
// the secret itself (gitleaks; only its hash ever leaves this module).
import { createHash } from 'node:crypto';

export const SEVERITIES = ['critical', 'high', 'medium', 'low'];
export const sevRank = (s) => ({ critical: 4, high: 3, medium: 2, low: 1 })[s] || 0;

// The owner's priority order: 1 exploitable, 2 database exposure, 3 data leakage, 4 keys/tokens, 5 everything else.
const EXPLOITABLE = ['injection', 'rce', 'auth-bypass', 'idor', 'ssrf', 'xss', 'path-traversal', 'csrf'];
export const CATEGORIES = [...EXPLOITABLE, 'db-exposure', 'data-leak', 'secret', 'dependency', 'other'];
export function priorityOf(category) {
  if (EXPLOITABLE.includes(category)) return 1;
  return { 'db-exposure': 2, 'data-leak': 3, secret: 4 }[category] || 5;
}

export const MIN_CONFIDENCE = 8;
// a secret only in the PR's commits (removed since) cannot be fixed by a commit: reported and recorded, not blocking
export const blocking = (f) => sevRank(f.severity) >= 3 && f.confidence >= MIN_CONFIDENCE && !f.historyOnly;

const sha = (s) => createHash('sha256').update(String(s)).digest('hex');
export const normalise = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
export const contextHash = (text) => sha(normalise(text)).slice(0, 16);
export const fingerprintOf = (rule, file, ctxHash) => sha(`${rule}\n${file}\n${ctxHash}`).slice(0, 16);

export function areaOf(file) {
  const f = String(file || '');
  if (/(^|\/)(package-lock\.json|requirements[^/]*\.txt)$/.test(f)) return 'deps';
  if (f.startsWith('backend/') || f.startsWith('moderation_service/')) return 'backend';
  if (f.startsWith('multiplayer_server/')) return 'multiplayer';
  if (f.startsWith('src/') || f.startsWith('public/')) return 'frontend';
  if (f.startsWith('.github/')) return 'ci';
  if (f.startsWith('scripts/') || f.startsWith('infra/') || f.startsWith('.claude/')) return 'tooling';
  return 'other';
}

/** Lines of `text` → { line, snippet } of the first line whose normalised text equals `snippet`'s, else null. */
export function locate(text, snippet) {
  const want = normalise(snippet);
  if (!want) return null;
  const lines = String(text).split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) if (normalise(lines[i]) === want) return { line: i + 1, snippet: lines[i].trim() };
  // A multi-line snippet, or one the model shortened: the first line that contains its first line.
  const first = normalise(String(snippet).split(/\r?\n/)[0]);
  if (first.length >= 12) for (let i = 0; i < lines.length; i++) if (normalise(lines[i]).includes(first)) return { line: i + 1, snippet: lines[i].trim() };
  return null;
}

const SEV_ALIASES = { critical: 'critical', high: 'high', medium: 'medium', moderate: 'medium', low: 'low', info: 'low' };
const clampConf = (n) => Math.max(1, Math.min(10, Math.round(Number(n) || 0)));
const steps = (v) => (Array.isArray(v) ? v : String(v || '').split(/\n+/)).map((s) => String(s).replace(/^\s*\d+[.)]\s*/, '').trim()).filter(Boolean);
const slug = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48);

/**
 * A Claude finding (the JSON the review returns) → finding. `readFile(path)` → file text or null (the checkout under
 * review): the snippet is located there, so line and fingerprint come from the code, not from the model's counting.
 */
export function fromClaude(raw, readFile) {
  const file = String(raw.file || '').replace(/^\.\//, '').replace(/\\/g, '/');
  const category = CATEGORIES.includes(raw.category) ? raw.category : 'other';
  const rule = slug(raw.rule) || category;
  const text = file ? readFile(file) : null;
  const hit = text !== null && text !== undefined ? locate(text, raw.snippet) : null;
  let line = hit?.line || Number(raw.line) || 0;
  let snippet = hit?.snippet || String(raw.snippet || '').trim();
  if (!hit && text && line > 0) snippet = String(text).split(/\r?\n/)[line - 1]?.trim() || snippet;
  if (!snippet) snippet = normalise(raw.title);
  const severity = SEV_ALIASES[String(raw.severity || '').toLowerCase()] || 'medium';
  return {
    fingerprint: fingerprintOf(rule, file, contextHash(snippet)),
    tool: 'claude', rule, category, priority: priorityOf(category), severity, confidence: clampConf(raw.confidence),
    title: normalise(raw.title) || rule, file, line, snippet: snippet.slice(0, 300), commit: null,
    exploitPath: normalise(raw.exploitPath || raw.exploit_path), fix: steps(raw.fix),
    acceptance: normalise(raw.acceptance), verify: normalise(raw.verify),
    rootCause: slug(raw.rootCause || raw.root_cause) || `${category}-${areaOf(file)}`, area: areaOf(file),
  };
}

/** One gitleaks report entry → finding. The secret is hashed into the fingerprint and then dropped. */
export function fromGitleaks(g, { mode = 'weekly' } = {}) {
  const file = String(g.File || '').replace(/^\/repo\//, '').replace(/^\.\//, '');
  const rule = slug(g.RuleID) || 'secret';
  const commit = g.Commit ? String(g.Commit).slice(0, 12) : null;
  const where = commit ? `\`${file}\` (commit ${commit.slice(0, 7)}${g.Date ? `, ${String(g.Date).slice(0, 10)}` : ''})` : `\`${file}\``;
  return {
    fingerprint: fingerprintOf(rule, file, contextHash(g.Secret || g.Match || g.Fingerprint)),
    tool: 'gitleaks', rule, category: 'secret', priority: priorityOf('secret'), severity: 'critical', confidence: 9,
    title: `Leaked ${g.RuleID || 'secret'} credential in ${file}`, file, line: Number(g.StartLine) || 0,
    snippet: '', commit,
    exploitPath: `${where} holds a ${g.RuleID} credential. The repository is public, so anyone who clones it (or reads the commit on GitHub) has the key → they can call the service as this project${mode === 'pr' ? ' (the branch was already pushed, so the key is public now)' : ''}.`,
    fix: [
      `Revoke / rotate the credential at its provider first (the leaked value stays valid until you do; see docs/CREDENTIALS.md for who issued it and its blast radius).`,
      `Put the new value in the environment (GitHub secret / Vercel / Railway env, \`.env\` locally — never in code) and read it from there in \`${file}\`.`,
      `Remove the literal from \`${file}\`${commit ? ` and purge it from git history (git filter-repo --replace-text, then a force-push the owner does by hand; deleting it from the current code alone is not a fix — every old commit still serves it)` : ''}.`,
    ],
    acceptance: `The old credential is revoked at the provider; gitleaks finds no ${g.RuleID} in ${commit ? 'the full history' : 'the tree'}.`,
    verify: `Run the weekly security scan (workflow_dispatch) or \`gitleaks detect\`${commit ? '' : ' --no-git'}: no ${rule} finding for ${file}.`,
    rootCause: 'leaked-secrets', area: areaOf(file),
  };
}

const cvssSeverity = (score) => {
  const n = Number(score);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n >= 9 ? 'critical' : n >= 7 ? 'high' : n >= 4 ? 'medium' : 'low';
};

// '4.2.10' > '4.2.3': compare dotted numeric parts (pre-release suffixes ignored)
const verCmp = (a, b) => {
  const pa = String(a).split(/[.+-]/).map((x) => parseInt(x, 10) || 0), pb = String(b).split(/[.+-]/).map((x) => parseInt(x, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) - (pb[i] || 0);
  return 0;
};

/** osv-scanner v2 JSON (`scan source --format json`) → findings, ONE per locked package version (all its advisories:
 *  the root cause is that version, the fix one upgrade). Lockfile paths are made relative to `root` (the scanned dir). */
export function fromOsv(report, { root = '' } = {}) {
  const out = [];
  const base = String(root).replace(/\\/g, '/').replace(/\/+$/, '');
  for (const res of report?.results || []) {
    const abs = String(res.source?.path || '').replace(/\\/g, '/');
    const file = base && abs.startsWith(`${base}/`) ? abs.slice(base.length + 1) : abs.replace(/^\.\//, '');
    for (const p of res.packages || []) {
      const pkg = p.package || {};
      const vulns = p.vulnerabilities || [];
      if (!vulns.length) continue;
      const groups = p.groups?.length ? p.groups : vulns.map((v) => ({ ids: [v.id] }));
      const ids = [...new Set(groups.map((g) => [...(g.ids || [])].sort()[0]).filter(Boolean))].sort();
      const dbSev = vulns.map((v) => SEV_ALIASES[String(v.database_specific?.severity || '').toLowerCase()]).filter(Boolean);
      const severity = [...groups.map((g) => cvssSeverity(g.max_severity)).filter(Boolean), ...dbSev].sort((a, b) => sevRank(b) - sevRank(a))[0] || 'medium';
      const fixed = [...new Set(vulns.flatMap((v) => (v.affected || []).filter((a) => a.package?.name === pkg.name).flatMap((a) => (a.ranges || []).flatMap((r) => (r.events || []).map((e) => e.fixed).filter(Boolean)))))].sort(verCmp);
      const target = fixed.filter((v) => verCmp(v, pkg.version) > 0).pop() || fixed.pop();
      const summary = normalise(vulns.map((v) => v.summary).find(Boolean) || ids[0]);
      const idText = `${ids.slice(0, 8).join(', ')}${ids.length > 8 ? ` +${ids.length - 8} more` : ''}`;
      out.push({
        fingerprint: fingerprintOf(`osv-${slug(pkg.name)}`, file, contextHash(`${pkg.ecosystem}:${pkg.name}@${pkg.version}`)),
        tool: 'osv', rule: `osv-${slug(pkg.name)}`, category: 'dependency', priority: priorityOf('dependency'), severity, confidence: 8,
        title: `${pkg.name}@${pkg.version}: ${ids.length > 1 ? `${ids.length} advisories` : summary}`.slice(0, 200), file, line: 0, snippet: `${pkg.ecosystem}:${pkg.name}@${pkg.version}`, commit: null,
        exploitPath: `${pkg.name}@${pkg.version} (${pkg.ecosystem}, locked in ${file}) is affected by ${idText} (e.g. ${summary}). Exploitable only where the app reaches the vulnerable API; a build/dev-only package is lower risk.`,
        fix: [target ? `Upgrade ${pkg.name} from ${pkg.version} to ${target} or later in \`${file}\` (${pkg.ecosystem === 'PyPI' ? `pin \`${pkg.name}>=${target}\`` : `\`npm install ${pkg.name}@${target}\` for a direct dependency, an \`overrides\` entry for a transitive one`}).` : `No fixed version is published for ${pkg.name}@${pkg.version}: replace it, or confirm the vulnerable API is unused and mute the fingerprint in .security/ignore.json with that reason.`],
        // one line per lockfile in the ticket (the group dedupes identical text)
        acceptance: `osv-scanner reports none of the packages above in \`${file}\`.`,
        verify: `The tests of the area \`${file}\` serves pass after the upgrades; \`osv-scanner scan source -r .\` no longer lists them.`,
        rootCause: `deps-${slug(file)}`, area: 'deps',
      });
    }
  }
  return out;
}

/** Same fingerprint twice (two detectors, two lockfiles, one model reporting a sink twice): keep the strongest. A secret
 *  the review reports where gitleaks already did (same file, within 2 lines) is the same leak: gitleaks' finding stays. */
export function dedupe(findings) {
  const leaks = findings.filter((f) => f.tool === 'gitleaks');
  findings = findings.filter((f) => !(f.tool === 'claude' && f.category === 'secret' && leaks.some((g) => g.file === f.file && Math.abs((g.line || 0) - (f.line || 0)) <= 2)));
  const by = new Map();
  for (const f of findings) {
    const prev = by.get(f.fingerprint);
    if (!prev || sevRank(f.severity) > sevRank(prev.severity) || (sevRank(f.severity) === sevRank(prev.severity) && f.confidence > prev.confidence)) by.set(f.fingerprint, f);
  }
  return [...by.values()];
}

/** .security/ignore.json entries [{ fingerprint, reason, until? }] → the findings not muted (an expired `until` unmutes). */
export function applyIgnore(findings, ignore = [], now = Date.now()) {
  const muted = new Set(ignore.filter((i) => i && i.fingerprint && i.reason && (!i.until || Date.parse(i.until) > now)).map((i) => i.fingerprint));
  return findings.filter((f) => !muted.has(f.fingerprint));
}

export const bySeverity = (a, b) => sevRank(b.severity) - sevRank(a.severity) || a.priority - b.priority || b.confidence - a.confidence || String(a.file).localeCompare(String(b.file));
