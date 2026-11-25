// The cost report (docs/team/PIPELINE.md §19): one row per shipped card, read from the commits themselves.
// A shipped card is a commit whose body has a `Notion:` line (the ship skill writes it); its `Cost:` line, when
// it has one, carries the numbers. Older commits have none: their row shows what the commit says (date,
// category, engines) and null for the rest. No number is filled in.
// Pure functions; the only I/O is the `git` function the caller passes to readCommits (tests pass a fake).
import { parseCost, fixRounds, estimateUsd, tokensByModel, modelAlias, GATES } from "./cost.mjs";

export const LOG_FORMAT = "%H%x1f%cI%x1f%s%x1f%b%x1e";
export const ESTIMATE_NOTE = "upper-bound estimate at list input price; the subscription is not billed per token";
const SOURCES = ["ui-check", "logic-check", "check-bug", "security", "seo"];
const NA = "n/a";

/** `git log --format=LOG_FORMAT` output → [{ sha, date, subject, body }] */
export function parseLog(raw) {
  return String(raw || "").split("\x1e").map((rec) => rec.replace(/^\s+/, "")).filter(Boolean).map((rec) => {
    const [sha, date, subject, body] = rec.split("\x1f");
    return { sha, date: date || "", subject: subject || "", body: (body || "").trimEnd() };
  });
}

/**
 * The commits of `ref` (newest first). `git(args)` returns stdout and throws when git fails. When `ref` does
 * not exist and a `fallback` is given, that is read instead. → { ref, commits }
 */
export function readCommits({ ref = "origin/dev", since = null, fallback = null, git }) {
  const exists = (r) => { try { git(["rev-parse", "--verify", "--quiet", `${r}^{commit}`]); return true; } catch { return false; } };
  let used = ref;
  if (!exists(ref)) {
    if (!fallback || !exists(fallback)) throw new Error(`git ref ${ref} does not exist`);
    used = fallback;
  }
  const args = ["log", used, `--format=${LOG_FORMAT}`];
  if (since) args.push(`--since=${since}`);
  return { ref: used, commits: parseLog(git(args)) };
}

/** ISO 8601 week of a `YYYY-MM-DD…` date: { key: "2026-W47", monday: "2026-11-16" }, or null. */
export function isoWeek(date) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(date || ""));
  if (!m) return null;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  if (Number.isNaN(d.getTime())) return null;
  const monday = new Date(d);
  monday.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  const thursday = new Date(monday);
  thursday.setUTCDate(monday.getUTCDate() + 3);
  const year = thursday.getUTCFullYear();
  const week = Math.floor((thursday - Date.UTC(year, 0, 1)) / (7 * 86400000)) + 1;
  return { key: `${year}-W${String(week).padStart(2, "0")}`, monday: monday.toISOString().slice(0, 10) };
}

/** One commit → one row, or null when the commit is not a shipped card (no `Notion:` line). */
export function rowOf(commit, { registry = null, rates = {} } = {}) {
  const body = String(commit.body || "");
  const notion = /^Notion:[ \t]+(\S+)/m.exec(body);
  if (!notion) return null;
  const subject = String(commit.subject || "").trim();
  const typed = /^([a-z]+)(?:\(([^)]*)\))?!?:\s*(.*)$/i.exec(subject);
  const title = typed ? typed[3] : subject;
  const tag = /^\[([a-z-]+)\]/i.exec(title);
  // the card's own name is the first part of its Notion URL: it names a check card whose subject lost the tag
  const slug = /\/p\/([a-z]+(?:-[a-z]+)?)-/i.exec(notion[1]);
  const source = [tag?.[1], slug?.[1]].map((s) => String(s || "").toLowerCase()).find((s) => SOURCES.includes(s)) || "card";
  const notes = (/## Agent notes([\s\S]*?)(?:\n## |$)/.exec(body) || [])[1] || "";
  const engines = [...new Set([...notes.matchAll(/^- agent:[ \t]*(\S+)/gm)].map((x) => x[1]))];
  const author = /^Co-Authored-By:[ \t]*Claude[ \t]+([^<\n]+?)[ \t]*</mi.exec(body);
  const cost = parseCost(body);
  const date = String(commit.date || "").slice(0, 10);
  return {
    sha: commit.sha, date, week: isoWeek(date)?.key || null,
    type: typed ? typed[1].toLowerCase() : null, title, source,
    category: (/^Category:[ \t]+(.+)$/m.exec(body) || [])[1]?.trim() || null,
    notion: notion[1], engines,
    copyOf: (/^\(cherry picked from commit ([0-9a-f]{7,40})\)/m.exec(body) || [])[1] || null,
    orchestrator: author ? modelAlias(author[1], registry) : null,
    cost,
    tokens: cost ? cost.tokens : null,
    fixRounds: fixRounds(cost),
    estimateUsd: estimateUsd(cost, rates),
  };
}

