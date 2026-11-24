import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { agentEnv, agentMeta, extractJson, runAgent } from './claude-agent.mjs';

const repo = () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'agent-'));
  mkdirSync(path.join(root, '.claude', 'agents'), { recursive: true });
  writeFileSync(path.join(root, '.claude', 'agents', 'ticket-writer.md'), '---\nname: ticket-writer\ndescription: Splits text: into tickets\nmodel: opus\neffort: high\n---\n\nBody.\n');
  return root;
};

test('agentMeta reads the frontmatter', () => {
  assert.deepEqual(agentMeta('ticket-writer', { root: repo() }), { name: 'ticket-writer', description: 'Splits text: into tickets', model: 'opus', effort: 'high' });
  assert.throws(() => agentMeta('nope', { root: repo() }), /no agent file/);
});

test('extractJson: fenced, bare, and nothing', () => {
  assert.deepEqual(extractJson('Here:\n```json\n{"a": 1}\n```'), { a: 1 });
  assert.deepEqual(extractJson('prefix {"a": {"b": 2}} suffix'), { a: { b: 2 } });
  assert.throws(() => extractJson('no object'), /no JSON object/);
});

test('agentEnv drops credentials but keeps the Claude login', () => {
  const env = agentEnv({ PATH: '/bin', NOTION_TOKEN: 'n', SLACK_BOT_TOKEN: 's', DATABASE_URL: 'postgres://', DJANGO_SECRET_KEY: 'k', GH_TOKEN: 'g', GOOGLE_SEO_CLIENT: 'c', CLAUDE_CODE_OAUTH_TOKEN: 'keep', HOME: '/h' });
  assert.deepEqual(Object.keys(env).sort(), ['CLAUDE_CODE_OAUTH_TOKEN', 'HOME', 'PATH']);
});

test('runAgent: a read-only claude -p run of the agent file, prompt on stdin', () => {
  const calls = [];
  const spawn = (cmd, args, opts) => { calls.push({ cmd, args, opts }); return { status: 0, stdout: JSON.stringify({ is_error: false, result: '```json\n{"tickets": []}\n```' }), stderr: '' }; };
  const root = repo();
  const r = runAgent('ticket-writer', 'the task', { root, spawn, env: { PATH: '/bin', NOTION_TOKEN: 'n' }, addDirs: ['/tmp/in'] });
  assert.deepEqual(r, { ok: true, json: { tickets: [] }, model: 'opus' });
  const { cmd, args, opts } = calls[0];
  assert.equal(cmd, 'claude');
  assert.deepEqual(args.slice(0, 5), ['-p', '--agent', 'ticket-writer', '--model', 'opus']);
  assert.equal(args[args.indexOf('--allowedTools') + 1], 'Read,Grep,Glob');
  assert.match(args[args.indexOf('--disallowedTools') + 1], /^Bash,Edit,Write,/);
  assert.equal(args[args.indexOf('--add-dir') + 1], '/tmp/in');
  assert.equal(args.includes('--dangerously-skip-permissions'), false);
  assert.deepEqual([opts.input, opts.cwd, opts.env.NOTION_TOKEN], ['the task', root, undefined]);
  assert.equal(runAgent('ticket-writer', 'x', { root, spawn, model: 'sonnet' }).model, 'sonnet');
});

test('runAgent reports failures instead of throwing', () => {
  const root = repo();
  assert.match(runAgent('missing', 'x', { root }).error, /no agent file/);
  assert.match(runAgent('ticket-writer', 'x', { root, spawn: () => ({ status: 1, stdout: '', stderr: 'boom\nnot logged in' }) }).error, /exit 1\): not logged in/);
  assert.match(runAgent('ticket-writer', 'x', { root, spawn: () => ({ status: 0, stdout: JSON.stringify({ is_error: true, subtype: 'error_max_turns' }) }) }).error, /error_max_turns/);
  assert.match(runAgent('ticket-writer', 'x', { root, spawn: () => ({ status: 0, stdout: JSON.stringify({ result: 'I could not.' }) }) }).error, /not readable JSON/);
});
