#!/usr/bin/env node
// Check bugs → Notion cards. A judge or the Logic triage drops a failure that is the check's fault, not the app's: the
// check is out of date with intended behaviour (`spec`), or its environment broke it (`env`: the check stack, a seed,
// the runner's network). Dropped silently, that check fails every run and nobody sees what it no longer guards, so each
// entry of <runDir>/check-bugs/<writer>.json (one file per judge / the triage: they run in parallel) becomes one
// `[check-bug]` card (Category pipeline, Target dev: the checker tooling lives on dev), deduped by the card's Source
// fingerprint like notion-push; entries with the same key (two judges, one cause) make one card.
//   node scripts/check-core/check-bugs.mjs --run <id> [--dry-run]
// Entry: { kind: 'spec'|'env', checks: ['AC-LOGIN-01', …], key?: '<stable slug>', title, current, expected, lost,
//          files: [{ path, line?, why }], fix: ['…'] }  (key defaults to the sorted checks; one cause = one entry)
// Prints one line per entry:
//   card <id|DRY> <title>        · seen <key> open card <id>        · error <key> <message>
// then `check-bugs done: <n> new · <s> seen again · <e> error(s)`. No entries: `check-bugs: none`.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { uicHome } from './lib/home.mjs';
import { runPath, readJson } from './lib/findings.mjs';
import { recordLedger, ledgerPath } from './lib/cards-ledger.mjs';
import { cliClient, seenText, seenRe, sourceHasRun, notionUrl } from './notion-push.mjs';

export const KINDS = ['spec', 'env'];
const ID_RE = /^(LC|G|AC|GM|MP|ST)-[A-Za-z0-9-]+$/;
/** One Source token per check (`;` ends it: cb:LC-ROOMS-1; never matches cb:LC-ROOMS-10;), so next week's entry for the
 *  same check finds the open card even when its key or check set differs. */
export const checkToken = (id) => `cb:${id};`;
const TITLE_MAX = 110;

export const bugKey = (e) => `${e.kind}|${e.key || [...e.checks].sort().join(',')}`;
export const bugFingerprint = (e) => createHash('sha1').update(`check-bug|${bugKey(e)}`).digest('hex').slice(0, 12);

/** Problems of one entry ([] when it is fine). */
export function validateBug(e) {
  const p = [];
  if (!e || typeof e !== 'object') return ['not an object'];
  if (!KINDS.includes(e.kind)) p.push(`kind must be ${KINDS.join(' or ')}`);
  if (!Array.isArray(e.checks) || !e.checks.length || !e.checks.every((c) => ID_RE.test(String(c)))) p.push('checks: one or more check ids (LC-…, G-…, AC-…, GM-…, MP-…)');
  for (const k of ['title', 'current', 'expected', 'lost']) if (typeof e[k] !== 'string' || !e[k].trim()) p.push(`${k}: a non-empty string`);
  if (!Array.isArray(e.files) || !e.files.length || !e.files.every((f) => f && typeof f.path === 'string' && typeof f.why === 'string')) p.push('files: [{ path, line?, why }] (the check files to change and the app code that proves the behaviour)');
  if (!Array.isArray(e.fix) || !e.fix.length || !e.fix.every((s) => typeof s === 'string' && s.trim())) p.push('fix: one or more concrete steps');
  if (e.key !== undefined && !/^[a-z0-9][a-z0-9-]{2,60}$/.test(String(e.key))) p.push('key: a short lowercase slug');
  return p;
}

const clip = (s, n) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** Every entry of <runDir>/check-bugs/*.json, one per key (the first writer's wins, the others' checks join it).
 *  → { bugs, bad: ['<file>: not a JSON array'] } */