/** The rows of a commit list. A `cherry-pick -x` copy of a card that is itself in the list is the same ship, not a second one. */
export function rowsOf(commits, opts) {
  const rows = commits.map((c) => rowOf(c, opts)).filter(Boolean);
  const shas = rows.map((r) => String(r.sha));
  return rows.filter((r) => !(r.copyOf && shas.some((sha) => sha !== r.sha && sha.startsWith(r.copyOf))));
}

const sumKnown = (values) => { const known = values.filter((v) => v !== null && v !== undefined); return known.length ? known.reduce((a, b) => a + b, 0) : null; };

function groupTotals(key, rows) {
  const costed = rows.filter((r) => r.cost);
  const rounds = costed.map((r) => r.fixRounds).filter((n) => n !== null);
  return {
    key, cards: rows.length, withCost: costed.length,
    tokens: sumKnown(rows.map((r) => r.tokens)),
    estimateUsd: sumKnown(rows.map((r) => r.estimateUsd)),
    // both over the cards whose line has fix rounds: an older commit says nothing about them
    fixShare: rounds.length ? rounds.filter((n) => n > 0).length / rounds.length : null,
    meanFix: rounds.length ? rounds.reduce((a, b) => a + b, 0) / rounds.length : null,
    fixCards: rounds.length, fixTotal: rounds.length ? rounds.reduce((a, b) => a + b, 0) : null,
  };
}

function groupBy(rows, keyOf, order) {
  const groups = new Map();
  for (const r of rows) { const k = keyOf(r) ?? NA; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(r); }
  return [...groups].map(([k, list]) => groupTotals(k, list)).sort(order);
}

/** Totals over rows: the whole set, per category, per engine model, per ISO week, and tokens per model. */
export function summarize(rows) {
  const byCount = (a, b) => b.cards - a.cards || String(a.key).localeCompare(String(b.key));
  const perModel = new Map();
  for (const r of rows) for (const [model, tokens] of Object.entries(tokensByModel(r.cost) || {})) perModel.set(model, (perModel.get(model) || 0) + tokens);
  return {
    ...groupTotals("all", rows),
    byCategory: groupBy(rows, (r) => r.category, byCount),
    byModel: groupBy(rows, (r) => r.cost?.engine, byCount),
    byWeek: groupBy(rows, (r) => r.week, (a, b) => String(b.key).localeCompare(String(a.key))),
    tokensByModel: [...perModel].map(([key, tokens]) => ({ key, tokens })).sort((a, b) => b.tokens - a.tokens || a.key.localeCompare(b.key)),
  };
}

// ---------- text ----------

const fmtInt = (n) => (n === null || n === undefined ? NA : String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ","));
const fmtUsd = (n) => (n === null || n === undefined ? NA : `$${n.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ",")}`);
const fmtPct = (n) => (n === null || n === undefined ? NA : `${Math.round(n * 100)}%`);
const fmtMean = (n) => (n === null || n === undefined ? NA : n.toFixed(1));
const fmtFix = (cost) => (cost?.fix ? GATES.map((g) => `${g[0]}${cost.fix[g]}`).join(" ") : NA);
const compact = (n) => {
  if (n === null || n === undefined) return NA;
  if (n >= 1e9) return `${(n / 1e9).toFixed(n >= 1e10 ? 0 : 1)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(n >= 1e7 ? 0 : 1)}M`;
  if (n >= 1e4) return `${Math.round(n / 1e3)}K`;
  return fmtInt(n);
};
const or = (v) => (v === null || v === undefined || v === "" ? NA : String(v));
const cut = (s, n) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

