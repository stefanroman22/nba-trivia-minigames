// Runs one .claude/agents/<name>.md agent headless and returns the JSON object it answers with.
//
// For agents that read untrusted text (user feedback, a pasted brain-dump) and whose only job is to return a
// document: the agent gets Read, Grep and Glob and nothing else, no credential the caller holds reaches its
// environment, and every write (Notion cards, database rows) is done by the calling script after it has validated
// the answer. The agent file is the single source for the role, its model and its effort.
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { ROOT } from './team-config.mjs';

const WIN = process.platform === 'win32';
const READ_ONLY = ['--allowedTools', 'Read,Grep,Glob',
  '--disallowedTools', 'Bash,Edit,Write,NotebookEdit,WebFetch,WebSearch,Agent,Read(//proc/**),Grep(//proc/**)'];
// Tokens and connection strings the calling script may hold; an agent that only reads files needs none of them.
const SECRET_ENV = /(^|_)(TOKEN|SECRET|PASSWORD|KEY)$|^DATABASE_URL$|^REDIS_URL$|^GOOGLE_SEO_/;
// The agent's own credential is the one secret it does need.
const KEEP_ENV = /^(CLAUDE_CODE_OAUTH_TOKEN|ANTHROPIC_API_KEY)$/;

/** `env` without anything that looks like a credential (the Claude login itself is kept). */
export function agentEnv(env = process.env) {
  return Object.fromEntries(Object.entries(env).filter(([k]) => KEEP_ENV.test(k) || !SECRET_ENV.test(k)));
}

/** The frontmatter of an agent file as { name, description, model, effort, … }; throws when the file is missing. */
export function agentMeta(name, { root = ROOT } = {}) {
  const file = path.join(root, '.claude', 'agents', `${name}.md`);
  if (!existsSync(file)) throw new Error(`no agent file ${path.relative(root, file)}`);
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(readFileSync(file, 'utf8'));
  if (!m) throw new Error(`${name}.md has no frontmatter`);
  return Object.fromEntries(m[1].split(/\r?\n/).map((l) => /^([\w-]+):\s*(.*)$/.exec(l)).filter(Boolean).map((x) => [x[1], x[2].trim()]));
}

/** The JSON object in a model's final message: a fenced block when there is one, else the outermost braces. */
export function extractJson(text) {
  const s = String(text || '');
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(s);
  const body = fenced ? fenced[1] : s.slice(s.indexOf('{'), s.lastIndexOf('}') + 1);
  if (!body.trim()) throw new Error('the agent returned no JSON object');
  return JSON.parse(body);
}

/**
 * @param {string} name   agent file name without .md
 * @param {string} prompt the task (goes on stdin, so its length and quoting never matter)
 * @returns {{ ok: true, json: object, model: string } | { ok: false, error: string }}
 */
export function runAgent(name, prompt, { root = ROOT, model = null, maxTurns = 40, timeoutMin = 20, addDirs = [], spawn = spawnSync, env = process.env } = {}) {
  let meta;
  try { meta = agentMeta(name, { root }); } catch (e) { return { ok: false, error: e.message }; }
  const useModel = model || meta.model || 'sonnet';
  const args = ['-p', '--agent', name, '--model', useModel, '--output-format', 'json', '--max-turns', String(maxTurns),
    ...addDirs.flatMap((d) => ['--add-dir', d]), ...READ_ONLY];
  const r = spawn('claude', args, { cwd: root, input: prompt, env: agentEnv(env), encoding: 'utf8', shell: WIN, timeout: timeoutMin * 60_000, maxBuffer: 64 << 20 });
  if (r.error || r.status !== 0) return { ok: false, error: `claude failed (${r.error?.code || `exit ${r.status}`}): ${String(r.stderr || '').trim().split('\n').pop() || 'no output'}` };
  try {
    const out = JSON.parse(r.stdout);
    if (out.is_error) return { ok: false, error: `claude error: ${out.subtype || 'unknown'}` };
    return { ok: true, json: extractJson(out.result), model: useModel };
  } catch (e) {
    return { ok: false, error: `the agent's answer is not readable JSON: ${e.message}` };
  }
}
