// Per-page signals and the OP checks of scripts/seo/CHECKS.md (On-page, phase 2). pageSignals() reads the server HTML
// of one page as a crawler sees it before rendering (regexes, no DOM; extractSignals of html-checks.mjs for what it
// already parses); sharedSets() finds the text and links every game page carries (the shared game menu, the header and
// footer links); checkOnpage() turns one page's signals into OP-01…OP-10 failures; queryFlags() turns Search Analytics
// page × query rows into the OP-11 flags. Everything here is pure: the fetches live in scripts/seo/onpage.mjs.
import { ATTRS, SITE_NAME, decodeEntities, dropElements, extractSignals, parseAttrs, startTags, underOrigin } from './html-checks.mjs';

export const OP_IDS = Array.from({ length: 11 }, (_, i) => `OP-${String(i + 1).padStart(2, '0')}`);
export const OP_AREAS = {
  'OP-01': 'keyword map', 'OP-02': 'title', 'OP-03': 'description', 'OP-04': 'headings', 'OP-05': 'content',
  'OP-06': 'internal links', 'OP-07': 'URL', 'OP-08': 'images', 'OP-09': 'structured data', 'OP-10': 'page experience',
  'OP-11': 'measurement',
};
/** Sitemap paths that are neither the home page nor a game page. */
export const NON_GAME_PATHS = ['/', '/privacy', '/terms'];

export const TITLE_MIN = 30;
export const TITLE_MAX = 60;
export const QUERY_WITHIN = 40;
export const BRAND_SUFFIX = ` | ${SITE_NAME}`;
export const DESCRIPTION_MIN = 110;
export const DESCRIPTION_MAX = 160;
export const MIN_H2 = 2;
export const MIN_UNIQUE_WORDS = 150;
export const MIN_RELATED_LINKS = 2;
export const MIN_ANCHOR_WORDS = 3;
export const HTML_MAX_BYTES = 250 * 1024;
export const PSI_LIMITS = { lcp: 2500, tbt: 200, cls: 0.1, inp: 200 };
export const LOW_CTR = { impressions: 100, ctr: 0.02 };
export const STRIKING = { from: 8, to: 20, impressions: 50 };

/** Words a primary query may hold that OP-01/OP-02 do not ask for. */
const QUERY_IGNORED = ['the', 'a'];
/** Words that never make two queries (or a query and a description) "share a word" (OP-03, OP-11 mismatch). */
export const STOPWORDS = ['a', 'an', 'the', 'and', 'or', 'of', 'to', 'in', 'on', 'for', 'by', 'with', 'at', 'from', 'is',
  'are', 'be', 'it', 'its', 'this', 'that', 'who', 'what', 'how', 'which', 'my', 'your', 'you'];
const GENERIC_ANCHOR = /^(click here|here|play|play now|more|read more|learn more|see more|more games|this game|link)$/;
/** Tags that run inside a sentence; every other tag ends a text block. */
const INLINE = new Set(['a', 'abbr', 'b', 'bdi', 'bdo', 'cite', 'code', 'data', 'dfn', 'em', 'font', 'i', 'kbd', 'label',
  'mark', 'q', 's', 'samp', 'small', 'span', 'strong', 'sub', 'sup', 'time', 'u', 'var', 'wbr']);

const collapse = (s) => s.replace(/\s+/g, ' ').trim();
/** The lowercased words of `s` (letters and digits; "Tic-Tac-Toe" is tic, tac, toe). */
export const words = (s) => String(s ?? '').toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
export const wordCount = (s) => words(s).length;
const queryWords = (q) => words(q).filter((w) => !QUERY_IGNORED.includes(w));
const contentWords = (q) => words(q).filter((w) => !STOPWORDS.includes(w));
const quoted = (list) => list.map((w) => `"${w}"`).join(', ');
/** `u` without query and fragment, for comparing link targets. */
function bare(u) {
  try { const x = new URL(u); x.search = ''; x.hash = ''; return x.href; } catch { return u; }
}
export const pathOf = (u) => new URL(u).pathname;
/** A link's identity in the shared set: its target and its anchor text (the menu link "Who Are Ya?" is not a related-games link to the same page). */
const linkKey = (l) => `${bare(l.href)}\t${l.text}`;

