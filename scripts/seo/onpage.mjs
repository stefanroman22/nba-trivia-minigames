// The SEO on-page measurement (phase 2, catalogue scripts/seo/CHECKS.md "On-page"): sitemap.xml → the home page and
// every sitemap URL (GET, 4 in flight, redirects never followed) → the OP checks of lib/onpage-checks.mjs, with the
// keyword map scripts/seo/keyword-map.json; optionally PageSpeed Insights (OP-10) and a Search Analytics page × query
// export (OP-11).
//
//   node scripts/seo/onpage.mjs [--site <url>] [--run-dir <dir>] [--analytics <gsc-analytics-pq.json>] [--psi]
//
// Writes onpage.json (per URL: a signals summary and its failures) and onpage-summary.md (header, one `## FAIL OP-nn`
// per failing check, `## Coverage gaps`) to <uicHome()>/seo/runs/<runId>/ (or --run-dir). With --analytics also
// queries-summary.md, the only file that carries Search Analytics values or query strings (PRIVATE, first line says
// so): never the console, onpage.json or onpage-summary.md. --psi: PageSpeed Insights v5 (mobile, performance) for the
// home page and up to 3 game pages with env PSI_API_KEY (the key is never printed). First line
// `seo-onpage: run <runId> · site <site> · <n> urls · <f> failing checks`, last line `seo-onpage: summary <path>`.
// Exit 0 all pass, 1 a check failed, 2 infra (sitemap unreachable, bad arguments, an unreadable --analytics file).
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { RUNS_ROOT, newRunId } from './audit.mjs';
import { loadConfig } from './lib/config.mjs';
import { fetcher as makeFetcher, DEFAULT_UA } from './lib/fetcher.mjs';
import { parseSitemap } from './lib/sitemap.mjs';
import { NON_GAME_PATHS, OP_AREAS, OP_IDS, checkOnpage, pageSignals, pathOf, queryFlags, sharedSets, uniqueSentences, wordCount } from './lib/onpage-checks.mjs';

export const KEYWORD_MAP_PATH = fileURLToPath(new URL('./keyword-map.json', import.meta.url));
export const PSI_URL = 'https://www.googleapis.com/pagespeedonline/v5/runPagespeed';
export const PSI_TIMEOUT_MS = 120_000;
/** Game pages PageSpeed Insights measures besides the home page. */
export const PSI_GAME_PAGES = 3;
export const PRIVATE_LINE = 'PRIVATE: do not copy into REPORT.md, owner-actions.md, logs or Slack';
const UNIQUE_TEXT_MAX = 1500;

const infra = (message) => Object.assign(new Error(message), { infra: true });

/** scripts/seo/keyword-map.json → { path: { primary, related } }. */
export function loadKeywordMap(file = KEYWORD_MAP_PATH) {
  return JSON.parse(readFileSync(file, 'utf8').replace(/^﻿/, ''));
}

/**
 * A Search Analytics page × query export (gsc-client analytics() rows, or `{ rows }`) → its rows. Throws without
 * quoting the file: a JSON.parse message would carry a piece of it, query strings included.
 */
export function readAnalytics(file) {
  let doc;
  try { doc = JSON.parse(readFileSync(file, 'utf8').replace(/^﻿/, '')); } catch (e) {
    throw new Error(`--analytics ${file}: ${e.code === 'ENOENT' ? 'no such file' : 'does not parse as JSON'}`);
  }
  const rows = Array.isArray(doc) ? doc : doc?.rows;
  if (!Array.isArray(rows) || !rows.every((r) => Array.isArray(r?.keys) && r.keys.length >= 2)) {
    throw new Error(`--analytics ${file}: not a page × query Search Analytics export (rows with keys [page, query])`);
  }
  return rows;
}

/**
 * PageSpeed Insights v5 for `url` (strategy mobile, category performance) → { lab: { lcp, tbt, cls }, field: { lcp,
 * inp, cls } | null } (ms; CLS unitless; field = the page's own p75 from loadingExperience, null when absent or only
 * the origin's). A non-2xx answer throws an Error with `status`; no message ever holds the request URL (it has the key).
 */
