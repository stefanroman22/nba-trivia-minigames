// The SEO indexing audit (spec §4, catalogue scripts/seo/CHECKS.md): robots.txt → sitemap.xml → every sitemap URL, the
// home page and the expected-noindex pages (GET, 4 in flight, redirects never followed) → the per-page HTML checks
// (lib/html-checks.mjs; plus one `?ref=seo-audit` variant per page for IX-04) → the site-wide checks IX-01, IX-02 (status, http:// and www. variants, an unknown slug),
// IX-10 (sitemap), IX-11 (orphans) and the IX-12 fetches (og:image, favicon, manifest; HEAD).
//
//   node scripts/seo/audit.mjs [--site <url>] [--only IX-04,IX-10] [--url <u>] [--baseline <baseline.json>]
//                              [--findings] [--run-dir <dir>] [--json]
//
// Writes digest.md, results.json and baseline.json to <uicHome()>/seo/runs/<runId>/ (or --run-dir); --findings adds
// findings.json (one card per regressed check). --baseline takes a Baseline ({ url: failing ids }; a --only/--url run
// writes { only, urls } and is compared on its `only` ids alone) or a previous run's results.json. --json prints the AuditResult on stdout (the progress lines go to stderr). First line
// `seo-audit: run <runId> · site <site> · <n> urls · <f> failing checks`, last line `seo-audit: digest <path>`.
// Exit 0 all pass, 1 a check failed, 2 infra (site unreachable, bad arguments), 3 a regression against the baseline.
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { uicHome } from '../check-core/lib/home.mjs';
import { loadConfig } from './lib/config.mjs';
import { fetcher as makeFetcher, DEFAULT_UA } from './lib/fetcher.mjs';
import { extractSignals, checkPage } from './lib/html-checks.mjs';
import { parseRobots, robotsAllows } from './lib/robots.mjs';
import { parseSitemap } from './lib/sitemap.mjs';
import { allFailures, digestHeader, isSubsetBaseline, regressionsAgainst, toBaseline, writeDigest, writeRegressionFindings } from './lib/digest.mjs';

export { toBaseline, regressionsAgainst };

export const IX_IDS = Array.from({ length: 12 }, (_, i) => `IX-${String(i + 1).padStart(2, '0')}`);
export const RUNS_ROOT = path.join(uicHome(), 'seo', 'runs');
/** Checks a --url run cannot judge for its page alone (they compare against, or walk, the rest of the site). */
const PARTIAL_UNDER_URL = ['IX-05', 'IX-06', 'IX-10', 'IX-11'];

const pad = (n) => String(n).padStart(2, '0');
const minuteId = (d) => `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}-seo`;

/**
 * The id of a new run (local time, YYYYMMDD-HHmm-seo): the first minute from `now` on (at most 30 ahead) whose run dir
 * under `root` holds no results.json, so two runs in one minute never overwrite each other (as the checkers' freshRunId).
 */
export function newRunId({ now = new Date(), root = RUNS_ROOT } = {}) {
  let id = minuteId(now);
  for (let k = 1; k <= 30 && existsSync(path.join(root, id, 'results.json')); k++) id = minuteId(new Date(now.getTime() + k * 60_000));
  return id;
}

const isLocalHost = (hostname) => ['localhost', '127.0.0.1', '[::1]', '::1'].includes(hostname) || hostname.endsWith('.localhost');
const infra = (message) => Object.assign(new Error(message), { infra: true });
/** A URL without query and fragment, for link-graph comparisons. */
const bare = (u) => { const x = new URL(u); x.search = ''; x.hash = ''; return x.href; };
const sameUrl = (a, b) => { try { return new URL(a).href === new URL(b).href; } catch { return a === b; } };

/** "301 → <location>", "404", or "request failed (<why>)" for a fetch result. */
function statusText(res) {
  if (res.status === 0) return `request failed (${res.error})`;
  return res.location ? `${res.status} → ${res.location}` : String(res.status);
}

