#!/usr/bin/env node
// Clusters of open findings: one engine (frontend → frontend-engine; backend, ci → backend-engine) and a shared
// file or acceptance check per cluster, so one cluster is one engine dispatch (ui-fix) and one Notion card
// (notion-push). `[prod]` clusters hold a perf criterion and sort last (budgets are enforced only in prod builds).
//   node scripts/check-core/lib/clusters.mjs [runId|-] [severities|all] [owners|all] [suites|all] [ids|all]
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ROOT } from './home.mjs';
import { listRuns, readFindingsDoc, runPath } from './findings.mjs';

export const CHECKS_MD = path.join(ROOT, 'scripts', 'ui-check', 'CHECKS.md');
export const PERF_RULES = ['perf', 'loaf', 'cls', 'slow-action', 'slow-api'];
export const DEFAULT_SEVERITIES = 'blocker,major,minor';

/**
 * Check-id patterns of the `@perf` rows in CHECKS.md (`<game>` style placeholders match any id segment). The tag may sit
 * in any cell after the id (the guest table has an extra `live` column before the description since 2026-10-15).
 */
export function perfIdsFrom(checksMd) {
  return [...String(checksMd).matchAll(/^\| `([^`]+)` \|(?:[^|\n]*\|)*?\s*`@perf`/gm)].map((m) => new RegExp('^' + m[1].replace(/<[^>]+>/g, '[A-Za-z0-9_.-]+') + '$'));
}

export function isPerfFinding(f, perfIds) {
  return PERF_RULES.includes(f.rule)
    || (f.acceptance.assertions || []).some((x) => (x.expect || []).some((e) => 'maxCls' in e || 'maxLoafMs' in e))
    || (f.acceptance.checks || []).some((c) => perfIds.some((re) => re.test(c.id)));
}

export const engineOf = (f) => (f.owner === 'frontend' ? 'frontend-engine' : 'backend-engine');
const keysOf = (f) => [...f.files.map((x) => 'f:' + x.path), ...(f.acceptance.checks || []).map((c) => 'c:' + c.id)];

/** Open findings matching the filters (each a list, or null for all). */
export function selectOpen(findings, { severities = null, owners = null, suites = null, ids = null } = {}) {
  const ok = (list, v) => !list || list.includes(v);
  return findings.filter((f) => f.status !== 'fixed' && ok(severities, f.severity) && ok(owners, f.owner) && ok(suites, f.suite) && ok(ids, f.id));
}

/** [{ engine, prod, items, keys }] in dispatch order (non-prod first, otherwise first-seen order). */
export function planClusters(findings, { checksMd, perfIds } = {}) {
  const res = perfIds || perfIdsFrom(checksMd ?? readFileSync(CHECKS_MD, 'utf8'));
  const clusters = [];
  for (const f of findings) {
    const hit = clusters.filter((c) => c.engine === engineOf(f) && keysOf(f).some((k) => c.keys.has(k)));
    const c = hit.shift() || (clusters.push({ engine: engineOf(f), keys: new Set(), items: [] }), clusters.at(-1));
    for (const o of hit) { c.items.push(...o.items); o.keys.forEach((k) => c.keys.add(k)); clusters.splice(clusters.indexOf(o), 1); }
    c.items.push(f); keysOf(f).forEach((k) => c.keys.add(k));
  }
  const prod = (c) => c.items.some((f) => isPerfFinding(f, res));
  clusters.sort((x, y) => prod(x) - prod(y));
  return clusters.map((c) => ({ engine: c.engine, prod: prod(c), items: c.items, keys: [...c.keys] }));
}

/** The plan as printed by the CLI (and, before, by the ui-fix skill's inline script). */
export function planLines({ run, runDir, open, clusters, perfIds }) {
  const out = [`runDir ${runDir} · runId ${run} · ${open.length} open finding(s) · ${clusters.length} cluster(s)`];
  clusters.forEach((c, i) => {
    out.push(`#${i + 1} ${c.engine}${c.prod ? ' [prod]' : ''}: ${c.items.map((f) => f.id).join(' ')}`);
    for (const f of c.items) out.push(`   ${f.id} ${f.severity} ${f.owner} ${f.suite}${isPerfFinding(f, perfIds) ? ' perf' : ''} ${f.where.route} checks=${[...new Set([f.evidence.checkId, ...(f.acceptance.checks || []).map((x) => x.id)].filter(Boolean))].join(',') || '-'} files=${[...new Set(f.files.map((x) => x.path))].join(',')}`);
  });
  return out;
}

/** A run directory name: YYYYMMDD-HHmm, plus an optional `x` (copied run) or `-live` (live subset) suffix. */
export const isRunId = (r) => /^\d{8}-\d{4}(x|-live)?$/.test(String(r));

/** CLI-style list argument: '-' or missing → default, 'all' → null, else comma list. */
export const listArg = (v, d) => { const s = v && v !== '-' ? v : d; return s === 'all' ? null : s.split(','); };

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const a = process.argv.slice(2);
  const run = a[0] && a[0] !== '-' ? a[0] : listRuns().find((r) => isRunId(r) && readFindingsDoc(r));
  if (!run || !readFindingsDoc(run)) { console.log(`no findings.json for run ${run || '(none)'}: run the ui-check skill first`); process.exit(0); }
  const open = selectOpen(readFindingsDoc(run).findings, {
    severities: listArg(a[1], DEFAULT_SEVERITIES), owners: listArg(a[2], 'all'), suites: listArg(a[3], 'all'), ids: listArg(a[4], 'all'),
  });
  const perfIds = perfIdsFrom(readFileSync(CHECKS_MD, 'utf8'));
  const clusters = planClusters(open, { perfIds });
  console.log(planLines({ run, runDir: runPath(run), open, clusters, perfIds }).join('\n'));
}
