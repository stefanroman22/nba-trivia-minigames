#!/usr/bin/env node
// Which model should run `classify`? A measured answer instead of a price list.
//
// The eval itself (36 cases, 19 real cards and 17 owner-written, with an owner-verified answer key, and the runner
// that replays the real planner-architect agent in a worktree at each case's commit) lives on the branch
// `eval/classify` and must never be merged here: classify greps the repo, and would read the answer key while
// classifying real cards. This script borrows it for one comparison and puts nothing of it under version control.
//
//   node scripts/team/eval-classify.mjs run --models sonnet,haiku [--reps 2] [--only r01,u03] [--concurrency 2] [--at <ref>]
//       one pass of the eval per model, on the classify skill and agents of THIS checkout
//       --at <ref>: replay every case at that commit instead of its own. Needed since the 2026-10-08 history
//       clean-up: the commits the cases were recorded at no longer exist on the remote. All models of one run then
//       see the same repository, so they compare with each other, but not with the scores recorded on the branch.
//   node scripts/team/eval-classify.mjs compare [--dir .team/eval-classify/<stamp>] [--json]
//       scores per model with 95 % intervals, cost per run, and which model the data supports
//
// Every run is a real model call on the Claude login of this machine: 36 cases x reps x models. A full pass was
// about $52 API-equivalent on Fable 5.1; --only keeps a trial small. Results: .team/eval-classify/<stamp>/ (git-ignored).
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { ROOT } from '../lib/team-config.mjs';
import { parseJsonl, renderTable, summarize, verdict } from './lib/eval-tiers.mjs';

export const EVAL_REF = 'origin/eval/classify';
export const FLOW = '.claude/hillclimb/classify';
const FILES = ['run-eval.mjs', 'cases.jsonl', '_state.json'];
export const OUT_ROOT = path.join(ROOT, '.team', 'eval-classify');
const stamp = (d = new Date()) => d.toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 13);

const git = (args, opts = {}) => spawnSync('git', ['-C', ROOT, ...args], { encoding: 'utf8', maxBuffer: 64 << 20, ...opts });

/** alias -> full model id (the eval refuses a run whose served model differs from the one asked for). */
export function modelIds(names, registry) {
  return names.map((n) => {
    const id = registry.aliases[n]?.id || (/^claude-[a-z0-9-]+$/.test(n) ? n : null);
    if (!id) throw new Error(`unknown model "${n}": use ${Object.keys(registry.aliases).join(', ')} or a full claude-* id`);
    return { name: n, id };
  });
}

/** Every run of one variant directory: finished rows plus failed ones (which count against every metric). */
export function readVariant(dir) {
  const read = (f) => (existsSync(path.join(dir, f)) ? parseJsonl(readFileSync(path.join(dir, f), 'utf8')) : []);
  return [...read('results.jsonl').map((r) => ({ ...r, status: 'ok' })), ...read('errors.jsonl').map((e) => ({ ...e, status: 'error' }))];
}

/** Copies the eval's three files out of the eval branch. → true when this call created the folder (so it removes it). */
function materialize(log) {
  const dir = path.join(ROOT, FLOW);
  if (existsSync(path.join(dir, 'run-eval.mjs'))) { log(`using the eval already at ${FLOW}`); return false; }
  const fetched = git(['fetch', '--quiet', 'origin', 'eval/classify:refs/remotes/origin/eval/classify']);
  if (fetched.status !== 0) throw new Error(`cannot fetch the eval branch: ${(fetched.stderr || '').trim().split('\n').pop()}`);
  mkdirSync(dir, { recursive: true });
  for (const f of FILES) {
    const r = git(['show', `${EVAL_REF}:${FLOW}/${f}`], { encoding: 'buffer' });
    if (r.status !== 0) throw new Error(`${EVAL_REF} has no ${FLOW}/${f}`);
    // The branch's JSON files carry a UTF-8 byte-order mark (written on Windows), which JSON.parse refuses.
    const bytes = r.stdout[0] === 0xef && r.stdout[1] === 0xbb && r.stdout[2] === 0xbf ? r.stdout.subarray(3) : r.stdout;
    writeFileSync(path.join(dir, f), bytes);
  }
  return true;
}

/** The cases with every `baseSha` replaced (pure; the answer key itself is untouched). */
export const rebased = (casesText, sha) => parseJsonl(casesText).map((c) => JSON.stringify({ ...c, baseSha: sha })).join('\n') + '\n';

/**
 * Replays every case at one commit. Only on a copy this run created: the runner refuses a cases file it has not
 * seen (it hashes it), so the throwaway copy is re-approved here; the eval branch itself is never written.
 */
function rebaseCases(ref, created, log) {
  if (!created) throw new Error(`--at needs a fresh copy of the eval: remove the local ${FLOW} folder first (it is never edited in place)`);
  const sha = git(['rev-parse', '--verify', `${ref}^{commit}`]).stdout.trim();
  if (!sha) throw new Error(`--at ${ref}: not a commit in this clone`);
  const file = path.join(ROOT, FLOW, 'cases.jsonl');
  writeFileSync(file, rebased(readFileSync(file, 'utf8'), sha));
  spawnSync(process.execPath, [path.join(FLOW, 'run-eval.mjs'), '--flow', FLOW, '--approve-harness'], { cwd: ROOT, stdio: 'ignore' });
  log(`every case replays at ${sha.slice(0, 7)} (${ref}); scores compare between the models of this run only`);
}