/** Visible text of an HTML fragment: an `<img>` reads as its alt (as an anchor does for Google), tags become spaces. */
function textOf(fragment) {
  const withAlt = fragment.replace(new RegExp(`<img\\b${ATTRS}>`, 'gi'), (m, a) => ` ${parseAttrs(a).alt ?? ''} `);
  return collapse(decodeEntities(withAlt.replace(/<[^>]*>/g, ' ')));
}

/** The text of every visible `<name>` element, in document order. */
function headings(html, name) {
  return [...html.matchAll(new RegExp(`<${name}\\b${ATTRS}>([\\s\\S]*?)</${name}\\s*>`, 'gi'))]
    .filter((m) => !('hidden' in parseAttrs(m[1])))
    .map((m) => textOf(m[2]));
}

/**
 * The text of `region` as sentences: every non-inline tag ends a block, each block is split after ". ", "! " and "? ",
 * whitespace is collapsed and empty pieces are dropped.
 */
function sentencesOf(region) {
  const blocks = region.replace(new RegExp(`</?([a-zA-Z][\\w-]*)${ATTRS}>`, 'g'), (m, name) => (INLINE.has(name.toLowerCase()) ? ' ' : '\n'));
  return decodeEntities(blocks).split('\n').flatMap((b) => collapse(b).split(/(?<=[.!?])\s+/)).map(collapse).filter(Boolean);
}

/** The @type values of one JSON-LD node as an array. */
const typesOf = (node) => {
  const t = node && typeof node === 'object' ? node['@type'] : null;
  return Array.isArray(t) ? t.filter((x) => typeof x === 'string') : typeof t === 'string' ? [t] : [];
};

/**
 * The on-page signals of one page's server HTML. `url` is the URL it was fetched from; relative links and images
 * resolve against it and only links to its host count; with `asOrigin` (an `--as` run) a link on that origin is read
 * on `url`'s origin, so it counts too.
 *
 * `mainText`: the visible text of the first `<main>` (the `<body>` without `<nav>`, `<header>` and `<footer>` when there
 * is none), without scripts, styles, `<svg>`, `<template>` and `<noscript>`, one sentence per line (a block element ends
 * a sentence too, so each menu entry is its own line). `links`: every internal `<a href>` (fragment dropped) with its
 * anchor text (an image inside reads as its alt; an empty anchor falls back to aria-label). `jsonLdTypes`: the @type
 * values of the top-level JSON-LD nodes (a block, or each node of its @graph), first occurrence order. `breadcrumbItems`:
 * the most ListItems of any BreadcrumbList node. `hasRating`: an aggregateRating or review key anywhere in the JSON-LD.
 *
 * @param {string} html
 * @param {{ url: string, asOrigin?: string|null }} opts
 * @returns {{ title: string|null, description: string|null, h1: string[], h2: string[], mainText: string,
 *   links: { href: string, text: string }[], images: { src: string, alt: string|null }[], jsonLdTypes: string[],
 *   breadcrumbItems: number, hasRating: boolean, htmlBytes: number }}
 */
