// node --test scripts/seo/onpage.test.mjs — the on-page (phase 2) checks: page signals, the shared-menu removal, the
// OP checks on the "today" and "good" game page fixtures (scripts/seo/fixtures/onpage/), the query flags, and the CLI
// against a fake site (an injected fetcher, never the network) with its privacy rule for Search Analytics data.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { OP_IDS, pageSignals, sharedSets, uniqueSentences, wordCount, checkOnpage, queryFlags } from './lib/onpage-checks.mjs';
import { cli, loadKeywordMap, runOnpage, PRIVATE_LINE } from './onpage.mjs';

const FIXTURES = fileURLToPath(new URL('./fixtures/onpage/', import.meta.url));
const fixture = (name) => readFileSync(path.join(FIXTURES, name), 'utf8');
const S = 'https://swishquest.com';
const tmpDirs = [];
const tmp = () => { const d = mkdtempSync(path.join(os.tmpdir(), 'seo-onpage-')); tmpDirs.push(d); return d; };
after(() => { for (const d of tmpDirs) rmSync(d, { recursive: true, force: true }); });

const KEYWORDS = loadKeywordMap();
const page = (name, p) => ({ url: `${S}${p}`, signals: pageSignals(fixture(name), { url: `${S}${p}` }) });
const TODAY = page('career-path-today.html', '/career-path');
const WORDLE = page('wordle-today.html', '/wordle');
const GOOD = page('career-path-good.html', '/career-path');

/** Every game page of the keyword map (the run takes them from the sitemap). */
const GAME_URLS = new Set(Object.keys(KEYWORDS).filter((p) => p !== '/').map((p) => `${S}${p}`));
/** The ctx of a game page among `games` (descriptions unique unless `siteDescriptions` says otherwise). */
function gameCtx(p, games, over = {}) {
  const siteDescriptions = new Map(games.map((g) => [g.signals.description, [g.url]]));
  const shared = { ...sharedSets(games), gameUrls: GAME_URLS };
  return { keyword: KEYWORDS[new URL(p.url).pathname] ?? null, isGame: true, isHome: false, shared, siteDescriptions, psi: null, ...over };
}
const ids = (failures) => failures.map((f) => f.id).sort();

test('OP_IDS lists OP-01..OP-11', () => {
  assert.deepEqual(OP_IDS, ['OP-01', 'OP-02', 'OP-03', 'OP-04', 'OP-05', 'OP-06', 'OP-07', 'OP-08', 'OP-09', 'OP-10', 'OP-11']);
});

test('keyword-map.json has an entry for the home page and every game', () => {
  for (const p of ['/', '/wordle', '/career-path', '/who-are-ya', '/tictactoe', '/name-logo', '/guess-mvps', '/contexto', '/starting-five', '/series-winner', '/fan-favorites', '/who-would-win']) {
    assert.ok(KEYWORDS[p]?.primary, `${p} has a primary query`);
    assert.ok(Array.isArray(KEYWORDS[p].related) && KEYWORDS[p].related.length, `${p} has related queries`);
  }
  assert.equal(KEYWORDS['/career-path'].primary, 'nba career path quiz');
  assert.equal(KEYWORDS['/series-winner'].primary, 'nba playoff series quiz');
});

test('pageSignals reads the today game page as a crawler sees it', () => {
  const s = TODAY.signals;
  assert.equal(s.title, 'Career Path Challenge | Swish Quest');
  assert.equal(s.description, 'Name the NBA player from his career path, revealed team by team with years, games and points per game. Fewer misses, more points.');
  assert.deepEqual(s.h1, ['Career Path Challenge']);
  assert.deepEqual(s.h2, []);
  assert.deepEqual(s.images, [{ src: `${S}/_next/static/immutable/media/basketballLogo.44cwk5u9j-nsf.webp`, alt: 'Swish Quest' }]);
  assert.deepEqual(s.jsonLdTypes, ['VideoGame', 'WebApplication']);
  assert.equal(s.breadcrumbItems, 0);
  assert.equal(s.hasRating, false);
  assert.equal(s.htmlBytes, Buffer.byteLength(fixture('career-path-today.html')));
  // 15 internal links (logo, 11 games, privacy, terms, credits); the mailto is not internal.
  assert.equal(s.links.length, 15);
  assert.ok(s.links.some((l) => l.href === `${S}/who-are-ya` && l.text === 'Who Are Ya?'));
  // The main text keeps its blocks apart (one sentence per line), and never reads scripts or the header/footer.
  assert.ok(s.mainText.split('\n').includes('Whose career path is this?'));
  assert.ok(s.mainText.split('\n').includes('Guess the Series Winner up to 100 pts'));
  assert.ok(!/payload/.test(s.mainText));
  assert.ok(!/Privacy Policy/.test(s.mainText));
});

