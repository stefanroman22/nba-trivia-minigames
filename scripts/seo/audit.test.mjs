// node --test scripts/seo/audit.test.mjs — robots/sitemap parsing, and the whole audit against a fake site
// (scripts/seo/fixtures/site/ served by node:http on 127.0.0.1: /old answers 301 → /wordle, __ORIGIN__ in the fixtures
// becomes the server's origin), the digest, the baseline and the regression findings.
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseRobots, robotsAllows } from './lib/robots.mjs';
import { parseSitemap } from './lib/sitemap.mjs';
import { fetcher, DEFAULT_UA } from './lib/fetcher.mjs';
import { writeDigest, writeRegressionFindings } from './lib/digest.mjs';
import { runAudit, toBaseline, exitCodeFor } from './audit.mjs';
import { loadConfig } from './lib/config.mjs';

const SITE_DIR = fileURLToPath(new URL('./fixtures/site/', import.meta.url));
const AUDIT = fileURLToPath(new URL('./audit.mjs', import.meta.url));
const fixture = (name) => readFileSync(path.join(SITE_DIR, name), 'utf8');
const tmpDirs = [];
const tmp = () => { const d = mkdtempSync(path.join(os.tmpdir(), 'seo-audit-')); tmpDirs.push(d); return d; };

let server;
let O; // the fake site's origin, e.g. http://127.0.0.1:53211
/** Every request the fake site saw: { method, path, search, ua }. */
let requests = [];
/** Per-test knobs: robots → a robots.txt body replacing the fixture; noindex → paths served with a robots noindex meta;
 *  echoCanonical → every page's canonical is the requested URL, query included. */
const state = { robots: null, noindex: new Set(), echoCanonical: false, inFlight: 0, maxInFlight: 0 };

const NOT_FOUND = '<!DOCTYPE html><html><head><meta name="robots" content="noindex"/><title>404</title></head><body><h1>404</h1></body></html>';

function handle(req, res) {
  const { pathname, search, href } = new URL(req.url, O);
  requests.push({ method: req.method, path: pathname, search, ua: req.headers['user-agent'] });
  const send = (status, type, body = '', headers = {}) => {
    res.writeHead(status, { 'content-type': type, ...headers });
    res.end(req.method === 'HEAD' ? undefined : body);
  };
  const page = (name) => {
    let html = fixture(name).replaceAll('__ORIGIN__', O);
    if (state.noindex.has(pathname)) html = html.replace('<head>', '<head>\n<meta name="robots" content="noindex"/>');
    if (state.echoCanonical) html = html.replace(/<link rel="canonical" href="[^"]*"\/>/, `<link rel="canonical" href="${href}"/>`);
    return html;
  };
  if (pathname === '/slow') {
    state.inFlight += 1;
    state.maxInFlight = Math.max(state.maxInFlight, state.inFlight);
    setTimeout(() => { state.inFlight -= 1; send(200, 'text/plain', 'ok'); }, 40);
    return;
  }
  if (pathname === '/robots.txt') return send(200, 'text/plain', state.robots ?? fixture('robots.txt').replaceAll('__ORIGIN__', O));
  if (pathname === '/sitemap.xml') return send(200, 'application/xml', fixture('sitemap.xml').replaceAll('__ORIGIN__', O));
  if (pathname === '/old') return send(301, 'text/plain', 'Moved', { location: `${O}/wordle` });
  if (pathname === '/') return send(200, 'text/html; charset=utf-8', page('index.html'));
  if (['/wordle', '/orphan', '/admin'].includes(pathname)) return send(200, 'text/html; charset=utf-8', page(`${pathname.slice(1)}.html`));
  if (pathname.endsWith('/opengraph-image.png')) return send(200, 'image/png', 'png');
  if (pathname === '/favicon.ico') return send(200, 'image/x-icon', 'ico');
  if (pathname === '/manifest.webmanifest') return send(200, 'application/manifest+json', '{}');
  return send(404, 'text/html; charset=utf-8', NOT_FOUND);
}

