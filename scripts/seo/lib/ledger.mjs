// The per-URL ledger (spec §6): what the audit found, what Google's index says, what the owner asked Google for and
// what the last run decided, per URL; plus the data ages and the last 52 runs. It lives on the public `checks-state`
// branch as seo/ledger.json (lib/store.mjs; merged by check-core/lib/state-merge.mjs mergeSeoLedger), so it holds
// coverage only: no Search Analytics field (clicks, impressions, queries) ever enters it. Pure: no I/O, every function
// returns a new ledger.
//
//   { dataAsOf: { audit, gsc, indexnow },
//     urls: { [url]: { inSitemap, expectNoindex, audit: { runId, pass, fail }, gsc: { …Inspection, inspectedAt },
//                      requests: [{ at, by, note }], indexnow: { lastPingAt, status }, decision: { runId, kind, ref, recheckAfter } } },
//     history: [{ runId, at, status, indexed, notIndexed, failedChecks, cards }] }
import { toBaseline } from './digest.mjs';
import { IX_IDS } from '../audit.mjs';
import { lastSundayMidnight, parisParts } from '../../check-core/lib/weekly-slot.mjs';

/** @typedef {{ dataAsOf: { audit: string|null, gsc: string|null, indexnow: string|null }, urls: Record<string, object>, history: object[] }} Ledger */

const HOUR = 3_600_000;
const iso = (t) => new Date(t).toISOString();
/** The Inspection fields the ledger keeps (anything else a caller passes is dropped). */
const GSC_FIELDS = ['verdict', 'coverageState', 'indexingState', 'pageFetchState', 'robotsTxtState', 'lastCrawlTime',
  'googleCanonical', 'userCanonical', 'crawledAs', 'richResults', 'inspectedAt', 'link'];
const DECISION_RANK = { card: 3, owner: 2, wait: 1, none: 0 };

/** @returns {Ledger} */
export function emptyLedger() {
  return { dataAsOf: { audit: null, gsc: null, indexnow: null }, urls: {}, history: [] };
}

const emptyEntry = () => ({ inSitemap: null, expectNoindex: null, audit: null, gsc: null, requests: [], indexnow: null, decision: null });
const copy = (ledger) => {
  const l = structuredClone(ledger ?? emptyLedger());
  l.dataAsOf = { ...emptyLedger().dataAsOf, ...l.dataAsOf };
  l.urls ??= {};
  l.history ??= [];
  return l;
};
const entryOf = (l, url) => (l.urls[url] ??= emptyEntry());
const sorted = (ids) => [...new Set(ids)].sort();

/**
 * Merges an AuditResult (Task 3's results.json) into the ledger. Each URL's failing ids are toBaseline()'s (site-wide
 * failures on the URL they name), so baselineFrom() hands the next audit what that run's baseline.json says. A full
 * run sets `audit` to { runId, pass: every IX id not failing, fail }; a subset run (`only`) changes only its `only`
 * ids in the pass/fail sets already there. `expectNoindex`: the config's expectedNoindex (paths or URLs); every
 * audited page is the home page, a sitemap URL or one of those, so `inSitemap` = not an expected-noindex page.
 * @param {Ledger} ledger
 * @param {object} result an AuditResult
 * @param {{ expectNoindex?: string[], now?: number }} [opts]
 * @returns {Ledger}
 */
export function applyAudit(ledger, result, { expectNoindex = [], now = Date.now() } = {}) {
  const l = copy(ledger);
  const noindex = new Set(expectNoindex.map((p) => new URL(p, result.site).href));
  const b = toBaseline(result);
  const failing = result.only ? b.urls : b;
  for (const [url, fail] of Object.entries(failing)) {
    const e = entryOf(l, url);
    if (Object.hasOwn(result.urls, url)) { e.expectNoindex = noindex.has(url); e.inSitemap = !noindex.has(url); }
    if (!result.only) {
      e.audit = { runId: result.runId, pass: IX_IDS.filter((id) => !fail.includes(id)), fail: sorted(fail) };
      continue;
    }
    const keep = (ids) => (ids ?? []).filter((id) => !result.only.includes(id));
    e.audit = {
      runId: result.runId,
      pass: sorted([...keep(e.audit?.pass), ...result.only.filter((id) => !fail.includes(id))]),
      fail: sorted([...keep(e.audit?.fail), ...fail]),
    };
  }
  l.dataAsOf.audit = iso(now);
  return l;
}