test('pageSignals reads breadcrumbs, artwork and h2s of the good page', () => {
  const s = GOOD.signals;
  assert.deepEqual(s.h1, ['NBA Career Path Quiz']);
  assert.equal(s.h2.length, 4);
  assert.equal(s.h2[0], 'How to play NBA Career Path Quiz');
  assert.equal(s.breadcrumbItems, 2);
  assert.deepEqual(s.jsonLdTypes, ['VideoGame', 'WebApplication', 'BreadcrumbList']);
  assert.equal(s.images.length, 2);
});

test('pageSignals flags aggregateRating/review anywhere in the JSON-LD', () => {
  const html = '<html><body><main><h1>x</h1></main><script type="application/ld+json">{"@context":"https://schema.org","@type":"VideoGame","name":"x","aggregateRating":{"@type":"AggregateRating","ratingValue":5}}</script></body></html>';
  assert.equal(pageSignals(html, { url: `${S}/x` }).hasRating, true);
  const graph = '<script type="application/ld+json">{"@context":"https://schema.org","@graph":[{"@type":"BreadcrumbList","itemListElement":[{"@type":"ListItem","position":1},{"@type":"ListItem","position":2},{"@type":"ListItem","position":3}]}]}</script>';
  const s = pageSignals(`<html><body>${graph}</body></html>`, { url: `${S}/x` });
  assert.deepEqual(s.jsonLdTypes, ['BreadcrumbList']);
  assert.equal(s.breadcrumbItems, 3);
});

test('sharedSets finds the shared menu; what is left of the today page is about ten words', () => {
  const shared = sharedSets([TODAY, WORDLE]);
  assert.ok(shared.sentences.has('Guess the Series Winner up to 100 pts'));
  assert.ok(shared.sentences.has('Challenge a random opponent, or set up a private room with friends.'));
  assert.ok(!shared.sentences.has('Whose career path is this?'));
  assert.equal(shared.links.size, 15);
  assert.deepEqual([...shared.gameUrls].sort(), [`${S}/career-path`, `${S}/wordle`]);
  // The H1 game name and the Play button are on every game page too (the menu chip, every stage), so they go as well.
  const left = uniqueSentences(TODAY.signals, shared);
  assert.deepEqual(left, ['Whose career path is this?', '5 rounds up to 200 pts']);
  assert.equal(wordCount(left.join(' ')), 11);
});

test('sharedSets with a single game page removes nothing (no menu can be told apart)', () => {
  const shared = sharedSets([TODAY]);
  assert.equal(shared.sentences.size, 0);
  assert.equal(shared.links.size, 0);
});

test('the today game page fails OP-01, 02, 04, 05, 06, 08, 09', () => {
  const failures = checkOnpage(TODAY, gameCtx(TODAY, [TODAY, WORDLE]));
  assert.deepEqual(ids(failures), ['OP-01', 'OP-02', 'OP-04', 'OP-05', 'OP-06', 'OP-08', 'OP-09']);
  for (const f of failures) { assert.equal(f.url, `${S}/career-path`); assert.ok(f.evidence.length > 0); }
  const by = Object.fromEntries(failures.map((f) => [f.id, f.evidence]));
  assert.match(by['OP-01'], /"nba".*title/);
  assert.match(by['OP-01'], /quiz/);
  assert.match(by['OP-04'], /0 <h2>/);
  assert.match(by['OP-05'], /unique words/);
  assert.match(by['OP-05'], /how to play/i);
  assert.match(by['OP-06'], /0 /);
  assert.match(by['OP-08'], /besides the logo/);
  assert.match(by['OP-09'], /BreadcrumbList/);
});