const TOTAL_HEAD = ["Cards", "With cost", "Tokens", "Est. $", "Any fix round", "Mean fix rounds"];
const totalCells = (g) => [String(g.cards), String(g.withCost), fmtInt(g.tokens), fmtUsd(g.estimateUsd), fmtPct(g.fixShare), fmtMean(g.meanFix)];

/** The report as markdown: the cards table, then totals per category, per engine model and per ISO week. */
export function renderMarkdown(rows, meta = {}) {
  const sum = summarize(rows);
  const cell = (v) => String(v).replace(/\|/g, "\\|").replace(/\s+/g, " ");
  const table = (head, lines) => [`| ${head.join(" | ")} |`, `|${head.map(() => "---").join("|")}|`, ...lines.map((l) => `| ${l.map(cell).join(" | ")} |`)].join("\n");
  const totals = (name, groups) => `## Per ${name}\n\n${table([name[0].toUpperCase() + name.slice(1), ...TOTAL_HEAD], groups.map((g) => [g.key, ...totalCells(g)]))}`;
  return [
    `# Team pipeline cost ledger`,
    ``,
    `${meta.ref ? `\`${meta.ref}\`` : "git log"}${meta.since ? ` since ${meta.since}` : ""}: ${sum.cards} cards shipped, ${sum.withCost} with a \`Cost:\` line, ${fmtInt(sum.tokens)} tokens, ${fmtUsd(sum.estimateUsd)} (${ESTIMATE_NOTE}).`,
    `Commits from before the ledger carry no numbers: they show ${NA}, nothing is filled in. Tokens count the agents a run spawned, not the orchestrator session. Fix = rounds at verify / qa / review.`,
    ``,
    table(
      ["Date", "Commit", "Title", "Source", "Category", "Engines", "Tier", "Model", "Spawns", "Tokens", "Fix", "Min", "Est. $"],
      rows.map((r) => [r.date || NA, String(r.sha || "").slice(0, 7), cut(r.title, 64), r.source, or(r.category), r.engines.join(", ") || NA,
        or(r.cost?.tier), or(r.cost?.engine), fmtInt(r.cost?.spawns), fmtInt(r.tokens), fmtFix(r.cost), fmtInt(r.cost?.minutes), fmtUsd(r.estimateUsd)]),
    ),
    ``,
    totals("category", sum.byCategory),
    ``,
    totals("engine model", sum.byModel),
    ``,
    totals("ISO week", sum.byWeek),
    ``,
  ].join("\n");
}

// ---------- html ----------

export const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const f1 = (n) => (Math.round(n * 10) / 10).toString();