/**
 * Merges Search Console inspections ({ [url]: Inspection }, Task 4). A good inspection replaces the URL's `gsc` block
 * (the previous verdict and coverage kept as `gsc.previous`, for the summary); an `{ error }` one keeps the old block
 * and sets `gsc.error` / `gsc.errorAt`. dataAsOf.gsc = the newest good inspection.
 * @returns {Ledger}
 */
export function applyInspections(ledger, inspections) {
  const l = copy(ledger);
  for (const [url, insp] of Object.entries(inspections ?? {})) {
    const e = entryOf(l, url);
    if (insp.error) {
      e.gsc = { ...(e.gsc ?? {}), error: insp.error, errorAt: insp.inspectedAt ?? null };
      continue;
    }
    const gsc = Object.fromEntries(GSC_FIELDS.map((k) => [k, insp[k] ?? null]));
    if (e.gsc?.verdict !== undefined && e.gsc?.inspectedAt) {
      gsc.previous = { verdict: e.gsc.verdict ?? null, coverageState: e.gsc.coverageState ?? null, inspectedAt: e.gsc.inspectedAt };
    }
    e.gsc = gsc;
    if (gsc.inspectedAt && (!l.dataAsOf.gsc || gsc.inspectedAt > l.dataAsOf.gsc)) l.dataAsOf.gsc = gsc.inspectedAt;
  }
  return l;
}

/**
 * Mirrors a run's decisions (Task 6 findings) onto their URLs: decision = { runId, kind, ref: the finding id,
 * recheckAfter }. A URL named by several findings keeps the strongest kind (card > owner > wait > none).
 * @returns {Ledger}
 */
export function applyDecisions(ledger, findings, runId) {
  const l = copy(ledger);
  const set = new Set();
  for (const f of findings ?? []) {
    for (const url of f.urls ?? []) {
      const e = entryOf(l, url);
      const d = { runId, kind: f.decision, ref: f.id, recheckAfter: f.recheckAfter ?? null };
      if (set.has(url) && (DECISION_RANK[e.decision.kind] ?? 0) >= (DECISION_RANK[d.kind] ?? 0)) continue;
      e.decision = d;
      set.add(url);
    }
  }
  return l;
}

/**
 * The owner told the system they asked Google for `url` (`ledger.mjs requested`): appends { at, by, note } to its
 * requests, once per note and UTC day.
 * @returns {Ledger}
 */
export function markRequested(ledger, url, note, { now = Date.now(), by = 'owner' } = {}) {
  const l = copy(ledger);
  const e = entryOf(l, url);
  const at = iso(now);
  if (!e.requests.some((q) => q.note === note && String(q.at).slice(0, 10) === at.slice(0, 10))) e.requests.push({ at, by, note });
  return l;
}

/** The full-run Baseline (Task 3) the ledger implies: { [url]: failing ids } for every URL with an audit block. */
export function baselineFrom(ledger) {
  return Object.fromEntries(Object.entries(ledger?.urls ?? {}).filter(([, e]) => e.audit).map(([u, e]) => [u, sorted(e.audit.fail ?? [])]));
}

const ageText = (at, now) => {
  if (!at) return 'never';
  const h = Math.max(0, Math.floor((now - Date.parse(at)) / HOUR));
  return `${at} (${h < 48 ? `${h} h` : `${Math.floor(h / 24)} d`} ago)`;
};

/**
 * ledger-summary.md: the data ages, the URLs per coverageState, the URLs whose verdict or coverage changed since the
 * previous inspection, the URLs failing any IX check.
 * @returns {string}
 */