/**
 * A failure caused by a request that could not complete even after the fetcher's retries (status 0): its evidence
 * starts with "request failed" and it carries `transient: true`, so it fails the run (exit 1) and is listed under
 * Coverage gaps, but it is never a regression (regressionsAgainst).
 */
const transientFailure = (id, url, res, context) => ({ id, url, evidence: `request failed (${res.error})${context ? `: ${context}` : ''}`, transient: true });

/** The href of the page's `<link rel="manifest">`, resolved against `url`, or null. */
function manifestHref(html, url) {
  for (const [tag] of String(html).matchAll(/<link\b[^>]*>/gi)) {
    const rel = tag.match(/\brel\s*=\s*["']?([^"'>]*)/i)?.[1] ?? '';
    const href = tag.match(/\bhref\s*=\s*["']?([^"'\s>]+)/i)?.[1];
    if (href && rel.toLowerCase().split(/\s+/).includes('manifest')) { try { return new URL(href, url).href; } catch { return null; } }
  }
  return null;
}

/**
 * @typedef {{ id: string, url: string, evidence: string, transient?: true }} Failure
 *   `transient`: the failure comes from a request that could not complete (see transientFailure).
 * @typedef {{ runId: string, site: string, only: string[]|null, urls: Record<string, { status: number, failures: Failure[] }>,
 *   siteFailures: Failure[], regressions: Failure[]|null, gaps: string[], counts: { urls: number, pass: number, fail: number } }} AuditResult
 *   `only`: the ids this run fully checked, null for a full run (--only's list; under --url also without IX-05, IX-06,
 *   IX-10 and IX-11, which need the whole site); its baseline then vouches for those ids only. `urls`: every fetched page (sitemap URLs, the home page, the expected-noindex pages) with its status (0 = the request
 *   failed) and its page checks (IX-02 status, IX-03…IX-09, IX-12). `siteFailures`: IX-01, the IX-02 variants and the
 *   unknown slug, IX-10, IX-11 and the favicon/manifest IX-12; a site-wide failure without a page of its own (robots.txt,
 *   the sitemap file, the slug, the icons) is reported on the home page's URL. `regressions`: null without a baseline.
 *   `gaps`: what was not checked and why (digest `## Coverage gaps`).
 */

/**
 * Runs the audit. `site` is the origin to audit; `config` is loadConfig()'s (its `site` is the production host: only
 * there are the http:// and www. variants checked, and a robots.txt that disallows everything on any other host is
 * a preview, so IX-01 is skipped). Sitemap URLs on the production host are fetched on `site` when `site` is another
 * host. `only` keeps those check ids (and skips the fetches only the others need); `url` audits that one page.
 *
 * @param {{ site: string, config: object, fetcher: ReturnType<typeof makeFetcher>, baseline?: Record<string, string[]>|null,
 *   only?: string[]|null, url?: string|null, runId?: string, now?: Date }} opts
 * @returns {Promise<AuditResult>}
 */
export async function runAudit({ site, config, fetcher, baseline = null, only = null, url = null, runId, now = new Date() }) {
  site = site.replace(/\/+$/, '');
  const siteUrl = new URL(site);
  const home = `${site}/`;
  const configHost = new URL(config.site).host;
  const isProduction = siteUrl.host === configHost;
  const variantsReachable = isProduction && !isLocalHost(siteUrl.hostname);
  const want = (id) => !only || only.includes(id);
  const gaps = [];
  const siteFailures = [];
  const siteFail = (id, evidence, at = home) => siteFailures.push({ id, url: at, evidence });
  const get = (u) => fetcher.get(u).catch((e) => ({ status: 0, headers: {}, body: '', location: null, error: e.message }));
  const head = (u) => fetcher.head(u).catch((e) => ({ status: 0, headers: {}, body: '', location: null, error: e.message }));

  // 1. robots.txt and 2. the sitemap: without them the site is unreachable (infra), not failing.
  const robotsUrl = `${site}/robots.txt`;
  const sitemapUrl = `${site}/sitemap.xml`;
  let robotsRes;
  let sitemapRes;
  try { robotsRes = await fetcher.get(robotsUrl); } catch (e) { throw infra(e.message); }
  try { sitemapRes = await fetcher.get(sitemapUrl); } catch (e) { throw infra(e.message); }
  const robots = parseRobots(robotsRes.status === 200 ? robotsRes.body : '');
  const sitemap = sitemapRes.status === 200 ? parseSitemap(sitemapRes.body) : { urls: [], errors: [], hasPriorityOrChangefreq: false };

  const entries = []; // { loc, lastmod, fetchUrl }: absolute sitemap URLs, deduped
  const foreign = [];
  for (const { loc, lastmod } of sitemap.urls) {
    let abs;
    try { abs = new URL(loc); } catch { continue; } // a relative loc is already a sitemap error
    if (!/^https?:$/.test(abs.protocol)) continue;
    let fetchUrl = abs.href;
    if (abs.host !== siteUrl.host) {
      if (isProduction) { foreign.push(abs.href); continue; }
      fetchUrl = new URL(`${abs.pathname}${abs.search}`, site).href; // a preview or local build lists the production URLs
    }
    if (!entries.some((e) => e.fetchUrl === fetchUrl)) entries.push({ loc: abs.href, lastmod, fetchUrl });
  }
  const bySitemap = new Map(entries.map((e) => [e.fetchUrl, e]));
  const noindexUrls = new Set((config.expectedNoindex ?? []).map((p) => new URL(p, site).href));

  // 3. Fetch the pages (the fetcher keeps 4 in flight).
  let targets = [...new Set([home, ...entries.map((e) => e.fetchUrl), ...noindexUrls])];
  if (url) {
    targets = [new URL(url, site).href];
    gaps.push(`--url ${targets[0]}: IX-11 (orphans) not checked; IX-05/IX-06 uniqueness and the per-URL IX-10 checks cover this page only`);
  }
  const pages = new Map(await Promise.all(targets.map(async (u) => [u, await get(u)])));
  const failed = [...pages.values()].filter((p) => p.status === 0);
  if (failed.length === pages.size) throw infra(`every page request failed (${failed[0].error})`);
  const inScope = entries.filter((e) => pages.has(e.fetchUrl));
  const ok = (u) => pages.get(u)?.status === 200;
  // IX-04 "?ref=x variants keep it": one tracking-parameter variant per indexable sitemap URL.
  const refOf = (u) => { const x = new URL(u); x.searchParams.append('ref', 'seo-audit'); return x.href; };
  const refPages = !want('IX-04') ? new Map()
    : new Map(await Promise.all(inScope.filter((e) => ok(e.fetchUrl) && !noindexUrls.has(e.fetchUrl)).map(async (e) => [e.fetchUrl, await get(refOf(e.fetchUrl))])));

  const signals = new Map();
  for (const [u, res] of pages) if (res.status === 200 || noindexUrls.has(u)) signals.set(u, extractSignals(res.body, { url: u }));
  const indexable = targets.filter((u) => ok(u) && !noindexUrls.has(u));

  // 4. Per-page checks. Titles and descriptions are compared across the indexable pages only (a noindex page sharing
  // the default title competes with nothing).
  const siteTitles = new Map();
  const siteDescriptions = new Map();
  const addTo = (map, key, u) => { if (key) map.set(key, [...(map.get(key) ?? []), u]); };
  for (const u of indexable) { addTo(siteTitles, signals.get(u).title, u); addTo(siteDescriptions, signals.get(u).description, u); }

  const urls = Object.fromEntries(targets.map((u) => [u, { status: pages.get(u).status, failures: [] }]));
  for (const u of targets) {
    const res = pages.get(u);
    const ctx = { url: u, sitemapUrl: bySitemap.get(u)?.loc ?? null, xRobotsTag: res.headers['x-robots-tag'] ?? null, siteTitles, siteDescriptions };
    if (noindexUrls.has(u)) {
      const found = checkPage(signals.get(u), { ...ctx, expectNoindex: true });
      if (res.status === 0) for (const f of found) Object.assign(f, { evidence: `${statusText(res)}; ${f.evidence}`, transient: true });
      else if (res.status !== 200) for (const f of found) f.evidence = `answered ${statusText(res)}; ${f.evidence}`;
      urls[u].failures.push(...found);
    } else if (res.status === 0) {
      urls[u].failures.push(transientFailure('IX-02', u, res, 'want 200'));
    } else if (res.status !== 200) {
      urls[u].failures.push({ id: 'IX-02', url: u, evidence: `answered ${statusText(res)}, want 200` });
    } else {
      urls[u].failures.push(...checkPage(signals.get(u), { ...ctx, expectNoindex: false }));
    }
  }
  /**
   * Adds `reason` to the page's `id` failure (one Failure per page and check), creating it when there is none. The
   * failure stays transient only while every reason is (a request that failed).
   */
  const addPageReason = (u, id, reason, transient = false) => {
    const existing = urls[u].failures.find((f) => f.id === id);
    if (existing) { existing.evidence += `; ${reason}`; if (!transient) delete existing.transient; }
    else urls[u].failures.push({ id, url: u, evidence: reason, ...(transient ? { transient: true } : {}) });
  };
  for (const [u, res] of refPages) {
    if (res.status !== 200) continue; // a variant that does not answer is not a canonical question
    const variant = refOf(u);
    const ctx = { url: variant, sitemapUrl: bySitemap.get(u).loc, expectNoindex: false, xRobotsTag: null, siteTitles, siteDescriptions };
    const canonical = checkPage(extractSignals(res.body, { url: variant }), ctx).find((f) => f.id === 'IX-04');
    if (canonical) addPageReason(u, 'IX-04', `variant ${variant}: ${canonical.evidence}`);
  }

  // IX-01 robots.txt
  if (!isProduction && robotsRes.status === 200 && !robotsAllows(robots, home)) {
    gaps.push(`IX-01 not checked: ${siteUrl.host} is not the configured site ${configHost} and its robots.txt disallows everything (a preview or local build)`);
  } else if (want('IX-01')) {
    const reasons = [];
    if (robotsRes.status !== 200) reasons.push(`answered ${statusText(robotsRes)}, want 200`);
    else {
      if (!robots.groups.length && !robots.sitemaps.length) reasons.push('does not parse as robots.txt (no User-agent group, no Sitemap line)');
      else if (!robots.groups.some((g) => g.agents.includes('*'))) reasons.push('no User-agent: * group');
      const blocked = entries.filter((e) => !robotsAllows(robots, e.fetchUrl)).map((e) => e.fetchUrl);
      if (blocked.length) reasons.push(`User-agent: * disallows sitemap URL(s) ${blocked.join(', ')}`);
      if (robotsAllows(robots, `${site}/admin`)) reasons.push('User-agent: * allows /admin');
      if (!robots.sitemaps.some((s) => sameUrl(s, sitemapUrl))) reasons.push(`no "Sitemap: ${sitemapUrl}" line${robots.sitemaps.length ? ` (it names ${robots.sitemaps.join(', ')})` : ''}`);
      for (const line of robots.unsupported.filter((l) => /^(noindex|crawl-delay)\s*:/i.test(l))) reasons.push(`unsupported line "${line}"`);
    }
    if (reasons.length) siteFail('IX-01', `${robotsUrl}: ${reasons.join('; ')}`);
  }

  // IX-02 the variants (production host only) and an unknown slug
  const extra = [];
  if (want('IX-02')) {
    if (!variantsReachable) {
      gaps.push(`IX-02 http:// and www. variants not checked: ${isProduction ? `${siteUrl.hostname} is a local host` : `${siteUrl.host} is not the production host ${configHost}`}`);
    } else {
      for (const e of inScope) {
        const t = new URL(e.fetchUrl);
        const variants = [`http://${t.host}${t.pathname}${t.search}`];
        if (!t.hostname.startsWith('www.')) variants.push(`https://www.${t.host}${t.pathname}${t.search}`);
        for (const v of variants) {
          extra.push(head(v).then((res) => {
            if (res.status === 0) siteFailures.push(transientFailure('IX-02', e.fetchUrl, res, `${v}, want one 301/308 hop to ${e.fetchUrl}`));
            else if (![301, 308].includes(res.status) || !res.location || !sameUrl(res.location, e.fetchUrl)) {
              siteFail('IX-02', `${v} answered ${statusText(res)}, want one 301/308 hop to ${e.fetchUrl}`, e.fetchUrl);
            }
          }));
        }
      }
    }
    const slug = `${site}/__seo-audit-404-${now.getTime()}`;
    extra.push(get(slug).then((res) => {
      if (res.status === 0) siteFailures.push(transientFailure('IX-02', home, res, `unknown slug ${slug}, want 404`));
      else if (![404, 410].includes(res.status)) siteFail('IX-02', `unknown slug ${slug} answered ${statusText(res)}, want 404`);
    }));
  }

  // IX-10 the sitemap
  if (want('IX-10')) {
    const reasons = [];
    if (sitemapRes.status !== 200) reasons.push(`answered ${statusText(sitemapRes)}, want 200`);
    else {
      reasons.push(...sitemap.errors);
      if (sitemap.hasPriorityOrChangefreq) reasons.push('has <priority> or <changefreq> (Google ignores both)');
      if (!sitemap.urls.length && !sitemap.errors.length) reasons.push('lists no URL');
      for (const f of foreign) reasons.push(`loc ${f} is not on ${siteUrl.host}`);
      const dated = sitemap.urls.filter((u) => u.lastmod);
      for (const u of dated.filter((d) => Date.parse(d.lastmod) > now.getTime())) reasons.push(`${u.loc} lastmod ${u.lastmod} is in the future`);
      if (sitemap.urls.length > 1 && dated.length === sitemap.urls.length && new Set(dated.map((d) => d.lastmod)).size === 1) {
        reasons.push(`every URL has the same lastmod ${dated[0].lastmod}`);
      }
    }
    if (reasons.length) siteFail('IX-10', `${sitemapUrl}: ${reasons.join('; ')}`);
    for (const e of inScope) {
      const res = pages.get(e.fetchUrl);
      if (res.status === 0) { siteFailures.push(transientFailure('IX-10', e.fetchUrl, res, 'listed in the sitemap')); continue; }
      if (res.status !== 200) { siteFail('IX-10', `listed in the sitemap but answers ${statusText(res)}`, e.fetchUrl); continue; }
      const canonical = signals.get(e.fetchUrl).canonical;
      if (canonical.length === 1 && /^https?:\/\//i.test(canonical[0]) && !sameUrl(canonical[0], e.loc)) {
        siteFail('IX-10', `listed as ${e.loc} but the page's canonical is ${canonical[0]}`, e.fetchUrl);
      }
    }
  }

  // IX-11 orphans: every indexable sitemap URL is linked from the home page or another sitemap URL.
  if (want('IX-11') && !url) {
    const linkers = [...new Set([home, ...entries.map((e) => e.fetchUrl)])].filter((u) => indexable.includes(u));
    const linksOf = new Map(linkers.map((u) => [u, new Set(signals.get(u).internalLinks.map(bare))]));
    // A page whose request failed may be the one that links: an orphan found without it is not judged.
    const unread = [...new Set([home, ...entries.map((e) => e.fetchUrl)])].filter((u) => pages.get(u)?.status === 0);
    for (const e of entries.filter((x) => indexable.includes(x.fetchUrl))) {
      const target = bare(e.fetchUrl);
      if (!linkers.some((p) => p !== e.fetchUrl && linksOf.get(p).has(target))) {
        const evidence = `no <a href> to it from the home page or another sitemap URL (${linkers.length - 1} other pages read)`;
        if (unread.length) siteFailures.push(transientFailure('IX-11', e.fetchUrl, pages.get(unread[0]), `${unread.join(', ')} not read; ${evidence}`));
        else siteFail('IX-11', evidence, e.fetchUrl);
      }
    }
  }

  // IX-12 fetches: each page's og:image (HEAD, once per image), /favicon.ico, the manifest.
  if (want('IX-12')) {
    const heads = new Map();
    const headOnce = (u) => { if (!heads.has(u)) heads.set(u, head(u)); return heads.get(u); };
    for (const u of indexable) {
      const image = signals.get(u).og.image;
      if (!image) continue;
      let img;
      try { img = new URL(image, u).href; } catch { addPageReason(u, 'IX-12', `og:image "${image}" is not a URL`); continue; }
      extra.push(headOnce(img).then((res) => {
        const type = res.headers['content-type'] ?? '';
        if (res.status === 0) addPageReason(u, 'IX-12', `${statusText(res)}: og:image ${img}, want 200`, true);
        else if (res.status !== 200) addPageReason(u, 'IX-12', `og:image ${img} answered ${statusText(res)}, want 200`);
        else if (!/^image\//i.test(type)) addPageReason(u, 'IX-12', `og:image ${img} is ${type || 'untyped'}, want an image type`);
      }));
    }
    const favicon = `${site}/favicon.ico`;
    const withManifest = [home, ...targets].find((u) => ok(u) && manifestHref(pages.get(u).body, u));
    const manifest = withManifest ? manifestHref(pages.get(withManifest).body, withManifest) : `${site}/manifest.webmanifest`;
    for (const icon of [favicon, manifest]) {
      extra.push(headOnce(icon).then((res) => {
        if (res.status === 0) siteFailures.push(transientFailure('IX-12', home, res, `${icon}, want 200`));
        else if (res.status !== 200) siteFail('IX-12', `${icon} answered ${statusText(res)}, want 200`);
      }));
    }
  }
  await Promise.all(extra);

  for (const u of targets) urls[u].failures = urls[u].failures.filter((f) => want(f.id));
  const kept = siteFailures.filter((f) => want(f.id)).sort((a, b) => a.id.localeCompare(b.id) || a.url.localeCompare(b.url));
  for (const f of allFailures({ urls, siteFailures: kept }).filter((x) => x.transient)) {
    gaps.push(`${f.id} ${f.url} not judged: ${f.evidence} (retried, still failing: a failure of this run, never a regression)`);
  }
  const failing = new Set(allFailures({ urls, siteFailures: kept }).map((f) => f.url));
  const fail = targets.filter((u) => failing.has(u)).length;
  // The ids this run fully checked (null = all): the --only list, minus under --url the checks that need the whole
  // site (uniqueness, sitemap-wide, orphans), so its baseline never claims those clean.
  const checked = url ? (only ?? IX_IDS).filter((id) => !PARTIAL_UNDER_URL.includes(id)) : only;
  const result = {
    runId: runId ?? minuteId(now),
    site,
    only: checked ? [...checked] : null,
    urls,
    siteFailures: kept,
    regressions: null,
    gaps,
    counts: { urls: targets.length, pass: targets.length - fail, fail },
  };
  if (baseline) result.regressions = regressionsAgainst(result, baseline);
  return result;
}

/** 3 when a regression against the baseline, else 1 when any check failed, else 0. */
export function exitCodeFor(result) {
  if (result.regressions?.length) return 3;
  return allFailures(result).length ? 1 : 0;
}

/** CLI flags → { site, only, url, baseline, findings, runDir, json }; throws on an unknown flag or a bad check id. */
export function parseArgs(argv) {
  const opts = { site: null, only: null, url: null, baseline: null, findings: false, runDir: null, json: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const value = () => {
      const v = argv[++i];
      if (v === undefined || v.startsWith('--')) throw new Error(`${a} needs a value`);
      return v;
    };
    if (a === '--site') opts.site = value();
    else if (a === '--only') {
      opts.only = value().split(',').map((s) => s.trim().toUpperCase()).filter(Boolean);
      const bad = opts.only.filter((id) => !IX_IDS.includes(id));
      if (bad.length || !opts.only.length) throw new Error(`--only: unknown check id(s) ${bad.join(', ') || '(none given)'}; ids are IX-01..IX-12`);
    } else if (a === '--url') opts.url = value();
    else if (a === '--baseline') opts.baseline = value();
    else if (a === '--findings') opts.findings = true;
    else if (a === '--run-dir') opts.runDir = value();
    else if (a === '--json') opts.json = true;
    else throw new Error(`unknown argument ${a}`);
  }
  return opts;
}

/**
 * A Baseline file (a full `{ url: [failing ids] }` or a subset `{ only, urls }`), or a previous run's results.json (an
 * AuditResult, turned into its Baseline, which keeps that run's `only`).
 */
export function readBaseline(file) {
  const doc = JSON.parse(readFileSync(file, 'utf8').replace(/^﻿/, ''));
  if (doc && typeof doc.urls === 'object' && Array.isArray(doc.siteFailures)) return toBaseline(doc);
  const map = isSubsetBaseline(doc) ? doc.urls : doc;
  const valid = map && typeof map === 'object' && !Array.isArray(map)
    && Object.values(map).every((ids) => Array.isArray(ids) && ids.every((id) => typeof id === 'string'))
    && (!isSubsetBaseline(doc) || doc.only.every((id) => IX_IDS.includes(id)));
  if (!valid) throw new Error('not a Baseline ({ url: [failing ids] } or { only, urls }) or an audit results.json');
  return doc;
}

async function main(argv) {
  let opts;
  let baseline = null;
  try {
    opts = parseArgs(argv);
    if (opts.site && !/^https?:$/.test(new URL(opts.site).protocol)) throw new Error(`--site ${opts.site} is not an http(s) URL`);
    if (opts.baseline) baseline = readBaseline(opts.baseline);
  } catch (e) {
    console.error(`seo-audit: ${e.message}`);
    return 2;
  }
  const config = loadConfig();
  const site = (opts.site ?? config.site).replace(/\/+$/, '');
  const runId = opts.runDir ? minuteId(new Date()) : newRunId();
  const runDir = opts.runDir ? path.resolve(opts.runDir) : path.join(RUNS_ROOT, runId);
  const say = opts.json ? (s) => console.error(s) : (s) => console.log(s);
  try {
    const client = makeFetcher({ ua: DEFAULT_UA, concurrency: 4, timeoutMs: 15000, redirect: 'manual' });
    const result = await runAudit({ site, config, fetcher: client, baseline, only: opts.only, url: opts.url, runId });
    say(digestHeader(result));
    const ids = [...new Set(allFailures(result).map((f) => f.id))];
    for (const id of ids) say(`seo-audit: FAIL ${id} · ${new Set(allFailures(result).filter((f) => f.id === id).map((f) => f.url)).size} url(s)`);
    if (result.regressions) say(`seo-audit: ${result.regressions.length} regression(s) against the baseline${result.regressions.length ? `: ${[...new Set(result.regressions.map((f) => f.id))].join(', ')}` : ''}`);
    const { digestPath } = writeDigest(result, runDir);
    if (opts.findings) say(`seo-audit: findings ${writeRegressionFindings(result, runDir)}`);
    if (opts.json) console.log(JSON.stringify(result));
    say(`seo-audit: digest ${digestPath}`);
    return exitCodeFor(result);
  } catch (e) {
    console.error(`seo-audit: infra: ${e.infra ? e.message : e.stack}`);
    return 2;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await main(process.argv.slice(2));
}
