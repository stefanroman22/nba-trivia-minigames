// Static SEO check of the page code (design docs/superpowers/specs/2026-10-26-seo-dev-gate-design.md §4), no build,
// no dependencies. Rules are docs/constraints/SEO_CONSTRAINTS.md SEO-1 … SEO-5.
//   npm run check:seo       (also run by `npm run lint`)
//   node scripts/check-seo.mjs [--root <dir>]
// Prints one `SEO-n <file>: <message>` line per violation and exits 1, or `check:seo: ok (<n> routes, <m> games)`.
//
// What it reads and how (string/regex scanning, no TypeScript compiler):
//   - Every source file goes through a small lexer that blanks comments (`//`, `/* */`) and, in a second copy, the
//     contents of string, template and regex literals. Lengths are kept, so a position found in the blanked copy
//     reads the same place in the source. Keys, identifiers and braces are only ever matched in the blanked copy,
//     so a word inside a comment or a string ("No canonical here") never counts.
//   - Routes: every `page.{tsx,ts,jsx,js}` under src/app. Route groups `(x)` and slots `@x` add no segment, a `_x`
//     folder is private (not a route); `route.ts` handlers (llms.txt) are not pages. The route made of one dynamic
//     segment directly under src/app (`[game]`) is the game route; its URLs are the visible games.
//   - Page metadata: the object literal of `export const metadata … = { … }`, or of every `return { … }` in
//     `export [async] function generateMetadata(…) { … }` (or `export const generateMetadata = … => { … }`). Only
//     its top-level keys count (nested `openGraph.title` is not a title); a shorthand key (`description,`) counts.
//     `alternates.canonical` is a `canonical` key at the top level of the `alternates: { … }` object.
//   - noindex: in that metadata, `robots: { … index: false … }` or `robots: "…noindex…"`.
//   - The home page `/` and the root layout are one route segment: its title and description may come from the root
//     layout's top-level `title` / `description` (Next's `title.default` exists for it); its canonical may not.
//   - Root layout canonical: the identifier `alternates` or `canonical` anywhere in src/app/layout.tsx's code.
//   - Sitemap paths (src/app/sitemap.ts): string literals that are a path (`"/privacy"`), and template literals
//     `${SITE_URL}/path` (`${SITE_URL}/` is `/`). Game URLs: the code must use `visibleGames`, and must name the id of
//     any visible game whose own page is noindex (the `coming-soon` exclusion).
//   - Catalogue (src/utils/GameUtils.tsx): the top-level object entries of `export const games … = [ … ]`, their
//     top-level `id`, `urlPath`, `seoDescription` (string or plain template literal) and `hidden: true`. Visible =
//     not hidden and id not `coming-soon`, which holds only while `visibleGames` is `games.filter((g) => !g.hidden)`;
//     the check fails if that definition changes, so this file is updated with it.
//   - expectedNoindex: scripts/seo/config.json.
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const URL_RE = /^\/[a-z0-9]+(-[a-z0-9]+)*$/;
const SEGMENT_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const DESC_MIN = 50;
const DESC_MAX = 160;

// ---------------------------------------------------------------- lexer

const REGEX_AFTER_CHAR = new Set("(,=:[!&|?{};+-*%~^".split(""));
const REGEX_AFTER_WORD = /\b(return|typeof|case|in|of|new|delete|void|throw|yield|await)$/;

/**
 * @returns {{ code: string, mask: string, strings: Map<number, { quote: string, raw: string, end: number }> }}
 *   code: comments blanked; mask: comments and literal contents blanked (delimiters kept); strings by start index.
 */
