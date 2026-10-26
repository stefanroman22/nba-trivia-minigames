// The findings contract of an SEO run (spec §3, §8): `<runDir>/findings.json`, written by the seo agent (weekly run) or
// by audit.mjs --findings (post-deploy regressions, lib/digest.mjs writeRegressionFindings), read by notion-push.mjs.
//   { runId, findings: [ { id: 'SEO-<runId>-NNN', check: 'IX-04', severity, urls, current, expected, files, howToFix,
//     acceptance: { audit, qa: [{ route, selector, expect }] }, fingerprint: 'IX-04|<sorted urls>' (OP: 'OP-05|onpage'), regression?: true,
//     decision: 'card'|'owner'|'wait'|'none', owner?: { action, clickPath }, recheckAfter?: iso } ] }
// `files` are free-form strings (a path, or a path with a note such as `src/app/layout.tsx (footer)`).
// `check` is an IX id, an OP id (phase 2, on-page), or GSC for a Search Console verdict with no IX failure behind it
// (never a card: no code change). OP-07 (URL, informational) and OP-11 (measurement) are never a card either.
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { IX_IDS } from '../audit.mjs';
import { OP_IDS } from './onpage-checks.mjs';

export const GSC_CHECK = 'GSC';
export const CHECK_IDS = [...IX_IDS, ...OP_IDS, GSC_CHECK];
/** OP checks that never become a card: OP-07 (existing URLs are never renamed), OP-11 (its flags feed other cards). */
export const OP_NO_CARD = { 'OP-07': 'URL is informational: existing URLs are never renamed', 'OP-11': 'measurement flags feed other cards, never a card itself' };
export const SEVERITIES = ['blocker', 'major', 'minor'];
export const DECISIONS = ['card', 'owner', 'wait', 'none'];

export const findingsPath = (runDir) => path.join(runDir, 'findings.json');
/**
 * The fingerprint a finding must carry: an IX or GSC finding its check and its URLs, sorted, comma-joined; an OP finding
 * `OP-nn|onpage` (one card per OP check whatever pages fail it: the URLs are in the body, never in the fingerprint).
 */
export const fingerprintOf = (f) => (OP_IDS.includes(f.check) ? `${f.check}|onpage` : `${f.check}|${[...(f.urls || [])].sort().join(',')}`);

/** The parsed `<runDir>/findings.json`, or null when there is none (throws on a file that is not JSON). */
export function readFindings(runDir) {
  const file = findingsPath(runDir);
  if (!existsSync(file)) return null;
  return JSON.parse(readFileSync(file, 'utf8').replace(/^﻿/, ''));
}

const text = (v) => typeof v === 'string' && v.trim() !== '';
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const absUrl = (u) => { try { return /^https?:$/.test(new URL(u).protocol); } catch { return false; } };
const isoDate = (v) => typeof v === 'string' && /^\d{4}-\d\d-\d\d(T|$)/.test(v) && !Number.isNaN(Date.parse(v));

/** Errors of one finding, without the finding prefix. */
function findingErrors(f, runId) {
  const e = [];
  const idRe = new RegExp(`^SEO-${String(runId).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}-\\d{3}$`);
  if (!text(f.id) || !idRe.test(f.id)) e.push(`id must be SEO-${runId}-NNN`);
  if (!CHECK_IDS.includes(f.check)) e.push(`unknown check ${JSON.stringify(f.check)} (want IX-01..IX-12, OP-01..OP-11 or ${GSC_CHECK})`);
  if (!SEVERITIES.includes(f.severity)) e.push(`severity must be ${SEVERITIES.join('|')}`);
  if (!Array.isArray(f.urls) || !f.urls.length) e.push('urls must be a non-empty list');
  else if (!f.urls.every(absUrl)) e.push('urls must be absolute http(s) URLs');
  for (const k of ['current', 'expected']) if (!text(f[k])) e.push(`${k} must be a non-empty string`);
  if (f.files !== undefined && !(Array.isArray(f.files) && f.files.every(text))) e.push('files must be a list of non-empty strings');
  if (f.howToFix !== undefined && typeof f.howToFix !== 'string') e.push('howToFix must be a string');
  if (f.acceptance !== undefined) {
    const a = f.acceptance;
    if (!isObj(a)) e.push('acceptance must be { audit, qa }');
    else {
      if (a.audit !== undefined && typeof a.audit !== 'string') e.push('acceptance.audit must be a string');
      if (a.qa !== undefined && !(Array.isArray(a.qa) && a.qa.every((q) => isObj(q) && ['route', 'selector', 'expect'].every((k) => text(q[k]))))) {
        e.push('acceptance.qa must be a list of { route, selector, expect } strings');
      }
    }
  }
  if (Array.isArray(f.urls) && f.fingerprint !== fingerprintOf(f)) e.push(`fingerprint must be ${JSON.stringify(fingerprintOf(f))}`);
  if (f.regression !== undefined && f.regression !== true) e.push('regression, when present, must be true');
  if (!DECISIONS.includes(f.decision)) e.push(`decision must be ${DECISIONS.join('|')}`);
  if (f.decision === 'card') {
    if (f.check === GSC_CHECK) e.push(`decision card needs an IX check (${GSC_CHECK} findings carry no code change)`);
    if (OP_NO_CARD[f.check]) e.push(`decision card is never allowed for ${f.check} (${OP_NO_CARD[f.check]})`);
    if (!Array.isArray(f.files) || !f.files.length) e.push('decision card needs files');
    if (!text(f.howToFix)) e.push('decision card needs howToFix');
    if (!text(f.acceptance?.audit)) e.push('decision card needs acceptance.audit');
    if (!Array.isArray(f.acceptance?.qa)) e.push('decision card needs acceptance.qa (a list, may be empty)');
  }
  if (f.decision === 'owner' && !(isObj(f.owner) && text(f.owner.action) && text(f.owner.clickPath))) e.push('decision owner needs owner { action, clickPath }');
  if (f.decision === 'wait' && !isoDate(f.recheckAfter)) e.push('decision wait needs recheckAfter (an ISO date)');
  if (f.recheckAfter !== undefined && !isoDate(f.recheckAfter)) e.push('recheckAfter must be an ISO date');
  return e;
}

/** Every contract violation of a findings document, one line each ([] = valid). */
export function validateFindings(doc) {
  if (!isObj(doc)) return ['findings.json must be an object { runId, findings }'];
  const errors = [];
  if (!text(doc.runId)) errors.push('runId must be a non-empty string');
  if (!Array.isArray(doc.findings)) { errors.push('findings must be a list'); return errors; }
  const seen = new Set();
  doc.findings.forEach((f, i) => {
    const label = `findings[${i}]${isObj(f) && text(f.id) ? ` ${f.id}` : ''}`;
    if (!isObj(f)) { errors.push(`${label}: must be an object`); return; }
    if (text(f.id) && seen.has(f.id)) errors.push(`${label}: duplicate id`);
    seen.add(f.id);
    for (const e of findingErrors(f, doc.runId)) errors.push(`${label}: ${e}`);
  });
  return errors;
}
