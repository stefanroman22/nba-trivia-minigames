// What an audit run leaves in its run dir (spec §4): digest.md (the only file the seo agent reads), results.json (the
// AuditResult), baseline.json (failing ids per URL, the next run's --baseline), and, for the post-deploy workflow,
// findings.json with one card finding per regressed check (Task 6's findings shape). Also the baseline comparison.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const CHECKS_PATH = fileURLToPath(new URL('../CHECKS.md', import.meta.url));

/** Top-level comma split that keeps "a (b, c)" in one piece. */
function splitTopLevel(s) {
  const out = [];
  let depth = 0;
  let cur = '';
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '(') depth += 1;
    if (c === ')') depth -= 1;
    if (depth === 0 && s.startsWith(', ', i)) { out.push(cur); cur = ''; i += 1; continue; }
    cur += c;
  }
  return [...out, cur].map((x) => x.trim()).filter(Boolean);
}

/**
 * The IX catalogue from scripts/seo/CHECKS.md → Map id → { what, pass, step, files: string[] }. `files` is the files
 * column split on ", " outside parentheses, backticks removed.
 */
export function readCatalogue(file = CHECKS_PATH) {
  const out = new Map();
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\|\s*(IX-\d\d)\s*\|(.*)\|\s*$/);
    if (!m) continue;
    const [what, pass, step, files] = m[2].split('|').map((c) => c.trim());
    out.set(m[1], { what, pass, step, files: splitTopLevel(files).map((f) => f.replaceAll('`', '')) });
  }
  return out;
}

/** Every failure of a result, page and site-wide, sorted by id then url. */
export function allFailures(result) {
  return [...Object.values(result.urls).flatMap((u) => u.failures), ...result.siteFailures]
    .sort((a, b) => a.id.localeCompare(b.id) || a.url.localeCompare(b.url));
}

/**
 * Baseline = { [url]: failing ids } over every audited URL ([] when clean) and every URL a site-wide failure names
 * (site-wide checks report on the home page's URL, so a robots.txt break is a regression of the home page).
 * A subset run (`result.only`: --only, or --url) checked only those ids, so its baseline is
 * `{ only, urls: { [url]: ids } }` over the audited pages alone: its [] means "clean for the `only` ids", never "clean".
 * @returns {Record<string, string[]> | { only: string[], urls: Record<string, string[]> }}
 */
export function toBaseline(result) {
  const out = Object.fromEntries(Object.keys(result.urls).map((u) => [u, []]));
  for (const f of allFailures(result)) {
    if (result.only && !Object.hasOwn(out, f.url)) continue; // a --url run's site-wide line on a page it did not audit
    out[f.url] ??= [];
    if (!out[f.url].includes(f.id)) out[f.url].push(f.id);
  }
  for (const ids of Object.values(out)) ids.sort();
  return result.only ? { only: [...result.only], urls: out } : out;
}

/** True for a subset baseline `{ only: string[], urls: {…} }` (a full one is keyed by absolute URLs, never "only"). */
export const isSubsetBaseline = (b) => Array.isArray(b?.only) && b.urls && typeof b.urls === 'object' && !Array.isArray(b.urls);

/**
 * The failures of `result` whose (url, id) is new against `baseline`: the url is in the baseline, the baseline checked
 * the id (every id for a full baseline, its `only` ids for a subset one) and the id is not in the url's list. A URL
 * absent from the baseline is never a regression (a new page has no "was fine" to compare with), nor is an id a
 * subset baseline never checked. A transient failure (a request that could not complete, `transient: true`) is never a
 * regression either: it still fails the run and is listed under Coverage gaps.
 * @param {object} result an AuditResult
 * @param {Record<string, string[]> | { only: string[], urls: Record<string, string[]> }} baseline
 */
export function regressionsAgainst(result, baseline) {
  const { only, urls } = isSubsetBaseline(baseline) ? baseline : { only: null, urls: baseline };
  return allFailures(result).filter((f) => !f.transient && (!only || only.includes(f.id))
    && Object.hasOwn(urls, f.url) && !(urls[f.url] ?? []).includes(f.id));
}

