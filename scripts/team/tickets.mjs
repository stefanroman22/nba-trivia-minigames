#!/usr/bin/env node
// Ticket intake: one long piece of text (meeting notes, a brain-dump, a feature list) becomes separate board
// cards, each with acceptance criteria, that the team pipeline picks up like any card the owner wrote.
//
//   node scripts/team/tickets.mjs split <text-file> [--out tickets.json] [--model <m>]
//       the ticket-writer agent (read-only) writes tickets.json; an invalid answer is sent back once with the reasons
//   node scripts/team/tickets.mjs validate <tickets.json>
//   node scripts/team/tickets.mjs render <tickets.json>          the card bodies, as they would be filed
//   node scripts/team/tickets.mjs create <tickets.json> [--status Backlog] [--dry-run] [--run <id>]
//       one card per ticket (Status "To Do" unless --status Backlog); a ticket whose title already has an open
//       card is skipped. Prints [{ title, action: created|skip|dry, id, why }].
//
// The agent proposes; this script decides what reaches the board: nothing is filed from a document that fails
// validation, and a ticket without checkable acceptance criteria is a validation failure.
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { ROOT, STATUS } from '../lib/team-config.mjs';
import { cliClient } from '../lib/notion-cli.mjs';
import { runAgent } from '../lib/claude-agent.mjs';
import { fingerprint, renderTicket, sourceOf, validateTickets } from './lib/ticket.mjs';

export const KIND = 'ticket-intake';
const DONE = STATUS.DONE;
export const runId = (d = new Date()) => d.toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 13);
export const ticketsDir = (id, root = ROOT) => path.join(root, '.team', 'tickets', id);

export const splitPrompt = (inputFile, problems = []) => [
  `Split the text in ${inputFile} into tickets, following your instructions.`,
  'Reply with ONLY the JSON object { "tickets": [ … ] } and nothing else.',
  ...(problems.length ? ['', 'Your previous answer was rejected by the validator. Fix exactly these problems and answer again:', ...problems.map((p) => `- ${p}`)] : []),
].join('\n');

/** Agent → validated tickets, with one corrective retry. → { ok, tickets, problems, attempts } */
export function split(inputFile, { model = null, run = runAgent, log = () => {} } = {}) {
  let problems = [];
  for (let attempt = 1; attempt <= 2; attempt++) {
    const r = run('ticket-writer', splitPrompt(inputFile, problems), { model, addDirs: [path.dirname(inputFile)] });
    if (!r.ok) return { ok: false, tickets: [], problems: [r.error], attempts: attempt };
    const v = validateTickets(r.json);
    if (v.ok) return { ok: true, tickets: v.tickets, problems: [], attempts: attempt };
    problems = v.problems;
    log(`attempt ${attempt}: ${problems.length} problem(s)`);
  }
  return { ok: false, tickets: [], problems, attempts: 2 };
}

/**
 * Files one card per ticket. `note(ticket)` may add a closing line to the body (feedback evidence).
 * → [{ title, action: 'created'|'skip'|'dry'|'error', id, why, fp }]
 */
export function createTickets({ tickets, kind = KIND, run, status = STATUS.TODO, client, dryRun = false, outDir, note = () => '', fpOf = (t) => fingerprint(t.title), log = () => {} }) {
  if (!dryRun) mkdirSync(outDir, { recursive: true });
  return tickets.map((t, i) => {
    const fp = fpOf(t);
    const result = (action, id, why) => { log(`${action.padEnd(7)} ${t.title}${why ? ` (${why})` : ''}`); return { title: t.title, action, id, why, fp }; };
    try {
      const open = dryRun ? [] : client.findCards([`fp:${fp}`]).filter((c) => c.status !== DONE);  // a dry run never touches Notion
      if (open.length) return result('skip', open[0].id, `open card, status ${open[0].status}`);
      if (dryRun) return result('dry', null, `would file as ${status}`);
      const bodyFile = path.join(outDir, `${String(i + 1).padStart(2, '0')}-${fp}.md`);
      writeFileSync(bodyFile, renderTicket(t, { note: note(t) }));
      const meta = { title: t.title, category: t.category, priority: t.priority, difficulty: t.difficulty, source: sourceOf(kind, fp, run), status };
      return result('created', client.createCard(meta, bodyFile), status);
    } catch (e) {
      return result('error', null, e.message);
    }
  });
}

const readDoc = (file) => {
  if (!file || !existsSync(file)) throw new Error(`no such file: ${file || '(none given)'}`);
  return JSON.parse(readFileSync(file, 'utf8'));
};

export function cli(argv, { log = console.log, err = console.error, client = cliClient, agent = runAgent } = {}) {
  const [cmd, file, ...rest] = argv;
  const flag = (k) => { const i = rest.indexOf(k); return i >= 0 ? rest[i + 1] : null; };
  try {
    if (cmd === 'split') {
      if (!file || !existsSync(file)) throw new Error(`no such file: ${file || '(none given)'}`);
      const id = flag('--run') || runId();
      const dir = ticketsDir(id);
      mkdirSync(dir, { recursive: true });
      const input = path.join(dir, 'input.txt');
      copyFileSync(file, input);  // the agent reads a copy inside the run dir, wherever the original lives
      const r = split(input, { model: flag('--model'), run: agent, log: (l) => err(`tickets split: ${l}`) });
      if (!r.ok) { r.problems.forEach((p) => err(p)); return 1; }
      const out = flag('--out') || path.join(dir, 'tickets.json');
      writeFileSync(out, `${JSON.stringify({ run: id, tickets: r.tickets }, null, 2)}\n`);
      log(`${r.tickets.length} ticket(s) → ${path.relative(ROOT, out)} (attempts: ${r.attempts})`);
      return 0;
    }
    if (!['validate', 'render', 'create'].includes(cmd)) throw new Error('usage: tickets.mjs split|validate|render|create <file> [flags]');
    const doc = readDoc(file);
    const v = validateTickets(doc);
    if (!v.ok) { v.problems.forEach((p) => err(p)); return 1; }
    if (cmd === 'validate') { log(`ok: ${v.tickets.length} ticket(s), ${v.tickets.reduce((n, t) => n + t.acceptance.length, 0)} acceptance criteria`); return 0; }
    if (cmd === 'render') { v.tickets.forEach((t) => log(`# ${t.title}  [${t.category} · ${t.priority}${t.difficulty ? ` · ${t.difficulty}` : ''}]\n\n${renderTicket(t)}`)); return 0; }
    const status = flag('--status') || STATUS.TODO;
    if (![STATUS.BACKLOG, STATUS.TODO].includes(status)) throw new Error(`--status must be "${STATUS.BACKLOG}" or "${STATUS.TODO}"`);
    const dryRun = rest.includes('--dry-run');
    const id = flag('--run') || doc.run || runId();
    const results = createTickets({ tickets: v.tickets, run: id, status, client: dryRun ? null : client(), dryRun, outDir: path.join(ticketsDir(id), 'cards'), log: (l) => err(l) });
    log(JSON.stringify(results, null, 2));
    return results.some((r) => r.action === 'error') ? 1 : 0;
  } catch (e) {
    err(e.message);
    return 2;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) process.exit(cli(process.argv.slice(2)));