before(async () => {
  server = http.createServer(handle);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  O = `http://127.0.0.1:${server.address().port}`;
});
after(() => {
  for (const d of tmpDirs) rmSync(d, { recursive: true, force: true });
  return new Promise((resolve) => server.close(resolve));
});
beforeEach(() => { requests = []; state.robots = null; state.noindex = new Set(); state.echoCanonical = false; });

const client = () => fetcher({ ua: DEFAULT_UA, concurrency: 4, timeoutMs: 15000, redirect: 'manual' });
/** The fake site as the configured production site, with /admin as the only expected-noindex page. */
const fakeConfig = (over = {}) => ({ ...loadConfig(), site: O, expectedNoindex: ['/admin'], ...over });
const audit = (over = {}) => runAudit({ site: O, config: fakeConfig(), fetcher: client(), ...over });
/** Every failure of a result (page and site) as sorted "IX-nn <url>" strings. */
const allFails = (r) => [...Object.values(r.urls).flatMap((u) => u.failures), ...r.siteFailures].map((f) => `${f.id} ${f.url}`).sort();

/** Runs the CLI against the fake site → { code, stdout, stderr } (async: the fake site lives in this process). */
function cli(args, env = {}) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [AUDIT, ...args], { env: { ...process.env, SEO_SITE: O, ...env } });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}

test('parseRobots: live file → sitemap line, Disallow /admin, allows /wordle, disallows /admin', () => {
  const robots = parseRobots(fixture('robots.txt').replaceAll('__ORIGIN__', 'https://swishquest.com'));
  assert.deepEqual(robots.sitemaps, ['https://swishquest.com/sitemap.xml']);
  assert.deepEqual(robots.groups, [{ agents: ['*'], allow: ['/'], disallow: ['/admin'] }]);
  assert.deepEqual(robots.unsupported, []);
  assert.equal(robotsAllows(robots, 'https://swishquest.com/wordle'), true);
  assert.equal(robotsAllows(robots, 'https://swishquest.com/admin'), false);
  assert.equal(robotsAllows(robots, 'https://swishquest.com/admin/users?x=1'), false);
  // Longest match wins; on a tie Allow wins; `*` and `$` are patterns.
  const narrow = parseRobots('User-agent: *\nDisallow: /\nAllow: /wordle\nDisallow: /*.json$\n');
  assert.equal(robotsAllows(narrow, 'https://swishquest.com/wordle'), true);
  assert.equal(robotsAllows(narrow, 'https://swishquest.com/terms'), false);
  assert.equal(robotsAllows(parseRobots('User-agent: *\nAllow: /a\nDisallow: /a\n'), 'https://x.com/a'), true);
  assert.equal(robotsAllows(parseRobots('User-agent: *\nDisallow: /*.json$\n'), 'https://x.com/data.json'), false);
  assert.equal(robotsAllows(parseRobots('User-agent: *\nDisallow: /*.json$\n'), 'https://x.com/data.json?x'), true);
});

test('parseRobots flags noindex and crawl-delay lines as unsupported', () => {
  const robots = parseRobots('# comment\nUser-agent: *\nDisallow:\nNoindex: /secret\nCrawl-delay: 10\n');
  assert.deepEqual(robots.unsupported, ['Noindex: /secret', 'Crawl-delay: 10']);
  assert.deepEqual(robots.groups, [{ agents: ['*'], allow: [], disallow: [] }]);
  assert.equal(robotsAllows(robots, 'https://x.com/anything'), true);
});