export function pageSignals(html, { url, asOrigin = null }) {
  const source = String(html ?? '');
  const base = extractSignals(source, { url, asOrigin });
  const clean = source.replace(/<!--[\s\S]*?-->/g, ' ');
  const visible = dropElements(clean, ['script', 'style', 'svg', 'template', 'noscript']);

  const mainMatch = visible.match(new RegExp(`<main\\b${ATTRS}>([\\s\\S]*?)</main\\s*>`, 'i'));
  let region;
  if (mainMatch) region = mainMatch[2];
  else {
    const bodyMatch = visible.match(new RegExp(`<body\\b${ATTRS}>([\\s\\S]*?)(?:</body\\s*>|$)`, 'i'));
    region = dropElements(bodyMatch ? bodyMatch[2] : visible.replace(/<head\b[\s\S]*?<\/head\s*>/i, ' '), ['nav', 'header', 'footer']);
  }

  const host = new URL(url).host;
  const links = [];
  for (const m of visible.matchAll(new RegExp(`<a\\b${ATTRS}>([\\s\\S]*?)</a\\s*>`, 'gi'))) {
    const a = parseAttrs(m[1]);
    const href = (a.href ?? '').trim();
    if (!href || href.startsWith('#')) continue;
    let target;
    try { target = new URL(href, url); } catch { continue; }
    if (asOrigin) target = new URL(underOrigin(target.href, asOrigin, url));
    if (!/^https?:$/.test(target.protocol) || target.host !== host) continue;
    target.hash = '';
    links.push({ href: target.href, text: textOf(m[2]) || collapse(a['aria-label'] ?? '') });
  }

  const images = startTags(visible, 'img').map((a) => {
    let src = (a.src ?? '').trim();
    try { if (src) src = new URL(src, url).href; } catch { /* kept as written */ }
    return { src, alt: 'alt' in a ? a.alt.trim() : null };
  });

  const nodes = base.jsonLd.blocks.flatMap((b) => (b && Array.isArray(b['@graph']) ? b['@graph'] : [b]));
  const jsonLdTypes = [...new Set(nodes.flatMap(typesOf))];
  const breadcrumbItems = Math.max(0, ...nodes.filter((n) => typesOf(n).includes('BreadcrumbList'))
    .map((n) => (Array.isArray(n.itemListElement) ? n.itemListElement.filter((i) => typesOf(i).includes('ListItem')).length : 0)));

  return {
    title: base.title,
    description: base.description,
    h1: headings(visible, 'h1'),
    h2: headings(visible, 'h2'),
    mainText: sentencesOf(region).join('\n'),
    links,
    images,
    jsonLdTypes,
    breadcrumbItems,
    // A key, not a string value: JSON.stringify escapes every quote inside a string.
    hasRating: /(?<!\\)"(aggregateRating|review)"\s*:/.test(JSON.stringify(base.jsonLd.blocks)),
    htmlBytes: Buffer.byteLength(source, 'utf8'),
  };
}

/**
 * What every game page carries: the sentences of `mainText` and the links (target + anchor text) found on all of
 * `pages` (the shared game menu, the header and footer links), and the game page URLs. With fewer than two pages
 * nothing can be told apart, so both sets are empty.
 *
 * @param {{ url: string, signals: ReturnType<typeof pageSignals> }[]} pages the game pages
 * @returns {{ sentences: Set<string>, links: Set<string>, gameUrls: Set<string> }}
 */
export function sharedSets(pages) {
  const gameUrls = new Set(pages.map((p) => bare(p.url)));
  if (pages.length < 2) return { sentences: new Set(), links: new Set(), gameUrls };
  const intersect = (sets) => new Set([...sets[0]].filter((x) => sets.every((s) => s.has(x))));
  return {
    sentences: intersect(pages.map((p) => new Set(p.signals.mainText.split('\n').filter(Boolean)))),
    links: intersect(pages.map((p) => new Set(p.signals.links.map(linkKey)))),
    gameUrls,
  };
}

/** The sentences of a page's mainText that are not on every game page (duplicates kept). */
export function uniqueSentences(signals, shared) {
  return signals.mainText.split('\n').filter((s) => s && !shared.sentences.has(s));
}

/** OP-07: the URL's path is lowercase words joined by hyphens, without underscores or a query string. */
function checkUrl(url) {
  const u = new URL(url);
  const reasons = [];
  if (u.search) reasons.push(`has a query string "${u.search}"`);
  if (u.pathname !== u.pathname.toLowerCase()) reasons.push(`path ${u.pathname} is not lowercase`);
  if (u.pathname.includes('_')) reasons.push(`path ${u.pathname} has an underscore, want hyphens`);
  for (const seg of u.pathname.split('/').filter(Boolean)) {
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/i.test(seg.replace(/_/g, '-'))) reasons.push(`path segment "${seg}" is not words joined by hyphens`);
  }
  return reasons;
}

