// node --test scripts/security/finding.test.mjs — one finding shape and stable fingerprints (lib/finding.mjs).
import assert from 'node:assert/strict';
import test from 'node:test';
import { applyIgnore, blocking, dedupe, fromClaude, fromGitleaks, fromOsv, locate, priorityOf } from './lib/finding.mjs';

const VIEW = ['from django.db import connection', '', 'def search(request):', '    q = request.GET["q"]', '    cursor.execute(f"SELECT * FROM users WHERE name = \'{q}\'")'].join('\n');
const raw = { rule: 'SQL Injection', category: 'injection', title: 'User input in raw SQL', file: 'backend/users/views.py', line: 5, snippet: 'cursor.execute(f"SELECT * FROM users WHERE name = \'{q}\'")', severity: 'high', confidence: 9, exploitPath: 'GET q → cursor.execute', fix: ['1. Use params'], rootCause: 'raw-sql-users' };

test('claude: the snippet is located in the file, so the line comes from the code', () => {
  const f = fromClaude({ ...raw, line: 99 }, () => VIEW);
  assert.equal(f.line, 5);
  assert.equal(f.rule, 'sql-injection');
  assert.equal(f.priority, 1);
  assert.deepEqual(f.fix, ['Use params']);
  assert.equal(f.area, 'backend');
});

test('fingerprint: unchanged when code above the sink moves, changed when the sink changes', () => {
  const a = fromClaude(raw, () => VIEW);
  const b = fromClaude({ ...raw, line: 12 }, () => `# a new header comment\n\n\n${VIEW}`);
  assert.equal(a.fingerprint, b.fingerprint);
  assert.notEqual(b.line, a.line);
  const c = fromClaude({ ...raw, snippet: 'cursor.execute("SELECT 1")' }, () => VIEW.replace(/cursor\.execute\(.*\)$/m, 'cursor.execute("SELECT 1")'));
  assert.notEqual(a.fingerprint, c.fingerprint);
});

test('locate: whitespace-insensitive, then a prefix match for a shortened snippet', () => {
  assert.equal(locate('a\n   x  =  1\nb', 'x = 1').line, 2);
  assert.equal(locate('one\n    return render(request, template_name, ctx)\n', 'return render(request, template_name').line, 2);
  assert.equal(locate('a\nb', 'zzz'), null);
});

test('gitleaks: the secret is hashed into the fingerprint and never kept', () => {
  const g = { RuleID: 'generic-api-key', Description: 'Generic API Key', File: '/repo/backend/settings.py', StartLine: 7, Secret: 'not-a-real-value-123', Match: 'KEY = "not-a-real-value-123"', Commit: 'abcdef1234567890', Date: '2026-01-02T00:00:00Z' };
  const f = fromGitleaks(g);
  assert.equal(f.file, 'backend/settings.py');
  assert.equal(f.category, 'secret');
  assert.equal(f.severity, 'critical');
  assert.ok(!JSON.stringify(f).includes('not-a-real-value-123'));
  assert.match(f.fix[0], /^Revoke \/ rotate/);
  assert.match(f.fix.join(' '), /purge it from git history/);
  assert.notEqual(f.fingerprint, fromGitleaks({ ...g, Secret: 'another-value' }).fingerprint);
  assert.equal(f.fingerprint, fromGitleaks({ ...g, StartLine: 40, Commit: 'ffff' }).fingerprint);
});

test('osv: one finding per package version (all advisories), max severity, highest fixed version, path relative to root', () => {
  const adv = (id, fixed) => ({ id, summary: `issue ${id}`, affected: [{ package: { name: 'socket.io-parser' }, ranges: [{ events: [{ introduced: '0' }, { fixed }] }] }] });
  const report = { results: [{ source: { path: '/w/repo/multiplayer_server/package-lock.json' }, packages: [{
    package: { name: 'socket.io-parser', version: '4.2.1', ecosystem: 'npm' },
    vulnerabilities: [adv('GHSA-aaaa', '4.2.3'), adv('GHSA-bbbb', '4.2.10')],
    groups: [{ ids: ['GHSA-aaaa'], max_severity: '5.3' }, { ids: ['GHSA-bbbb'], max_severity: '7.5' }],
  }] }] };
  const out = fromOsv(report, { root: '/w/repo' });
  assert.equal(out.length, 1);
  const [f] = out;
  assert.equal(f.file, 'multiplayer_server/package-lock.json');
  assert.equal(f.severity, 'high');
  assert.match(f.fix[0], /to 4\.2\.10 or later/);
  assert.doesNotMatch(f.fix[0], /pip/);
  assert.match(f.title, /2 advisories/);
  assert.equal(f.rootCause, 'deps-multiplayer-server-package-lock-json');
  // a newly published advisory against the same version keeps the fingerprint
  report.results[0].packages[0].vulnerabilities.push(adv('GHSA-cccc', '4.2.11'));
  assert.equal(fromOsv(report, { root: '/w/repo' })[0].fingerprint, f.fingerprint);
});

test('dedupe keeps the strongest, ignore mutes by fingerprint until its date, blocking = high+ at confidence ≥ 8', () => {
  const a = fromClaude(raw, () => VIEW);
  const weak = { ...a, severity: 'medium', confidence: 8 };
  assert.equal(dedupe([weak, a])[0].severity, 'high');
  const leak = { ...a, fingerprint: 'g1', tool: 'gitleaks', category: 'secret', line: 8 };
  const same = { ...a, fingerprint: 'c1', category: 'secret', line: 9 };
  assert.deepEqual(dedupe([leak, same, a]).map((x) => x.fingerprint).sort(), [a.fingerprint, 'g1'].sort(), 'the review re-reporting a gitleaks leak is dropped');
  assert.equal(applyIgnore([a], [{ fingerprint: a.fingerprint, reason: 'fp' }]).length, 0);
  assert.equal(applyIgnore([a], [{ fingerprint: a.fingerprint }]).length, 1, 'no reason, no mute');
  assert.equal(applyIgnore([a], [{ fingerprint: a.fingerprint, reason: 'x', until: '2000-01-01' }]).length, 1);
  assert.equal(blocking(a), true);
  assert.equal(blocking({ ...a, confidence: 7 }), false);
  assert.equal(blocking({ ...a, severity: 'medium' }), false);
  assert.equal(blocking({ ...a, historyOnly: true }), false, 'a secret only in old PR commits cannot be fixed by a commit');
});

test('cardOf: the 32-hex Notion id at the end of the URL, never a hex-looking title word', async () => {
  const { cardOf } = await import('./run.mjs');
  const id = '3be2cfb1c595816e9ff8fa0909d3641f';
  assert.equal(cardOf(`fix: x\n\nNotion: https://www.notion.so/Fix-the-bad-${id}\nCategory: backend`), id);
  assert.equal(cardOf(`Notion: https://www.notion.so/${id}?pvs=4`), id);
  assert.equal(cardOf('Notion: https://www.notion.so/3be2cfb1-c595-816e-9ff8-fa0909d3641f'), '3be2cfb1-c595-816e-9ff8-fa0909d3641f');
  assert.equal(cardOf('no card here'), null);
});

test('priority order: exploitable 1, db exposure 2, data leak 3, secret 4, rest 5', () => {
  assert.deepEqual(['idor', 'db-exposure', 'data-leak', 'secret', 'dependency', 'other'].map(priorityOf), [1, 2, 3, 4, 5, 5]);
});