test('the good game page passes every OP check', () => {
  const games = [GOOD, WORDLE];
  const failures = checkOnpage(GOOD, gameCtx(GOOD, games));
  assert.deepEqual(failures, []);
  assert.ok(wordCount(uniqueSentences(GOOD.signals, sharedSets(games)).join(' ')) >= 150);
});

test('OP-08 fails a game page whose artwork <img> has alt="" or no alt at all', () => {
  const ART_ALT = / alt="NBA Career Path Quiz board[^"]*"/;
  assert.match(fixture('career-path-good.html'), ART_ALT);
  for (const [label, alt] of [['alt=""', ' alt=""'], ['no alt', '']]) {
    const html = fixture('career-path-good.html').replace(ART_ALT, alt);
    const p = { url: `${S}/career-path`, signals: pageSignals(html, { url: `${S}/career-path` }) };
    const failures = checkOnpage(p, gameCtx(p, [p, WORDLE]));
    assert.deepEqual(ids(failures), ['OP-08'], label);
    assert.match(failures[0].evidence, /1 <img> without alt text \(https:\/\/swishquest\.com\/games\/nba-career-path-quiz\.webp\)/, label);
  }
});

test('OP-02 checks length, query position and the brand suffix', () => {
  const games = [TODAY, WORDLE];
  const withTitle = (title) => ({ ...TODAY, signals: { ...TODAY.signals, title } });
  const op02 = (title, over) => checkOnpage(withTitle(title), gameCtx(TODAY, games, over)).find((f) => f.id === 'OP-02')?.evidence;
  assert.equal(op02('NBA Career Path Quiz: Guess the Player | Swish Quest'), undefined);
  assert.equal(op02('NBA Career Path Quiz | Swish Quest'), undefined);
  const late = op02('Guess the Player From His Teams: NBA Career Path Quiz | Swish Quest');
  assert.match(late, /67 characters, want 30-60/);
  assert.match(late, /"path" starts at character 45, want within the first 40/);
  const noBrand = op02('Play This Fun Basketball Game Online: NBA Career Path Quiz');
  assert.match(noBrand, /"career" starts at character 43/);
  assert.match(noBrand, /does not end with " \| Swish Quest"/);
  assert.match(op02('Career Path Challenge | Swish Quest'), /"nba" not in the title/);
  assert.match(op02('NBA Career Path Quiz: Guess the Player - Swish Quest'), /\| Swish Quest/);
  assert.match(op02('NBA Career Path Quiz: Guess the Player | Swish Quest', { keyword: null }), /keyword-map/);
});

test('OP-03 checks length, uniqueness and a query word', () => {
  const games = [TODAY, WORDLE];
  const withDesc = (description) => ({ ...TODAY, signals: { ...TODAY.signals, description } });
  const op03 = (d, over) => checkOnpage(withDesc(d), gameCtx(TODAY, games, over)).find((f) => f.id === 'OP-03')?.evidence;
  assert.match(op03('Too short.'), /10 characters, want 110-160/);
  const long = 'Name the player from his trail of teams, revealed club by club with years, games and points per game. Fewer misses, more points for you.';
  assert.match(op03(long), /no word of the primary query/);
  const shared = new Map([[TODAY.signals.description, [`${S}/career-path`, `${S}/wordle`]]]);
  assert.match(op03(TODAY.signals.description, { siteDescriptions: shared }), /also used by https:\/\/swishquest.com\/wordle/);
});

