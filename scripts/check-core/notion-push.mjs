#!/usr/bin/env node
// Validated checker findings → one Notion card per cluster (scripts/check-core/lib/clusters.mjs), deduped by the
// card's Source property (fingerprint keys). Spec: docs/superpowers/specs/2026-10-15-checks-prod-logic-design.md §3.4.
//   node scripts/check-core/notion-push.mjs --run <id> --checker ui|logic [--target main|dev] [--dry-run] [--severities blocker,major,minor|all]
// Cards are titled `[ui-check] …` / `[logic-check] …`; a logic card points the engine at "Fixing a Logic-check finding" and
// verifies with `node scripts/ui-check/verify.mjs <id> --run <runId>` (lib/card-body.mjs).
// Prints one line per cluster:
//   card <id|DRY> <title> findings=<ids>
//   skip <key…> already open card <id>            (or: done without commit (closed by hand) / done, fix not on origin/main yet)
//   regression <old card> → <new card>
//   error <key…> <message>                         (that cluster only; the others still run)
// Dedupe, per cluster, on the keys of every finding's fingerprint and mergedFingerprints:
//   - any non-Done card → no card; one "seen again in run <id>" comment per card per run (none when the card's own Source
//     says run:<id>). New sibling findings of that open card are named in the comment only and get no card of their own:
//     they wait for the next run after the open card is Done (then they are new, or the card's fix covered them).
//   - a Done card with an empty Commit was closed by hand (won't fix) → skip, never a Regression.
//   - a Done card whose Commit is not on origin/main yet → skip (the fix has not reached prod code).
//   - all hits Done and their Commit on origin/main → one Regression card linking them.
// The ledger (<home>/notion-cards.json) is written after every card. --dry-run reads Notion but writes nothing.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ROOT, uicHome } from './lib/home.mjs';
import { readFindingsDoc, runPath, readJson } from './lib/findings.mjs';
import { planClusters, selectOpen, listArg, DEFAULT_SEVERITIES } from './lib/clusters.mjs';
import { cardMeta, renderBody, attachmentDoc, findingKeys, SOURCE_MAX } from './lib/card-body.mjs';
import { recordLedger, ledgerPath } from './lib/cards-ledger.mjs';

const DONE = 'Done';
export const seenText = (runId) => `seen again in run ${runId}`;
export const notionUrl = (id) => `https://www.notion.so/${String(id).replace(/-/g, '')}`;
const esc = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** Source written by this run (anchored: run 20261014-1153 never matches run:20261014-1153x). */
export const sourceHasRun = (source, runId) => new RegExp(`(^|\\s)run:${esc(runId)}(\\s|$)`).test(String(source || ''));
const seenRe = (runId) => new RegExp(`${esc(seenText(runId))}(?![\\w-])`);

/** Notion through scripts/notion.mjs (one process per call, like the pipeline's intake), shipped-ness through git. */
export function cliClient({ root = ROOT } = {}) {
  const notion = (...a) => {
    const r = spawnSync(process.execPath, [path.join(root, 'scripts', 'notion.mjs'), ...a], { cwd: root, encoding: 'utf8', maxBuffer: 32 << 20 });
    if (r.status !== 0) throw new Error(`notion.mjs ${a[0]} failed: ${(r.stderr || r.stdout || '').trim().split('\n').pop()}`);
    return r.stdout.trim();
  };
  let fetched = false;
  return {
    findCards: (keys) => JSON.parse(notion('find-cards', ...keys.flatMap((k) => ['--source-fp', k])) || '[]'),
    listComments: (id) => JSON.parse(notion('list-comments', id) || '[]'),
    comment: (id, text) => notion('comment', id, text),
    createCard: (m, bodyFile, attach) => notion('create-card', m.title, '--category', m.category, '--priority', m.priority, '--difficulty', m.difficulty,
      '--source', m.source, '--target', m.target, '--body-file', bodyFile, ...attach.flatMap((f) => ['--attach', f])).split(/\r?\n/).pop(),
    isShipped: (sha) => {
      if (!fetched) { spawnSync('git', ['fetch', '--quiet', 'origin', 'main'], { cwd: root }); fetched = true; }
      return spawnSync('git', ['merge-base', '--is-ancestor', sha, 'origin/main'], { cwd: root }).status === 0;
    },
  };
}

