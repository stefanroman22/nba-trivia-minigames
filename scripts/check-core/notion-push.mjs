#!/usr/bin/env node
// Validated checker findings → one Notion card per cluster (scripts/check-core/lib/clusters.mjs), deduped by the
// card's Source property (fingerprint keys). Spec: docs/superpowers/specs/2026-10-15-checks-prod-logic-design.md §3.4.
//   node scripts/check-core/notion-push.mjs --run <id> --checker ui|logic [--target main|dev] [--dry-run] [--severities blocker,major,minor|all]
// Prints one line per cluster:
//   card <id|DRY> <title> findings=<ids>
//   skip <key…> already open card <id>
//   regression <old card> → <new card>
// Dedupe: any non-Done card with one of the cluster's keys → no card, one "seen again in run <id>" comment per card per run.
// All hits Done and their Commit on origin/main (or no Commit recorded) → a Regression card linking them. A Done hit whose
// Commit is not on origin/main yet → skip (the fix has not reached prod code). --dry-run reads Notion but writes nothing.
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ROOT, uicHome } from './lib/home.mjs';
import { readFindingsDoc, runPath, readJson } from './lib/findings.mjs';
import { planClusters, selectOpen, listArg, DEFAULT_SEVERITIES } from './lib/clusters.mjs';
import { cardMeta, renderBody, attachmentDoc, fpKey } from './lib/card-body.mjs';
import { recordLedger, ledgerPath } from './lib/cards-ledger.mjs';

const DONE = 'Done';
export const seenText = (runId) => `seen again in run ${runId}`;
export const notionUrl = (id) => `https://www.notion.so/${String(id).replace(/-/g, '')}`;

/** Notion through scripts/notion.mjs (one process per call, like the pipeline's intake), shipped-ness through git. */
export function cliClient({ root = ROOT } = {}) {
  const notion = (...a) => execFileSync(process.execPath, [path.join(root, 'scripts', 'notion.mjs'), ...a], { cwd: root, encoding: 'utf8', maxBuffer: 32 << 20 }).trim();
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

/** { action: 'create' | 'skip' | 'regression', open, done } for one cluster's keys. */
export function decide(keys, client) {
  const hits = client.findCards(keys);
  const open = hits.filter((h) => h.status !== DONE);
  if (open.length) return { action: 'skip', open, done: [] };
  if (!hits.length) return { action: 'create', open: [], done: [] };
  const pending = hits.filter((h) => h.commit && !client.isShipped(h.commit));
  if (pending.length) return { action: 'skip', open: [], done: hits, pending };
  return { action: 'regression', open: [], done: hits };
}

export function pushRun({ doc, runId, checker = 'ui', target = 'main', severities = DEFAULT_SEVERITIES.split(','), dryRun = false,
  client, runDir = runPath(runId), meta = {}, exists = existsSync, log = console.log, ledgerFile = ledgerPath(), workDir }) {
  const all = selectOpen(doc.findings || [], { severities });
  const unvalidated = all.filter((f) => !f.validatedAt);
  for (const f of unvalidated) log(`warn ${f.id} not validated (run report.mjs --validate) — left out`);
  const open = all.filter((f) => f.validatedAt);
  const clusters = planClusters(open);
  const results = [];
  const commented = new Set();
  const ledger = {};
  const at = new Date().toISOString();
  const note = (cluster, rec) => { for (const f of cluster.items) ledger[f.fingerprint] = { key: fpKey(f.fingerprint), ...rec, run: runId, at, id: f.id }; };
  log(`notion-push ${checker}-check run ${runId}: ${open.length} open validated finding(s) · ${clusters.length} cluster(s)${dryRun ? ' · DRY RUN' : ''}`);

  clusters.forEach((cluster, i) => {
    const d = decide(cardMeta(cluster, { checker, runId, target }).keys, client);
    const meta0 = cardMeta(cluster, { checker, runId, target, regression: d.action === 'regression' });
    if (d.action === 'skip') {
      const cards = d.open.length ? d.open : d.done;
      for (const c of cards) {
        if (d.open.length && !commented.has(c.id)) {
          commented.add(c.id);
          const already = client.listComments(c.id).some((x) => String(x.text || '').includes(seenText(runId)));
          const extra = meta0.ids.filter((id) => !String(c.source || '').includes(id));
          const text = `${seenText(runId)}${extra.length ? ` · also in this cluster now: ${extra.join(', ')}` : ''}`;
          if (already) log(`  (card ${c.id} already has "${seenText(runId)}")`);
          else if (dryRun) log(`  (dry: would comment on ${c.id}: ${text})`);
          else { client.comment(c.id, text); log(`  commented on ${c.id}: ${text}`); }
        }
        log(`skip ${meta0.keys.join(' ')} already ${d.open.length ? 'open' : `done, fix ${String(c.commit).slice(0, 7)} not on origin/main yet,`} card ${c.id}`);
      }
      const c = cards[0];
      note(cluster, { card: c.id, url: c.url, title: c.title, status: c.status, decision: 'skip' });
      results.push({ action: 'skip', cards: cards.map((c) => c.id), ids: meta0.ids });
      return;
    }
    const regressionOf = d.done.map((h) => ({ id: h.id, url: h.url || notionUrl(h.id), commit: h.commit }));
    const { markdown } = renderBody(cluster, { checker, runId, runDir, meta, target, regressionOf, exists });
    const attachment = attachmentDoc(cluster, { checker, runId, meta, source: meta0.source });
    let id = 'DRY';
    if (dryRun) {
      log(`card DRY ${meta0.title} findings=${meta0.ids.join(',')}`);
      log(`  Category ${meta0.category} · Priority ${meta0.priority} · Difficulty ${meta0.difficulty} · Status To Do · Target ${meta0.target}`);
      log(`  Source ${meta0.source}`);
      log(`  Attachment findings.json (${cluster.items.length} finding object(s))`);
      log(markdown.trimEnd().split('\n').map((l) => `  | ${l}`).join('\n'));
    } else {
      const dir = path.join(workDir || path.join(uicHome(), 'notion-push', runId), String(i + 1));
      mkdirSync(dir, { recursive: true });
      const bodyFile = path.join(dir, 'body.md');
      const attachFile = path.join(dir, 'findings.json');
      writeFileSync(bodyFile, markdown);
      writeFileSync(attachFile, JSON.stringify(attachment, null, 2) + '\n');
      id = client.createCard(meta0, bodyFile, [attachFile]);
      log(`card ${id} ${meta0.title} findings=${meta0.ids.join(',')}`);
    }
    if (d.action === 'regression') for (const h of regressionOf) log(`regression ${h.id} → ${id}`);
    note(cluster, { card: id, url: id === 'DRY' ? null : notionUrl(id), title: meta0.title, status: 'To Do', decision: d.action });
    results.push({ action: d.action, card: id, ids: meta0.ids, title: meta0.title, regressionOf: regressionOf.map((h) => h.id) });
  });

  if (!dryRun && Object.keys(ledger).length) recordLedger(ledger, ledgerFile);
  const n = (a) => results.filter((r) => r.action === a).length;
  log(`notion-push done: ${n('create')} new · ${n('regression')} regression · ${n('skip')} skipped${dryRun ? ' (dry run: nothing written)' : ` · ledger ${ledgerFile}`}`);
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
  pushRun({ doc, runId: o.run, checker: o.checker, target: o.target, severities: listArg(o.severities, DEFAULT_SEVERITIES), dryRun: o.dryRun, client: cliClient(), meta });
}