const CSS = `
:root{color-scheme:dark;--page:#0b0b0b;--surface:#191919;--ink:#efefef;--ink-2:#9c9c9c;--grid:#303030;--axis:#474747;--border:rgba(255,255,255,.10);--series:#338ced;--wash:rgba(255,255,255,.05)}
@media (prefers-color-scheme: light){:root{color-scheme:light;--page:#f9f9f9;--surface:#ffffff;--ink:#191919;--ink-2:#666666;--grid:#e7e7e7;--axis:#c2c2c2;--border:rgba(11,11,11,.10);--series:#257de0;--wash:rgba(11,11,11,.04)}}
*{box-sizing:border-box}
body{margin:0;background:var(--page);color:var(--ink);font:14px/1.45 system-ui,-apple-system,"Segoe UI",sans-serif}
main{max-width:1320px;margin:0 auto;padding:24px 16px 48px}
h1{font-size:22px;margin:0 0 4px}h2{font-size:16px;margin:32px 0 12px}h3{font-size:14px;margin:0}
.sub,.note,figcaption p,.empty{color:var(--ink-2);margin:0}
.note{margin-top:12px;max-width:80ch}
.tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;margin-top:20px}
.tile,.card{background:var(--surface);border:1px solid var(--border);border-radius:8px;padding:14px 16px}
.tile .label{color:var(--ink-2);font-size:13px}.tile .value{font-size:28px;font-weight:600;line-height:1.2;margin-top:2px}.tile .hint{color:var(--ink-2);font-size:12px}
.charts,.totals{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:12px}
.totals{grid-template-columns:repeat(auto-fit,minmax(min(100%,560px),1fr));align-items:start}
.card{margin:0;min-width:0}figcaption{margin-bottom:8px}.card svg{display:block;width:100%;height:auto}.empty{padding:24px 0}
svg text{font:11px system-ui,-apple-system,"Segoe UI",sans-serif;fill:var(--ink-2)}svg text.val{fill:var(--ink);font-variant-numeric:tabular-nums}
.grid{stroke:var(--grid);stroke-width:1}.axis{stroke:var(--axis);stroke-width:1}.bar{fill:var(--series)}.hit{fill:transparent}
.mark{outline:none;cursor:default}.mark:hover .bar,.mark:focus-visible .bar{filter:brightness(1.2)}.mark:focus-visible .hit{stroke:var(--ink-2);stroke-width:1}
.scroll{overflow-x:auto;border:1px solid var(--border);border-radius:8px;background:var(--surface)}
table{border-collapse:collapse;width:100%;font-variant-numeric:tabular-nums}
th,td{padding:8px 8px;text-align:left;border-bottom:1px solid var(--grid);vertical-align:top;white-space:nowrap}
tbody tr:last-child td{border-bottom:0}tbody tr:hover td{background:var(--wash)}
th{color:var(--ink-2);font-weight:500;font-size:13px}.total th{white-space:normal;vertical-align:bottom}.num{text-align:right}td.title{white-space:normal;min-width:220px}td.wrap{white-space:normal}td.na{color:var(--ink-2)}
th button{all:unset;cursor:pointer;display:inline-flex;gap:4px;align-items:center}th button:focus-visible{outline:2px solid var(--series);outline-offset:2px}
th[aria-sort="ascending"] button::after{content:"\\2191"}th[aria-sort="descending"] button::after{content:"\\2193"}
.bar-row{display:flex;gap:12px;align-items:center;flex-wrap:wrap;margin-bottom:12px}
#filter{flex:1 1 220px;max-width:360px;padding:8px 10px;border-radius:6px;border:1px solid var(--axis);background:var(--surface);color:var(--ink);font:inherit}
#count{color:var(--ink-2)}code{font:12px ui-monospace,SFMono-Regular,Menlo,monospace}
#tip{position:fixed;z-index:10;pointer-events:none;background:var(--surface);border:1px solid var(--axis);border-radius:6px;padding:6px 8px;font-size:12px;box-shadow:0 4px 14px rgba(0,0,0,.3);max-width:240px}
#tip b{display:block;font-size:13px}#tip span{color:var(--ink-2)}
`;

const SCRIPT = `
(function(){
  var table=document.getElementById('cards');
  if(table){
    var body=table.tBodies[0],rows=Array.prototype.slice.call(body.rows),heads=Array.prototype.slice.call(table.tHead.rows[0].cells);
    var filter=document.getElementById('filter'),count=document.getElementById('count');
    function show(){var q=filter.value.trim().toLowerCase(),n=0;rows.forEach(function(tr){var ok=!q||tr.textContent.toLowerCase().indexOf(q)>=0;tr.hidden=!ok;if(ok)n++;});count.textContent=n===rows.length?rows.length+' cards':n+' of '+rows.length+' cards';}
    filter.addEventListener('input',show);
    heads.forEach(function(th,i){th.querySelector('button').addEventListener('click',function(){
      var num=th.getAttribute('data-type')==='num',dir=th.getAttribute('aria-sort')==='ascending'?-1:1;
      heads.forEach(function(h){h.removeAttribute('aria-sort');});th.setAttribute('aria-sort',dir>0?'ascending':'descending');
      rows.sort(function(a,b){var x=a.cells[i].getAttribute('data-v'),y=b.cells[i].getAttribute('data-v');
        if(x===''||y==='')return x===y?0:x===''?1:-1;
        return dir*(num?Number(x)-Number(y):x<y?-1:x>y?1:0);});
      rows.forEach(function(tr){body.appendChild(tr);});});});
    show();
  }
  var tip=document.getElementById('tip');
  function place(x,y){tip.hidden=false;var w=tip.offsetWidth,h=tip.offsetHeight;tip.style.left=Math.max(8,Math.min(x+12,window.innerWidth-w-8))+'px';tip.style.top=Math.max(8,y-h-12)+'px';}
  function fill(m){tip.textContent='';var b=document.createElement('b'),s=document.createElement('span');b.textContent=m.getAttribute('data-value');s.textContent=m.getAttribute('data-label');tip.appendChild(b);tip.appendChild(s);}
  Array.prototype.forEach.call(document.querySelectorAll('.mark'),function(m){
    m.addEventListener('pointermove',function(e){fill(m);place(e.clientX,e.clientY);});
    m.addEventListener('pointerleave',function(){tip.hidden=true;});
    m.addEventListener('focus',function(){fill(m);var r=m.getBoundingClientRect();place(r.left+r.width/2,r.top);});
    m.addEventListener('blur',function(){tip.hidden=true;});
  });
})();
`;