test('OP-07 flags /nba_grid and /NBA and a query string; other pages get only OP-07', () => {
  const ctx = { keyword: null, isGame: false, isHome: false, shared: sharedSets([]), siteDescriptions: new Map(), psi: null };
  const op07 = (u) => checkOnpage({ url: u, signals: TODAY.signals }, ctx);
  assert.match(op07(`${S}/nba_grid`)[0].evidence, /underscore/);
  assert.match(op07(`${S}/NBA`)[0].evidence, /lowercase/);
  assert.match(op07(`${S}/wordle?ref=x`)[0].evidence, /query string/);
  assert.deepEqual(op07(`${S}/privacy`), []);
  assert.deepEqual(op07(`${S}/`), []);
  assert.deepEqual(ids(op07(`${S}/nba_grid`)), ['OP-07']);
});

test('OP-10 fails a page over 250 KB, and lab/field PageSpeed numbers over the thresholds', () => {
  const games = [GOOD, WORDLE];
  const big = { ...GOOD, signals: { ...GOOD.signals, htmlBytes: 399 * 1024 } };
  assert.match(checkOnpage(big, gameCtx(GOOD, games)).find((f) => f.id === 'OP-10').evidence, /399 KB, want <= 250 KB/);
  const psi = { lab: { lcp: 2600, tbt: 150, cls: 0.02 }, field: { lcp: 2400, inp: 250, cls: 0.05 } };
  const ev = checkOnpage(GOOD, gameCtx(GOOD, games, { psi })).find((f) => f.id === 'OP-10').evidence;
  assert.match(ev, /lab LCP 2600 ms, want <= 2500/);
  assert.match(ev, /field p75 INP 250 ms, want <= 200/);
  assert.doesNotMatch(ev, /TBT|CLS/);
  assert.equal(checkOnpage(GOOD, gameCtx(GOOD, games, { psi: { lab: { lcp: 2000, tbt: 100, cls: 0.05 }, field: null } })).length, 0);
});

test('OP-06 ignores generic and short anchors and links that are on every page', () => {
  const games = [GOOD, WORDLE];
  const op06 = checkOnpage(GOOD, gameCtx(GOOD, games)).find((f) => f.id === 'OP-06');
  assert.equal(op06, undefined);
  const oneLink = { ...GOOD, signals: { ...GOOD.signals, links: GOOD.signals.links.filter((l) => !l.text.startsWith('Who Are Ya:')) } };
  assert.match(checkOnpage(oneLink, gameCtx(GOOD, games)).find((f) => f.id === 'OP-06').evidence, /1 link/);
});

test('the home page is held to OP-01..04, 08, 09, 10 but not to the game-only rules', () => {
  const home = page('home.html', '/');
  const ctx = { keyword: KEYWORDS['/'], isGame: false, isHome: true, shared: sharedSets([TODAY, WORDLE]), siteDescriptions: new Map(), psi: null };
  const failures = checkOnpage(home, ctx);
  // The slogan H1 lacks "nba trivia games"; the title passes OP-02 (starts with the brand, query within 40 characters).
  assert.deepEqual(ids(failures), ['OP-01']);
  assert.match(failures[0].evidence, /H1/);
});

test('queryFlags: low-ctr, striking, mismatch per path, top query by impressions', () => {
  const rows = [
    { keys: [`${S}/wordle`, 'nba wordle'], clicks: 1, impressions: 150, ctr: 0.0067, position: 12.0 },
    { keys: [`${S}/wordle`, 'nba wordle unlimited'], clicks: 0, impressions: 30, ctr: 0, position: 18.0 },
    { keys: [`${S}/career-path`, 'basketball journeyman game'], clicks: 9, impressions: 60, ctr: 0.15, position: 3.0 },
    { keys: [`${S}/career-path`, 'nba career path'], clicks: 2, impressions: 20, ctr: 0.1, position: 4.0 },
    { keys: [`${S}/contexto`, 'nba contexto'], clicks: 0, impressions: 10, ctr: 0, position: 40 },
  ];
  const q = queryFlags(rows, KEYWORDS);
  assert.deepEqual(q['/wordle'].flags, ['low-ctr', 'striking']);
  assert.equal(q['/wordle'].topQuery, 'nba wordle');
  assert.deepEqual(q['/career-path'].flags, ['mismatch']);
  assert.equal(q['/career-path'].topQuery, 'basketball journeyman game');
  assert.deepEqual(q['/contexto'].flags, []);
  assert.equal(q['/wordle'].impressions, 180);
  assert.equal(q['/wordle'].queries[0].query, 'nba wordle');
  assert.equal(q['/wordle'].primary, 'nba wordle');
});

