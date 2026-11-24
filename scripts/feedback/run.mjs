#!/usr/bin/env node
// Feedback triage: what players wrote in the in-app feedback form becomes verdicts and, where it is actionable,
// board cards with acceptance criteria.
//
//   python manage.py feedback_triage export --out batch.json          (has the database, no model)
//   node scripts/feedback/run.mjs triage --batch batch.json --out triage.json [--model <m>]
//                                                                     (the agent: read-only, no database, no Notion)
//   node scripts/feedback/run.mjs file --batch batch.json --triage triage.json --out applied.json [--dry-run]
//                                                                     (Notion: files the cards)
//   python manage.py feedback_triage apply --file applied.json       (marks the rows read, links their card)
//
// Feedback is text from the public, so it is handled as data at every step: the agent can only read files and
// return JSON, this script validates that JSON against the batch, and a card that comes from feedback is always
// filed in Backlog. Nothing a player typed can reach the build queue without the owner moving the card.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { ROOT, STATUS } from '../lib/team-config.mjs';
import { cliClient } from '../lib/notion-cli.mjs';
import { runAgent } from '../lib/claude-agent.mjs';
import { createTickets, ticketsDir } from '../team/tickets.mjs';
import { appliedDoc, evidenceNote, validateTriage } from './lib/triage.mjs';

export const KIND = 'feedback';
export const seenText = (run, n) => `seen again in run ${run}: ${n} more player report(s)`;

export const triagePrompt = (batchFile, problems = []) => [
  `Triage the player feedback in ${batchFile}, following your instructions.`,
  'Reply with ONLY the JSON object { "items": [ … ], "tickets": [ … ] } and nothing else.',
  ...(problems.length ? ['', 'Your previous answer was rejected by the validator. Fix exactly these problems and answer again:', ...problems.map((p) => `- ${p}`)] : []),
].join('\n');

/** Agent → validated triage, with one corrective retry. An empty batch needs no model. */
export function triage(batch, batchFile, { model = null, run = runAgent, log = () => {} } = {}) {
  if (!batch.items?.length) return { ok: true, items: [], tickets: [], attempts: 0 };
  let problems = [];
  for (let attempt = 1; attempt <= 2; attempt++) {
    const r = run('feedback-triage', triagePrompt(batchFile, problems), { model, addDirs: [path.dirname(batchFile)] });
    if (!r.ok) return { ok: false, problems: [r.error], attempts: attempt };
    const v = validateTriage(batch, r.json);
    if (v.ok) return { ok: true, items: v.items, tickets: v.tickets, attempts: attempt };
    problems = v.problems;
    log(`attempt ${attempt}: ${problems.length} problem(s)`);
  }
  return { ok: false, problems, attempts: 2 };
}

/** Files the tickets (Backlog, always) and notes repeat reports on a card that is already open. */
export function file(batch, doc, { client, dryRun = false, log = () => {}, outDir = path.join(ticketsDir(`feedback-${batch.run}`), 'cards') } = {}) {
  const v = validateTriage(batch, doc);
  if (!v.ok) return { ok: false, problems: v.problems };
  const results = createTickets({
    tickets: v.tickets, kind: KIND, run: batch.run, status: STATUS.BACKLOG, client, dryRun,
    outDir, note: (t) => evidenceNote(t, batch), log,
  });
  if (!dryRun) results.forEach((r, i) => { if (r.action === 'skip') client.comment(r.id, seenText(batch.run, v.tickets[i].evidence.length)); });
  return { ok: !results.some((r) => r.action === 'error'), results, applied: appliedDoc(batch, v.items, v.tickets, results) };
}

const readJson = (f) => {
  if (!f || !existsSync(f)) throw new Error(`no such file: ${f || '(none given)'}`);
  return JSON.parse(readFileSync(f, 'utf8'));
};
const writeJson = (f, obj) => { mkdirSync(path.dirname(path.resolve(f)), { recursive: true }); writeFileSync(f, `${JSON.stringify(obj, null, 2)}\n`); };

export function cli(argv, { log = console.log, err = console.error, client = cliClient, agent = runAgent } = {}) {
  const [cmd, ...rest] = argv;
  const flag = (k) => { const i = rest.indexOf(k); return i >= 0 ? rest[i + 1] : null; };
  try {
    const batchFile = path.resolve(flag('--batch') || '');
    const batch = readJson(flag('--batch') && batchFile);
    const out = flag('--out');
    if (!out) throw new Error('--out <file> required');
    if (cmd === 'triage') {
      const r = triage(batch, batchFile, { model: flag('--model'), run: agent, log: (l) => err(`feedback triage: ${l}`) });
      if (!r.ok) { r.problems.forEach((p) => err(p)); return 1; }
      writeJson(out, { run: batch.run, items: r.items, tickets: r.tickets });
      log(`${r.items.length} verdict(s), ${r.tickets.length} ticket(s) → ${path.relative(ROOT, path.resolve(out))}`);
      return 0;
    }
    if (cmd === 'file') {
      const dryRun = rest.includes('--dry-run');
      const r = file(batch, readJson(flag('--triage')), { client: dryRun ? null : client(), dryRun, log: (l) => err(l) });
      if (r.problems) { r.problems.forEach((p) => err(p)); return 1; }
      writeJson(out, r.applied);
      log(JSON.stringify(r.results, null, 2));
      return r.ok ? 0 : 1;
    }
    throw new Error('usage: run.mjs triage|file --batch <batch.json> --out <file> [--triage <triage.json>] [--model <m>] [--dry-run]');
  } catch (e) {
    err(e.message);
    return 2;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) process.exit(cli(process.argv.slice(2)));
