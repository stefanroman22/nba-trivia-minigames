#!/usr/bin/env node
// An SEO run's findings.json (lib/findings.mjs) → one ordinary Notion team card per `decision: 'card'` finding, deduped by
// the card's Source property (`seo-check fp:<fpKey> run:<runId>`). Spec: docs/superpowers/specs/2026-10-25-seo-agent-design.md §5, §8.
//   node scripts/seo/notion-push.mjs --run <runId> [--run-dir <dir>] [--dry-run] [--priority P0|P1|P2] [--regressions-only]
//   node scripts/seo/notion-push.mjs --run <runId> [--run-dir <dir>] --validate-only
// Validates findings.json first: errors → exit 2, one line per error. --validate-only stops there: `findings: valid (<n>)`
// and exit 0, never a Notion call (no token needed; the seo agent's validator). --regressions-only keeps the `regression: true`
// findings (the post-deploy workflow). The same decision table as scripts/check-core/notion-push.mjs (its decide()):
//   - any non-Done card → no card; one "seen again in run <id>" comment per card per run (none in QA, none when the
//     card's own Source says run:<id>).
//   - a Done card with an empty Commit was closed by hand → skip; a Done card whose Commit is not on origin/main → skip.
//   - all hits Done and their Commit on origin/main → one Regression card linking them.
// Cards: Target always dev, never an attachment (QA treats an attached findings.json as a check card); the finding is in
// the body. Prints one line per finding:
//   card <id|DRY> <title>
//   skip <key> <why>                (already open card <id> · done without commit (closed by hand) card <id> · decision owner …)
//   regression <old card> → <new card>
//   error <key> <message>           (that finding only; the others still run → exit 1)
// --dry-run reads Notion but writes nothing.
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ROOT, uicHome } from '../check-core/lib/home.mjs';
import { decide, seenText, sourceHasRun, notionUrl } from '../check-core/notion-push.mjs';
import { readFindings, validateFindings } from './lib/findings.mjs';
import { renderCard } from './lib/card-body.mjs';
import { loadConfig } from './lib/config.mjs';
import { RUNS_ROOT } from './audit.mjs';

const PRIORITIES = ['P0', 'P1', 'P2'];
const esc = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const seenRe = (runId) => new RegExp(`${esc(seenText(runId))}(?![\\w-])`);

/**
 * Notion through scripts/notion.mjs (one process per call, as check-core's cliClient), shipped-ness through git.
 * createCard always passes --target dev and never --attach. `spawn` is injectable for tests.
 */
export function cliClient({ root = ROOT, spawn = spawnSync } = {}) {
  const notion = (...a) => {
    const r = spawn(process.execPath, [path.join(root, 'scripts', 'notion.mjs'), ...a], { cwd: root, encoding: 'utf8', maxBuffer: 32 << 20 });
    if (r.status !== 0) throw new Error(`notion.mjs ${a[0]} failed: ${(r.stderr || r.stdout || '').trim().split('\n').pop()}`);
    return r.stdout.trim();
  };
  let fetched = false;
  return {
    findCards: (keys) => JSON.parse(notion('find-cards', ...keys.flatMap((k) => ['--source-fp', k])) || '[]'),
    listComments: (id) => JSON.parse(notion('list-comments', id) || '[]'),
    comment: (id, text) => notion('comment', id, text),
    createCard: (m, bodyFile) => notion('create-card', m.title, '--category', m.category, '--priority', m.priority, '--difficulty', m.difficulty,
      '--source', m.source, '--target', 'dev', '--body-file', bodyFile).split(/\r?\n/).pop(),
    isShipped: (sha) => {
      if (!fetched) { spawn('git', ['fetch', '--quiet', 'origin', 'main'], { cwd: root }); fetched = true; }
      return spawn('git', ['merge-base', '--is-ancestor', sha, 'origin/main'], { cwd: root }).status === 0;
    },
  };
}

/**
 * Pushes a validated findings document. → [{ action: 'card'|'skip'|'regression'|'error', id, cardId|null, why }]
 * (`why`: 'new', 'regression of <old ids>', 'open'|'byHand'|'pending', 'decision <owner|wait|none>', or the error).
 */