// ---------------------------------------------------------------- the run, on a fake site (no network)

const SITEMAP = `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${['/', '/career-path', '/wordle', '/privacy'].map((p) => `<url><loc>${S}${p}</loc></url>`).join('')}</urlset>`;
const FAKE = { '/sitemap.xml': SITEMAP, '/': fixture('home.html'), '/career-path': fixture('career-path-today.html'), '/wordle': fixture('wordle-today.html'), '/privacy': fixture('privacy.html') };

/** A fetcher over FAKE (`over` replaces paths: a string body, or a number status); records every request. */
function fakeFetcher(over = {}) {
  const site = { ...FAKE, ...over };
  const seen = [];
  const answer = (method, u) => {
    seen.push(`${method} ${u}`);
    const body = site[new URL(u).pathname];
    if (body === undefined) return { status: 404, headers: {}, body: '', location: null };
    if (typeof body === 'number') return { status: body, headers: {}, body: '', location: null };
    return { status: 200, headers: { 'content-type': 'text/html' }, body: method === 'HEAD' ? '' : body, location: null };
  };
  return { seen, get: async (u) => answer('GET', u), head: async (u) => answer('HEAD', u) };
}

const SECRET_QUERY = 'zebra sneaker basketball riddle';
const ANALYTICS = [
  { keys: [`${S}/wordle`, SECRET_QUERY], clicks: 3, impressions: 4321, ctr: 0.000694, position: 9.87 },
  { keys: [`${S}/career-path`, 'nba career path'], clicks: 7, impressions: 77, ctr: 0.0909, position: 5.55 },
];

function capture() {
  const lines = [];
  return { lines, log: (s) => lines.push(String(s)), err: (s) => lines.push(String(s)) };
}

