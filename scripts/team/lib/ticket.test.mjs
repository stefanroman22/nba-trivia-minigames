import test from 'node:test';
import assert from 'node:assert/strict';
import { acceptanceOf, fingerprint, renderTicket, sourceOf, ticketProblems, validateTickets, normalize } from './ticket.mjs';
import { detectSteps } from './steps.mjs';

export const ticket = (over = {}) => ({
  title: 'Show the daily streak on the profile page',
  category: 'frontend',
  priority: 'P1',
  context: 'Players earn a daily streak but can only see it right after a game.',
  scope: ['Add a streak tile to `src/views/ProfileSettings.tsx`.'],
  acceptance: ['The profile page shows the current streak as a number of days.', 'A player with no streak sees 0, not an empty tile.'],
  ...over,
});

test('a complete ticket is valid', () => {
  assert.deepEqual(ticketProblems(ticket()), []);
  assert.equal(validateTickets({ tickets: [ticket()] }).ok, true);
});

test('acceptance criteria are required and must be checkable', () => {
  assert.match(ticketProblems(ticket({ acceptance: [] })).join(' '), /at least one criterion/);
  for (const vague of ['It works.', 'works well', 'The feature is done', 'No bugs', 'looks good']) {
    assert.match(ticketProblems(ticket({ acceptance: [vague] })).join(' '), /names no outcome/, vague);
  }
  assert.match(ticketProblems(ticket({ acceptance: ['1. The streak tile is visible on the profile page.'] })).join(' '), /must not start with a number/);
  assert.match(ticketProblems(ticket({ acceptance: ['The tile shows the streak.', 'the tile shows the streak.'] })).join(' '), /repeats/);
});

test('fields are checked against the board vocabulary', () => {
  const p = ticketProblems(ticket({ category: 'design', priority: 'high', difficulty: 'epic', scope: [], context: '', extra: 1 })).join(' ');
  for (const part of ['"category"', '"priority"', '"difficulty"', '"scope"', '"context"', 'unknown key "extra"']) assert.ok(p.includes(part), part);
});

test('a document: duplicate titles, unknown dependencies, empty', () => {
  assert.equal(validateTickets({}).ok, false);
  assert.equal(validateTickets({ tickets: [] }).ok, false);
  const dup = validateTickets({ tickets: [ticket(), ticket()] });
  assert.match(dup.problems.join(' '), /title repeats tickets\[0\]/);
  const dep = validateTickets({ tickets: [ticket({ depends_on: ['Something else'] })] });
  assert.match(dep.problems.join(' '), /depends_on "Something else"/);
  const ok = validateTickets({ tickets: [ticket(), ticket({ title: 'Second one that builds on it', depends_on: ['show the daily streak on the profile page'] })] });
  assert.equal(ok.ok, true, ok.problems.join('\n'));
});

test('the card body reads back: criteria survive the round trip and are never plan steps', () => {
  const t = normalize(ticket({ out_of_scope: ['The leaderboard.'], files: ['src/views/ProfileSettings.tsx'] }));
  const body = renderTicket(t, { note: 'Filed by a test.' });
  assert.match(body, /## Acceptance criteria\n- AC1: The profile page shows/);
  assert.deepEqual(acceptanceOf(body), t.acceptance.map((text, i) => ({ id: `AC${i + 1}`, text })));
  assert.equal(detectSteps(body).steps.length, 0);
  assert.match(body, /## Out of scope\n- The leaderboard\./);
  assert.ok(body.trimEnd().endsWith('Filed by a test.'));
});

test('acceptanceOf reads hand-written cards too', () => {
  const spec = ['Make the tile.', '', 'Acceptance:', '- [ ] Tile is visible on mobile', '* AC7. Tile has an aria-label', '', '## Notes', '- not a criterion'].join('\n');
  assert.deepEqual(acceptanceOf(spec).map((a) => a.text), ['Tile is visible on mobile', 'Tile has an aria-label']);
  assert.deepEqual(acceptanceOf('No section here.\n- a bullet'), []);
});

test('fingerprint ignores case and punctuation; the Source carries it', () => {
  assert.equal(fingerprint('Show the daily streak!'), fingerprint('  show the DAILY streak '));
  assert.notEqual(fingerprint('a'), fingerprint('b'));
  assert.equal(sourceOf('feedback', 'abc', 'r1'), 'feedback fp:abc run:r1');
});

test('briefAcceptance reads the brief\'s own list, not the copy inside the spec', async () => {
  const { briefAcceptance, BRIEF_ACCEPTANCE } = await import('./ticket.mjs');
  const brief = ['# Brief', '## Spec', '## Acceptance criteria', '- AC1: from the card', '', BRIEF_ACCEPTANCE, '- AC1: canonical one', '- AC2: canonical two', '', '_From the card._', '', '## Attachments', '- x'].join('\n');
  assert.deepEqual(briefAcceptance(brief).map((a) => a.text), ['canonical one', 'canonical two']);
  assert.deepEqual(briefAcceptance(`${BRIEF_ACCEPTANCE}\n_The card has none. Planner: replace this paragraph._\n\n## Attachments`), []);
  assert.deepEqual(briefAcceptance('# no such section'), []);
});