export function loadBugs(runDir) {
  const dir = path.join(runDir, 'check-bugs');
  const bugs = [], bad = [], byKey = new Map();
  const files = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.json')).sort() : [];
  for (const f of files) {
    const doc = readJson(path.join(dir, f), null);
    const list = Array.isArray(doc) ? doc : doc && Array.isArray(doc.bugs) ? doc.bugs : null;
    if (!list) { bad.push(`${f}: not a JSON array`); continue; }
    for (const e of list) {
      const k = e && KINDS.includes(e.kind) && Array.isArray(e.checks) ? bugKey(e) : null;
      const first = k && byKey.get(k);
      if (first) { for (const c of e.checks) if (!first.checks.includes(c)) first.checks.push(c); continue; }
      const copy = e && typeof e === 'object' ? { ...e, checks: Array.isArray(e.checks) ? [...e.checks] : e.checks } : e;
      if (k) byKey.set(k, copy);
      bugs.push(copy);
    }
  }
  return { bugs, bad };
}

export function cardFor(e, { checker, runId }) {
  const fp = bugFingerprint(e);
  return {
    fp,
    title: clip(`[check-bug] ${e.checks.join(', ')}: ${e.title}`, TITLE_MAX),
    category: 'pipeline',
    priority: 'P1',
    difficulty: 'standard',
    target: 'dev',
    source: `check-bug fp:${fp} ${e.checks.map(checkToken).join(' ')} checker:${checker} run:${runId}`,
  };
}

export function renderBugBody(e, { checker, runId }) {
  const tool = checker === 'logic' ? 'scripts/logic-check' : 'scripts/ui-check';
  const what = e.kind === 'spec' ? 'is out of date with how the app now works (on purpose)' : 'is broken by its environment (the check stack, its data or the runner), not by the app';
  const run = checker === 'logic'
    ? `node scripts/logic-check/run.mjs --only ${e.checks.join(',')} --ref main`
    : `node scripts/ui-check/run.mjs --only "${e.checks.join(',')}" --vp all --ref main`;
  return [
    `The ${checker === 'logic' ? 'Logic' : 'UI'} check ${e.checks.join(', ')} ${what}. Run ${runId} dropped its failure as not an app defect, so until this is fixed the check fails every week and its failures are thrown away: a real regression in this area would not be reported.`,
    '',
    '## What went unverified',
    '',
    e.lost,
    '',
    '## Current',
    '',
    e.current,
    '',
    '## Expected',
    '',
    e.expected,
    '',
    '## Files',
    '',
    ...e.files.map((f) => `- ${f.path}${f.line ? `:${f.line}` : ''} — ${f.why}`),
    '',
    '## How to fix',
    '',
    ...e.fix.map((s) => `- ${s}`),
    '',
    '## Acceptance',
    '',
    `- \`${run}\` passes on today's main.`,
    `- The check still guards what it was written for: it must still FAIL when that behaviour breaks (tighten it to the new rule, never loosen or skip it).`,
    `- Update the check's row in ${tool}/CHECKS.md when its expectation changes.`,
    '',
    '## Pipeline',
    '',
    `- A tooling card: the checker code lives on dev (${tool}/, scripts/check-core/). Target dev, ship like any other card.`,
    `- Dedupe: Source fp:${bugFingerprint(e)} = ${bugKey(e)}.`,
    '',
  ].join('\n');
}

