import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { file, seenText, triage } from './run.mjs';
import { appliedDoc, evidenceNote, validateTriage } from './lib/triage.mjs';
import { fingerprint } from '../team/lib/ticket.mjs';
import { ticket } from '../team/lib/ticket.test.mjs';

const batch = {
  run: '20261124-2100',
  items: [
    { id: 1, rating: 2, message: 'Wordle froze on my phone', page: '/wordle', game: 'wordle', day: '2026-11-20', signed_in: true },
    { id: 2, rating: 1, message: 'wordle stuck after 3rd guess', page: '/wordle', game: 'wordle', day: '2026-11-21', signed_in: false },
    { id: 3, rating: 5, message: 'love it', page: '/', game: '', day: '2026-11-21', signed_in: false },
  ],
};
const answer = (over = {}) => ({
  items: [
    { id: 1, kind: 'bug', summary: 'Wordle freezes on mobile', cluster: 'wordle-freeze' },
    { id: 2, kind: 'bug', summary: 'Wordle freezes after the third guess', cluster: 'wordle-freeze' },
    { id: 3, kind: 'praise', summary: 'Likes the site', cluster: 'praise' },
  ],
  tickets: [ticket({ title: 'Wordle freezes on phones mid-game', category: 'frontend', evidence: [1, 2] })],
  ...over,
});
const outDir = () => mkdtempSync(path.join(os.tmpdir(), 'feedback-'));
const fakeClient = (existing = []) => {
  const calls = { create: [], comment: [] };
  return {
    calls,
    findCards: (keys) => existing.filter((c) => keys.includes(c.key)),
    createCard: (m, bodyFile) => { calls.create.push({ m, body: readFileSync(bodyFile, 'utf8') }); return `page-${calls.create.length}`; },
    comment: (id, text) => calls.comment.push([id, text]),
  };
};

test('every exported item needs exactly one verdict', () => {
  assert.equal(validateTriage(batch, answer()).ok, true);
  const missing = validateTriage(batch, answer({ items: answer().items.slice(0, 2), tickets: [] }));
  assert.match(missing.problems.join(' '), /feedback 3 has no verdict/);
  const extra = validateTriage(batch, answer({ items: [...answer().items, { id: 99, kind: 'bug', summary: 'x' }] }));
  assert.match(extra.problems.join(' '), /id 99 is not in the batch/);
  const twice = validateTriage(batch, answer({ items: [...answer().items, answer().items[0]] }));
  assert.match(twice.problems.join(' '), /id 1 has two verdicts/);
  assert.match(validateTriage(batch, answer({ items: answer().items.map((i) => ({ ...i, kind: 'urgent' })), tickets: [] })).problems.join(' '), /kind "urgent"/);
  assert.equal(validateTriage(batch, { tickets: [] }).ok, false);
});

test('a ticket must be backed by actionable feedback from this batch, used once', () => {
  const t = answer().tickets[0];
  const check = (tickets) => validateTriage(batch, answer({ tickets })).problems.join(' ');
  assert.match(check([{ ...t, evidence: [] }]), /"evidence" must list/);
  assert.match(check([{ ...t, evidence: [1, 77] }]), /evidence 77 is not in the batch/);
  assert.match(check([{ ...t, evidence: [3] }]), /evidence 3 is "praise", which never becomes a ticket/);
  assert.match(check([t, { ...t, title: 'Another ticket from the same report', evidence: [2] }]), /evidence 2 is already used by tickets\[0\]/);
  assert.match(check([{ ...t, acceptance: [] }]), /at least one criterion/);
});

test('triage: an empty batch needs no model; a bad answer is retried once with the reasons', () => {
  assert.deepEqual(triage({ run: 'r', items: [] }, '/x/batch.json', { run: () => { throw new Error('must not run'); } }), { ok: true, items: [], tickets: [], attempts: 0 });
  const prompts = [];
  const agent = (name, prompt) => { prompts.push([name, prompt]); return { ok: true, json: prompts.length === 1 ? answer({ tickets: [{ ...answer().tickets[0], evidence: [3] }] }) : answer() }; };
  const r = triage(batch, '/x/batch.json', { run: agent });
  assert.deepEqual([r.ok, r.attempts, r.tickets.length], [true, 2, 1]);
  assert.equal(prompts[0][0], 'feedback-triage');
  assert.match(prompts[1][1], /rejected by the validator[\s\S]*never becomes a ticket/);
});

test('file: feedback cards always land in Backlog, with numbers but no player text', () => {
  const client = fakeClient();
  const r = file(batch, answer(), { client, outDir: outDir() });
  assert.equal(r.ok, true);
  const { m, body } = client.calls.create[0];
  assert.equal(m.status, 'Backlog');
  assert.equal(m.source, `feedback fp:${fingerprint('Wordle freezes on phones mid-game')} run:20261124-2100`);
  assert.match(body, /Filed by the feedback-triage agent from 2 player report\(s\) \(feedback ids 1, 2; average rating 1\.5\/5\)/);
  for (const i of batch.items) assert.equal(body.includes(i.message), false);
  assert.deepEqual(r.applied, { run: '20261124-2100', items: [
    { id: 1, kind: 'bug', summary: 'Wordle freezes on mobile', cluster: 'wordle-freeze', ticket: 'page-1' },
    { id: 2, kind: 'bug', summary: 'Wordle freezes after the third guess', cluster: 'wordle-freeze', ticket: 'page-1' },
    { id: 3, kind: 'praise', summary: 'Likes the site', cluster: 'praise', ticket: '' },
  ] });
});

test('file: a repeat report comments on the open card instead of filing a second one', () => {
  const client = fakeClient([{ key: `fp:${fingerprint('Wordle freezes on phones mid-game')}`, id: 'open-card', status: 'Backlog' }]);
  const r = file(batch, answer(), { client, outDir: outDir() });
  assert.equal(client.calls.create.length, 0);
  assert.deepEqual(client.calls.comment, [['open-card', seenText('20261124-2100', 2)]]);
  assert.equal(r.applied.items[0].ticket, 'open-card');
  assert.equal(file(batch, answer({ tickets: [{ ...answer().tickets[0], evidence: [] }] }), { client, outDir: outDir() }).ok, false);
});

test('a dry run files nothing and still produces the verdict rows', () => {
  const r = file(batch, answer(), { client: null, dryRun: true });
  assert.deepEqual(r.results.map((x) => x.action), ['dry']);
  assert.equal(r.applied.items.length, 3);
  assert.equal(evidenceNote({ evidence: [3] }, batch).includes('average rating 5.0/5'), true);
  assert.deepEqual(appliedDoc(batch, [], [], []), { run: batch.run, items: [] });
});