export async function fetchPsi(url, { key, fetch: fetchImpl = globalThis.fetch, timeoutMs = PSI_TIMEOUT_MS }) {
  const api = new URL(PSI_URL);
  api.searchParams.set('url', url);
  api.searchParams.set('strategy', 'mobile');
  api.searchParams.set('category', 'performance');
  api.searchParams.set('key', key);
  let res;
  try { res = await fetchImpl(api.href, { signal: AbortSignal.timeout(timeoutMs) }); } catch (e) {
    throw new Error(`request failed (${e.name === 'TimeoutError' ? `timed out after ${timeoutMs / 1000} s` : e.cause?.code || e.name})`);
  }
  if (!res.ok) throw Object.assign(new Error(`PageSpeed Insights answered ${res.status}`), { status: res.status });
  let body;
  try { body = await res.json(); } catch { throw new Error('PageSpeed Insights did not answer JSON'); }
  const audits = body?.lighthouseResult?.audits ?? {};
  const num = (k) => (typeof audits[k]?.numericValue === 'number' ? audits[k].numericValue : null);
  const exp = body?.loadingExperience;
  const metric = (k) => (typeof exp?.metrics?.[k]?.percentile === 'number' ? exp.metrics[k].percentile : null);
  let field = null;
  if (exp?.metrics && !exp.origin_fallback) {
    const clsP = metric('CUMULATIVE_LAYOUT_SHIFT_SCORE');
    field = { lcp: metric('LARGEST_CONTENTFUL_PAINT_MS'), inp: metric('INTERACTION_TO_NEXT_PAINT'), cls: clsP === null ? null : clsP / 100 };
    if (Object.values(field).every((v) => v === null)) field = null;
  }
  return { lab: { lcp: num('largest-contentful-paint'), tbt: num('total-blocking-time'), cls: num('cumulative-layout-shift') }, field };
}

/** "404", or "request failed (<why>)" for a fetch result. */
const statusText = (res) => (res.status === 0 ? `request failed (${res.error})` : `answered ${res.status}`);

/** 'home' for `/`, 'other' for the other NON_GAME_PATHS, else 'game'. */
const kindOf = (u) => { const p = pathOf(u); return p === '/' ? 'home' : NON_GAME_PATHS.includes(p) ? 'other' : 'game'; };

/**
 * @typedef {{ id: string, url: string, evidence: string }} Failure
 * @typedef {{ runId: string, site: string, urls: Record<string, { status: number, path: string, kind: 'home'|'game'|'other',
 *   summary: object|null, failures: Failure[] }>, gaps: string[], counts: { urls: number, pass: number, fail: number },
 *   queries: ReturnType<typeof queryFlags>|null }} OnpageResult
 *   `queries`: the OP-11 flags with their Search Analytics numbers (private: writeOnpage puts them in
 *   queries-summary.md only, never in onpage.json).
 */

/**
 * Runs the on-page checks. Sitemap URLs on another host than `site` (a preview listing the production URLs) are
 * fetched on `site`. A page that does not answer 200 is not judged (a Coverage gaps line: its status is IX-02's).
 * `psi`: null (not asked: one gaps line), or { key, fetch } (no key, a 429 or a 403: one gaps line; other errors one
 * line per page). `analytics`: the page × query rows, or null.
 *
 * @param {{ site: string, fetcher: { get(url: string): Promise<object> }, keywordMap: object, analytics?: object[]|null,
 *   psi?: { key: string|null, fetch?: typeof fetch }|null, runId: string }} opts
 * @returns {Promise<OnpageResult>}
 */
