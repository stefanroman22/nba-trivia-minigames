// node --test scripts/seo/lib/html-checks.test.mjs — HTML signal extraction and the per-page IX checks on the fixtures.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { extractSignals, checkPage } from './html-checks.mjs';
import { loadConfig } from './config.mjs';

const fixture = (name) => readFileSync(fileURLToPath(new URL(`../fixtures/${name}`, import.meta.url)), 'utf8');
const OK = fixture('page-ok.html');
const BAD = fixture('page-bad.html');
const URL_ = 'https://swishquest.com/wordle';

/** A context where this page is the only one on the site (titles and descriptions unique). */
function ctxFor(signals, over = {}) {
  const url = over.url ?? URL_;
  return {
    url,
    sitemapUrl: URL_,
    expectNoindex: false,
    xRobotsTag: null,
    siteTitles: new Map(signals.title ? [[signals.title, [url]]] : []),
    siteDescriptions: new Map(signals.description ? [[signals.description, [url]]] : []),
    ...over,
  };
}
const ids = (failures) => failures.map((f) => f.id).sort();

test('loadConfig reads config.json and SEO_SITE overrides site', () => {
  const prev = process.env.SEO_SITE;
  try {
    delete process.env.SEO_SITE;
    const cfg = loadConfig();
    assert.equal(cfg.site, 'https://swishquest.com');
    assert.deepEqual(cfg.expectedNoindex, ['/admin', '/profile', '/credits', '/coming-soon']);
    process.env.SEO_SITE = 'http://localhost:3000';
    assert.equal(loadConfig().site, 'http://localhost:3000');
  } finally {
    if (prev === undefined) delete process.env.SEO_SITE; else process.env.SEO_SITE = prev;
  }
});

