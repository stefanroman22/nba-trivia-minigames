// The security scan's durable state: one file, findings.json, on the orphan branch `security-state` (never dev or main),
// written through check-core's optimistic store (scripts/check-core/lib/state-store.mjs: fetch → apply → fast-forward
// push, never force), so the weekly run and every PR run share it without clobbering each other.
//
//   { version: 1, entries: { <fingerprint>: Entry }, runs: [ { id, mode, at, slot?, status, new, open, resolved, ticket } ] }
//   Entry: { fp, tool, status: open|resolved|closed, firstSeen, lastSeen, resolvedAt, missed, source: weekly|pr, pr,
//            ticket (Notion page id | null), ticketedAt, details }
//   closed = its ticket was Done but the finding is a secret still in old history: the owner closed it (rotated, history
//   not purged); never re-ticketed. A new leak is a new fingerprint (it hashes the secret).
//
// The repo is public, so an entry carries nothing about the vulnerability in clear (no rule, category, severity, path,
// title or exploit text): `details` is the finding, AES-256-GCM encrypted with SECURITY_STATE_KEY (a repo secret).
// Without the key `details` is null and only fingerprints are kept.
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { storeGit, update } from '../../check-core/lib/state-store.mjs';

export const STATE_BRANCH = 'security-state';
export const STATE_FILE = 'findings.json';
const RUNS_KEPT = 30;
const README = `# security-state

Durable state of the security scan (weekly full scan + PR scans to main): findings.json, one entry per finding
fingerprint (new / open / resolved, its Notion ticket). Details are encrypted with the SECURITY_STATE_KEY secret.
Written only by scripts/security/lib/state.mjs (fast-forward pushes, never force). Do not merge this branch anywhere.
See docs/security/README.md.
`;

const keyOf = (secret) => (secret ? createHash('sha256').update(String(secret)).digest() : null);

export function seal(obj, secret) {
  const key = keyOf(secret);
  if (!key) return null;
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([c.update(JSON.stringify(obj), 'utf8'), c.final()]);
  return `v1:${Buffer.concat([iv, c.getAuthTag(), ct]).toString('base64')}`;
}

export function unseal(text, secret) {
  const key = keyOf(secret);
  if (!key || typeof text !== 'string' || !text.startsWith('v1:')) return null;
  try {
    const buf = Buffer.from(text.slice(3), 'base64');
    const d = createDecipheriv('aes-256-gcm', key, buf.subarray(0, 12));
    d.setAuthTag(buf.subarray(12, 28));
    return JSON.parse(Buffer.concat([d.update(buf.subarray(28)), d.final()]).toString('utf8'));
  } catch { return null; }
}

export const emptyState = () => ({ version: 1, entries: {}, runs: [] });

export function parseState(buf) {
  if (buf === undefined || buf === null) return emptyState();
  try {
    const s = JSON.parse(String(buf).replace(/^﻿/, ''));
    return { version: 1, entries: s.entries && typeof s.entries === 'object' ? s.entries : {}, runs: Array.isArray(s.runs) ? s.runs : [] };
  } catch { return emptyState(); }
}

const iso = (t) => new Date(t).toISOString();
export const MISSED_TO_RESOLVE = 3;

/**
 * The weekly diff of the state against this run's findings (pure).
 *   findings: this run's findings (ignore list applied, confidence ≥ MIN_CONFIDENCE).
 *   stillPresent(entry, details) → true when a finding this run did not report still looks present (its sink line is
 *   still in the file). The model is not deterministic, so such a finding stays open — but only for MISSED_TO_RESOLVE
 *   runs in a row (a fix often adds a guard above an unchanged sink line), and it is never re-ticketed from here.
 *   failedTools: detectors that did not run this time; their entries are left as they are.
 * → { state, fresh: [finding] (to ticket), still: [fp], resolved: [fp] }
 *   fresh = new, reopened after resolved, re-reported after its ticket was Done, or an unticketed PR-recorded finding.
 */