export async function runOnpage({ site, fetcher, keywordMap, analytics = null, psi = null, runId }) {
  site = site.replace(/\/+$/, '');
  const siteUrl = new URL(site);
  const home = `${site}/`;
  const gaps = [];
  const get = (u) => fetcher.get(u).catch((e) => ({ status: 0, headers: {}, body: '', location: null, error: e.message }));

  const sitemapUrl = `${site}/sitemap.xml`;
  let sitemapRes;
  try { sitemapRes = await fetcher.get(sitemapUrl); } catch (e) { throw infra(e.message); }
  if (sitemapRes.status !== 200) throw infra(`${sitemapUrl} answered ${sitemapRes.status}, want 200`);
  const targets = [home];
  for (const { loc } of parseSitemap(sitemapRes.body).urls) {
    let abs;
    try { abs = new URL(loc); } catch { continue; }
    if (!/^https?:$/.test(abs.protocol)) continue;
    const fetchUrl = abs.host === siteUrl.host ? abs.href : new URL(`${abs.pathname}${abs.search}`, site).href;
    if (!targets.includes(fetchUrl)) targets.push(fetchUrl);
  }
  if (targets.length === 1) throw infra(`${sitemapUrl} lists no URL`);

  const pages = new Map(await Promise.all(targets.map(async (u) => [u, await get(u)])));
  const failed = [...pages.values()].filter((p) => p.status === 0);
  if (failed.length === pages.size) throw infra(`every page request failed (${failed[0].error})`);
  const ok = (u) => pages.get(u).status === 200;
  for (const u of targets.filter((x) => !ok(x))) gaps.push(`${u} not checked: ${statusText(pages.get(u))}`);
  const signals = new Map(targets.filter(ok).map((u) => [u, pageSignals(pages.get(u).body, { url: u })]));

  const games = targets.filter((u) => kindOf(u) === 'game');
  const readGames = games.filter(ok);
  const shared = { ...sharedSets(readGames.map((u) => ({ url: u, signals: signals.get(u) }))), gameUrls: new Set(games) };
  if (readGames.length < 2) gaps.push(`OP-05/OP-06 shared menu not removed: ${readGames.length} game page(s) read, want >= 2`);
  const checked = targets.filter((u) => ok(u) && kindOf(u) !== 'other');
  const siteDescriptions = new Map();
  for (const u of checked) {
    const d = signals.get(u).description;
    if (d) siteDescriptions.set(d, [...(siteDescriptions.get(d) ?? []), u]);
  }

  // OP-10 lab and field data: the home page and the first game pages, one at a time (a 429 stops the rest).
  const psiData = new Map();
  if (!psi) gaps.push('OP-10 PageSpeed lab and field data not checked: run with --psi and env PSI_API_KEY (the HTML size is checked)');
  else if (!psi.key) gaps.push('OP-10 PageSpeed lab and field data not checked: --psi given but env PSI_API_KEY is not set');
  else {
    for (const u of [home, ...readGames.slice(0, PSI_GAME_PAGES)].filter(ok)) {
      try { psiData.set(u, await fetchPsi(u, { key: psi.key, fetch: psi.fetch })); } catch (e) {
        if (e.status === 429 || e.status === 403) {
          gaps.push(`OP-10 PageSpeed lab and field data not checked: PageSpeed Insights answered ${e.status} (${e.status === 429 ? 'quota exceeded' : 'key refused'})`);
          break;
        }
        gaps.push(`OP-10 PageSpeed data for ${u} not fetched: ${e.message}`);
      }
    }
    const without = checked.filter((u) => !psiData.has(u));
    if (psiData.size && without.length) gaps.push(`OP-10 PageSpeed lab and field data for ${psiData.size} of ${checked.length} pages (the home page and up to ${PSI_GAME_PAGES} game pages); HTML size only for the other ${without.length}`);
  }

  const urls = {};
  for (const u of targets) {
    const kind = kindOf(u);
    const entry = { status: pages.get(u).status, path: pathOf(u), kind, summary: null, failures: [] };
    urls[u] = entry;
    if (!ok(u)) continue;
    const s = signals.get(u);
    const ctx = { keyword: keywordMap[pathOf(u)] ?? null, isGame: kind === 'game', isHome: kind === 'home', shared, siteDescriptions, psi: psiData.get(u) ?? null };
    entry.failures = checkOnpage({ url: u, signals: s }, ctx);
    const unique = uniqueSentences(s, shared).join(' ');
    entry.summary = {
      title: s.title,
      description: s.description,
      h1: s.h1,
      h2: s.h2,
      uniqueWords: wordCount(unique),
      uniqueText: unique.length > UNIQUE_TEXT_MAX ? `${unique.slice(0, UNIQUE_TEXT_MAX)}…` : unique,
      links: s.links.length,
      images: s.images,
      jsonLdTypes: s.jsonLdTypes,
      breadcrumbItems: s.breadcrumbItems,
      hasRating: s.hasRating,
      htmlBytes: s.htmlBytes,
      psi: psiData.get(u) ?? null,
    };
  }

  if (!analytics) gaps.push('OP-11 not checked: no --analytics file (gsc-analytics-pq.json)');
  const fail = targets.filter((u) => urls[u].failures.length).length;
  return { runId, site, urls, gaps, counts: { urls: targets.length, pass: targets.length - fail, fail }, queries: analytics ? queryFlags(analytics, keywordMap) : null };
}

