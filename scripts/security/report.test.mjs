// node --test scripts/security/report.test.mjs — ticket, PR comment, fix spec (lib/report.mjs) and detector parsing (lib/detect.mjs).
import assert from 'node:assert/strict';
import test from 'node:test';
import { detectSteps } from '../team/lib/steps.mjs';
import { addedLines, parseClaudeResult } from './lib/detect.mjs';
import { fixSpec, groupFindings, prComment, weeklyTicket } from './lib/report.mjs';

const mk = (fp, o = {}) => ({ fingerprint: fp, tool: 'claude', rule: 'idor', category: 'idor', priority: 1, severity: 'high', confidence: 9, title: `t-${fp}`, file: 'backend/users/views.py', line: 10, snippet: 'x', exploitPath: `path-${fp}`, fix: [`Scope the query in \`backend/users/views.py\``], acceptance: 'B gets 404', verify: 'backend/users/tests/test_x.py asserts 404', rootCause: 'unscoped-rooms', area: 'backend', ...o });
const secret = mk('s1', { tool: 'gitleaks', category: 'secret', priority: 4, severity: 'critical', rootCause: 'leaked-secrets', file: '.env', area: 'other', fix: ['Revoke / rotate it first.', 'Read it from the environment in `.env`.'] });
const low = mk('l1', { severity: 'low', category: 'data-leak', priority: 3, rootCause: 'log-email', area: 'backend' });

test('groups: one per root cause and area, most severe first; all secrets in one group', () => {
  const g = groupFindings([low, mk('a'), mk('b'), secret, mk('c', { area: 'frontend', file: 'src/x.ts' })]);
  assert.deepEqual(g.map((x) => x.key), ['leaked-secrets', 'unscoped-rooms::backend', 'unscoped-rooms::frontend', 'log-email::backend']);
  assert.equal(g[1].findings.length, 2);
});

test('weekly ticket: P0 for high+, numbered steps across groups name files (the brief takes them as the plan), secrets say revoke first', () => {
  const t = weeklyTicket([mk('a'), mk('b', { file: 'backend/users/rooms.py', fix: ['Check membership in `backend/users/rooms.py`'] }), secret, low], { date: '2026-10-30', runId: 'r1' });
  assert.equal(t.priority, 'P0');
  assert.match(t.title, /^\[security\] Weekly scan 2026-10-30: 4 new \(1 critical, 2 high, 1 low\)$/);
  assert.match(t.source, /^security-check fp:a,b,s1,l1|^security-check fp:/);
  assert.match(t.body, /Owner actions first[\s\S]*Revoke \/ rotate every credential/);
  assert.match(t.body, /Deleting it from the code alone is not a fix/);
  const steps = detectSteps(t.body);
  assert.equal(steps.hasPlan, true);
  assert.deepEqual(steps.steps.map((s) => s.n), steps.steps.map((_, i) => i + 1));
  assert.ok(t.body.indexOf('Leaked secrets') < t.body.indexOf('t-a'));
  for (const h of ['### Affected files', '### Why it is exploitable', '### Fix steps', '### Acceptance criteria', '### How to verify (test to add)']) assert.ok(t.body.includes(h), h);
});

test('PR comment: no exploit paths (public repo), one marker, secret warning', () => {
  const c = prComment({ blockingFindings: [mk('a'), secret], otherFindings: [low], result: 'fail', rounds: 2, maxRounds: 2, autofix: true });
  assert.ok(c.startsWith('<!-- security-scan -->'));
  assert.ok(!c.includes('path-a') && !c.includes('path-l1'));
  assert.match(c, /a human has to fix or dismiss/);
  assert.match(c, /revoke \/ rotate it at the provider now/);
  assert.match(prComment({ result: 'pass' }), /No findings with confidence ≥ 8/);
});

test('fix spec: numbered steps naming files, then the findings with their exploit path', () => {
  const s = fixSpec([low, mk('a')], { branch: 'feat/x', pr: 12, round: 1 });
  assert.equal(detectSteps(s).steps.length, 2);
  assert.match(s, /path-a/);
  assert.match(s, /PR #12 → main/);
});

test('addedLines: added line numbers of the head side per file', () => {
  const diff = ['diff --git a/a.py b/a.py', '--- a/a.py', '+++ b/a.py', '@@ -3,0 +4,2 @@', '+x = 1', '+y = 2', '@@ -9 +11 @@', '-old', '+new', 'diff --git a/gone.py b/gone.py', '--- a/gone.py', '+++ /dev/null', '@@ -1 +0,0 @@', '-z'].join('\n');
  const m = addedLines(diff);
  assert.deepEqual([...m.get('a.py')], [4, 5, 11]);
  assert.equal(m.has('gone.py'), false);
});

test('parseClaudeResult: fenced or bare JSON; no findings array throws', () => {
  assert.deepEqual(parseClaudeResult('Done.\n```json\n{"findings": []}\n```'), []);
  assert.equal(parseClaudeResult('x {"findings": [{"rule": "a"}]} y').length, 1);
  assert.throws(() => parseClaudeResult('{"nope": 1}'));
});