test('the CLI writes onpage.json and onpage-summary.md, exits 1 on failures, GET only', async () => {
  const dir = tmp();
  const f = fakeFetcher();
  const io = capture();
  const code = await cli(['--site', S, '--run-dir', dir], { ...io, fetcher: f, env: {} });
  assert.equal(code, 1);
  assert.ok(f.seen.every((r) => r.startsWith('GET ')));
  assert.ok(f.seen.includes(`GET ${S}/sitemap.xml`));
  const summary = readFileSync(path.join(dir, 'onpage-summary.md'), 'utf8');
  const first = summary.split('\n')[0];
  assert.match(first, /^# seo-onpage: run \d{8}-\d{4}-seo · site https:\/\/swishquest\.com · 4 urls · 7 failing checks$/);
  for (const id of ['OP-01', 'OP-02', 'OP-04', 'OP-05', 'OP-06', 'OP-08', 'OP-09']) assert.match(summary, new RegExp(`^## FAIL ${id}\\b`, 'm'));
  assert.match(summary, /^## Coverage gaps$/m);
  assert.match(summary, /OP-10 .*PageSpeed/);
  assert.match(summary, /OP-11 .*--analytics/);
  const json = JSON.parse(readFileSync(path.join(dir, 'onpage.json'), 'utf8'));
  assert.equal(Object.keys(json.urls).length, 4);
  assert.deepEqual(json.urls[`${S}/privacy`].failures, []);
  assert.equal(json.urls[`${S}/career-path`].kind, 'game');
  assert.ok(json.urls[`${S}/career-path`].summary.uniqueWords < 20);
  assert.equal(io.lines[0], first.slice(2));
  assert.ok(io.lines.some((l) => /^seo-onpage: FAIL OP-05 · 2 url\(s\)$/.test(l)));
});

test('--analytics writes the private queries-summary.md; no value or query string anywhere else', async () => {
  const dir = tmp();
  const file = path.join(tmp(), 'gsc-analytics-pq.json');
  writeFileSync(file, JSON.stringify(ANALYTICS));
  const io = capture();
  const code = await cli(['--site', S, '--run-dir', dir, '--analytics', file], { ...io, fetcher: fakeFetcher(), env: {} });
  assert.equal(code, 1);
  const queries = readFileSync(path.join(dir, 'queries-summary.md'), 'utf8');
  assert.equal(queries.split('\n')[0], PRIVATE_LINE);
  assert.equal(PRIVATE_LINE, 'PRIVATE: do not copy into REPORT.md, owner-actions.md, logs or Slack');
  assert.match(queries, new RegExp(SECRET_QUERY));
  assert.match(queries, /4321/);
  assert.match(queries, /low-ctr/);
  const publicText = [readFileSync(path.join(dir, 'onpage-summary.md'), 'utf8'), readFileSync(path.join(dir, 'onpage.json'), 'utf8'), ...io.lines].join('\n');
  for (const secret of [SECRET_QUERY, 'nba career path"', '4321', '9.87', '5.55', '0.0909', 'low-ctr', 'striking', 'mismatch']) {
    assert.ok(!publicText.includes(secret), `public output carries "${secret}"`);
  }
});

test('a bad --analytics file or an unreachable sitemap is infra (exit 2); a bad flag too', async () => {
  const bad = path.join(tmp(), 'bad.json');
  writeFileSync(bad, '{not json');
  assert.equal(await cli(['--site', S, '--run-dir', tmp(), '--analytics', bad], { ...capture(), fetcher: fakeFetcher(), env: {} }), 2);
  assert.equal(await cli(['--site', S, '--run-dir', tmp()], { ...capture(), fetcher: fakeFetcher({ '/sitemap.xml': 500 }), env: {} }), 2);
  assert.equal(await cli(['--nope'], { ...capture(), fetcher: fakeFetcher(), env: {} }), 2);
});

test('a page that does not load is a Coverage gaps line, not a failure', async () => {
  const r = await runOnpage({ site: S, fetcher: fakeFetcher({ '/wordle': 503 }), keywordMap: KEYWORDS, runId: 'r1' });
  assert.ok(r.gaps.some((g) => g.includes(`${S}/wordle`) && /503/.test(g)));
  assert.deepEqual(r.urls[`${S}/wordle`].failures, []);
});

test('--as: links that name the alias origin are internal links of --site, the run equals the one on the origin itself, every request on --site', async () => {
  const L = 'http://localhost:5612';
  const sitemap = SITEMAP.replace('</urlset>', `<url><loc>${S}/who-are-ya</loc></url><url><loc>${S}/starting-five</loc></url></urlset>`);
  const relative = { '/sitemap.xml': sitemap, '/career-path': fixture('career-path-good.html') };
  const absolute = Object.fromEntries(['/', '/career-path', '/wordle', '/privacy'].map((p) => [p, (relative[p] ?? FAKE[p]).replaceAll('href="/', `href="${S}/`)]));
  const over = { ...relative, ...absolute };
  const op06 = (r, origin) => r.urls[`${origin}/career-path`].failures.find((f) => f.id === 'OP-06');
  const idsByPath = (r) => Object.values(r.urls).map((e) => [e.path, ids(e.failures)]);

  const own = await runOnpage({ site: S, fetcher: fakeFetcher(relative), keywordMap: KEYWORDS, runId: 'r1' });
  assert.equal(op06(own, S), undefined, 'the good fixture passes OP-06 on its own origin');
  const plain = await runOnpage({ site: L, fetcher: fakeFetcher(over), keywordMap: KEYWORDS, runId: 'r1' });
  assert.ok(op06(plain, L), 'without --as the absolute links are not internal');

  const f = fakeFetcher(over);
  const r = await runOnpage({ site: L, fetcher: f, keywordMap: KEYWORDS, runId: 'r1', asOrigin: S });
  assert.equal(op06(r, L), undefined);
  assert.deepEqual(idsByPath(r), idsByPath(own));
  assert.ok(f.seen.every((x) => x.startsWith(`GET ${L}/`)), f.seen.join('\n'));

  const io = capture();
  assert.equal(await cli(['--site', L, '--as', `${S}/`, '--run-dir', tmp()], { ...io, fetcher: fakeFetcher(over), env: {} }), 1);
  assert.match(io.lines[0], new RegExp(`^seo-onpage: run \\S+ · site ${L} · 6 urls · `));
  assert.equal(await cli(['--site', L, '--as', 'not a url', '--run-dir', tmp()], { ...capture(), fetcher: fakeFetcher(over), env: {} }), 2);
});

test('--psi without PSI_API_KEY, and a 429, are one Coverage gaps line each; the key is never printed', async () => {
  const noKey = await runOnpage({ site: S, fetcher: fakeFetcher(), keywordMap: KEYWORDS, runId: 'r1', psi: { key: null, fetch: async () => { throw new Error('must not be called'); } } });
  assert.equal(noKey.gaps.filter((g) => /PSI_API_KEY/.test(g)).length, 1);

  const KEY = 'TESTKEY-abc123'; // gitleaks:allow (fake key for the test)
  let calls = 0;
  const limited = await runOnpage({ site: S, fetcher: fakeFetcher(), keywordMap: KEYWORDS, runId: 'r1', psi: { key: KEY, fetch: async () => { calls += 1; return new Response('{}', { status: 429 }); } } });
  assert.equal(calls, 1, 'stops after the first 429');
  assert.equal(limited.gaps.filter((g) => /OP-10/.test(g) && /429/.test(g)).length, 1);
  assert.ok(!JSON.stringify(limited).includes(KEY));

  const dir = tmp();
  const io = capture();
  const forbidden = async () => new Response('{}', { status: 403 });
  await cli(['--site', S, '--run-dir', dir, '--psi'], { ...io, fetcher: fakeFetcher(), env: { PSI_API_KEY: KEY }, fetch: forbidden });
  const all = [readFileSync(path.join(dir, 'onpage-summary.md'), 'utf8'), readFileSync(path.join(dir, 'onpage.json'), 'utf8'), ...io.lines].join('\n');
  assert.ok(!all.includes(KEY));
  assert.match(all, /OP-10 .*403/);
});

test('--psi with data: the home page and up to 3 game pages, lab and field numbers checked', async () => {
  const requested = [];
  const psiFetch = async (u) => {
    const q = new URL(u);
    requested.push(q.searchParams.get('url'));
    assert.equal(q.searchParams.get('strategy'), 'mobile');
    assert.equal(q.searchParams.get('category'), 'performance');
    assert.equal(q.searchParams.get('key'), 'K');
    return new Response(JSON.stringify({
      lighthouseResult: { audits: { 'largest-contentful-paint': { numericValue: 3100 }, 'total-blocking-time': { numericValue: 120 }, 'cumulative-layout-shift': { numericValue: 0.01 } } },
      loadingExperience: { metrics: { LARGEST_CONTENTFUL_PAINT_MS: { percentile: 2300 }, INTERACTION_TO_NEXT_PAINT: { percentile: 180 }, CUMULATIVE_LAYOUT_SHIFT_SCORE: { percentile: 25 } } },
    }), { status: 200 });
  };
  const r = await runOnpage({ site: S, fetcher: fakeFetcher(), keywordMap: KEYWORDS, runId: 'r1', psi: { key: 'K', fetch: psiFetch } });
  assert.deepEqual(requested.sort(), [`${S}/`, `${S}/career-path`, `${S}/wordle`].sort());
  const op10 = r.urls[`${S}/`].failures.find((f) => f.id === 'OP-10').evidence;
  assert.match(op10, /lab LCP 3100 ms/);
  assert.match(op10, /field p75 CLS 0.25, want <= 0.1/);
  assert.ok(!r.gaps.some((g) => /OP-10/.test(g)));
});