/** Every failure of a result, sorted by id then url. */
export const allFailures = (result) => Object.values(result.urls).flatMap((u) => u.failures)
  .sort((a, b) => a.id.localeCompare(b.id) || a.url.localeCompare(b.url));

/** The header line: also the CLI's first line (without the "# "). */
export function onpageHeader(result) {
  const failing = new Set(allFailures(result).map((f) => f.id)).size;
  return `seo-onpage: run ${result.runId} · site ${result.site} · ${result.counts.urls} urls · ${failing} failing checks`;
}

/** onpage-summary.md: header, one `## FAIL OP-nn <area>` per failing id with `- <url>: <evidence>`, `## Coverage gaps`. No Search Analytics data. */
export function renderSummary(result) {
  const lines = [`# ${onpageHeader(result)}`, ''];
  const failures = allFailures(result);
  for (const id of OP_IDS) {
    const list = failures.filter((f) => f.id === id);
    if (list.length) lines.push(`## FAIL ${id} ${OP_AREAS[id]}`, ...list.map((f) => `- ${f.url}: ${f.evidence}`), '');
  }
  lines.push('## Coverage gaps', ...(result.gaps.length ? result.gaps.map((g) => `- ${g}`) : ['- none']), '');
  return lines.join('\n');
}

const pct = (x) => `${(x * 100).toFixed(1)} %`;
const pos = (x) => x.toFixed(1);

/** queries-summary.md (PRIVATE): per path the primary query, the OP-11 flags and the top 5 queries with their numbers. */
export function renderQueries(result) {
  const lines = [PRIVATE_LINE, '', `# seo-onpage queries: run ${result.runId} · site ${result.site} · Search Analytics page × query, 28 days`, ''];
  const entries = Object.entries(result.queries ?? {});
  if (!entries.length) lines.push('No rows.', '');
  for (const [p, q] of entries) {
    lines.push(
      `## ${p}`,
      `- primary query: ${q.primary ?? '(no keyword-map entry)'}`,
      `- flags: ${q.flags.length ? q.flags.join(', ') : 'none'}`,
      `- page: ${q.impressions} impressions · ${q.clicks} clicks · CTR ${pct(q.ctr)} · position ${pos(q.position)}`,
      '- top queries by impressions:',
      ...q.queries.map((r) => `  - "${r.query}": ${r.impressions} impressions · ${r.clicks} clicks · CTR ${pct(r.ctr)} · position ${pos(r.position)}`),
      '',
    );
  }
  return lines.join('\n');
}

/**
 * Writes onpage.json (the result without `queries`), onpage-summary.md and, when the result has queries,
 * queries-summary.md into `runDir`.
 * @returns {{ jsonPath: string, summaryPath: string, queriesPath: string|null }}
 */
export function writeOnpage(result, runDir) {
  mkdirSync(runDir, { recursive: true });
  const jsonPath = path.join(runDir, 'onpage.json');
  const summaryPath = path.join(runDir, 'onpage-summary.md');
  const { queries, ...publicResult } = result;
  writeFileSync(jsonPath, `${JSON.stringify(publicResult, null, 2)}\n`);
  writeFileSync(summaryPath, renderSummary(result));
  let queriesPath = null;
  if (queries) {
    queriesPath = path.join(runDir, 'queries-summary.md');
    writeFileSync(queriesPath, renderQueries(result));
  }
  return { jsonPath, summaryPath, queriesPath };
}