export function summary(ledger, { now = Date.now() } = {}) {
  const l = copy(ledger);
  const urls = Object.entries(l.urls).sort(([a], [b]) => a.localeCompare(b));
  const lines = ['# Ledger summary', '', '## Data ages', ...['audit', 'gsc', 'indexnow'].map((k) => `- ${k}: ${ageText(l.dataAsOf[k], now)}`), ''];
  const byState = new Map();
  for (const [, e] of urls) {
    const k = e.gsc?.coverageState ?? (e.gsc ? 'no coverage state' : 'not inspected');
    byState.set(k, (byState.get(k) ?? 0) + 1);
  }
  lines.push('## Coverage', ...([...byState].sort(([a], [b]) => a.localeCompare(b)).map(([k, n]) => `- ${k}: ${n}`)), '');
  const changed = urls.filter(([, e]) => e.gsc?.previous && (e.gsc.previous.verdict !== e.gsc.verdict || e.gsc.previous.coverageState !== e.gsc.coverageState))
    .map(([u, e]) => `- ${u}: ${e.gsc.previous.verdict} → ${e.gsc.verdict} (${e.gsc.previous.coverageState} → ${e.gsc.coverageState})`);
  lines.push('## Changed since the previous inspection', ...(changed.length ? changed : ['- none']), '');
  const failing = urls.filter(([, e]) => e.audit?.fail?.length).map(([u, e]) => `- ${u}: ${e.audit.fail.join(', ')}`);
  lines.push('## Failing IX checks', ...(failing.length ? failing : ['- none']), '');
  return lines.join('\n');
}

export const CSV_COLUMNS = ['url', 'inSitemap', 'auditFail', 'verdict', 'coverageState', 'lastCrawlTime', 'googleCanonical', 'requestedAt', 'decision'];
const cell = (v) => {
  const s = v === null || v === undefined ? '' : String(v);
  return /[",\r\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
};

/** The ledger as CSV (one row per URL, sorted; auditFail space-separated; requestedAt the latest request). */
export function toCsv(ledger) {
  const rows = Object.entries(ledger?.urls ?? {}).sort(([a], [b]) => a.localeCompare(b)).map(([u, e]) => [
    u, e.inSitemap, (e.audit?.fail ?? []).join(' '), e.gsc?.verdict, e.gsc?.coverageState, e.gsc?.lastCrawlTime, e.gsc?.googleCanonical,
    (e.requests ?? []).map((q) => q.at).sort().at(-1), e.decision?.kind,
  ]);
  return [CSV_COLUMNS, ...rows].map((r) => r.map(cell).join(',')).join('\n') + '\n';
}

/** The Paris Monday 00:00 of the week `now` falls in (DST-correct: Paris Sundays have 23, 24 or 25 hours). */
export function lastMondayMidnight(now) {
  const after = (sunday) => {
    const t = sunday + 24 * HOUR;
    const p = parisParts(t);
    return p.wd === 1 ? t - p.hh * HOUR : t + (24 - p.hh) * HOUR;
  };
  const sunday = lastSundayMidnight(now);
  const monday = after(sunday);
  return monday <= now ? monday : after(lastSundayMidnight(sunday - 1));
}

/**
 * What a weekly run starting now would find: 'busy' while another run's lease (seo/lease.json) is unexpired, 'done'
 * when `history` has a run with status 'ok' started since Monday 00:00 Paris time, else 'free'.
 * @param {Ledger} ledger
 * @param {{ holder: string, until: string } | null} leaseDoc
 * @returns {'free'|'busy'|'done'}
 */
export function weeklyStatus(ledger, leaseDoc, { now = Date.now() } = {}) {
  if (leaseDoc?.until && Date.parse(leaseDoc.until) > now) return 'busy';
  const since = lastMondayMidnight(now);
  return (ledger?.history ?? []).some((h) => h.status === 'ok' && Date.parse(h.at) >= since) ? 'done' : 'free';
}