const mark = (label, value, inner) => `<g class="mark" tabindex="0" role="img" aria-label="${esc(`${label}: ${value}`)}" data-label="${esc(label)}" data-value="${esc(value)}">${inner}</g>`;
const figure = (title, subtitle, inner) => `<figure class="card"><figcaption><h3>${esc(title)}</h3><p>${esc(subtitle)}</p></figcaption>${inner}</figure>`;
const EMPTY = `<p class="empty">No cost data in this range yet.</p>`;

// A whole-number axis step that gives about four gridlines.
const niceStep = (top) => {
  if (top <= 4) return 1;
  const raw = top / 4, p = 10 ** Math.floor(Math.log10(raw)), f = raw / p;
  return (f > 5 ? 10 : f > 2 ? 5 : f > 1 ? 2 : 1) * p;
};

/** Columns over time. items: [{ label, value, tip, text }] */
function columnChart(title, subtitle, items) {
  if (!items.length) return figure(title, subtitle, EMPTY);
  const W = 360, H = 190, L = 30, R = 8, T = 18, B = 24;
  const top = Math.max(1, ...items.map((i) => i.value));
  const step = niceStep(top);
  const max = Math.ceil(top / step) * step;
  const band = (W - L - R) / items.length;
  const w = Math.max(2, Math.min(24, band - 4));
  const y = (v) => T + (H - T - B) * (1 - v / max);
  const ticks = [];
  for (let v = 0; v <= max; v += step) ticks.push(v);
  const every = Math.ceil(items.length / 6);
  const parts = ticks.map((v) => `<line class="${v ? "grid" : "axis"}" x1="${L}" x2="${W - R}" y1="${f1(y(v))}" y2="${f1(y(v))}"/><text x="${L - 6}" y="${f1(y(v) + 4)}" text-anchor="end">${compact(v)}</text>`);
  items.forEach((it, i) => {
    const x = L + band * i + (band - w) / 2, yt = y(it.value), yb = y(0), r = Math.min(4, w / 2, yb - yt);
    const bar = it.value > 0 ? `<path class="bar" d="M${f1(x)} ${f1(yb)}V${f1(yt + r)}Q${f1(x)} ${f1(yt)} ${f1(x + r)} ${f1(yt)}H${f1(x + w - r)}Q${f1(x + w)} ${f1(yt)} ${f1(x + w)} ${f1(yt + r)}V${f1(yb)}Z"/>` : "";
    const cap = it.value > 0 && items.length <= 12 ? `<text class="val" x="${f1(x + w / 2)}" y="${f1(yt - 5)}" text-anchor="middle">${esc(it.text)}</text>` : "";
    const tick = i % every === 0 ? `<text x="${f1(x + w / 2)}" y="${H - 7}" text-anchor="middle">${esc(it.label)}</text>` : "";
    parts.push(mark(it.tip, it.text, `<rect class="hit" x="${f1(L + band * i)}" y="${T}" width="${f1(band)}" height="${H - T - B}"/>${bar}${cap}`) + tick);
  });
  return figure(title, subtitle, `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(title)}">${parts.join("")}</svg>`);
}