function checkKeyword(s, ctx, p) {
  if (!ctx.keyword?.primary) return [`no entry for ${p} in scripts/seo/keyword-map.json`];
  const q = queryWords(ctx.keyword.primary);
  const missing = (text) => { const have = words(text); return q.filter((w) => !have.includes(w)); };
  const reasons = [];
  const inTitle = missing(s.title);
  if (inTitle.length) reasons.push(`${quoted(inTitle)} not in the title "${s.title ?? ''}"`);
  if (!s.h1.length) reasons.push('no <h1>');
  else {
    const inH1 = missing(s.h1.join(' '));
    if (inH1.length) reasons.push(`${quoted(inH1)} not in the H1 "${s.h1.join(' / ')}"`);
  }
  return reasons.length ? [`primary query "${ctx.keyword.primary}": ${reasons.join('; ')}`] : [];
}

/** 0-based index of the first occurrence of `word` as a whole word in `text` (lowercased), or -1. */
function wordIndex(text, word) {
  for (const m of String(text).toLowerCase().matchAll(/[\p{L}\p{N}]+/gu)) if (m[0] === word) return m.index;
  return -1;
}

function checkTitle(s, ctx, p) {
  if (!s.title) return ['no <title>'];
  const reasons = [];
  const n = s.title.length;
  if (n < TITLE_MIN || n > TITLE_MAX) reasons.push(`${n} characters, want ${TITLE_MIN}-${TITLE_MAX}`);
  if (!ctx.keyword?.primary) reasons.push(`no entry for ${p} in scripts/seo/keyword-map.json, so the query cannot be placed`);
  else {
    for (const w of queryWords(ctx.keyword.primary)) {
      const at = wordIndex(s.title, w);
      if (at < 0) reasons.push(`"${w}" not in the title`);
      else if (at >= QUERY_WITHIN) reasons.push(`"${w}" starts at character ${at + 1}, want within the first ${QUERY_WITHIN}`);
    }
  }
  if (ctx.isHome) { if (!s.title.startsWith(SITE_NAME)) reasons.push(`does not start with "${SITE_NAME}"`); }
  else if (!s.title.endsWith(BRAND_SUFFIX)) reasons.push(`does not end with "${BRAND_SUFFIX}"`);
  return reasons.length ? [`title "${s.title}": ${reasons.join('; ')}`] : [];
}

function checkDescription(s, ctx, url) {
  if (!s.description) return ['no <meta name="description">'];
  const reasons = [];
  const n = s.description.length;
  if (n < DESCRIPTION_MIN || n > DESCRIPTION_MAX) reasons.push(`description is ${n} characters, want ${DESCRIPTION_MIN}-${DESCRIPTION_MAX}`);
  const others = [...new Set(ctx.siteDescriptions?.get(s.description) ?? [])].filter((u) => u !== url);
  if (others.length) reasons.push(`description is also used by ${others.join(', ')}`);
  if (ctx.keyword?.primary) {
    const have = words(s.description);
    if (!contentWords(ctx.keyword.primary).some((w) => have.includes(w))) reasons.push(`description has no word of the primary query "${ctx.keyword.primary}"`);
  }
  return reasons;
}

function checkHeadings(s, ctx) {
  const reasons = [];
  if (s.h1.length !== 1) reasons.push(`${s.h1.length} <h1>, want exactly 1`);
  if (ctx.isGame && s.h2.length < MIN_H2) reasons.push(`${s.h2.length} <h2>, want >= ${MIN_H2}`);
  return reasons;
}

function checkContent(s, ctx) {
  const reasons = [];
  const n = wordCount(uniqueSentences(s, ctx.shared).join(' '));
  if (n < MIN_UNIQUE_WORDS) reasons.push(`${n} unique words in <main> after removing the text shared by every game page, want >= ${MIN_UNIQUE_WORDS}`);
  if (!s.h2.some((h) => /how to play/i.test(h))) reasons.push('no <h2> matching "how to play"');
  return reasons;
}

const isGeneric = (text) => { const t = collapse(text).toLowerCase().replace(/[.!?:]+$/, ''); return GENERIC_ANCHOR.test(t) || t.includes('click here'); };