/** The header line: also the CLI's first line (without the "# "). */
export function digestHeader(result) {
  const failing = new Set(allFailures(result).map((f) => f.id)).size;
  return `seo-audit: run ${result.runId} · site ${result.site} · ${result.counts.urls} urls · ${failing} failing checks`;
}

const evidenceLine = (f) => `${f.url}: ${f.evidence}`;

/** digest.md as a string: header, one `## FAIL IX-nn <what>` per failing id, `## Regressions` (baseline runs only), `## Coverage gaps`. */
export function renderDigest(result, catalogue = readCatalogue()) {
  const lines = [`# ${digestHeader(result)}`, ''];
  const byId = new Map();
  for (const f of allFailures(result)) {
    if (!byId.has(f.id)) byId.set(f.id, []);
    byId.get(f.id).push(f);
  }
  for (const [id, list] of byId) {
    lines.push(`## FAIL ${id} ${catalogue.get(id)?.what ?? ''}`.trimEnd(), ...list.map((f) => `- ${evidenceLine(f)}`), '');
  }
  if (result.regressions) {
    lines.push('## Regressions', ...(result.regressions.length ? result.regressions.map((f) => `- ${f.id} ${evidenceLine(f)}`) : ['- none']), '');
  }
  lines.push('## Coverage gaps', ...(result.gaps.length ? result.gaps.map((g) => `- ${g}`) : ['- none']), '');
  return lines.join('\n');
}

/**
 * Writes digest.md, results.json (the AuditResult) and baseline.json (toBaseline) into `runDir`.
 * @returns {{ digestPath: string, resultsPath: string, baselinePath: string }}
 */
export function writeDigest(result, runDir) {
  mkdirSync(runDir, { recursive: true });
  const digestPath = path.join(runDir, 'digest.md');
  const resultsPath = path.join(runDir, 'results.json');
  const baselinePath = path.join(runDir, 'baseline.json');
  writeFileSync(digestPath, renderDigest(result));
  writeFileSync(resultsPath, `${JSON.stringify(result, null, 2)}\n`);
  writeFileSync(baselinePath, `${JSON.stringify(toBaseline(result), null, 2)}\n`);
  return { digestPath, resultsPath, baselinePath };
}

/**
 * `<runDir>/findings.json` for the post-deploy workflow: one `decision: 'card'` blocker finding per regressed check
 * id, its URLs grouped and sorted, in Task 6's findings shape (`regression: true`). No regressions → `findings: []`.
 * @returns {string} the file path
 */
export function writeRegressionFindings(result, runDir, catalogue = readCatalogue()) {
  const byId = new Map();
  for (const f of result.regressions ?? []) {
    if (!byId.has(f.id)) byId.set(f.id, []);
    byId.get(f.id).push(f);
  }
  const findings = [...byId.keys()].sort().map((check, i) => {
    const list = byId.get(check).sort((a, b) => a.url.localeCompare(b.url));
    const urls = [...new Set(list.map((f) => f.url))];
    const entry = catalogue.get(check) ?? { pass: '', step: '', files: [] };
    return {
      id: `SEO-${result.runId}-${String(i + 1).padStart(3, '0')}`,
      check,
      severity: 'blocker',
      urls,
      current: list.map(evidenceLine).join('; '),
      expected: entry.pass,
      files: entry.files,
      howToFix: `See docs/seo/indexing-guide.md step ${entry.step}`,
      acceptance: { audit: `node scripts/seo/audit.mjs --only ${check} --site ${result.site}`, qa: [] },
      fingerprint: `${check}|${[...urls].sort().join(',')}`,
      regression: true,
      decision: 'card',
    };
  });
  mkdirSync(runDir, { recursive: true });
  const file = path.join(runDir, 'findings.json');
  writeFileSync(file, `${JSON.stringify({ runId: result.runId, findings }, null, 2)}\n`);
  return file;
}