/** { action: 'create' | 'skip' | 'regression', open, done, why } for one cluster's keys. */
export function decide(keys, client) {
  const hits = client.findCards(keys);
  const open = hits.filter((h) => h.status !== DONE);
  if (open.length) return { action: 'skip', open, done: [], why: 'open' };
  if (!hits.length) return { action: 'create', open: [], done: [] };
  const byHand = hits.filter((h) => !h.commit);
  if (byHand.length) return { action: 'skip', open: [], done: byHand, why: 'byHand' };
  const pending = hits.filter((h) => !client.isShipped(h.commit));
  if (pending.length) return { action: 'skip', open: [], done: pending, why: 'pending' };
  return { action: 'regression', open: [], done: hits };
}

export function pushRun({ doc, runId, checker = 'ui', target = 'main', severities = DEFAULT_SEVERITIES.split(','), dryRun = false,
  client, runDir = runPath(runId), meta = {}, exists = existsSync, log = console.log, ledgerFile = ledgerPath(), workDir, perfIds }) {
  const all = selectOpen(doc.findings || [], { severities });
  for (const f of all.filter((x) => !x.validatedAt)) log(`warn ${f.id} not validated (run report.mjs --validate) — left out`);
  const open = all.filter((f) => f.validatedAt);
  const clusters = planClusters(open, perfIds ? { perfIds } : {});
  const results = [];
  const commented = new Set();
  const at = new Date().toISOString();
  const note = (cluster, rec) => {
    if (dryRun) return;
    const entries = {};
    for (const f of cluster.items) for (const fp of [f.fingerprint, ...(f.mergedFingerprints || [])]) entries[fp] = { key: findingKeys({ fingerprint: fp })[0], ...rec, run: runId, at, id: f.id };
    recordLedger(entries, ledgerFile);
  };
  log(`notion-push ${checker}-check run ${runId}: ${open.length} open validated finding(s) · ${clusters.length} cluster(s)${dryRun ? ' · DRY RUN' : ''}`);

  clusters.forEach((cluster, i) => {
    let keys = [];
    try {
      keys = cardMeta(cluster, { checker, runId, target }).keys;
      const d = decide(keys, client);
      const m = cardMeta(cluster, { checker, runId, target, regression: d.action === 'regression' });
      if (m.source.length > SOURCE_MAX) log(`warn Source is ${m.source.length} chars (> ${SOURCE_MAX}); Notion keeps the first ${SOURCE_MAX}, so later keys/ids are not searchable`);
      if (d.action === 'skip') {
        const cards = d.open.length ? d.open : d.done;
        for (const c of cards) {
          if (d.why === 'open' && c.status !== 'QA' && !commented.has(c.id)) {
            commented.add(c.id);
            const extra = m.ids.filter((id) => !String(c.source || '').includes(id));
            const text = `${seenText(runId)}${extra.length ? ` · also in this cluster now: ${extra.join(', ')}` : ''}`;
            if (sourceHasRun(c.source, runId)) log(`  (card ${c.id} was created from run ${runId}: no comment)`);
            else if (client.listComments(c.id).some((x) => seenRe(runId).test(String(x.text || '')))) log(`  (card ${c.id} already has "${seenText(runId)}")`);
            else if (dryRun) log(`  (dry: would comment on ${c.id}: ${text})`);
            else { client.comment(c.id, text); log(`  commented on ${c.id}: ${text}`); }
          }
          const why = d.why === 'open' ? 'already open' : d.why === 'byHand' ? 'done without commit (closed by hand)' : `done, fix ${String(c.commit).slice(0, 7)} not on origin/main yet,`;
          log(`skip ${keys.join(' ')} ${why} card ${c.id}`);
        }
        const c = cards[0];
        note(cluster, { card: c.id, url: c.url, title: c.title, status: c.status, decision: `skip:${d.why}` });
        results.push({ action: 'skip', why: d.why, cards: cards.map((x) => x.id), ids: m.ids });
        return;
      }
      const regressionOf = d.done.map((h) => ({ id: h.id, url: h.url || notionUrl(h.id), commit: h.commit }));
      const { markdown } = renderBody(cluster, { checker, runId, runDir, meta, target, regressionOf, exists });
      const attachment = attachmentDoc(cluster, { checker, runId, meta, source: m.source });
      let id = 'DRY';
      if (dryRun) {
        log(`card DRY ${m.title} findings=${m.ids.join(',')}`);
        log(`  Category ${m.category} · Priority ${m.priority} · Difficulty ${m.difficulty} · Status To Do · Target ${m.target}`);
        log(`  Source ${m.source}`);
        log(`  Attachment findings.json (${cluster.items.length} finding object(s))`);
        log(markdown.trimEnd().split('\n').map((l) => `  | ${l}`).join('\n'));
      } else {
        const dir = path.join(workDir || path.join(uicHome(), 'notion-push', runId), String(i + 1));
        mkdirSync(dir, { recursive: true });
        const bodyFile = path.join(dir, 'body.md');
        const attachFile = path.join(dir, 'findings.json');
        writeFileSync(bodyFile, markdown);
        writeFileSync(attachFile, JSON.stringify(attachment, null, 2) + '\n');
        id = client.createCard(m, bodyFile, [attachFile]);
        log(`card ${id} ${m.title} findings=${m.ids.join(',')}`);
      }
      if (d.action === 'regression') for (const h of regressionOf) log(`regression ${h.id} → ${id}`);
      note(cluster, { card: id, url: notionUrl(id), title: m.title, status: 'To Do', decision: d.action });
      results.push({ action: d.action, card: id, ids: m.ids, title: m.title, regressionOf: regressionOf.map((h) => h.id) });
    } catch (e) {
      log(`error ${keys.join(' ') || `cluster #${i + 1}`} ${String(e.message || e).split('\n')[0]}`);
      results.push({ action: 'error', ids: cluster.items.map((f) => f.id), error: String(e.message || e) });
    }
  });

  const n = (a) => results.filter((r) => r.action === a).length;
  log(`notion-push done: ${n('create')} new · ${n('regression')} regression · ${n('skip')} skipped · ${n('error')} error(s)${dryRun ? ' (dry run: nothing written)' : ` · ledger ${ledgerFile}`}`);
  return results;
}

function parseArgs(argv) {
  const o = { checker: 'ui', target: 'main', dryRun: false, severities: DEFAULT_SEVERITIES };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--run') o.run = argv[++i];
    else if (a === '--checker') o.checker = argv[++i];
    else if (a === '--target') o.target = argv[++i];
    else if (a === '--severities') o.severities = argv[++i];
    else if (a === '--dry-run') o.dryRun = true;
    else { console.error(`notion-push: unknown argument ${a}`); process.exit(2); }
  }
  return o;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const o = parseArgs(process.argv.slice(2));
  if (!o.run) { console.error('notion-push: --run <id> required'); process.exit(2); }
  if (!['ui', 'logic'].includes(o.checker)) { console.error('notion-push: --checker ui|logic'); process.exit(2); }
  if (!['main', 'dev'].includes(o.target)) { console.error('notion-push: --target main|dev'); process.exit(2); }
  const doc = readFindingsDoc(o.run);
  if (!doc) { console.error(`notion-push: no findings.json for run ${o.run}`); process.exit(1); }
  const runMeta = readJson(path.join(runPath(o.run), 'run-meta.json'), {}) || {};
  const meta = { mode: runMeta.code?.mode || doc.mode, head: runMeta.head || runMeta.code?.head, ref: runMeta.ref };
  const results = pushRun({ doc, runId: o.run, checker: o.checker, target: o.target, severities: listArg(o.severities, DEFAULT_SEVERITIES), dryRun: o.dryRun, client: cliClient(), meta });
  if (results.some((r) => r.action === 'error')) process.exitCode = 1;
}