/** Horizontal bars, one per name. items: [{ label, value, tip, text }] */
function barChart(title, subtitle, items) {
  if (!items.length) return figure(title, subtitle, EMPTY);
  const W = 360, L = 92, R = 64, ROW = 30, T = 4, THICK = 16;
  const max = Math.max(...items.map((i) => i.value)) || 1;
  const H = T + ROW * items.length + 4;
  const parts = [`<line class="axis" x1="${L}" x2="${L}" y1="${T}" y2="${H - 4}"/>`];
  items.forEach((it, i) => {
    const yy = T + ROW * i + (ROW - THICK) / 2, w = ((W - L - R) * it.value) / max, r = Math.min(4, w, THICK / 2);
    const bar = w > 0 ? `<path class="bar" d="M${L} ${f1(yy)}H${f1(L + w - r)}Q${f1(L + w)} ${f1(yy)} ${f1(L + w)} ${f1(yy + r)}V${f1(yy + THICK - r)}Q${f1(L + w)} ${f1(yy + THICK)} ${f1(L + w - r)} ${f1(yy + THICK)}H${L}Z"/>` : "";
    parts.push(`<text x="${L - 8}" y="${f1(yy + THICK / 2 + 4)}" text-anchor="end">${esc(cut(it.label, 14))}</text>`
      + mark(it.tip, it.text, `<rect class="hit" x="${L}" y="${f1(T + ROW * i)}" width="${W - L}" height="${ROW}"/>${bar}<text class="val" x="${f1(L + w + 6)}" y="${f1(yy + THICK / 2 + 4)}">${esc(it.text)}</text>`));
  });
  return figure(title, subtitle, `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(title)}">${parts.join("")}</svg>`);
}

/** The last `n` ISO weeks up to the newest row, weeks without a card included. */
function weekSeries(rows, n = 12) {
  const dates = rows.map((r) => r.date).filter(Boolean).sort();
  const newest = isoWeek(dates[dates.length - 1]);
  if (!newest) return [];
  const counts = new Map();
  for (const r of rows) if (r.week) counts.set(r.week, (counts.get(r.week) || 0) + 1);
  const oldest = isoWeek(dates[0]);
  const out = [];
  for (let i = 0, d = new Date(`${newest.monday}T00:00:00Z`); i < n; i++, d.setUTCDate(d.getUTCDate() - 7)) {
    const wk = isoWeek(d.toISOString());
    if (wk.key < oldest.key) break;
    const v = counts.get(wk.key) || 0;
    out.unshift({ label: wk.key.slice(5), value: v, text: String(v), tip: `${wk.key}, week of ${wk.monday}` });
  }
  return out;
}

/**
 * The report as one self-contained HTML page (inline CSS and script, no external request).
 * meta: { ref, since, generatedAt, rates } — all optional; `rates` = { alias: USD per million input tokens }.
 */
