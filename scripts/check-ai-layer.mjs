#!/usr/bin/env node
// Drift check for the AI layer (.claude/README.md). Fails when the pieces disagree:
//   - an agent file's frontmatter is incomplete, or its model is not the one .claude/models.json records
//   - a skill folder has no valid SKILL.md
//   - an agent, a skill or a workflow is missing from the index in .claude/README.md
//   - a workflow or script pins a different Claude Code version than models.json
//   - the backend's default game-builder model is not the registry's
//   - docs/team/PIPELINE.md does not name the current models
//   - an agent, skill or workflow points at a repo file that does not exist
//   - the classify eval (.claude/hillclimb/, borrowed from the eval/classify branch) is tracked here
// Usage: node scripts/check-ai-layer.mjs   (part of `npm run lint`)
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'];
// A backticked path counts as a reference when it starts at one of these roots and names a file.
const PATH_RE = /`((?:\.claude|\.github|scripts|docs|src|backend|infra|multiplayer_server)\/[^`\s]+?\.(?:md|mjs|js|cjs|ts|tsx|py|json|yml|sh|ps1|css|txt))(?::\d+(?:-\d+)?)?`/g;
// Placeholders (<slug>, *, {a,b}, …) and files a run creates are not references to check.
const NOT_A_REFERENCE = /[<>*{}|…]|^\.team\/|\/\.team\/|^backend\/ops\/|\.ui-check\//;
// Paths a document names on purpose although they are absent from a checkout: outputs written by a run, files that
// live on another branch, and files quoted in an explanation of what must not exist.
const ABSENT_ON_PURPOSE = new Set([
  'docs/seo/owner-actions.md',
]);

export function frontmatter(text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  if (!m) return null;
  return Object.fromEntries(m[1].split(/\r?\n/).map((l) => /^([\w-]+):\s*(.*)$/.exec(l)).filter(Boolean).map((x) => [x[1], x[2].trim()]));
}

export function pathRefs(text) {
  return [...new Set([...text.matchAll(PATH_RE)].map((m) => m[1]).filter((p) => !NOT_A_REFERENCE.test(p)))];
}

/** Every problem as one line; an empty list means the layer is consistent. */
export function check({ root = ROOT } = {}) {
  const problems = [];
  const read = (rel) => readFileSync(path.join(root, rel), 'utf8');
  const exists = (rel) => existsSync(path.join(root, rel));
  const registry = JSON.parse(read('.claude/models.json'));
  const aliases = Object.keys(registry.aliases);
  const index = read('.claude/README.md');
  const sources = [];  // [relative path, text] of everything whose path references are checked

  // --- agents
  const agentFiles = readdirSync(path.join(root, '.claude/agents')).filter((f) => f.endsWith('.md')).sort();
  for (const file of agentFiles) {
    const rel = `.claude/agents/${file}`;
    const name = file.replace(/\.md$/, '');
    const text = read(rel);
    sources.push([rel, text]);
    const fm = frontmatter(text);
    if (!fm) { problems.push(`${rel}: no frontmatter`); continue; }
    if (fm.name !== name) problems.push(`${rel}: frontmatter name "${fm.name}" is not the file name`);
    if (!fm.description) problems.push(`${rel}: no description`);
    if (!aliases.includes(fm.model)) problems.push(`${rel}: model "${fm.model}" is not an alias of .claude/models.json (${aliases.join(', ')})`);
    if (!EFFORTS.includes(fm.effort)) problems.push(`${rel}: effort "${fm.effort}" is not one of ${EFFORTS.join(', ')}`);
    const recorded = registry.agents[name];
    if (!recorded) problems.push(`${rel}: not listed under "agents" in .claude/models.json`);
    else if (recorded !== fm.model) problems.push(`${rel}: model ${fm.model}, but .claude/models.json says ${recorded}`);
    if (!index.includes(`\`${name}\``)) problems.push(`${rel}: not in the Agents table of .claude/README.md`);
  }
  for (const name of Object.keys(registry.agents)) {
    if (!agentFiles.includes(`${name}.md`)) problems.push(`.claude/models.json: agent "${name}" has no file in .claude/agents/`);
  }

  // --- skills
  for (const dir of readdirSync(path.join(root, '.claude/skills'), { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort()) {
    const rel = `.claude/skills/${dir}/SKILL.md`;
    if (!exists(rel)) { problems.push(`.claude/skills/${dir}/: no SKILL.md`); continue; }
    const text = read(rel);
    sources.push([rel, text]);
    const fm = frontmatter(text);
    if (!fm || fm.name !== dir) problems.push(`${rel}: frontmatter name must be "${dir}"`);
    if (!fm?.description) problems.push(`${rel}: no description`);
    if (!index.includes(`\`${dir}\``)) problems.push(`${rel}: not in the Skills table of .claude/README.md`);
  }

  // --- workflows: indexed, and on the registry's Claude Code version
  const pins = [];
  for (const file of readdirSync(path.join(root, '.github/workflows')).filter((f) => /\.ya?ml$/.test(f)).sort()) {
    const rel = `.github/workflows/${file}`;
    const text = read(rel);
    sources.push([rel, text.replace(/(\.claude\/(?:agents|skills)\/[\w./-]+\.md)/g, '`$1`')]);
    if (!index.includes(`\`${file}\``)) problems.push(`${rel}: not in the Automations tables of .claude/README.md`);
    for (const m of text.matchAll(/claude-code@([\d.]+)/g)) pins.push([rel, m[1]]);
  }
  const tools = 'scripts/security/install-tools.sh';
  if (exists(tools)) for (const m of read(tools).matchAll(/^CLAUDE_VERSION=([\d.]+)$/gm)) pins.push([tools, m[1]]);
  for (const [rel, version] of pins) {
    if (version !== registry.claudeCode) problems.push(`${rel}: pins Claude Code ${version}, .claude/models.json says ${registry.claudeCode}`);
  }

  // --- the runtime default and the policy doc follow the registry
  for (const [feature, r] of Object.entries(registry.runtime || {})) {
    const want = registry.aliases[r.model]?.id;
    const m = new RegExp(`${r.setting}\\s*=\\s*os\\.environ\\.get\\("${r.setting}",\\s*"([^"]+)"\\)`).exec(read(r.file));
    if (!m) problems.push(`${r.file}: no default for ${r.setting} (runtime "${feature}")`);
    else if (m[1] !== want) problems.push(`${r.file}: ${r.setting} defaults to ${m[1]}, .claude/models.json says ${want}`);
  }
  const policy = read('docs/team/PIPELINE.md');
  for (const a of Object.values(registry.aliases)) {
    if (!policy.includes(a.name)) problems.push(`docs/team/PIPELINE.md: does not name ${a.name} (the model policy is out of date)`);
    if (!index.includes(a.name)) problems.push(`.claude/README.md: does not name ${a.name}`);
  }

  // --- the classify eval's answer key stays on its own branch: classify greps the repo and would read it
  const tracked = spawnSync('git', ['-C', root, 'ls-files', '--', '.claude/hillclimb'], { encoding: 'utf8' });
  if (tracked.status === 0 && tracked.stdout.trim()) problems.push('.claude/hillclimb/ is tracked: the classify eval must stay on the eval/classify branch (scripts/team/eval-classify.mjs borrows it for a run)');

  // --- nothing points at a file that is gone
  for (const [rel, text] of sources) {
    for (const ref of pathRefs(text)) {
      if (!exists(ref) && !ABSENT_ON_PURPOSE.has(ref)) problems.push(`${rel}: points at ${ref}, which does not exist`);
    }
  }
  return problems;
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const problems = check();
  for (const p of problems) console.error(`check:ai  ${p}`);
  if (problems.length) { console.error(`check:ai  ${problems.length} problem(s)`); process.exit(1); }
  console.log('check:ai  ok');
}