export function lex(src) {
  const code = src.split("");
  const mask = src.split("");
  const strings = new Map();
  const blank = (arr, from, to) => { for (let k = from; k < to; k += 1) if (arr[k] !== "\n" && arr[k] !== "\r") arr[k] = " "; };
  let lastSig = ""; // last significant code character, for the regex-or-division guess
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i];
    const d = src[i + 1];
    if (c === "/" && d === "/") {
      const end = src.indexOf("\n", i);
      const stop = end < 0 ? n : end;
      blank(code, i, stop); blank(mask, i, stop);
      i = stop;
      continue;
    }
    if (c === "/" && d === "*") {
      const end = src.indexOf("*/", i + 2);
      const stop = end < 0 ? n : end + 2;
      blank(code, i, stop); blank(mask, i, stop);
      i = stop;
      continue;
    }
    if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < n && src[j] !== c && src[j] !== "\n") j += src[j] === "\\" ? 2 : 1;
      const end = Math.min(j, n);
      strings.set(i, { quote: c, raw: src.slice(i + 1, end), end: end + 1 });
      blank(mask, i + 1, end);
      i = end + 1;
      lastSig = c;
      continue;
    }
    if (c === "`") {
      let j = i + 1;
      let depth = 0; // brace depth inside ${ … }
      while (j < n) {
        if (src[j] === "\\") { j += 2; continue; }
        if (depth === 0 && src[j] === "`") break;
        if (src[j] === "$" && src[j + 1] === "{") { depth += 1; j += 2; continue; }
        if (depth > 0 && src[j] === "{") depth += 1;
        else if (depth > 0 && src[j] === "}") depth -= 1;
        j += 1;
      }
      const end = Math.min(j, n);
      strings.set(i, { quote: "`", raw: src.slice(i + 1, end), end: end + 1 });
      blank(mask, i + 1, end);
      i = end + 1;
      lastSig = "`";
      continue;
    }
    if (c === "/") {
      const before = src.slice(Math.max(0, i - 12), i).replace(/\s+$/, "");
      const isRegex = lastSig === "" || REGEX_AFTER_CHAR.has(lastSig) || REGEX_AFTER_WORD.test(before);
      if (isRegex) {
        let j = i + 1;
        let inClass = false;
        while (j < n && src[j] !== "\n") {
          if (src[j] === "\\") { j += 2; continue; }
          if (src[j] === "[") inClass = true;
          else if (src[j] === "]") inClass = false;
          else if (src[j] === "/" && !inClass) break;
          j += 1;
        }
        blank(mask, i + 1, j);
        i = j + 1;
        while (i < n && /[a-z]/i.test(src[i])) i += 1;
        lastSig = "/";
        continue;
      }
    }
    if (!/\s/.test(c)) lastSig = c;
    i += 1;
  }
  return { code: code.join(""), mask: mask.join(""), strings };
}

// ---------------------------------------------------------------- object-literal helpers (on the mask)

const OPEN = { "{": "}", "[": "]", "(": ")" };
const CLOSE = new Set(["}", "]", ")"]);

/** Index of the bracket closing the one at `open` (any of {[( nested), or -1. */
function matchClose(mask, open) {
  let depth = 0;
  for (let k = open; k < mask.length; k += 1) {
    const ch = mask[k];
    if (OPEN[ch]) depth += 1;
    else if (CLOSE.has(ch)) {
      depth -= 1;
      if (depth === 0) return k;
    }
  }
  return -1;
}