export function renderHtml(rows, meta = {}) {
  const sum = summarize(rows);
  const td = (text, { v = String(text).toLowerCase(), cls = "" } = {}) => `<td class="${[cls, text === NA ? "na" : ""].filter(Boolean).join(" ")}" data-v="${esc(text === NA ? "" : v)}">${esc(text)}</td>`;
  const n = (value, text) => td(text, { v: value === null || value === undefined ? "" : String(value), cls: "num" });
  const COLS = [["Date"], ["Commit"], ["Title"], ["Source"], ["Category"], ["Engines"], ["Tier"], ["Model"], ["Spawns", 1], ["Tokens", 1], ["Fix rounds", 1], ["Minutes", 1], ["Est. $", 1]];
  const cardRows = rows.map((r) => `<tr>${[
    td(r.date || NA), `<td data-v="${esc(r.sha)}"><code>${esc(String(r.sha || "").slice(0, 7))}</code></td>`, td(r.title, { cls: "title" }), td(r.source),
    td(or(r.category)), td(r.engines.join(", ") || NA, { cls: "wrap" }), td(or(r.cost?.tier)), td(or(r.cost?.engine)),
    n(r.cost?.spawns, fmtInt(r.cost?.spawns)), n(r.tokens, fmtInt(r.tokens)),
    `<td class="num${r.fixRounds === null ? " na" : ""}" data-v="${r.fixRounds ?? ""}" title="${esc(r.cost?.fix ? GATES.map((g) => `${g} ${r.cost.fix[g]}`).join(", ") : "")}">${esc(fmtInt(r.fixRounds))}</td>`,
    n(r.cost?.minutes, fmtInt(r.cost?.minutes)), n(r.estimateUsd, fmtUsd(r.estimateUsd)),
  ].join("")}</tr>`);
  const totals = (name, groups) => `<div class="scroll"><table class="total"><thead><tr><th>${esc(name)}</th>${TOTAL_HEAD.map((h) => `<th class="num">${esc(h)}</th>`).join("")}</tr></thead><tbody>${
    groups.map((g) => `<tr><td>${esc(g.key)}</td>${totalCells(g).map((c) => `<td class="num${c === NA ? " na" : ""}">${esc(c)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
  const tile = (label, value, hint) => `<div class="tile"><div class="label">${esc(label)}</div><div class="value">${esc(value)}</div><div class="hint">${esc(hint)}</div></div>`;
  const weeks = weekSeries(rows);
  const fixGroups = sum.byCategory.filter((g) => g.meanFix !== null);
  const rates = Object.entries(meta.rates || {}).map(([m, usd]) => `${m} $${usd}`).join(", ");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Pipeline cost ledger</title>
<style>${CSS}</style>
</head>
<body>
<main>
<header>
<h1>Pipeline cost ledger</h1>
<p class="sub">${esc([meta.ref ? `Cards shipped on ${meta.ref}` : "Cards shipped", meta.since ? `since ${meta.since}` : "", meta.generatedAt ? `generated ${meta.generatedAt}` : ""].filter(Boolean).join(" · "))}</p>
</header>
<section class="tiles" aria-label="Summary">
${tile("Cards shipped", fmtInt(sum.cards), "commits with a Notion line")}
${tile("Cards with cost data", fmtInt(sum.withCost), sum.cards ? `${fmtPct(sum.withCost / sum.cards)} of the cards` : "no cards in range")}
${tile("Total tokens", compact(sum.tokens), sum.tokens === null ? "no card reported tokens" : `${fmtInt(sum.tokens)} over the agents spawned`)}
${tile("Estimated $", fmtUsd(sum.estimateUsd), "upper bound, list input price")}
</section>
<p class="note">Dollars are an ${esc(ESTIMATE_NOTE)}.${rates ? ` Rates per million tokens: ${esc(rates)}.` : ""} Tokens count the agents a run spawned, not the orchestrator session. Commits from before the ledger carry no numbers: they show ${NA}, and nothing is filled in.</p>
<h2>Charts</h2>
<section class="charts">
${columnChart("Cards shipped per week", weeks.length ? `ISO weeks ${weeks[0].label} to ${weeks[weeks.length - 1].label}` : "ISO weeks", weeks)}
${barChart("Tokens by model", "Sum over the spawns that reported a number", sum.tokensByModel.map((m) => ({ label: m.key, value: m.tokens, text: compact(m.tokens), tip: `${m.key}: ${fmtInt(m.tokens)} tokens` })))}
${barChart("Fix rounds per card, by category", "Mean over cards with a cost line", fixGroups.map((g) => ({ label: g.key, value: g.meanFix, text: fmtMean(g.meanFix), tip: `${g.key}: ${g.fixTotal} rounds over ${g.fixCards} cards` })))}
</section>
<h2>Totals</h2>
<section class="totals">
${totals("Category", sum.byCategory)}
${totals("Engine model", sum.byModel)}
${totals("ISO week", sum.byWeek)}
</section>
<h2>Cards</h2>
<div class="bar-row"><input id="filter" type="search" placeholder="Filter cards: title, category, model…" aria-label="Filter cards"><span id="count" aria-live="polite">${rows.length} cards</span></div>
<div class="scroll">
<table id="cards">
<thead><tr>${COLS.map(([name, num]) => `<th${num ? ' class="num" data-type="num"' : ' data-type="text"'}><button type="button">${esc(name)}</button></th>`).join("")}</tr></thead>
<tbody>
${cardRows.join("\n")}
</tbody>
</table>
</div>
</main>
<div id="tip" role="status" hidden></div>
<script>${SCRIPT}</script>
</body>
</html>
`;
}