/** Push one run's check bugs. → results [{ action: 'create'|'seen'|'error', … }] */
export function pushBugs({ bugs, runId, checker, client, dryRun = false, log = console.log, ledgerFile = ledgerPath(), workDir }) {
  const results = [];
  const at = new Date().toISOString();
  bugs.forEach((e, i) => {
    const problems = validateBug(e);
    if (problems.length) { log(`error check-bugs.json[${i}] ${problems.join('; ')}`); results.push({ action: 'error', index: i, error: problems.join('; ') }); return; }
    const m = cardFor(e, { checker, runId });
    try {
      const open = client.findCards([m.fp, ...e.checks.map(checkToken)]).filter((c) => c.status !== 'Done');
      if (open.length) {
        // The card of this cause (its fp), else any open card of one of these checks.
        const c = open.find((x) => String(x.source || '').includes(`fp:${m.fp}`)) || open[0];
        const other = !String(c.source || '').includes(`fp:${m.fp}`);
        const text = `${seenText(runId)}${other ? ` · also: ${e.kind} "${e.title}" (${e.checks.join(', ')})` : ''}`;
        if (c.status === 'QA') log(`  (card ${c.id} is in QA: no comment)`);
        else if (sourceHasRun(c.source, runId)) log(`  (card ${c.id} was created from run ${runId}: no comment)`);
        else if (client.listComments(c.id).some((x) => seenRe(runId).test(String(x.text || '')))) log(`  (card ${c.id} already has "${seenText(runId)}")`);
        else if (dryRun) log(`  (dry: would comment on ${c.id}: ${text})`);
        else client.comment(c.id, text);
        log(`seen ${bugKey(e)} open card ${c.id}`);
        if (!dryRun) recordLedger({ [`check-bug|${bugKey(e)}`]: { key: m.fp, card: c.id, url: c.url || notionUrl(c.id), title: c.title, status: c.status, decision: 'skip:open', run: runId, at } }, ledgerFile);
        results.push({ action: 'seen', card: c.id, key: bugKey(e) });
        return;
      }
      const body = renderBugBody(e, { checker, runId });
      let id = 'DRY';
      if (dryRun) {
        log(`card DRY ${m.title}`);
        log(`  Category ${m.category} · Priority ${m.priority} · Difficulty ${m.difficulty} · Status To Do · Target ${m.target}`);
        log(`  Source ${m.source}`);
        log(body.trimEnd().split('\n').map((l) => `  | ${l}`).join('\n'));
      } else {
        const dir = path.join(workDir || path.join(uicHome(), 'check-bugs', runId), String(i + 1));
        mkdirSync(dir, { recursive: true });
        const bodyFile = path.join(dir, 'body.md');
        writeFileSync(bodyFile, body);
        id = client.createCard(m, bodyFile, []);
        log(`card ${id} ${m.title}`);
        recordLedger({ [`check-bug|${bugKey(e)}`]: { key: m.fp, card: id, url: notionUrl(id), title: m.title, status: 'To Do', decision: 'create', run: runId, at } }, ledgerFile);
      }
      results.push({ action: 'create', card: id, key: bugKey(e), title: m.title });
    } catch (err) {
      log(`error ${bugKey(e)} ${String(err.message || err).split('\n')[0]}`);
      results.push({ action: 'error', key: bugKey(e), error: String(err.message || err) });
    }
  });
  const n = (a) => results.filter((r) => r.action === a).length;
  log(`check-bugs done: ${n('create')} new · ${n('seen')} seen again · ${n('error')} error(s)${dryRun ? ' (dry run: nothing written)' : ''}`);
  return results;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2);
  const o = { dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--run') o.run = argv[++i];
    else if (argv[i] === '--dry-run') o.dryRun = true;
    else { console.error(`check-bugs: unknown argument ${argv[i]}`); process.exit(2); }
  }
  if (!o.run) { console.error('check-bugs: --run <id> required'); process.exit(2); }
  const { bugs, bad } = loadBugs(runPath(o.run));
  for (const b of bad) console.log(`error check-bugs/${b}`);
  if (!bugs.length && !bad.length) { console.log('check-bugs: none'); process.exit(0); }
  const checker = o.run.endsWith('-logic') ? 'logic' : 'ui';
  const results = bugs.length ? pushBugs({ bugs, runId: o.run, checker, client: cliClient(), dryRun: o.dryRun, log: (l) => console.log(l.startsWith('check-bugs done: ') && bad.length ? l.replace(/(\d+) error\(s\)/, (_, n) => `${+n + bad.length} error(s)`) : l) }) : [];
  if (!bugs.length) console.log(`check-bugs done: 0 new · 0 seen again · ${bad.length} error(s)`);
  if (bad.length || results.some((r) => r.action === 'error')) process.exitCode = 1;
}
