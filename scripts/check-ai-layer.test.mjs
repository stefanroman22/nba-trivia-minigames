import test from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { check, frontmatter, pathRefs } from './check-ai-layer.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** A copy of just what the check reads, so a test can break one thing and see it reported. */
function copy() {
  const root = mkdtempSync(path.join(os.tmpdir(), 'ai-layer-'));
  for (const rel of ['.claude/agents', '.claude/skills', '.claude/models.json', '.claude/README.md', '.github/workflows', 'docs/team/PIPELINE.md', 'backend/backend/settings.py', 'scripts/security/install-tools.sh']) {
    mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    cpSync(path.join(REPO, rel), path.join(root, rel), { recursive: true });
  }
  return root;
}
const edit = (root, rel, fn) => writeFileSync(path.join(root, rel), fn(readFileSync(path.join(root, rel), 'utf8')));
// The copy has none of the files the layer points at, so only look at the kind of problem under test.
const problems = (root, re) => check({ root }).filter((p) => re.test(p));

test('the repository is consistent', () => {
  assert.deepEqual(check(), []);
});

test('helpers', () => {
  assert.deepEqual(frontmatter('---\nname: a\nmodel: opus\n---\nbody'), { name: 'a', model: 'opus' });
  assert.equal(frontmatter('no frontmatter'), null);
  assert.deepEqual(pathRefs('see `scripts/notion.mjs`, `scripts/team/brief.mjs:12-20`, `.team/run/<slug>/brief.md`, `src/app/a|b/page.tsx` and `docs/*.md`'), ['scripts/notion.mjs', 'scripts/team/brief.mjs']);
});

test('an agent whose model differs from the registry, or that is unregistered or unindexed, is reported', () => {
  const root = copy();
  edit(root, '.claude/agents/code-reviewer.md', (s) => s.replace('model: sonnet', 'model: opus'));
  assert.match(problems(root, /code-reviewer/).join('\n'), /model opus, but \.claude\/models\.json says sonnet/);
  edit(root, '.claude/agents/code-reviewer.md', (s) => s.replace('model: opus', 'model: claude-opus-4-8'));
  assert.match(problems(root, /code-reviewer/).join('\n'), /is not an alias/);
  writeFileSync(path.join(root, '.claude/agents/ghost.md'), '---\nname: ghost\ndescription: x\nmodel: sonnet\neffort: high\n---\n');
  const ghost = problems(root, /ghost/).join('\n');
  assert.match(ghost, /not listed under "agents"/);
  assert.match(ghost, /not in the Agents table/);
  rmSync(path.join(root, '.claude/agents/seo.md'));
  assert.match(problems(root, /"seo"/).join('\n'), /has no file/);
});

test('a skill without a valid SKILL.md, an unindexed workflow and a stale CLI pin are reported', () => {
  const root = copy();
  mkdirSync(path.join(root, '.claude/skills/empty'));
  assert.match(problems(root, /skills\/empty/).join('\n'), /no SKILL\.md/);
  writeFileSync(path.join(root, '.github/workflows/new-thing.yml'), 'name: x\non: workflow_dispatch\njobs: {}\n# npm i -g @anthropic-ai/claude-code@1.0.0\n');
  const wf = problems(root, /new-thing/).join('\n');
  assert.match(wf, /not in the Automations tables/);
  assert.match(wf, /pins Claude Code 1\.0\.0/);
});

test('the backend default and the policy doc must follow the registry', () => {
  const root = copy();
  edit(root, 'backend/backend/settings.py', (s) => s.replace('"claude-opus-5-5"', '"claude-opus-5"'));
  assert.match(problems(root, /GAME_BUILDER_MODEL/).join('\n'), /defaults to claude-opus-5, \.claude\/models\.json says claude-opus-5-5/);
  edit(root, 'docs/team/PIPELINE.md', (s) => s.replaceAll('Fable 5.2', 'Fable 5.1'));
  assert.match(problems(root, /PIPELINE/).join('\n'), /does not name Fable 5\.2/);
});

test('a reference to a file that is gone is reported', () => {
  const root = copy();
  const missing = problems(root, /points at scripts\/notion\.mjs/);
  assert.ok(missing.length > 0);  // the copy has no scripts/notion.mjs, and several skills name it
});