test('extractSignals reads the ok page', () => {
  const s = extractSignals(OK, { url: URL_ });
  assert.equal(s.title, 'NBA Wordle | Swish Quest');
  assert.equal(s.description.length, 120);
  assert.match(s.description, /player's name/);
  assert.deepEqual(s.canonical, [URL_]);
  assert.equal(s.canonical.length, 1);
  assert.deepEqual(s.robotsMeta, []);
  assert.equal(s.h1Count, 1);
  assert.ok(s.textLength >= 300, `textLength ${s.textLength}`);
  assert.deepEqual(s.internalLinks, ['https://swishquest.com/guess-mvps', 'https://swishquest.com/career-path', 'https://swishquest.com/']);
  assert.equal(s.internalLinks.length, 3);
  assert.equal(s.jsonLd.ok, true);
  assert.equal(s.jsonLd.blocks.length, 1);
  assert.equal(s.jsonLd.blocks[0].description, 'NBA Wordle: guess the mystery <NBA> player');
  assert.deepEqual(s.og, { title: 'NBA Wordle | Swish Quest', description: s.description, image: 'https://swishquest.com/wordle/opengraph-image' });
  assert.equal(s.viewport, true);
});

test('extractSignals reads the bad page', () => {
  const s = extractSignals(BAD, { url: URL_ });
  assert.deepEqual(s.canonical, ['https://swishquest.com/', '/wordle']);
  assert.deepEqual(s.robotsMeta, ['noindex']);
  assert.equal(s.h1Count, 0);
  assert.equal(s.textLength, 80);
  assert.equal(s.description, null);
  assert.equal(s.jsonLd.ok, false);
  assert.equal(s.jsonLd.blocks.length, 1);
  assert.equal(s.jsonLd.errors.length, 1);
});

test('checkPage: ok page has no findings', () => {
  const s = extractSignals(OK, { url: URL_ });
  assert.deepEqual(checkPage(s, ctxFor(s)), []);
});

test('checkPage: bad page fails IX-03 IX-04 IX-05 IX-06 IX-07 IX-08 IX-09', () => {
  const s = extractSignals(BAD, { url: URL_ });
  const failures = checkPage(s, ctxFor(s));
  assert.deepEqual(ids(failures), ['IX-03', 'IX-04', 'IX-05', 'IX-06', 'IX-07', 'IX-08', 'IX-09']);
  for (const f of failures) {
    assert.equal(f.url, URL_);
    assert.ok(f.evidence.length > 0, `${f.id} has evidence`);
  }
});

test('IX-03 passes on an expected-noindex page that carries noindex, fails when it does not', () => {
  const url = 'https://swishquest.com/admin';
  const bad = extractSignals(BAD, { url });
  assert.deepEqual(ids(checkPage(bad, ctxFor(bad, { url, sitemapUrl: null, expectNoindex: true }))), []);
  const ok = extractSignals(OK, { url });
  assert.deepEqual(ids(checkPage(ok, ctxFor(ok, { url, sitemapUrl: null, expectNoindex: true }))), ['IX-03']);
  // carrying noindex but still listed in the sitemap is a failure too
  assert.deepEqual(ids(checkPage(bad, ctxFor(bad, { url, sitemapUrl: url, expectNoindex: true }))), ['IX-03']);
  // an expected-noindex page may also carry it as a header
  assert.deepEqual(ids(checkPage(ok, ctxFor(ok, { url, sitemapUrl: null, expectNoindex: true, xRobotsTag: 'noindex, nofollow' }))), []);
});

test('IX-03 fails on X-Robots-Tag: noindex even with no meta', () => {
  const s = extractSignals(OK, { url: URL_ });
  const failures = checkPage(s, ctxFor(s, { xRobotsTag: 'noindex' }));
  assert.deepEqual(ids(failures), ['IX-03']);
  assert.match(failures[0].evidence, /X-Robots-Tag/);
});

test('IX-04 fails when canonical differs from sitemapUrl, passes with ?ref=x in url', () => {
  const s = extractSignals(OK, { url: URL_ });
  assert.deepEqual(ids(checkPage(s, ctxFor(s, { sitemapUrl: 'https://swishquest.com/guess-mvps' }))), ['IX-04']);
  const ref = `${URL_}?ref=x`;
  const r = extractSignals(OK, { url: ref });
  assert.deepEqual(checkPage(r, ctxFor(r, { url: ref })), []);
});

test('IX-05 fails a duplicate title across two URLs (siteTitles has 2 urls for the title)', () => {
  const s = extractSignals(OK, { url: URL_ });
  const siteTitles = new Map([[s.title, [URL_, 'https://swishquest.com/guess-mvps']]]);
  const failures = checkPage(s, ctxFor(s, { siteTitles }));
  assert.deepEqual(ids(failures), ['IX-05']);
  assert.match(failures[0].evidence, /guess-mvps/);
});

test('IX-09 fails jsonLd whose url is not the canonical, and a VideoGame block with aggregateRating', () => {
  const wrongUrl = OK.replace('"url":"https://swishquest.com/wordle"', '"url":"https://swishquest.com/"');
  const w = extractSignals(wrongUrl, { url: URL_ });
  assert.deepEqual(ids(checkPage(w, ctxFor(w))), ['IX-09']);
  const rated = OK.replace('"genre":"Trivia"', '"genre":"Trivia","aggregateRating":{"@type":"AggregateRating","ratingValue":"5","ratingCount":"10"}');
  const r = extractSignals(rated, { url: URL_ });
  const failures = checkPage(r, ctxFor(r));
  assert.deepEqual(ids(failures), ['IX-09']);
  assert.match(failures[0].evidence, /aggregateRating/);
});

test('IX-12 fails when og:image is missing', () => {
  const noImage = OK.replace(/<meta content="[^"]*" property="og:image"\/>/, '');
  const s = extractSignals(noImage, { url: URL_ });
  assert.equal(s.og.image, null);
  const failures = checkPage(s, ctxFor(s));
  assert.deepEqual(ids(failures), ['IX-12']);
  assert.match(failures[0].evidence, /og:image/);
});