test('parseSitemap: urls, lastmod, errors on a relative loc, hasPriorityOrChangefreq', () => {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
<url><loc>https://swishquest.com/?a=1&amp;b=2</loc></url>
<url><loc>https://swishquest.com/privacy</loc><lastmod>2026-10-20</lastmod><priority>0.8</priority></url>
<url><loc>/terms</loc></url>
</urlset>`;
  const parsed = parseSitemap(xml);
  assert.deepEqual(parsed.urls, [
    { loc: 'https://swishquest.com/?a=1&b=2', lastmod: null },
    { loc: 'https://swishquest.com/privacy', lastmod: '2026-10-20' },
    { loc: '/terms', lastmod: null },
  ]);
  assert.equal(parsed.errors.length, 1);
  assert.match(parsed.errors[0], /\/terms.*not absolute/);
  assert.equal(parsed.hasPriorityOrChangefreq, true);

  const clean = parseSitemap(fixture('sitemap.xml').replaceAll('__ORIGIN__', 'https://swishquest.com'));
  assert.deepEqual(clean.errors, []);
  assert.equal(clean.hasPriorityOrChangefreq, false);
  assert.equal(clean.urls.length, 4);
  assert.match(parseSitemap('<html>not a sitemap</html>').errors.join(), /urlset/);
  assert.match(parseSitemap('<urlset><url><loc>https://x.com/</loc><lastmod>20 Oct 2026</lastmod></url></urlset>').errors.join(), /lastmod/);
});

test('runAudit on the fake site: IX-11 names /orphan, IX-02 and IX-10 name /old (301), IX-03 passes for /admin, exit code 1', async () => {
  const result = await audit();
  assert.deepEqual(allFails(result), [`IX-02 ${O}/old`, `IX-10 ${O}/old`, `IX-11 ${O}/orphan`]);
  assert.match(result.urls[`${O}/old`].failures[0].evidence, /301/);
  assert.deepEqual(result.urls[`${O}/admin`].failures, []);
  assert.match(result.runId, /^\d{8}-\d{4}-seo$/);
  assert.deepEqual(result.counts, { urls: 5, pass: 3, fail: 2 });
  assert.equal(exitCodeFor(result), 1);
  // A localhost --site skips the http:// and www. variants (out of reach), says so, and still checks the 404 slug.
  assert.ok(result.gaps.some((g) => /IX-02/.test(g) && /variants/.test(g)), result.gaps.join('\n'));
  assert.ok(requests.some((r) => r.path.startsWith('/__seo-audit-404-')));
  assert.ok(requests.every((r) => ['GET', 'HEAD'].includes(r.method) && r.ua === DEFAULT_UA));
  const heads = requests.filter((r) => r.method === 'HEAD').map((r) => r.path).sort();
  assert.deepEqual(heads, ['/favicon.ico', '/manifest.webmanifest', '/opengraph-image.png', '/orphan/opengraph-image.png', '/wordle/opengraph-image.png']);
});

test('runAudit with Disallow: / on a non-production host reports no IX-01 and still checks HTML', async () => {
  state.robots = 'User-agent: *\nDisallow: /\n';
  state.noindex = new Set(['/orphan']);
  const result = await audit({ config: fakeConfig({ site: 'https://swishquest.com' }) });
  assert.ok(!allFails(result).some((f) => f.startsWith('IX-01')));
  assert.ok(result.gaps.some((g) => /IX-01/.test(g)), result.gaps.join('\n'));
  assert.ok(result.gaps.some((g) => /IX-02/.test(g) && /variants/.test(g)));
  assert.deepEqual(result.urls[`${O}/wordle`], { status: 200, failures: [] });
  assert.deepEqual(result.urls[`${O}/orphan`].failures.map((f) => f.id), ['IX-03']);
  // The same robots.txt on the configured site is an IX-01 failure.
  const prod = await audit();
  assert.ok(allFails(prod).includes(`IX-01 ${O}/`), allFails(prod).join('\n'));
});

test('runAudit --baseline: a page that passed IX-03 before and fails now is in regressions; exit 3; a url missing from the baseline is not a regression', async () => {
  state.noindex = new Set(['/wordle', '/orphan']);
  const baseline = { [`${O}/`]: [], [`${O}/wordle`]: [], [`${O}/admin`]: [] }; // /orphan and /old absent
  const result = await audit({ baseline });
  assert.ok(allFails(result).includes(`IX-03 ${O}/orphan`));
  assert.deepEqual(result.regressions.map((f) => `${f.id} ${f.url}`), [`IX-03 ${O}/wordle`]);
  assert.equal(exitCodeFor(result), 3);
  // The CLI exits 3 on the same baseline file and accepts a previous run's results.json as the baseline too.
  const dir = tmp();
  writeFileSync(path.join(dir, 'baseline.json'), JSON.stringify(baseline));
  const run = await cli(['--site', O, '--baseline', path.join(dir, 'baseline.json'), '--run-dir', path.join(dir, 'run')]);
  assert.equal(run.code, 3, run.stderr);
  assert.match(readFileSync(path.join(dir, 'run', 'digest.md'), 'utf8'), /## Regressions\n- IX-03 /);
  state.noindex = new Set();
  const clean = await audit();
  writeFileSync(path.join(dir, 'prev-results.json'), JSON.stringify(clean));
  state.noindex = new Set(['/wordle']);
  const again = await cli(['--site', O, '--baseline', path.join(dir, 'prev-results.json'), '--run-dir', path.join(dir, 'run2')]);
  assert.equal(again.code, 3, again.stderr);
});

test('--findings writes findings.json with one card finding per regressed id, urls grouped, valid per Task 6 validateFindings (stub the import until Task 6 lands)', async () => {
  // Stub of Task 6's validateFindings: the keys and the types this writer promises (Task 6 adds the schema test).
  const validateFindings = (doc) => {
    const errors = [];
    if (typeof doc.runId !== 'string' || !Array.isArray(doc.findings)) errors.push('doc needs runId and findings[]');
    for (const f of doc.findings ?? []) {
      for (const k of ['id', 'check', 'severity', 'urls', 'current', 'expected', 'files', 'howToFix', 'acceptance', 'fingerprint', 'regression', 'decision']) {
        if (!(k in f)) errors.push(`${f.id}: missing ${k}`);
      }
      if (!/^SEO-\d{8}-\d{4}-seo-\d{3}$/.test(f.id)) errors.push(`${f.id}: bad id`);
      if (!Array.isArray(f.urls) || !Array.isArray(f.files) || !Array.isArray(f.acceptance?.qa)) errors.push(`${f.id}: arrays`);
    }
    return errors;
  };
  state.noindex = new Set(['/', '/wordle']);
  const dir = tmp();
  writeFileSync(path.join(dir, 'baseline.json'), JSON.stringify({ [`${O}/`]: [], [`${O}/wordle`]: [], [`${O}/orphan`]: [] }));
  const run = await cli(['--site', O, '--baseline', path.join(dir, 'baseline.json'), '--findings', '--run-dir', dir]);
  assert.equal(run.code, 3, run.stderr);
  const doc = JSON.parse(readFileSync(path.join(dir, 'findings.json'), 'utf8'));
  assert.deepEqual(validateFindings(doc), []);
  assert.deepEqual(doc.findings.map((f) => [f.id, f.check, f.urls]), [
    [`SEO-${doc.runId}-001`, 'IX-03', [`${O}/`, `${O}/wordle`]],
    [`SEO-${doc.runId}-002`, 'IX-11', [`${O}/orphan`]],
  ]);
  const [ix03] = doc.findings;
  assert.equal(ix03.severity, 'blocker');
  assert.equal(ix03.decision, 'card');
  assert.equal(ix03.regression, true);
  assert.equal(ix03.fingerprint, `IX-03|${O}/,${O}/wordle`);
  assert.equal(ix03.howToFix, 'See docs/seo/indexing-guide.md step 2');
  assert.equal(ix03.acceptance.audit, `node scripts/seo/audit.mjs --only IX-03 --site ${O}`);
  assert.ok(ix03.files.includes('src/app/sitemap.ts'), ix03.files.join());
  assert.match(ix03.expected, /expected-noindex list/);
  assert.match(ix03.current, new RegExp(`^${O}/: .*noindex.*; ${O}/wordle: `));
  // The direct writer, with no regressions, writes an empty findings list.
  state.noindex = new Set();
  const out = tmp();
  writeRegressionFindings(await audit({ baseline: {} }), out);
  assert.deepEqual(JSON.parse(readFileSync(path.join(out, 'findings.json'), 'utf8')).findings, []);
});

test('a subset run\'s baseline: no regression for ids outside its only list, still one inside it; a full-run baseline as before', async () => {
  // IX-02/IX-10 on /old and IX-11 on /orphan fail in every run; /wordle newly gains noindex (IX-03).
  const subset = await audit({ only: ['IX-03'] });
  assert.deepEqual(subset.only, ['IX-03']);
  const subsetBaseline = toBaseline(subset);
  assert.deepEqual(subsetBaseline.only, ['IX-03']);
  assert.deepEqual(subsetBaseline.urls[`${O}/orphan`], []);
  const full = await audit();
  assert.equal(full.only, null);
  const fullBaseline = toBaseline(full);
  assert.deepEqual(fullBaseline[`${O}/orphan`], ['IX-11']); // the full baseline keeps the old { url: ids } shape
  // A --url run's baseline covers its page alone and never vouches for the whole-site checks (here IX-11).
  const one = await audit({ url: `${O}/orphan` });
  assert.ok(!one.only.includes('IX-11') && one.only.includes('IX-03'));
  assert.deepEqual(Object.keys(toBaseline(one).urls), [`${O}/orphan`]);

  state.noindex = new Set(['/wordle']);
  const regressed = (baseline) => audit({ baseline }).then((r) => r.regressions.map((f) => `${f.id} ${f.url}`));
  assert.deepEqual(await regressed(subsetBaseline), [`IX-03 ${O}/wordle`]);
  assert.deepEqual(await regressed(toBaseline(one)), []);
  assert.deepEqual(await regressed(fullBaseline), [`IX-03 ${O}/wordle`]);
  assert.deepEqual(await regressed({ [`${O}/orphan`]: [], [`${O}/wordle`]: [] }), [`IX-03 ${O}/wordle`, `IX-11 ${O}/orphan`]);

  // The CLI: a --only run's baseline.json and its results.json both carry `only` into the next run.
  state.noindex = new Set();
  const dir = tmp();
  const first = await cli(['--site', O, '--only', 'IX-03', '--run-dir', path.join(dir, 'subset')]);
  assert.equal(first.code, 0, first.stderr); // under IX-03 alone the fake site is clean
  state.noindex = new Set(['/wordle']);
  for (const file of ['baseline.json', 'results.json']) {
    const run = await cli(['--site', O, '--baseline', path.join(dir, 'subset', file), '--run-dir', path.join(dir, file)]);
    assert.equal(run.code, 3, run.stderr);
    const regressions = readFileSync(path.join(dir, file, 'digest.md'), 'utf8').split('## Regressions\n')[1].split('\n\n')[0];
    assert.equal(regressions, `- IX-03 ${O}/wordle: <meta name="robots" content="noindex">`);
  }
});

test('runAudit never follows a redirect: the url map has /old with status 301 and no second entry for /wordle', async () => {
  const result = await audit();
  assert.deepEqual(result.urls[`${O}/old`].status, 301);
  assert.deepEqual(Object.keys(result.urls).sort(), [`${O}/`, `${O}/admin`, `${O}/old`, `${O}/orphan`, `${O}/wordle`]);
  assert.equal(requests.filter((r) => r.path === '/old').length, 1);
  // Its own sitemap fetch (and the IX-04 ?ref= variant), never a second fetch through /old.
  assert.deepEqual(requests.filter((r) => r.path === '/wordle').map((r) => r.search), ['', '?ref=seo-audit']);
});

test('runAudit: a ?ref=x variant whose canonical keeps the query fails IX-04 on the sitemap URL', async () => {
  state.echoCanonical = true;
  const result = await audit({ only: ['IX-04'] });
  assert.deepEqual(allFails(result), [`IX-04 ${O}/`, `IX-04 ${O}/orphan`, `IX-04 ${O}/wordle`]);
  assert.match(result.urls[`${O}/wordle`].failures[0].evidence, /^variant .*\?ref=seo-audit: canonical .*\?ref=seo-audit differs/);
  assert.ok(!requests.some((r) => r.method === 'HEAD'), 'IX-12 fetches skipped under --only IX-04');
});

test('writeDigest: header line "seo-audit: run <id> · site <site> · <n> urls · <f> failing checks", one "## FAIL IX-nn" per failing id, "## Regressions" only with --baseline', async () => {
  const plain = await audit();
  const dir = tmp();
  const paths = writeDigest(plain, dir);
  assert.deepEqual(paths, { digestPath: path.join(dir, 'digest.md'), resultsPath: path.join(dir, 'results.json'), baselinePath: path.join(dir, 'baseline.json') });
  const lines = readFileSync(paths.digestPath, 'utf8').split('\n');
  assert.equal(lines[0], `# seo-audit: run ${plain.runId} · site ${O} · 5 urls · 3 failing checks`);
  assert.deepEqual(lines.filter((l) => l.startsWith('## FAIL')).map((l) => l.split(' ')[2]), ['IX-02', 'IX-10', 'IX-11']);
  assert.ok(lines.includes(`- ${O}/orphan: ${plain.siteFailures.find((f) => f.id === 'IX-11').evidence}`));
  assert.ok(lines.includes('## Coverage gaps'));
  assert.ok(!lines.includes('## Regressions'));
  assert.deepEqual(JSON.parse(readFileSync(paths.resultsPath, 'utf8')), plain);
  assert.deepEqual(JSON.parse(readFileSync(paths.baselinePath, 'utf8')), toBaseline(plain));
  assert.deepEqual(toBaseline(plain)[`${O}/old`], ['IX-02', 'IX-10']);

  const withBaseline = await audit({ baseline: toBaseline(plain) });
  const dir2 = tmp();
  const text = readFileSync(writeDigest(withBaseline, dir2).digestPath, 'utf8');
  assert.match(text, /## Regressions\n- none\n/);
  // The CLI prints the header first and the digest path last (config.json's four expected-noindex pages answer the
  // fake site's 404, whose HTML carries noindex as Next's does: 8 urls, still 3 failing checks).
  const run = await cli(['--site', O, '--run-dir', path.join(dir2, 'cli')]);
  assert.equal(run.code, 1, run.stderr);
  const out = run.stdout.trim().split('\n');
  assert.match(out[0], new RegExp(`^seo-audit: run \\d{8}-\\d{4}-seo · site ${O} · 8 urls · 3 failing checks$`));
  assert.equal(out.at(-1), `seo-audit: digest ${path.join(dir2, 'cli', 'digest.md')}`);
  assert.ok(existsSync(path.join(dir2, 'cli', 'results.json')));
});

test('fetcher: at most 4 requests in flight, no redirect followed', async () => {
  state.maxInFlight = 0;
  const f = client();
  await Promise.all(Array.from({ length: 10 }, () => f.get(`${O}/slow`)));
  assert.equal(state.maxInFlight, 4);
  const moved = await f.get(`${O}/old`);
  assert.deepEqual([moved.status, moved.location], [301, `${O}/wordle`]);
  assert.throws(() => fetcher({ redirect: 'follow' }), /manual/);
});
