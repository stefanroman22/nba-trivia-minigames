// Three-way merges for the checks state store (lib/state-store.mjs, branch `checks-state`). Pure: no I/O.
// Every writer (the weekly run on the PC or on GitHub Actions, the live-probe workflow, a skill run) pulls the store,
// works on its own copy, and pushes back only its own changes: base = the store copy it pulled, local = its copy now,
// remote = the store now. Rules per keyed collection:
//   local added a key           → added (local's value wins over a remote value of the same key)
//   local changed a key         → local's value
//   local deleted a key         → deleted, unless remote changed it meanwhile (then remote's value stays)
//   remote deleted a key that local changed → local's value (modify wins over delete: a block that comes back is
//                                 resolved again by the next `resolve`, a block lost would hide a defect)
//   untouched by local          → remote's value (including remote's own adds, changes and deletes)
// A missing local copy means "no local change" (a fresh runner has no files yet), never "delete everything".

/** JSON with sorted object keys: the equality used by every merge. */
export function stable(v) {
  if (Array.isArray(v)) return `[${v.map(stable).join(',')}]`;
  if (v && typeof v === 'object') return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${stable(v[k])}`).join(',')}}`;
  return JSON.stringify(v ?? null);
}
export const same = (a, b) => stable(a) === stable(b);

/** Three-way merge of two keyed lists (see the header). `key(item)` → string. Keeps remote's order, local adds last. */
export function merge3List(base = [], local = base, remote = [], key) {
  const bm = new Map((base || []).map((x) => [key(x), x]));
  const lm = new Map((local || []).map((x) => [key(x), x]));
  const rm = new Map((remote || []).map((x) => [key(x), x]));
  const out = [];
  for (const [k, r] of rm) {
    const l = lm.get(k), b = bm.get(k);
    if (!lm.has(k) && bm.has(k)) { if (!same(b, r)) out.push(r); continue; } // local deleted (kept if remote changed it)
    if (lm.has(k) && (!bm.has(k) || !same(l, b))) { out.push(l); continue; } // local added or changed
    out.push(r);
  }
  for (const [k, l] of lm) {
    if (rm.has(k)) continue;
    if (!bm.has(k) || !same(l, bm.get(k))) out.push(l); // local add, or local change of a key remote deleted
  }
  return out;
}

/** Three-way merge of two maps (plain objects), the same rules per key. */
export function merge3Map(base = {}, local = base, remote = {}) {
  const toList = (o) => Object.entries(o || {}).map(([k, v]) => ({ k, v }));
  const merged = merge3List(toList(base), toList(local), toList(remote), (x) => x.k);
  return Object.fromEntries(merged.map((x) => [x.k, x.v]));
}

/** A whole value (one owner, e.g. the live probes' failure state): local's when it changed, else remote's. */
export function merge3Value(base, local = base, remote) {
  if (local === undefined || same(local, base)) return remote === undefined ? local : remote;
  return local;
}

// channel.json (lib/channel.mjs): blocks per (service, LC id); deferred items per (checker, check, project, LC id,
// since) — `resolvedAt` is a change of that item; resolved blocks per (service, LC id, resolvedAt).
export const CHANNEL_KEYS = {
  blocks: (b) => `${b.service}|${b.by}`,
  deferred: (d) => `${d.checker}|${d.checkId}|${d.project ?? ''}|${d.blockedBy}|${d.since}`,
  resolved: (b) => `${b.service}|${b.by}|${b.resolvedAt}`,
};

export function mergeChannel(base, local, remote) {
  const e = (c) => ({ blocks: c?.blocks || [], deferred: c?.deferred || [], resolved: c?.resolved || [] });
  const b = e(base), l = local === undefined ? b : e(local), r = e(remote);
  const out = {};
  for (const [k, key] of Object.entries(CHANNEL_KEYS)) out[k] = merge3List(b[k], l[k], r[k], key);
  return out;
}