export function pushFindings(doc, client, { dryRun = false, priorityOverride = null, regressionsOnly = false, site = loadConfig().site,
  log = console.log, workDir = path.join(uicHome(), 'seo', 'notion-push', String(doc.runId)) } = {}) {
  const runId = doc.runId;
  const findings = (doc.findings || []).filter((f) => !regressionsOnly || f.regression === true);
  const results = [];
  const commented = new Set();
  log(`notion-push seo-check run ${runId}: ${findings.length} finding(s) · ${findings.filter((f) => f.decision === 'card').length} card decision(s)${regressionsOnly ? ' · regressions only' : ''}${priorityOverride ? ` · priority ${priorityOverride}` : ''}${dryRun ? ' · DRY RUN' : ''}`);

  findings.forEach((f, i) => {
    let key = f.fingerprint;
    try {
      const probe = renderCard(f, { runId, site });
      key = probe.keys[0];
      if (f.decision !== 'card') {
        log(`skip ${key} decision ${f.decision} (${f.id})`);
        results.push({ action: 'skip', id: f.id, cardId: null, why: `decision ${f.decision}` });
        return;
      }
      const d = decide(probe.keys, client);
      if (d.action === 'skip') {
        const cards = d.open.length ? d.open : d.done;
        for (const c of cards) {
          if (d.why === 'open' && c.status !== 'QA' && !commented.has(c.id)) {
            commented.add(c.id);
            const text = seenText(runId);
            if (sourceHasRun(c.source, runId)) log(`  (card ${c.id} was created from run ${runId}: no comment)`);
            else if (client.listComments(c.id).some((x) => seenRe(runId).test(String(x.text || '')))) log(`  (card ${c.id} already has "${text}")`);
            else if (dryRun) log(`  (dry: would comment on ${c.id}: ${text})`);
            else { client.comment(c.id, text); log(`  commented on ${c.id}: ${text}`); }
          }
          const why = d.why === 'open' ? 'already open' : d.why === 'byHand' ? 'done without commit (closed by hand)' : `done, fix ${String(c.commit).slice(0, 7)} not on origin/main yet,`;
          log(`skip ${key} ${why} card ${c.id}`);
        }
        results.push({ action: 'skip', id: f.id, cardId: cards[0].id, why: d.why });
        return;
      }
      const regressionOf = d.done.map((h) => ({ id: h.id, url: h.url || notionUrl(h.id), commit: h.commit }));
      const m = renderCard(f, { runId, site, regressionOf, priority: priorityOverride });
      let id = 'DRY';
      if (dryRun) {
        log(`card DRY ${m.title}`);
        log(`  Category ${m.category} · Priority ${m.priority} · Difficulty ${m.difficulty} · Status To Do · Target ${m.target}`);
        log(`  Source ${m.source}`);
        log('  Attachment none (the finding is in the body)');
        log(m.body.trimEnd().split('\n').map((l) => `  | ${l}`).join('\n'));
      } else {
        const dir = path.join(workDir, String(i + 1));
        mkdirSync(dir, { recursive: true });
        const bodyFile = path.join(dir, 'body.md');
        writeFileSync(bodyFile, m.body);
        id = client.createCard(m, bodyFile);
        log(`card ${id} ${m.title}`);
      }
      for (const h of regressionOf) log(`regression ${h.id} → ${id}`);
      results.push(d.action === 'regression'
        ? { action: 'regression', id: f.id, cardId: id, why: `regression of ${regressionOf.map((h) => h.id).join(',')}` }
        : { action: 'card', id: f.id, cardId: id, why: 'new' });
    } catch (e) {
      log(`error ${key} ${String(e.message || e).split('\n')[0]}`);
      results.push({ action: 'error', id: f.id, cardId: null, why: String(e.message || e) });
    }
  });

  const n = (a) => results.filter((r) => r.action === a).length;
  log(`notion-push done: ${n('card')} new · ${n('regression')} regression · ${n('skip')} skipped · ${n('error')} error(s)${dryRun ? ' (dry run: nothing written)' : ''}`);
  return results;
}

function parseArgs(argv) {
  const o = { run: null, runDir: null, dryRun: false, priority: null, regressionsOnly: false, validateOnly: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--run') o.run = argv[++i];
    else if (a === '--run-dir') o.runDir = argv[++i];
    else if (a === '--priority') o.priority = argv[++i];
    else if (a === '--dry-run') o.dryRun = true;
    else if (a === '--regressions-only') o.regressionsOnly = true;
    else if (a === '--validate-only') o.validateOnly = true;
    else throw new Error(`unknown argument ${a}`);
  }
  return o;
}

/** The CLI → exit code. `client`: a factory for the Notion client, called only when findings are pushed. */
export function cli(argv, { log = console.log, err = console.error, client = cliClient } = {}) {
  let o;
  try { o = parseArgs(argv); } catch (e) { err(`notion-push: ${e.message}`); return 2; }
  if (!o.run && !o.runDir) { err('notion-push: --run <runId> (or --run-dir <dir>) required'); return 2; }
  if (o.priority && !PRIORITIES.includes(o.priority)) { err(`notion-push: --priority ${PRIORITIES.join('|')}`); return 2; }
  const runDir = path.resolve(o.runDir || path.join(RUNS_ROOT, o.run));
  let doc;
  try { doc = readFindings(runDir); } catch (e) { err(`notion-push: invalid findings.json: ${e.message}`); return 2; }
  if (!doc) { err(`notion-push: no findings.json in ${runDir}`); return 1; }
  const errors = validateFindings(doc);
  if (errors.length) { for (const e of errors) err(`notion-push: invalid findings.json: ${e}`); return 2; }
  if (o.validateOnly) { log(`findings: valid (${doc.findings.length})`); return 0; }
  const results = pushFindings(doc, client(), { dryRun: o.dryRun, priorityOverride: o.priority, regressionsOnly: o.regressionsOnly, log });
  return results.some((r) => r.action === 'error') ? 1 : 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = cli(process.argv.slice(2));
}
