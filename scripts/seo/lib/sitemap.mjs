// sitemap.xml read with regexes (no XML dependency): the <url> entries with their <loc> and <lastmod>, and the
// structural errors that would make a crawler reject the file or an entry. The checks that need the clock or the
// fetched pages (lastmod in the future, every lastmod equal, each URL canonical and 200) live in the audit.

/** W3C Datetime, the formats the sitemap protocol accepts for <lastmod>: YYYY, YYYY-MM, YYYY-MM-DD, or a full time. */
const W3C_DATETIME = /^\d{4}(-\d{2}(-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2}))?)?)?$/;
const XML_ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

function decodeXml(s) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] !== '#') return XML_ENTITIES[e] ?? m;
    return String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
  });
}

/** The text of every `<name>…</name>` child in `xml` (CDATA unwrapped, entities decoded, trimmed). */
function children(xml, name) {
  return [...xml.matchAll(new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)</${name}\\s*>`, 'gi'))]
    .map((m) => decodeXml(m[1].replace(/^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/, '$1').trim()));
}

/** True for a W3C Datetime string that is also a real date (no month 13). */
function isW3cDatetime(s) {
  return W3C_DATETIME.test(s) && !Number.isNaN(Date.parse(s.length === 4 ? `${s}-01-01` : s.length === 7 ? `${s}-01` : s));
}

/**
 * @param {string} xml the sitemap body
 * @returns {{ urls: { loc: string, lastmod: string|null }[], errors: string[], hasPriorityOrChangefreq: boolean }}
 *   `urls` keeps every entry with exactly one <loc>, relative ones included (they are also in `errors`).
 */
export function parseSitemap(xml) {
  const text = String(xml ?? '').replace(/^﻿/, '').replace(/<!--[\s\S]*?-->/g, ' ');
  const errors = [];
  const urls = [];
  if (/<sitemapindex\b/i.test(text)) errors.push('is a <sitemapindex>; the audit reads a single <urlset> sitemap');
  else if (!/<urlset\b[^>]*>/i.test(text) || !/<\/urlset\s*>/i.test(text)) errors.push('no complete <urlset> element (not a sitemap, or truncated)');
  const stray = text.match(/&(?!amp;|lt;|gt;|quot;|apos;|#\d+;|#x[0-9a-f]+;)/i);
  if (stray) errors.push(`unescaped "&" near "${text.slice(Math.max(0, stray.index - 20), stray.index + 20).trim()}" (the XML does not parse)`);
  const opened = (text.match(/<url\b[^>]*>/gi) ?? []).length;
  const closed = (text.match(/<\/url\s*>/gi) ?? []).length;
  if (opened !== closed) errors.push(`${opened} <url> start tags and ${closed} </url> end tags`);

  [...text.matchAll(/<url\b[^>]*>([\s\S]*?)<\/url\s*>/gi)].forEach((m, i) => {
    const locs = children(m[1], 'loc');
    const lastmods = children(m[1], 'lastmod');
    if (locs.length !== 1) { errors.push(`<url> entry ${i + 1} has ${locs.length} <loc> elements, want 1`); return; }
    const [loc] = locs;
    if (!/^https?:\/\//i.test(loc)) errors.push(`loc "${loc}" is not absolute`);
    if (lastmods.length > 1) errors.push(`${loc} has ${lastmods.length} <lastmod> elements`);
    const lastmod = lastmods[0] ?? null;
    if (lastmod !== null && !isW3cDatetime(lastmod)) errors.push(`${loc} lastmod "${lastmod}" is not an ISO (W3C Datetime) date`);
    urls.push({ loc, lastmod });
  });
  return { urls, errors, hasPriorityOrChangefreq: /<(priority|changefreq)\b/i.test(text) };
}