// notion-cards.json (lib/cards-ledger.mjs): the store keeps an entry without its card title and URL (the repo is
// public; the URL is the title as a slug; Notion stays the truth and the card id is enough). Local copies keep theirs.
const PRIVATE_LEDGER_FIELDS = ['title', 'url'];
export function publicEntry(e) {
  if (!e || typeof e !== 'object') return e;
  const o = { ...e };
  for (const f of PRIVATE_LEDGER_FIELDS) delete o[f];
  return o;
}
export const publicLedger = (l) => Object.fromEntries(Object.entries(l || {}).map(([k, v]) => [k, publicEntry(v)]));

/** → { store, local }: the store's ledger (public entries) and the local file (a local entry keeps its title/url
 *  when it says the same as the merged entry). */
export function mergeLedger(base, local, remote) {
  const b = publicLedger(base || {}), r = publicLedger(remote || {});
  const lFull = local === undefined ? null : local || {};
  const l = lFull === null ? b : publicLedger(lFull);
  const store = merge3Map(b, l, r);
  const out = {};
  for (const [k, v] of Object.entries(store)) out[k] = lFull && lFull[k] && same(publicEntry(lFull[k]), v) ? lFull[k] : v;
  return { store, local: out };
}

// seo/ledger.json (scripts/seo/lib/ledger.mjs): `urls` per URL with the rules above. A URL both writers changed is
// merged per field (a request on one side and an inspection on the other both survive); a field both changed takes
// the side whose entry is newer (gsc.inspectedAt, else audit.runId; a tie keeps local's), except `requests`, which is
// the union of both. `dataAsOf` per key → the newest ISO; `history` by runId, oldest first, the last 52 runs.
export const SEO_HISTORY_KEPT = 52;
const requestKey = (q) => `${q.at}|${q.by}|${q.note}`;

function newerSide(l, r) {
  for (const f of [(e) => e?.gsc?.inspectedAt, (e) => e?.audit?.runId]) {
    const a = f(l) ?? '', b = f(r) ?? '';
    if (a !== b) return b > a ? 'remote' : 'local';
  }
  return 'local';
}

function mergeSeoUrl(b = {}, l = {}, r = {}) {
  const side = newerSide(l, r);
  const out = {};
  for (const k of new Set([...Object.keys(b), ...Object.keys(l), ...Object.keys(r)])) {
    const lc = !same(l[k], b[k]), rc = !same(r[k], b[k]);
    let v;
    if (!lc) v = r[k];
    else if (!rc) v = l[k];
    else if (k === 'requests') v = [...new Map([...(l[k] || []), ...(r[k] || [])].map((q) => [requestKey(q), q])).values()].sort((x, y) => String(x.at).localeCompare(String(y.at)));
    else v = side === 'remote' ? r[k] : l[k];
    if (v !== undefined) out[k] = v;
  }
  return out;
}

export function mergeSeoLedger(base, local, remote) {
  if (base === undefined && local === undefined && remote === undefined) return undefined;
  const e = (x) => ({ dataAsOf: x?.dataAsOf || {}, urls: x?.urls || {}, history: x?.history || [] });
  const b = e(base), l = local === undefined ? b : e(local), r = e(remote);
  const urls = merge3Map(b.urls, l.urls, r.urls);
  for (const k of Object.keys(urls)) {
    if (!Object.hasOwn(l.urls, k) || !Object.hasOwn(r.urls, k) || same(l.urls[k], r.urls[k])) continue;
    if (!same(l.urls[k], b.urls[k]) && !same(r.urls[k], b.urls[k])) urls[k] = mergeSeoUrl(b.urls[k], l.urls[k], r.urls[k]);
  }
  const dataAsOf = {};
  for (const k of new Set(['audit', 'gsc', 'indexnow', ...Object.keys(l.dataAsOf), ...Object.keys(r.dataAsOf)])) {
    const vals = [l.dataAsOf[k], r.dataAsOf[k]].filter(Boolean).sort();
    dataAsOf[k] = vals.length ? vals.at(-1) : null;
  }
  const history = merge3List(b.history, l.history, r.history, (h) => h.runId)
    .sort((x, y) => String(x.at ?? '').localeCompare(String(y.at ?? ''))).slice(-SEO_HISTORY_KEPT);
  return { dataAsOf, urls, history };
}