export function reconcile(prev, findings, { now = Date.now(), secret = null, source = 'weekly', pr = null, doneTickets = new Set(), stillPresent = () => false, failedTools = [] } = {}) {
  const state = { ...prev, entries: { ...prev.entries } };
  const seen = new Set();
  const fresh = [], still = [], resolved = [];
  for (const f of findings) {
    seen.add(f.fingerprint);
    const e = state.entries[f.fingerprint];
    const base = { fp: f.fingerprint, tool: f.tool, lastSeen: iso(now), missed: 0, details: seal(f, secret) ?? e?.details ?? null };
    if (e?.status === 'closed') {
      state.entries[f.fingerprint] = { ...e, ...base };
    } else if (!e || e.status === 'resolved') {
      state.entries[f.fingerprint] = { ...base, status: 'open', firstSeen: iso(now), resolvedAt: null, source, pr, ticket: null, ticketedAt: null, ...(e ? { reopened: true } : {}) };
      fresh.push(f);
    } else if (e.ticket && doneTickets.has(e.ticket) && f.tool === 'gitleaks' && f.commit) {
      // a history secret whose ticket is Done: rotated, history not purged — the owner's call, do not nag every week
      state.entries[f.fingerprint] = { ...e, ...base, status: 'closed' };
      still.push(f.fingerprint);
    } else if (!e.ticket || doneTickets.has(e.ticket)) {
      // never ticketed (a PR run recorded it), or re-reported after its ticket went Done (not fixed / regressed)
      state.entries[f.fingerprint] = { ...e, ...base, status: 'open', ticket: null, ticketedAt: null, ...(e.ticket ? { reopened: true } : {}) };
      fresh.push(f);
    } else {
      state.entries[f.fingerprint] = { ...e, ...base };
      still.push(f.fingerprint);
    }
  }
  for (const [fp, e] of Object.entries(state.entries)) {
    if (seen.has(fp) || e.status !== 'open' || failedTools.includes(e.tool)) continue;
    const details = unseal(e.details, secret);
    const missed = (e.missed || 0) + 1;
    if (missed < MISSED_TO_RESOLVE && stillPresent(e, details)) {
      state.entries[fp] = { ...e, missed };
      still.push(fp);
      // a PR-recorded finding never ticketed yet: ticket it from its details (once: it has a ticket afterwards)
      if (!e.ticket && details) fresh.push(details);
    } else {
      state.entries[fp] = { ...e, missed, status: 'resolved', resolvedAt: iso(now) };
      resolved.push(fp);
    }
  }
  return { state, fresh, still, resolved };
}

/** PR mode: record medium/low findings so the weekly run tickets them (pure). Existing entries keep their ticket. */
export function recordPr(prev, findings, { now = Date.now(), secret = null, pr = null } = {}) {
  const state = { ...prev, entries: { ...prev.entries } };
  for (const f of findings) {
    const e = state.entries[f.fingerprint];
    const base = { fp: f.fingerprint, tool: f.tool, lastSeen: iso(now), details: seal(f, secret) ?? e?.details ?? null };
    state.entries[f.fingerprint] = e && e.status === 'open'
      ? { ...e, ...base }
      : { ...base, status: 'open', firstSeen: iso(now), resolvedAt: null, source: 'pr', pr, ticket: null, ticketedAt: null };
  }
  return state;
}

export function markTicketed(prev, fps, ticket, now = Date.now()) {
  const state = { ...prev, entries: { ...prev.entries } };
  for (const fp of fps) if (state.entries[fp]) state.entries[fp] = { ...state.entries[fp], ticket, ticketedAt: iso(now) };
  return state;
}

export const addRun = (prev, run) => ({ ...prev, runs: [...prev.runs.filter((r) => r.id !== run.id), run].slice(-RUNS_KEPT) });

/** Did a weekly run for this slot already finish ok? */
export const slotDone = (state, slotIso) => !!slotIso && state.runs.some((r) => r.mode === 'weekly' && r.slot === slotIso && r.status === 'ok');

export function openStore({ branch = STATE_BRANCH, token = process.env.SECURITY_STATE_TOKEN || null, cwd } = {}) {
  return storeGit({ branch, token, ...(cwd ? { cwd } : {}) });
}

export function readState(git) {
  const sha = git.fetch();
  return parseState(git.files(sha)[STATE_FILE]);
}

/** CAS write: `mutate(state)` → new state (re-applied on a rejected push). → the state written. */
export function writeState(git, mutate, message) {
  let out = null;
  update(git, (files) => {
    out = mutate(parseState(files[STATE_FILE]));
    return { files: { ...files, 'README.md': README, [STATE_FILE]: JSON.stringify(out, null, 2) + '\n' }, message };
  });
  return out;
}