/** Top-level keys of the object literal whose braces are at [open, close]: Map key -> index after the key. */
function objectKeys(lexed, open, close) {
  const { code, mask } = lexed;
  const keys = new Map();
  let depth = 0;
  let segStart = open + 1;
  const take = (s, e) => {
    const seg = code.slice(s, e);
    const m = seg.match(/^\s*(?:(["'])([^"'\n]*)\1|([A-Za-z_$][\w$]*))\s*(:|$)/);
    if (m) keys.set(m[2] ?? m[3], s + m[0].length);
  };
  for (let k = open + 1; k < close; k += 1) {
    const ch = mask[k];
    if (OPEN[ch]) depth += 1;
    else if (CLOSE.has(ch)) depth -= 1;
    else if (ch === "," && depth === 0) { take(segStart, k); segStart = k + 1; }
  }
  take(segStart, close);
  return keys;
}

/** If the value starting at `from` is an object literal, its [open, close]; else null. */
function objectAt(lexed, from) {
  const m = lexed.mask.slice(from).match(/^\s*\{/);
  if (!m) return null;
  const open = from + m[0].length - 1;
  const close = matchClose(lexed.mask, open);
  return close < 0 ? null : [open, close];
}

/** The string literal value starting at `from` (template literals only without ${}), or undefined. */
function stringAt(lexed, from) {
  const m = lexed.code.slice(from).match(/^\s*/);
  const at = from + m[0].length;
  const tok = lexed.strings.get(at);
  if (!tok) return undefined;
  const after = lexed.mask.slice(tok.end).match(/^\s*([,}\]\n]|$)/);
  if (!after) return undefined; // e.g. "a" + b
  if (tok.quote === "`") return tok.raw.includes("${") ? undefined : tok.raw.replace(/\\(.)/g, "$1");
  if (tok.quote === '"') { try { return JSON.parse(`"${tok.raw}"`); } catch { return tok.raw; } }
  return tok.raw.replace(/\\(.)/g, "$1");
}

// ---------------------------------------------------------------- metadata

/**
 * The metadata object literal(s) a route file exports.
 * @returns {{ found: boolean, objects: Array<[number, number]>, text: string }} text = comment-free code of the export
 */
function metadataOf(lexed) {
  const { mask, code } = lexed;
  const objects = [];
  let text = "";
  const constM = mask.match(/export\s+const\s+metadata\b[^=;]*=\s*/);
  if (constM) {
    const obj = objectAt(lexed, constM.index + constM[0].length);
    if (obj) { objects.push(obj); text += code.slice(obj[0], obj[1] + 1); }
    return { found: true, objects, text };
  }
  const fnM = mask.match(/export\s+(?:async\s+)?function\s+generateMetadata\s*\(/) || mask.match(/export\s+const\s+generateMetadata\b[^=]*=/);
  if (!fnM) return { found: false, objects, text };
  let k = fnM.index + fnM[0].length;
  if (mask[k - 1] === "(") {
    const close = matchClose(mask, k - 1);
    k = close + 1;
  } else {
    const arrow = mask.indexOf("=>", k);
    k = arrow < 0 ? mask.length : arrow + 2;
  }
  const open = mask.indexOf("{", k);
  const end = open < 0 ? -1 : matchClose(mask, open);
  if (end < 0) return { found: true, objects, text };
  const body = mask.slice(open, end + 1);
  text = code.slice(open, end + 1);
  for (const r of body.matchAll(/\breturn\s*\{/g)) {
    const o = open + r.index + r[0].length - 1;
    const c = matchClose(mask, o);
    if (c > 0) objects.push([o, c]);
  }
  return { found: true, objects, text };
}

const NOINDEX_RE = /\brobots\s*:\s*(?:\{[^}]*\bindex\s*:\s*false\b|["'`][^"'`]*\bnoindex\b)/;

/** Which of title / description / alternates.canonical the best metadata object sets. */
function seoKeys(lexed, objects) {
  let best = { title: false, description: false, canonical: false };
  const score = (b) => Number(b.title) + Number(b.description) + Number(b.canonical);
  for (const [o, c] of objects) {
    const keys = objectKeys(lexed, o, c);
    let canonical = false;
    if (keys.has("alternates")) {
      const alt = objectAt(lexed, keys.get("alternates"));
      canonical = Boolean(alt && objectKeys(lexed, alt[0], alt[1]).has("canonical"));
    }
    const cur = { title: keys.has("title"), description: keys.has("description"), canonical };
    if (score(cur) > score(best)) best = cur;
  }
  return best;
}

// ---------------------------------------------------------------- routes

const PAGE_RE = /^page\.(tsx|ts|jsx|js)$/;

function* walk(dir) {
  for (const name of readdirSync(dir).sort()) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) yield* walk(full);
    else yield full;
  }
}

/** Every page under src/app: { file, segments (URL segments, null if private), dynamic } */
function listRoutes(root) {
  const appDir = join(root, "src", "app");
  const routes = [];
  for (const full of walk(appDir)) {
    const name = full.slice(full.lastIndexOf(sep) + 1);
    if (!PAGE_RE.test(name)) continue;
    const dirs = relative(appDir, dirname(full)).split(sep).filter(Boolean);
    if (dirs.some((d) => d.startsWith("_"))) continue; // private folder: not routable
    const segments = dirs.filter((d) => !/^\(.*\)$/.test(d) && !d.startsWith("@"));
    routes.push({
      file: relative(root, full).split(sep).join("/"),
      segments,
      path: `/${segments.join("/")}`,
      dynamic: segments.some((s) => s.startsWith("[")),
    });
  }
  return routes;
}

// ---------------------------------------------------------------- catalogue

function readGames(lexed) {
  const { mask, code } = lexed;
  const m = mask.match(/export\s+const\s+games\b[^=]*=\s*\[/);
  if (!m) return null;
  const open = m.index + m[0].length - 1;
  const close = matchClose(mask, open);
  const games = [];
  let depth = 0;
  for (let k = open + 1; k < close; k += 1) {
    const ch = mask[k];
    if (ch === "{" && depth === 0) {
      const c = matchClose(mask, k);
      const keys = objectKeys(lexed, k, c);
      const val = (key) => (keys.has(key) ? stringAt(lexed, keys.get(key)) : undefined);
      const hidden = keys.has("hidden") && /^\s*true\b/.test(code.slice(keys.get("hidden")));
      games.push({
        id: val("id"),
        urlPath: val("urlPath"),
        hasSeo: keys.has("seoDescription"),
        seoDescription: val("seoDescription"),
        hidden,
      });
      k = c;
      continue;
    }
    if (OPEN[ch]) depth += 1;
    else if (CLOSE.has(ch)) depth -= 1;
  }
  return games;
}

const VISIBLE_RE = /export\s+const\s+visibleGames\b[^=]*=\s*games\s*\.\s*filter\s*\(\s*\(?\s*([A-Za-z_$][\w$]*)\s*\)?\s*=>\s*!\s*\1\s*\.\s*hidden\s*\)/;

// ---------------------------------------------------------------- the check

/**
 * @param {{ root: string }} opts repo root (or a fixture tree with the same layout)
 * @returns {{ violations: Array<{ rule: string, file: string, message: string }>, routes: number, games: number }}
 */
export function checkSeo({ root }) {
  const violations = [];
  const add = (rule, file, message) => violations.push({ rule, file, message });
  const read = (rel) => {
    const p = join(root, ...rel.split("/"));
    return existsSync(p) ? readFileSync(p, "utf8") : null;
  };

  // expectedNoindex
  const CONFIG = "scripts/seo/config.json";
  let expectedNoindex = [];
  try {
    expectedNoindex = JSON.parse(read(CONFIG) ?? "{}").expectedNoindex ?? [];
  } catch (e) {
    add("SEO-1", CONFIG, `cannot read expectedNoindex: ${e.message}`);
  }

  // sitemap
  const SITEMAP = "src/app/sitemap.ts";
  const sitemapSrc = read(SITEMAP);
  const sitemap = sitemapSrc === null ? null : lex(sitemapSrc);
  const sitemapPaths = new Set();
  const sitemapStrings = new Set();
  if (!sitemap) add("SEO-1", SITEMAP, "missing; every indexable page must be listed in a sitemap");
  else {
    for (const tok of sitemap.strings.values()) {
      sitemapStrings.add(tok.raw);
      if (tok.quote !== "`" && /^\/[^\s]*$/.test(tok.raw)) sitemapPaths.add(tok.raw);
      if (tok.quote === "`") {
        const t = tok.raw.match(/^\$\{\s*SITE_URL\s*\}(\/[^$\s]*)$/) || tok.raw.match(/^(\/[^$\s]*)$/);
        if (t) sitemapPaths.add(t[1]);
      }
    }
  }
  const inSitemap = (p) => sitemapPaths.has(p) || (p !== "/" && sitemapPaths.has(`${p}/`));

  // root layout
  const LAYOUT = "src/app/layout.tsx";
  const layoutSrc = read(LAYOUT);
  const layout = layoutSrc === null ? null : lex(layoutSrc);
  let layoutKeys = new Map();
  if (layout) {
    if (/\b(alternates|canonical)\b/.test(layout.mask)) {
      add("SEO-2", LAYOUT, "the root layout sets alternates/canonical; every page would inherit it (each page sets its own)");
    }
    const meta = metadataOf(layout);
    if (meta.objects[0]) layoutKeys = objectKeys(layout, ...meta.objects[0]);
  }

  // routes
  const routes = listRoutes(root);
  const noindexRoutes = new Set();
  const gameRoutes = routes.filter((r) => r.segments.length === 1 && /^\[[^.\]]+\]$/.test(r.segments[0]));
  for (const r of routes) {
    const lexed = lex(read(r.file));
    const meta = metadataOf(lexed);
    const noindex = NOINDEX_RE.test(meta.text);
    const isGame = gameRoutes.includes(r);

    for (const s of r.segments) {
      if (!s.startsWith("[") && !SEGMENT_RE.test(s)) {
        add("SEO-5", r.file, `route directory "${s}" must be lowercase and hyphen-separated (${SEGMENT_RE.source})`);
      }
    }

    if (noindex) {
      if (isGame) add("SEO-1", r.file, "the game route must be indexable: its URLs are the visible games in the sitemap");
      if (!r.dynamic) {
        noindexRoutes.add(r.path);
        if (!expectedNoindex.includes(r.path)) add("SEO-1", r.file, `noindex page ${r.path} is not in expectedNoindex (${CONFIG})`);
        if (inSitemap(r.path)) add("SEO-3", SITEMAP, `lists "${r.path}", a noindex page (${r.file})`);
      }
      continue;
    }

    // indexable
    if (r.dynamic && !isGame) {
      add("SEO-1", r.file, `dynamic route ${r.path} is indexable but check:seo cannot match it to the sitemap; make it noindex or teach scripts/check-seo.mjs its sitemap source`);
    } else if (!r.dynamic && !inSitemap(r.path)) {
      add("SEO-1", r.file, `indexable page ${r.path} is neither in ${SITEMAP} nor noindex (robots: { index: false } + expectedNoindex)`);
    }
    const got = seoKeys(lexed, meta.objects);
    if (r.path === "/") {
      got.title ||= layoutKeys.has("title");
      got.description ||= layoutKeys.has("description");
    }
    const missing = [!got.title && "title", !got.description && "description", !got.canonical && "alternates.canonical"].filter(Boolean);
    if (missing.length) {
      const how = meta.found ? "its metadata" : "a metadata/generateMetadata export";
      add("SEO-2", r.file, `indexable page ${r.path} has no ${missing.join(", ")} in ${how}`);
    }
  }

  for (const p of expectedNoindex) {
    if (!noindexRoutes.has(p)) add("SEO-1", CONFIG, `expectedNoindex lists "${p}", which is not a noindex page under src/app`);
  }

  // catalogue
  const CATALOGUE = "src/utils/GameUtils.tsx";
  const catSrc = read(CATALOGUE);
  let checkedGames = 0;
  if (catSrc !== null) {
    const cat = lex(catSrc);
    if (!VISIBLE_RE.test(cat.code)) {
      add("SEO-1", CATALOGUE, "visibleGames is no longer `games.filter((g) => !g.hidden)`; update scripts/check-seo.mjs to the new visibility rule");
    }
    const games = readGames(cat);
    if (!games) add("SEO-1", CATALOGUE, "cannot find `export const games = [ … ]`");
    const seen = new Map();
    for (const g of games || []) {
      if (g.hidden) continue;
      if (g.id === "coming-soon") {
        // its own noindex page; the sitemap must exclude it from the game URLs
        if (sitemap && noindexRoutes.has(g.urlPath) && !sitemapStrings.has(g.id) && !sitemapStrings.has(g.urlPath)) {
          add("SEO-3", SITEMAP, `the game URLs include "${g.urlPath}", a noindex page; filter out "${g.id}"`);
        }
        continue;
      }
      checkedGames += 1;
      const label = `game "${g.id ?? "?"}"`;
      if (typeof g.urlPath !== "string" || !URL_RE.test(g.urlPath)) {
        add("SEO-5", CATALOGUE, `${label} urlPath ${JSON.stringify(g.urlPath ?? null)} must match ${URL_RE.source}`);
      }
      if (!g.hasSeo) {
        add("SEO-4", CATALOGUE, `${label} has no seoDescription (the short description would be the meta description)`);
      } else if (typeof g.seoDescription !== "string") {
        add("SEO-4", CATALOGUE, `${label} seoDescription is not a plain string literal; check:seo cannot read it`);
      } else {
        const len = [...g.seoDescription].length;
        if (len < DESC_MIN || len > DESC_MAX) add("SEO-4", CATALOGUE, `${label} seoDescription is ${len} characters (${DESC_MIN}–${DESC_MAX})`);
        if (seen.has(g.seoDescription)) add("SEO-4", CATALOGUE, `${label} has the same seoDescription as "${seen.get(g.seoDescription)}"`);
        else seen.set(g.seoDescription, g.id);
      }
    }
  }

  if (sitemap && !/\bvisibleGames\b/.test(sitemap.mask) && checkedGames > 0) {
    add("SEO-1", SITEMAP, "does not build the game URLs from visibleGames (hidden games would be listed, visible ones may be missing)");
  }

  return { violations, routes: routes.length, games: checkedGames };
}

// ---------------------------------------------------------------- CLI

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const argv = process.argv.slice(2);
  const i = argv.indexOf("--root");
  const root = i >= 0 ? resolve(argv[i + 1]) : join(dirname(fileURLToPath(import.meta.url)), "..");
  const { violations, routes, games } = checkSeo({ root });
  if (violations.length) {
    for (const v of violations) console.error(`${v.rule} ${v.file}: ${v.message}`);
    console.error(`check:seo: ${violations.length} violation(s), see docs/constraints/SEO_CONSTRAINTS.md`);
    process.exit(1);
  }
  console.log(`check:seo: ok (${routes} routes, ${games} games)`);
}