/** Each case replays at the commit classify saw; a shallow clone may not have it yet. */
function ensureCommits(only, log) {
  const cases = parseJsonl(readFileSync(path.join(ROOT, FLOW, 'cases.jsonl'), 'utf8')).filter((c) => !only || only.has(c.prompt_id));
  if (!cases.length) throw new Error('--only matches no case');
  const have = (sha) => git(['cat-file', '-e', `${sha}^{commit}`]).status === 0;
  const missing = () => [...new Set(cases.map((c) => c.baseSha))].filter((sha) => !have(sha));
  for (const sha of missing()) git(['fetch', '--quiet', 'origin', sha]);  // works where the host serves a bare sha
  if (missing().length && git(['rev-parse', '--is-shallow-repository']).stdout.trim() === 'true') {
    log('this clone is shallow: fetching the full history of dev and eval/classify once');
    git(['fetch', '--quiet', '--unshallow', 'origin', 'dev', 'eval/classify']);
  }
  if (missing().length) {
    throw new Error(`commit(s) ${missing().map((s) => s.slice(0, 7)).join(', ')} are not in this clone and the remote no longer has them `
      + '(the 2026-10-08 history clean-up removed the commits the cases were recorded at). Pass --at <ref> to replay every case at one commit.');
  }
  return cases.length;
}

function run(o, { log }) {
  const registry = JSON.parse(readFileSync(path.join(ROOT, '.claude/models.json'), 'utf8'));
  const models = modelIds(o.models, registry);
  const tracked = git(['ls-files', '--', '.claude/hillclimb']).stdout.trim();
  if (tracked) throw new Error('.claude/hillclimb is tracked on this branch: the answer key must stay on eval/classify only');
  const created = materialize(log);
  const out = path.join(OUT_ROOT, stamp());
  try {
    if (o.at) rebaseCases(o.at, created, log);
    const n = ensureCommits(o.only, log);
    log(`${n} case(s) x ${o.reps} rep(s) x ${models.length} model(s) = ${n * o.reps * models.length} model run(s)`);
    models.forEach((m, i) => {
      const variant = `v${900 + i}`;  // the runner accepts baseline | v<N>; 9xx keeps clear of the hillclimb's own variants
      const vdir = path.join(ROOT, FLOW, variant);
      rmSync(vdir, { recursive: true, force: true });
      const args = [path.join(FLOW, 'run-eval.mjs'), '--flow', FLOW, '--variant', variant, '--model', m.id, '--reps', String(o.reps),
        '--concurrency', String(o.concurrency), ...(o.only ? ['--only', [...o.only].join(',')] : [])];
      log(`> ${m.name} (${m.id})`);
      const r = spawnSync(process.execPath, args, { cwd: ROOT, stdio: 'inherit' });
      mkdirSync(path.join(out, m.name), { recursive: true });
      for (const f of ['results.jsonl', 'errors.jsonl']) if (existsSync(path.join(vdir, f))) cpSync(path.join(vdir, f), path.join(out, m.name, f));
      if (r.status !== 0) log(`  the runner exited ${r.status} for ${m.name}; whatever finished is kept`);
      rmSync(vdir, { recursive: true, force: true });
    });
  } finally {
    if (created) rmSync(path.join(ROOT, '.claude/hillclimb'), { recursive: true, force: true });
  }
  return out;
}

export function compare(dir) {
  const models = readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort();
  const summaries = models.map((m) => summarize(m, readVariant(path.join(dir, m)))).filter((s) => s.runs);
  return { dir, summaries, verdict: verdict(summaries), table: renderTable(summaries) };
}

const latest = () => (existsSync(OUT_ROOT) ? readdirSync(OUT_ROOT).sort().map((d) => path.join(OUT_ROOT, d)).pop() : null);

export function cli(argv, { log = console.log, err = console.error } = {}) {
  const [cmd, ...rest] = argv;
  const flag = (k, d = null) => { const i = rest.indexOf(k); return i >= 0 ? rest[i + 1] : d; };
  try {
    if (cmd === 'run') {
      const o = {
        models: String(flag('--models', '') || '').split(',').map((s) => s.trim()).filter(Boolean),
        reps: Number(flag('--reps', '1')), concurrency: Number(flag('--concurrency', '2')),
        only: flag('--only') ? new Set(flag('--only').split(',').map((s) => s.trim()).filter(Boolean)) : null,
        at: flag('--at'),
      };
      if (!o.models.length) throw new Error('--models <alias,alias> required (e.g. sonnet,haiku)');
      if (!Number.isInteger(o.reps) || o.reps < 1 || !Number.isInteger(o.concurrency) || o.concurrency < 1) throw new Error('--reps and --concurrency are whole numbers ≥ 1');
      const out = run(o, { log: (l) => err(`eval-classify: ${l}`) });
      const c = compare(out);
      writeFileSync(path.join(out, 'comparison.md'), `${c.table}\n`);
      log(c.table);
      err(`eval-classify: results in ${path.relative(ROOT, out)}`);
      return 0;
    }
    if (cmd === 'compare') {
      const dir = flag('--dir') ? path.resolve(flag('--dir')) : latest();
      if (!dir || !existsSync(dir)) throw new Error('no results yet: run `eval-classify.mjs run --models …` first');
      const c = compare(dir);
      log(rest.includes('--json') ? JSON.stringify({ summaries: c.summaries, verdict: c.verdict }, null, 2) : c.table);
      return 0;
    }
    throw new Error('usage: eval-classify.mjs run --models a,b [--reps N] [--only id,id] [--concurrency N] [--at ref] | compare [--dir D] [--json]');
  } catch (e) {
    err(e.message);
    return 2;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) process.exit(cli(process.argv.slice(2)));
