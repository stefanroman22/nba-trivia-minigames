// Per-page HTML signals for the IX checks of scripts/seo/CHECKS.md. extractSignals() reads the server HTML of one page
// with regexes over the string (no DOM, no JavaScript run, as a crawler sees it before rendering); checkPage() turns
// those signals into IX-03…IX-09 and IX-12 failures. Fetches (og:image, favicon, manifest) and the site-wide checks
// (robots.txt, status, sitemap, orphans) live in the audit, not here.

export const SITE_NAME = 'Swish Quest';
export const TITLE_MIN = 10;
export const TITLE_MAX = 70;
export const DESCRIPTION_MIN = 50;
export const DESCRIPTION_MAX = 160;
export const TEXT_MIN = 300;

const NAMED_ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
// A start tag up to its closing ">", skipping any ">" inside quoted attribute values.
export const ATTRS = `((?:[^>"']|"[^"]*"|'[^']*')*)`;

/** `s` with numeric and the common named HTML entities decoded (unknown entities are left as written). */
export function decodeEntities(s) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] !== '#') return NAMED_ENTITIES[e.toLowerCase()] ?? m;
    const cp = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
    return cp <= 0x10ffff ? String.fromCodePoint(cp) : m;
  });
}

/** Attributes of one start tag's attribute source → { lowercased name: decoded value } (first occurrence wins). */
export function parseAttrs(src) {
  const out = {};
  for (const m of src.matchAll(/([^\s"'=<>/]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g)) {
    const key = m[1].toLowerCase();
    if (!(key in out)) out[key] = decodeEntities(m[2] ?? m[3] ?? m[4] ?? '');
  }
  return out;
}

/** Attribute maps of every `<name …>` start tag in `html`, in document order. */
export function startTags(html, name) {
  return [...html.matchAll(new RegExp(`<${name}\\b${ATTRS}>`, 'gi'))].map((m) => parseAttrs(m[1]));
}

/** `html` with every `<name>…</name>` element removed (non-greedy, so a nested element of the same name ends early). */
export function dropElements(html, names) {
  return names.reduce((h, n) => h.replace(new RegExp(`<${n}\\b${ATTRS}>[\\s\\S]*?</${n}\\s*>`, 'gi'), ' '), html);
}

const collapse = (s) => s.replace(/\s+/g, ' ').trim();

/** `u` normalised by the URL parser (so `https://x.com` equals `https://x.com/`); unparsable input is returned as is. */
function normalizeUrl(u, base) {
  try { return new URL(u, base).href; } catch { return u; }
}

/**
 * `u` read on `on` when it is on the origin `asOrigin` (an `--as` run: a local build names the production origin in its
 * URLs, which are the same paths on the served site); any other input, or no `asOrigin`, is returned as is.
 */
export function underOrigin(u, asOrigin, on) {
  if (!asOrigin) return u;
  try {
    const x = new URL(u);
    return x.origin === asOrigin ? new URL(`${x.pathname}${x.search}${x.hash}`, on).href : u;
  } catch { return u; }
}

/** `url` without its query and fragment: the URL a `?ref=x` variant should canonicalise to. */
function stripQuery(url) {
  try { const u = new URL(url); u.search = ''; u.hash = ''; return u.href; } catch { return url; }
}

/**
 * Every `application/ld+json` script → { ok, blocks, errors }. A script holding a JSON array contributes one block per
 * element. JSON.parse decodes the `<` escapes the JsonLd component writes for `<`.
 */
function readJsonLd(html) {
  const blocks = [];
  const errors = [];
  let n = 0;
  for (const m of html.matchAll(new RegExp(`<script\\b${ATTRS}>([\\s\\S]*?)</script\\s*>`, 'gi'))) {
    if ((parseAttrs(m[1]).type ?? '').trim().toLowerCase() !== 'application/ld+json') continue;
    n += 1;
    try {
      const value = JSON.parse(m[2].trim());
      blocks.push(...(Array.isArray(value) ? value : [value]));
    } catch (e) {
      errors.push(`ld+json script ${n} does not parse: ${e.message}`);
    }
  }
  return { ok: errors.length === 0, blocks, errors };
}

/**
 * The indexing signals of one page's server HTML. `url` is the URL the HTML was fetched from; relative links resolve
 * against it and only links to its host count as internal. With `asOrigin` (an `--as` run) a link on that origin is
 * read on `url`'s origin (underOrigin), so it is internal too.
 *
 * Text heuristic (`textLength`): the `<body>` (the whole document when there is none) without comments and without
 * `<script>`, `<style>`, `<nav>`, `<header>` and `<footer>` elements, then every tag replaced by a space, entities
 * decoded and whitespace collapsed. It counts what a crawler reads as main content without running JavaScript; text
 * hidden by CSS still counts. `h1Count` likewise counts `<h1>` tags without a `hidden` attribute.
 *
 * @param {string} html
 * @param {{ url: string, asOrigin?: string|null }} opts
 * @returns {{ title: string|null, description: string|null, canonical: string[], robotsMeta: string[], h1Count: number,
 *   textLength: number, internalLinks: string[], jsonLd: { ok: boolean, blocks: object[], errors: string[] },
 *   og: { title: string|null, description: string|null, image: string|null }, viewport: boolean }}
 */
export function extractSignals(html, { url, asOrigin = null }) {
  const clean = String(html ?? '').replace(/<!--[\s\S]*?-->/g, ' ');
  // Tags are read outside scripts, so markup quoted inside an inline script never counts as a tag.
  const markup = dropElements(clean, ['script']);

  const metas = startTags(markup, 'meta');
  const metaContent = (key) => {
    const tag = metas.find((a) => [a.name, a.property].some((v) => (v ?? '').toLowerCase() === key));
    return tag && 'content' in tag ? tag.content.trim() : null;
  };

  const titleMatch = dropElements(markup, ['svg']).match(/<title\b[^>]*>([\s\S]*?)<\/title\s*>/i);
  const title = titleMatch ? collapse(decodeEntities(titleMatch[1])) : null;

  const canonical = startTags(markup, 'link')
    .filter((a) => (a.rel ?? '').toLowerCase().split(/\s+/).includes('canonical'))
    .map((a) => (a.href ?? '').trim());

  const robotsMeta = metas
    .filter((a) => ['robots', 'googlebot'].includes((a.name ?? '').toLowerCase()))
    .map((a) => (a.content ?? '').trim().toLowerCase());

  const h1Count = startTags(markup, 'h1').filter((a) => !('hidden' in a)).length;

  const bodyMatch = clean.match(new RegExp(`<body\\b${ATTRS}>([\\s\\S]*?)(?:</body\\s*>|$)`, 'i'));
  const body = bodyMatch ? bodyMatch[2] : clean.replace(/<head\b[\s\S]*?<\/head\s*>/i, ' ');
  const text = collapse(decodeEntities(dropElements(body, ['script', 'style', 'nav', 'header', 'footer']).replace(/<[^>]*>/g, ' ')));

  const host = new URL(url).host;
  const internalLinks = [];
  for (const a of startTags(markup, 'a')) {
    const href = (a.href ?? '').trim();
    if (!href || href.startsWith('#')) continue;
    let target;
    try { target = new URL(href, url); } catch { continue; }
    if (asOrigin) target = new URL(underOrigin(target.href, asOrigin, url));
    if (!/^https?:$/.test(target.protocol) || target.host !== host) continue;
    target.hash = '';
    if (!internalLinks.includes(target.href)) internalLinks.push(target.href);
  }

  return {
    title,
    description: metaContent('description'),
    canonical,
    robotsMeta,
    h1Count,
    textLength: text.length,
    internalLinks,
    jsonLd: readJsonLd(clean),
    og: { title: metaContent('og:title'), description: metaContent('og:description'), image: metaContent('og:image') },
    viewport: metas.some((a) => (a.name ?? '').toLowerCase() === 'viewport'),
  };
}

/** True when a robots directive list (meta content or X-Robots-Tag value) contains noindex or none. */
function hasNoindex(directives) {
  return String(directives ?? '').toLowerCase().split(/[\s,]+/).some((d) => d === 'noindex' || d === 'none');
}

/** Keys from `keys` that occur anywhere inside `value`. */
function findKeys(value, keys, found = new Set()) {
  if (Array.isArray(value)) value.forEach((v) => findKeys(v, keys, found));
  else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      if (keys.includes(k)) found.add(k);
      findKeys(v, keys, found);
    }
  }
  return found;
}

/** Other URLs that share `value` in a site map of value → urls (this page's own url and sitemap URL excluded). */
function sharedWith(siteMap, value, ctx) {
  const urls = siteMap?.get(value) ?? [];
  return [...new Set(urls)].filter((u) => u !== ctx.url && u !== ctx.sitemapUrl);
}

function checkNoindex(s, ctx) {
  const metaNoindex = s.robotsMeta.filter(hasNoindex);
  const headerNoindex = hasNoindex(ctx.xRobotsTag);
  if (ctx.expectNoindex) {
    const reasons = [];
    if (!metaNoindex.length && !headerNoindex) reasons.push('expected noindex, found no robots meta noindex and no X-Robots-Tag noindex');
    if (ctx.sitemapUrl) reasons.push(`expected-noindex page is listed in the sitemap as ${ctx.sitemapUrl}`);
    return reasons;
  }
  return [
    ...metaNoindex.map((c) => `<meta name="robots" content="${c}">`),
    ...(headerNoindex ? [`X-Robots-Tag: ${ctx.xRobotsTag}`] : []),
  ];
}

function checkCanonical(s, ctx) {
  const expected = ctx.sitemapUrl ?? stripQuery(ctx.url);
  if (s.canonical.length !== 1) {
    return [s.canonical.length ? `${s.canonical.length} canonical links (${s.canonical.join(', ')}), want exactly 1` : 'no <link rel="canonical">'];
  }
  const [href] = s.canonical;
  if (!/^https?:\/\//i.test(href)) return [`canonical "${href}" is not absolute`];
  const local = (u) => underOrigin(normalizeUrl(u), ctx.asOrigin, ctx.url);
  return local(href) === local(expected) ? [] : [`canonical ${href} differs from the sitemap URL ${expected}`];
}

function checkTitle(s, ctx) {
  if (!s.title) return ['no <title>'];
  const reasons = [];
  if (s.title.length < TITLE_MIN || s.title.length > TITLE_MAX) reasons.push(`title "${s.title}" is ${s.title.length} characters, want ${TITLE_MIN}-${TITLE_MAX}`);
  if (s.title.trim().toLowerCase() === SITE_NAME.toLowerCase()) reasons.push(`title "${s.title}" is the bare site name`);
  const others = sharedWith(ctx.siteTitles, s.title, ctx);
  if (others.length) reasons.push(`title "${s.title}" is also used by ${others.join(', ')}`);
  return reasons;
}

function checkDescription(s, ctx) {
  if (!s.description) return ['no <meta name="description">'];
  const reasons = [];
  const n = s.description.length;
  if (n < DESCRIPTION_MIN || n > DESCRIPTION_MAX) reasons.push(`description is ${n} characters, want ${DESCRIPTION_MIN}-${DESCRIPTION_MAX}`);
  const others = sharedWith(ctx.siteDescriptions, s.description, ctx);
  if (others.length) reasons.push(`description is also used by ${others.join(', ')}`);
  return reasons;
}

function checkContent(s) {
  const reasons = [];
  if (s.textLength < TEXT_MIN) reasons.push(`${s.textLength} characters of text outside nav/header/footer/script/style, want >= ${TEXT_MIN}`);
  if (!s.internalLinks.length) reasons.push('no internal <a href>');
  return reasons;
}

function checkStructuredData(s, ctx) {
  const canonical = s.canonical.length === 1 ? normalizeUrl(s.canonical[0], ctx.url) : normalizeUrl(ctx.sitemapUrl ?? stripQuery(ctx.url));
  const local = (u) => underOrigin(u, ctx.asOrigin, ctx.url);
  const reasons = [...s.jsonLd.errors];
  s.jsonLd.blocks.forEach((block, i) => {
    const label = `ld+json block ${i + 1}`;
    if (!block || typeof block !== 'object' || Array.isArray(block)) { reasons.push(`${label} is not an object`); return; }
    if (!block['@context']) reasons.push(`${label} has no @context`);
    // A @graph block carries its nodes in the array; each node needs a @type and, when it names a url, the canonical.
    const nodes = Array.isArray(block['@graph']) ? block['@graph'] : [block];
    for (const node of nodes) {
      if (!node || typeof node !== 'object') continue;
      if (!node['@type']) reasons.push(`${label} has a node without @type`);
      if (typeof node.url === 'string' && local(normalizeUrl(node.url, ctx.url)) !== local(canonical)) reasons.push(`${label} url ${node.url} differs from the canonical ${canonical}`);
    }
    const banned = [...findKeys(block, ['aggregateRating', 'review'])];
    if (banned.length) reasons.push(`${label} has ${banned.join(' and ')}`);
  });
  return reasons;
}

function checkShare(s) {
  const missing = ['title', 'description', 'image'].filter((k) => !s.og[k]).map((k) => `og:${k}`);
  return missing.length ? [`missing ${missing.join(', ')}`] : [];
}

/**
 * The IX-03…IX-09 and IX-12 failures of one page: at most one Failure per check, its evidence the reasons joined by
 * "; ". An expected-noindex page (ctx.expectNoindex) is only held to IX-03: it must carry noindex (meta or header) and
 * have no sitemap URL; the indexability checks do not apply to it. siteTitles / siteDescriptions map each title /
 * description (as extractSignals returns it) to the URLs that use it. `asOrigin` (an `--as` run): the canonical, the
 * sitemap URL and JSON-LD urls are compared modulo that origin (underOrigin onto `url`'s origin).
 *
 * @param {ReturnType<typeof extractSignals>} signals
 * @param {{ url: string, sitemapUrl: string|null, expectNoindex: boolean, xRobotsTag: string|null,
 *   siteTitles: Map<string, string[]>, siteDescriptions: Map<string, string[]>, asOrigin?: string|null }} ctx
 * @returns {{ id: string, url: string, evidence: string }[]}
 */
export function checkPage(signals, ctx) {
  const failures = [];
  const add = (id, reasons) => { if (reasons.length) failures.push({ id, url: ctx.url, evidence: reasons.join('; ') }); };
  add('IX-03', checkNoindex(signals, ctx));
  if (ctx.expectNoindex) return failures;
  add('IX-04', checkCanonical(signals, ctx));
  add('IX-05', checkTitle(signals, ctx));
  add('IX-06', checkDescription(signals, ctx));
  add('IX-07', signals.h1Count === 1 ? [] : [`${signals.h1Count} <h1> in the server HTML, want 1`]);
  add('IX-08', checkContent(signals));
  add('IX-09', checkStructuredData(signals, ctx));
  add('IX-12', checkShare(signals));
  return failures;
}