function checkLinks(s, ctx, url) {
  const self = bare(url);
  const targets = new Set();
  const rejected = [];
  for (const l of s.links) {
    const to = bare(l.href);
    if (to === self || !ctx.shared.gameUrls.has(to) || ctx.shared.links.has(linkKey(l))) continue;
    if (wordCount(l.text) < MIN_ANCHOR_WORDS || isGeneric(l.text)) { rejected.push(`"${l.text}" → ${to}`); continue; }
    targets.add(to);
  }
  if (targets.size >= MIN_RELATED_LINKS) return [];
  return [`${targets.size} link(s) to other game pages outside the shared menu with a descriptive anchor (>= ${MIN_ANCHOR_WORDS} words, not generic), want >= ${MIN_RELATED_LINKS}`
    + (rejected.length ? `; anchors too short or generic: ${rejected.join(', ')}` : '')];
}

const isLogo = (img) => (img.alt ?? '').toLowerCase() === SITE_NAME.toLowerCase();

function checkImages(s, ctx) {
  const reasons = [];
  const noAlt = s.images.filter((i) => !i.alt);
  if (noAlt.length) reasons.push(`${noAlt.length} <img> without alt text (${noAlt.slice(0, 3).map((i) => i.src || '(no src)').join(', ')}${noAlt.length > 3 ? ', …' : ''})`);
  if (ctx.isGame && !s.images.some((i) => !isLogo(i))) reasons.push(`no <img> besides the logo (the game artwork is not an <img>; ${s.images.length} <img> in the HTML)`);
  return reasons;
}

function checkStructuredData(s, ctx) {
  const reasons = [];
  if (s.hasRating) reasons.push('JSON-LD has aggregateRating or review');
  if (ctx.isGame) {
    if (!s.jsonLdTypes.includes('VideoGame')) reasons.push(`no VideoGame node (types: ${s.jsonLdTypes.join(', ') || 'none'})`);
    if (s.breadcrumbItems < 2) reasons.push(s.jsonLdTypes.includes('BreadcrumbList') ? `BreadcrumbList has ${s.breadcrumbItems} ListItem(s), want >= 2` : 'no BreadcrumbList');
  }
  return reasons;
}

const ms = (v) => `${Math.round(v)} ms`;
const cls = (v) => String(Number(v.toFixed(3)));

function checkExperience(s, ctx) {
  const reasons = [];
  if (s.htmlBytes > HTML_MAX_BYTES) reasons.push(`HTML is ${Math.round(s.htmlBytes / 1024)} KB, want <= ${HTML_MAX_BYTES / 1024} KB`);
  const over = (label, v, max, fmt) => { if (typeof v === 'number' && v > max) reasons.push(`${label} ${fmt(v)}, want <= ${max}`); };
  const lab = ctx.psi?.lab;
  const field = ctx.psi?.field;
  if (lab) {
    over('lab LCP', lab.lcp, PSI_LIMITS.lcp, ms);
    over('lab TBT', lab.tbt, PSI_LIMITS.tbt, ms);
    over('lab CLS', lab.cls, PSI_LIMITS.cls, cls);
  }
  if (field) {
    over('field p75 LCP', field.lcp, PSI_LIMITS.lcp, ms);
    over('field p75 INP', field.inp, PSI_LIMITS.inp, ms);
    over('field p75 CLS', field.cls, PSI_LIMITS.cls, cls);
  }
  return reasons;
}

/**
 * The OP failures of one page (at most one Failure per check, its evidence the reasons joined by "; "), sorted by id.
 * OP-07 applies to every page; the others to the home page (`ctx.isHome`) and the game pages (`ctx.isGame`), the
 * "game pages:" rules of CHECKS.md to the game pages only. OP-11 is never a failure (see queryFlags).
 *
 * @param {{ url: string, signals: ReturnType<typeof pageSignals> }} page
 * @param {{ keyword: { primary: string, related: string[] }|null, isGame: boolean, isHome: boolean,
 *   shared: ReturnType<typeof sharedSets>, siteDescriptions: Map<string, string[]>,
 *   psi: { lab: { lcp: number|null, tbt: number|null, cls: number|null }|null, field: { lcp: number|null, inp: number|null, cls: number|null }|null }|null }} ctx
 *   `siteDescriptions` maps each description to the URLs (home and game pages) that use it.
 * @returns {{ id: string, url: string, evidence: string }[]}
 */
