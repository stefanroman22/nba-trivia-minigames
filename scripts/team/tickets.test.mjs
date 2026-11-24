import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { cli, createTickets, split, splitPrompt } from './tickets.mjs';
import { fingerprint, validateTickets } from './lib/ticket.mjs';
import { ticket } from './lib/ticket.test.mjs';

const tmp = () => mkdtempSync(path.join(os.tmpdir(), 'tickets-'));
const fakeClient = (existing = []) => {
  const calls = { find: [], create: [] };
  return {
    calls,
    findCards: (keys) => { calls.find.push(keys); return existing.filter((c) => keys.includes(c.key)); },
    createCard: (m, bodyFile) => { calls.create.push({ m, body: readFileSync(bodyFile, 'utf8') }); return `page-${calls.create.length}`; },
  };
};

test('split: a rejected answer goes back to the agent once, with the reasons', () => {
  const prompts = [];
  const agent = (name, prompt) => {
    prompts.push({ name, prompt });
    return { ok: true, json: { tickets: [prompts.length === 1 ? ticket({ acceptance: [] }) : ticket()] } };
  };
  const r = split('/x/input.txt', { run: agent });
  assert.equal(r.ok, true);
  assert.equal(r.attempts, 2);
  assert.equal(prompts[0].name, 'ticket-writer');
  assert.match(prompts[1].prompt, /rejected by the validator[\s\S]*at least one criterion/);
  assert.equal(split('/x/input.txt', { run: () => ({ ok: true, json: { tickets: [ticket({ acceptance: [] })] } }) }).ok, false);
  assert.deepEqual(split('/x/input.txt', { run: () => ({ ok: false, error: 'claude failed (exit 1)' }) }).problems, ['claude failed (exit 1)']);
  assert.match(splitPrompt('/x/input.txt'), /^Split the text in \/x\/input\.txt/);
});

test('create: one card per ticket, an open card with the same title is skipped', () => {
  const tickets = validateTickets({ tickets: [ticket(), ticket({ title: 'A second ticket to file', difficulty: 'hard' })] }).tickets;
  const client = fakeClient([{ key: `fp:${fingerprint(tickets[0].title)}`, id: 'old', status: 'In progress' }]);
  const outDir = tmp();
  const results = createTickets({ tickets, run: 'r1', client, outDir });
  assert.deepEqual(results.map((r) => [r.action, r.id]), [['skip', 'old'], ['created', 'page-1']]);
  const { m, body } = client.calls.create[0];
  assert.deepEqual(m, { title: 'A second ticket to file', category: 'frontend', priority: 'P1', difficulty: 'hard', source: `ticket-intake fp:${fingerprint('A second ticket to file')} run:r1`, status: 'To Do' });
  assert.match(body, /## Acceptance criteria\n- AC1:/);
  assert.equal(readdirSync(outDir).length, 1);
});

test('create: a shipped (Done) card does not block a new one; a dry run touches nothing', () => {
  const tickets = validateTickets({ tickets: [ticket()] }).tickets;
  const done = fakeClient([{ key: `fp:${fingerprint(tickets[0].title)}`, id: 'old', status: 'Done' }]);
  assert.equal(createTickets({ tickets, run: 'r1', client: done, outDir: tmp() })[0].action, 'created');
  const dry = createTickets({ tickets, run: 'r1', client: null, dryRun: true, status: 'Backlog', outDir: '/nonexistent/never-created' });
  assert.deepEqual([dry[0].action, dry[0].why], ['dry', 'would file as Backlog']);
});

test('cli: validate, render, create --dry-run, and refusing a bad document', () => {
  const dir = tmp();
  const good = path.join(dir, 'good.json'), bad = path.join(dir, 'bad.json');
  writeFileSync(good, JSON.stringify({ tickets: [ticket()] }));
  writeFileSync(bad, JSON.stringify({ tickets: [ticket({ acceptance: ['works'] })] }));
  const run = (...argv) => { const out = [], errs = []; const code = cli(argv, { log: (l) => out.push(l), err: (l) => errs.push(l), client: () => { throw new Error('no Notion in a dry run'); } }); return { code, out: out.join('\n'), errs: errs.join('\n') }; };
  assert.match(run('validate', good).out, /ok: 1 ticket\(s\), 2 acceptance criteria/);
  assert.match(run('render', good).out, /# Show the daily streak[\s\S]*## Scope/);
  const dry = run('create', good, '--dry-run', '--status', 'Backlog');
  assert.equal(dry.code, 0);
  assert.equal(JSON.parse(dry.out)[0].action, 'dry');
  const refused = run('create', bad, '--dry-run');
  assert.equal(refused.code, 1);
  assert.match(refused.errs, /names no outcome/);
  assert.equal(run('create', good, '--status', 'Done').code, 2);
  assert.equal(run('frobnicate', good).code, 2);
});