/** 1 when any check failed, else 0. */
export const exitCodeFor = (result) => (allFailures(result).length ? 1 : 0);

/** CLI flags → { site, runDir, analytics, psi }; throws on an unknown flag or a missing value. */
export function parseArgs(argv) {
  const opts = { site: null, runDir: null, analytics: null, psi: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const value = () => {
      const v = argv[++i];
      if (v === undefined || v.startsWith('--')) throw new Error(`${a} needs a value`);
      return v;
    };
    if (a === '--site') opts.site = value();
    else if (a === '--run-dir') opts.runDir = value();
    else if (a === '--analytics') opts.analytics = value();
    else if (a === '--psi') opts.psi = true;
    else throw new Error(`unknown argument ${a}`);
  }
  return opts;
}

/** A new run id (as audit.mjs makes them) whose run dir holds neither an audit's results.json nor an onpage.json. */
function freshRunId(now = new Date()) {
  let id = newRunId({ now });
  for (let k = 1; k <= 30 && existsSync(path.join(RUNS_ROOT, id, 'onpage.json')); k++) id = newRunId({ now: new Date(now.getTime() + k * 60_000) });
  return id;
}

/**
 * The CLI. `fetcher` (the site client) and `fetch` (PageSpeed Insights) are injectable for tests; `env` gives
 * PSI_API_KEY. Prints the header, one `seo-onpage: FAIL OP-nn · <k> url(s)` per failing id and the file paths: never
 * a Search Analytics value, a query string or the key.
 */
export async function cli(argv, { log = console.log, err = console.error, env = process.env, fetcher = null, fetch: fetchImpl = globalThis.fetch } = {}) {
  let opts;
  let analytics = null;
  try {
    opts = parseArgs(argv);
    if (opts.site && !/^https?:$/.test(new URL(opts.site).protocol)) throw new Error(`--site ${opts.site} is not an http(s) URL`);
    if (opts.analytics) analytics = readAnalytics(opts.analytics);
  } catch (e) {
    err(`seo-onpage: ${e.message}`);
    return 2;
  }
  const site = (opts.site ?? loadConfig().site).replace(/\/+$/, '');
  let runDir;
  let runId;
  if (opts.runDir) {
    runDir = path.resolve(opts.runDir);
    // The weekly run's dir is named by its run id; any other dir gets this minute's id (newRunId under a root that
    // holds no run dirs).
    runId = /^\d{8}-\d{4}-seo$/.test(path.basename(runDir)) ? path.basename(runDir) : newRunId({ root: runDir });
  } else {
    runId = freshRunId();
    runDir = path.join(RUNS_ROOT, runId);
  }
  try {
    const client = fetcher ?? makeFetcher({ ua: DEFAULT_UA, concurrency: 4, timeoutMs: 15000, redirect: 'manual' });
    const psi = opts.psi ? { key: env.PSI_API_KEY?.trim() || null, fetch: fetchImpl } : null;
    const result = await runOnpage({ site, fetcher: client, keywordMap: loadKeywordMap(), analytics, psi, runId });
    log(onpageHeader(result));
    const failures = allFailures(result);
    for (const id of OP_IDS) {
      const n = new Set(failures.filter((f) => f.id === id).map((f) => f.url)).size;
      if (n) log(`seo-onpage: FAIL ${id} · ${n} url(s)`);
    }
    const { summaryPath, queriesPath } = writeOnpage(result, runDir);
    if (queriesPath) log(`seo-onpage: queries ${queriesPath} (private)`);
    log(`seo-onpage: summary ${summaryPath}`);
    return exitCodeFor(result);
  } catch (e) {
    err(`seo-onpage: infra: ${e.infra ? e.message : e.stack}`);
    return 2;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await cli(process.argv.slice(2));
}