export function checkOnpage(page, ctx) {
  const { url, signals: s } = page;
  const failures = [];
  const add = (id, reasons) => { if (reasons.length) failures.push({ id, url, evidence: reasons.join('; ') }); };
  const urlReasons = checkUrl(url);
  add('OP-07', urlReasons.length ? [`${new URL(url).pathname}${new URL(url).search}: ${urlReasons.join('; ')}`] : []);
  if (!ctx.isGame && !ctx.isHome) return failures;
  const p = pathOf(url);
  add('OP-01', checkKeyword(s, ctx, p));
  add('OP-02', checkTitle(s, ctx, p));
  add('OP-03', checkDescription(s, ctx, url));
  add('OP-04', checkHeadings(s, ctx));
  if (ctx.isGame) {
    add('OP-05', checkContent(s, ctx));
    add('OP-06', checkLinks(s, ctx, url));
  }
  add('OP-08', checkImages(s, ctx));
  add('OP-09', checkStructuredData(s, ctx));
  add('OP-10', checkExperience(s, ctx));
  return failures.sort((a, b) => a.id.localeCompare(b.id));
}

/**
 * OP-11: Search Analytics rows (dimensions page, query; `{ keys: [page, query], clicks, impressions, ctr, position }`)
 * → per path { primary, flags, topQuery, impressions, clicks, ctr, position, queries }. Page totals: impressions and
 * clicks summed, CTR = clicks / impressions, position weighted by impressions. Flags, in this order: `low-ctr`
 * (>= 100 impressions, CTR < 2 %), `striking` (position 8-20, >= 50 impressions), `mismatch` (the top query by
 * impressions shares no non-stopword with the path's primary query; never without a keyword-map entry). `queries`: the
 * top 5 by impressions. The numbers and query strings are private: callers write them to queries-summary.md only.
 *
 * @param {{ keys: string[], clicks: number, impressions: number, ctr: number, position: number }[]} rows
 * @param {Record<string, { primary: string }>} keywordMap
 */
export function queryFlags(rows, keywordMap) {
  const byPath = new Map();
  for (const r of rows ?? []) {
    const [pageUrl, query] = r?.keys ?? [];
    if (!pageUrl || !query) continue;
    let p;
    try { p = new URL(pageUrl).pathname; } catch { p = pageUrl; }
    if (!byPath.has(p)) byPath.set(p, []);
    byPath.get(p).push({ query, impressions: Number(r.impressions) || 0, clicks: Number(r.clicks) || 0, ctr: Number(r.ctr) || 0, position: Number(r.position) || 0 });
  }
  const out = {};
  for (const p of [...byPath.keys()].sort()) {
    const qs = byPath.get(p).sort((a, b) => b.impressions - a.impressions || b.clicks - a.clicks || a.query.localeCompare(b.query));
    const impressions = qs.reduce((n, q) => n + q.impressions, 0);
    const clicks = qs.reduce((n, q) => n + q.clicks, 0);
    const ctr = impressions ? clicks / impressions : 0;
    const position = impressions ? qs.reduce((n, q) => n + q.position * q.impressions, 0) / impressions : 0;
    const primary = keywordMap?.[p]?.primary ?? null;
    const topQuery = qs[0]?.query ?? null;
    const flags = [];
    if (impressions >= LOW_CTR.impressions && ctr < LOW_CTR.ctr) flags.push('low-ctr');
    if (position >= STRIKING.from && position <= STRIKING.to && impressions >= STRIKING.impressions) flags.push('striking');
    if (primary && topQuery) {
      const want = contentWords(primary);
      if (!contentWords(topQuery).some((w) => want.includes(w))) flags.push('mismatch');
    }
    out[p] = { primary, flags, topQuery, impressions, clicks, ctr, position, queries: qs.slice(0, 5) };
  }
  return out;
}
