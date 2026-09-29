#!/usr/bin/env node
// Eval runner for the team pipeline's `classify` step (from the claude-api build-eval scaffold).
//
//   node .claude/hillclimb/classify/run-eval.mjs --flow .claude/hillclimb/classify --variant baseline \
//        --model claude-fable-5-1 --reps 2 [--only r01,r16,u14] [--concurrency 3]
//
// Each (case, rep) runs the REAL pipeline agent headlessly: `claude -p --agent planner-architect`
// in a throwaway git worktree checked out at the case's base commit (the repo state classify saw),
// with the harness under test (.claude/skills, .claude/agents, .claude/settings.json,
// docs/team/PIPELINE.md) copied in from this checkout, and .claude/hillclimb/ deleted so the answer
// key is structurally unreachable. Only repo settings load (--setting-sources project,local and
// --strict-mcp-config) to match the cloud pipeline, and the agent may only Read/Grep/Glob.
// Run from the repo root.

import { createHash } from 'node:crypto';
import { spawn, execFileSync } from 'node:child_process';
import { appendFileSync, cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';

// --- classify-specific ------------------------------------------------------

const REPO = process.cwd();
const WT_ROOT = join(homedir(), '.eval-worktrees', 'classify'); // outside OneDrive: fast, no sync locks
const OVERLAY = ['.claude/skills', '.claude/agents', '.claude/settings.json', 'docs/team/PIPELINE.md'];
const ENGINES = new Set(['haiku', 'sonnet', 'opus']);

let onlyIds = null; // set from --only

async function loadCases() {
  const cases = readFileSync(join(REPO, '.claude/hillclimb/classify/cases.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l))
    .map((c) => ({ ...c, id: c.prompt_id, prompt: `${c.title}\n\n${c.spec || ''}`.trim() }));
  return onlyIds ? cases.filter((c) => onlyIds.has(c.id)) : cases;
}

// The same inputs team-run hands classify: title, Category, Priority, get-spec output.
function classifyPrompt(c) {
  return [
    'Classify this team task using the `classify` skill (.claude/skills/classify/SKILL.md). Follow the skill exactly and end with its exact JSON output.',
    '',
    `Title: ${c.title}`,
    `Category: ${c.category ?? '(none)'}`,
    `Priority: ${c.priority ?? '(none)'}`,
    '',
    'get-spec output:',
    c.spec && c.spec.trim() ? c.spec.trim() : '(empty body)',
  ].join('\n');
}

// git worktree add/remove share .git/worktrees - serialize them.
let wtLock = Promise.resolve();
const withWtLock = (fn) => { const p = wtLock.then(fn, fn); wtLock = p.catch(() => {}); return p; };

function makeWorktree(c, rep) {
  return withWtLock(() => {
    const dir = join(WT_ROOT, `${c.id}_rep${rep}_${Date.now()}`);
    mkdirSync(WT_ROOT, { recursive: true });
    execFileSync('git', ['-C', REPO, 'worktree', 'add', '--detach', '--force', dir, c.baseSha], { stdio: 'ignore' });
    for (const p of OVERLAY) {
      const src = join(REPO, p), dst = join(dir, p);
      if (!existsSync(src)) continue;
      rmSync(dst, { recursive: true, force: true });
      cpSync(src, dst, { recursive: true });
    }
    rmSync(join(dir, '.claude', 'hillclimb'), { recursive: true, force: true }); // answer key never visible
    return dir;
  });
}
function dropWorktree(dir) {
  return withWtLock(() => {
    try { execFileSync('git', ['-C', REPO, 'worktree', 'remove', '--force', dir], { stdio: 'ignore' }); }
    catch { rmSync(dir, { recursive: true, force: true }); try { execFileSync('git', ['-C', REPO, 'worktree', 'prune'], { stdio: 'ignore' }); } catch {} }
  });
}

function runClaude(cwd, prompt, model) {
  const args = ['-p', '--agent', 'planner-architect', '--model', model, '--output-format', 'stream-json', '--verbose',
    '--permission-mode', 'dontAsk', '--allowedTools', 'Read', 'Grep', 'Glob',
    '--setting-sources', 'project,local', '--strict-mcp-config', '--no-session-persistence', '--max-budget-usd', '5'];
  return new Promise((res, rej) => {
    const env = { ...process.env };
    const child = spawn(process.platform === 'win32' ? 'cmd.exe' : 'claude',
      process.platform === 'win32' ? ['/d', '/s', '/c', 'claude', ...args] : args, { cwd, env, windowsHide: true });
    let out = '', err = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { err += d; });
    child.on('error', rej);
    child.on('close', (code) => res({ code, out, err }));
    child.stdin.end(prompt);
  });
}

async function runCase(c, ctx) {
  const dir = await makeWorktree(c, c.__rep ?? 0);
  try {
    const prompt = classifyPrompt(c);
    const { code, out, err } = await runClaude(dir, prompt, ctx.model);
    const events = out.split('\n').filter((l) => l.trim()).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
    const result = events.find((e) => e.type === 'result');
    if (!result) {
      const e = new Error(`claude exited ${code} with no result event: ${err.slice(0, 400) || out.slice(0, 400)}`);
      e.failure_class = /rate.?limit|overloaded|429|529/i.test(err + out) ? 'serving' : 'harness';
      throw e;
    }
    // Transcript in the report's Turn[] shape.
    const transcript = [
      { role: 'system', content: 'Agent: planner-architect (.claude/agents/planner-architect.md) running the classify skill, headless, in a worktree at ' + c.baseSha.slice(0, 7) },
      { role: 'user', content: prompt },
    ];
    let toolCalls = 0, closeCallAttempts = 0, finalText = '';
    const pendingNames = {};
    for (const e of events) {
      const content = e.message?.content;
      if (e.type === 'assistant' && Array.isArray(content)) {
        for (const b of content) {
          if (b.type === 'text' && b.text?.trim()) { transcript.push({ role: 'assistant', content: b.text }); finalText = b.text; }
          if (b.type === 'tool_use') {
            toolCalls++; pendingNames[b.id] = b.name;
            if (/^(Edit|Write|MultiEdit)$/.test(b.name) && /DECISIONS\.md/i.test(JSON.stringify(b.input))) closeCallAttempts++;
            transcript.push({ role: 'tool_call', name: b.name, content: JSON.stringify(b.input, null, 2) });
          }
        }
      }
      if (e.type === 'user' && Array.isArray(content)) {
        for (const b of content) if (b.type === 'tool_result') {
          const text = typeof b.content === 'string' ? b.content : (b.content || []).map((x) => x.text || '').join('');
          transcript.push({ role: 'tool_result', content: text.length > 4000 ? text.slice(0, 4000) + `\n... [${text.length - 4000} chars trimmed]` : text });
        }
      }
    }
    if (typeof result.result === 'string' && result.result.trim()) finalText = result.result;
    // A plan usage/session limit comes back as a "successful" result whose text is the notice -
    // never grade it. Non-transient (resets at a clock time), so it goes to errors.jsonl and a
    // later resume re-runs the case.
    if (/hit your (session|usage|weekly) limit|usage limit reached|limit .*resets/i.test(finalText)) {
      const e = new Error(`plan usage limit: ${finalText.trim().slice(0, 120)}`);
      e.failure_class = 'usage_limit';
      throw e;
    }
    // Served model = the model that did the most output work (Claude Code may also use a small helper model).
    const mu = result.modelUsage || {};
    const served = Object.entries(mu).sort((a, b) => (b[1].outputTokens || 0) - (a[1].outputTokens || 0))[0]?.[0];
    const u = result.usage || {};
    const status = result.subtype === 'success' ? 'ok' : (/max_turns|max_budget/.test(result.subtype || '') ? 'truncated' : 'error');
    if (status === 'error') { const e = new Error(`claude result subtype ${result.subtype}`); e.failure_class = 'harness'; throw e; }
    return {
      output: finalText, transcript, model: served,
      usage: { input_tokens: u.input_tokens || 0, output_tokens: u.output_tokens || 0,
        cache_read_input_tokens: u.cache_read_input_tokens || 0, cache_creation_input_tokens: u.cache_creation_input_tokens || 0 },
      stop_reason: result.subtype, status,
      perf: { tool_calls: toolCalls, close_call_attempts: closeCallAttempts, num_turns: result.num_turns ?? null,
        cost_usd_reported: result.total_cost_usd ?? null },
    };
  } finally {
    await dropWorktree(dir);
  }
}

// Balanced-brace extraction that respects JSON strings, tried from the last `{` backwards, so a `{`
// in prose before the final JSON block can't swallow it.
function balancedFrom(s, start) {
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < s.length; i++) {
    const ch = s[i];
    if (inStr) { if (esc) esc = false; else if (ch === '\\') esc = true; else if (ch === '"') inStr = false; continue; }
    if (ch === '"') inStr = true;
    else if (ch === '{') depth++;
    else if (ch === '}' && --depth === 0) return s.slice(start, i + 1);
  }
  return null;
}
function parseClassify(text) {
  const s = String(text);
  const isIt = (j) => j && typeof j === 'object' && 'engineModel' in j && 'needsDesignRound' in j;
  for (const m of [...s.matchAll(/```(?:json)?\s*([\s\S]*?)```/g)].reverse()) {
    try { const j = JSON.parse(m[1]); if (isIt(j)) return j; } catch {}
  }
  for (let i = s.lastIndexOf('{'); i >= 0; i = s.lastIndexOf('{', i - 1)) {
    const cand = balancedFrom(s, i);
    if (!cand) continue;
    try { const j = JSON.parse(cand); if (isIt(j)) return j; } catch {}
  }
  return null;
}

async function gradeCase(c, run) {
  const exp = c.expected;
  const got = parseClassify(run.output);
  if (!got) {
    return { grade: { routing: 0, design: 0, engine: 0, risk: 0, difficulty: 0, format: 0 },
      explanation: { format: 'no parseable classify JSON in the final output' } };
  }
  const format = ['difficulty', 'risk', 'engineModel', 'needsDesignRound'].every((k) => k in got) ? 1 : 0;
  const design = got.needsDesignRound === exp.needsDesignRound ? 1 : 0;
  const engine = exp.needsDesignRound
    ? (ENGINES.has(got.engineModel) && got.engineModel !== 'haiku' ? 1 : 0) // provisional pick: anything but haiku
    : (got.engineModel === exp.engineModel ? 1 : 0);
  const risk = got.risk === exp.risk ? 1 : 0;
  const difficulty = got.difficulty === exp.difficulty ? 1 : 0;
  const routing = design && engine ? 1 : 0;
  const d = (k, want, have) => `${k}: expected ${want}, got ${have}`;
  return {
    grade: { routing, design, engine, risk, difficulty, format },
    explanation: {
      routing: routing ? 'design-round call and model tier both right' : 'see design / engine',
      design: d('needsDesignRound', exp.needsDesignRound, got.needsDesignRound),
      engine: exp.needsDesignRound ? `provisional (design round expected): got ${got.engineModel} — pass unless haiku` : d('engineModel', exp.engineModel, got.engineModel),
      risk: d('risk', exp.risk, got.risk),
      difficulty: d('difficulty', exp.difficulty, got.difficulty),
      format: format ? 'valid' : 'missing required keys',
    },
  };
}

function perfFrom(run) { return { status: run.status, ...(run.perf || {}) }; }

// --- harness (from the build-eval scaffold; changes: --only, rep passed into runCase) ----

function parseArgs(argv) {
  const a = { flow: '.claude/hillclimb/flow', variant: 'baseline',
              model: undefined, reps: 1, concurrency: 3, timeoutS: 900,
              approveHarness: false, only: null };
  const val = (i) => { if (argv[i] === undefined) { console.error(`missing value for ${argv[i - 1]}`); usage(); process.exit(2); } return argv[i]; };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (k === '--flow') a.flow = val(++i);
    else if (k === '--variant') a.variant = val(++i);
    else if (k === '--model') a.model = val(++i);
    else if (k === '--reps') a.reps = +val(++i);
    else if (k === '--concurrency') a.concurrency = +val(++i);
    else if (k === '--timeout-s') a.timeoutS = +val(++i);
    else if (k === '--only') a.only = val(++i);
    else if (k === '--approve-harness') a.approveHarness = true;
    else if (k === '-h' || k === '--help') { usage(); process.exit(0); }
    else { console.error(`unknown argument: ${k}`); usage(); process.exit(2); }
  }
  if (!a.model && !a.approveHarness) { console.error('--model is required (e.g. claude-fable-5-1)'); process.exit(2); }
  if (!/^(baseline|v[1-9]\d*)$/.test(a.variant)) {
    console.error(`--variant must be 'baseline' or 'v<N>', got '${a.variant}'`);
    usage(); process.exit(2);
  }
  if (!Number.isFinite(a.timeoutS) || a.timeoutS < 0
      || a.timeoutS * 1000 > 2147483647
      || !Number.isInteger(a.reps) || a.reps < 1
      || !Number.isInteger(a.concurrency) || a.concurrency < 1) { usage(); process.exit(2); }
  return a;
}
function usage() {
  console.error('usage: node run-eval.mjs --flow DIR --variant ID --model ID [--reps N] [--concurrency N] [--timeout-s N] [--only id,id] [--approve-harness]');
}

function checkHarness(statePath, st, approve) {
  const self = fileURLToPath(import.meta.url);
  const listed = Array.isArray(st.harness_paths) ? st.harness_paths.map(String) : [];
  const paths = [...new Set([self, ...listed.map(p => resolve(p))])].sort();
  const h = createHash('sha256');
  const hashed = [];
  for (const p of paths) {
    let buf;
    try { buf = readFileSync(p); }
    catch (e) {
      if (p === self) throw e;
      console.error(`warning: harness path '${relative(process.cwd(), p)}' not readable (${e?.code || 'error'}) - skipped`);
      continue;
    }
    h.update(relative(process.cwd(), p)).update('\0').update(buf).update('\0');
    hashed.push(relative(process.cwd(), p));
  }
  const sha = h.digest('hex');
  if (st.harness_sha === sha) return;
  if (approve) {
    st.harness_sha = sha;
    writeFileSync(statePath, JSON.stringify(st, null, 2) + '\n');
    console.error(`harness approved: sha256 ${sha.slice(0, 12)} over ${hashed.length} file(s) recorded in ${statePath}`);
    process.exit(0);
  }
  if (st.harness_sha == null) {
    console.error(`no approved harness sha in ${statePath} (computed ${sha.slice(0, 12)} over: ${hashed.join(', ')}).`);
    console.error('Review the harness, then run once with --approve-harness to record it.');
  } else {
    console.error(`harness changed since last approved run (files: ${hashed.join(', ')}); `
      + `approved ${String(st.harness_sha).slice(0, 12)}, now ${sha.slice(0, 12)}.`);
    console.error('Re-run with --approve-harness after reviewing the diff.');
  }
  process.exit(2);
}

async function withBackoff(fn, retry, deadline = Infinity, tries = 5) {
  for (let attempt = 0; ; attempt++) {
    if (Date.now() >= deadline) {
      const e = new Error('wall-clock ceiling exceeded before attempt');
      e.failure_class = 'timeout';
      throw e;
    }
    try { return await fn(); } catch (e) {
      const status = e?.status ?? e?.response?.status;
      const transient = e?.failure_class === 'serving' || status === 429 || status === 529 || (status >= 500 && status < 600)
        || /overloaded|rate.?limit/i.test(String(e?.message ?? ''));
      if (!transient || attempt >= tries - 1) throw e;
      const delay = Math.min(60_000, 1000 * 2 ** attempt) * (0.5 + Math.random());
      if (Date.now() + delay >= deadline) throw e;
      retry.count++;
      await new Promise(r => setTimeout(r, delay));
    }
  }
}

function withTimeout(promise, seconds, label) {
  if (!(seconds > 0)) return promise;
  let timer;
  const ceiling = new Promise((_, reject) => {
    timer = setTimeout(() => {
      const e = new Error(`${label}: exceeded ${seconds}s wall-clock ceiling`);
      e.failure_class = 'timeout';
      reject(e);
    }, seconds * 1000);
  });
  return Promise.race([promise, ceiling]).finally(() => clearTimeout(timer));
}

function pathSafeId(id) {
  const raw = String(id);
  const cleaned = raw.replace(/[^\w.-]/g, '_');
  if (cleaned === raw && raw.length <= 129) return raw;
  return `${cleaned.slice(0, 120)}-${createHash('sha256').update(raw).digest('hex').slice(0, 8)}`;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.only) onlyIds = new Set(args.only.split(',').map((s) => s.trim()).filter(Boolean));
  const vdir = join(args.flow, args.variant);
  mkdirSync(join(vdir, 'traces'), { recursive: true });
  const statePath = join(args.flow, '_state.json');
  let st = {};
  if (existsSync(statePath)) {
    try { st = JSON.parse(readFileSync(statePath, 'utf8')) || {}; }
    catch (e) { console.error(`${statePath} exists but is not valid JSON (${e?.message || e}) - fix it before spending a pass`); process.exit(2); }
  }
  checkHarness(statePath, st, args.approveHarness);
  const ctx = { ...args, state: st };

  const resultsPath = join(vdir, 'results.jsonl');
  const done = new Set();
  if (existsSync(resultsPath))
    for (const ln of readFileSync(resultsPath, 'utf8').split('\n')) {
      if (!ln.trim()) continue;
      try { const r = JSON.parse(ln); done.add(`${r.prompt_id}\0${r.rep}`); } catch {}
    }

  const cases = await loadCases();
  const seen = new Map();
  for (const c of cases) {
    const k = pathSafeId(c.id).toLowerCase();
    if (seen.has(k)) { console.error(`duplicate case id after sanitization: '${c.id}' collides with '${seen.get(k)}'`); process.exit(2); }
    seen.set(k, c.id);
  }
  const tasks = [];
  for (const c of cases) for (let rep = 0; rep < args.reps; rep++) {
    if (done.has(`${pathSafeId(c.id)}\0${rep}`)) continue;
    tasks.push({ c, rep });
  }
  console.error(`[${args.variant}] ${tasks.length} of ${cases.length * args.reps} (id,rep) to run`);

  let i = 0, ok = 0, fail = 0;
  const errorsPath = join(vdir, 'errors.jsonl');
  for (const p of [resultsPath, errorsPath]) {
    if (!existsSync(p)) continue;
    const buf = readFileSync(p);
    if (buf.length && buf[buf.length - 1] !== 0x0a) appendFileSync(p, '\n');
  }
  async function worker() {
    while (i < tasks.length) {
      const { c, rep } = tasks[i++];
      const safeId = pathSafeId(c.id);
      const t0 = Date.now();
      let lastRun = null, rowWritten = false;
      const deadline = args.timeoutS > 0 ? t0 + args.timeoutS * 1000 : Infinity;
      const appRetry = { count: 0 }, judgeRetry = { count: 0 };
      try {
        const { run, g, latency_s } = await withTimeout((async () => {
          let tAttempt = t0;
          const run = await withBackoff(() => { tAttempt = Date.now(); return runCase({ ...c, __rep: rep }, ctx); }, appRetry, deadline);
          lastRun = run;
          const latency_s = (Date.now() - tAttempt) / 1000;
          if (ctx.model && run.model && run.model !== ctx.model) {
            const base = ctx.model.replace(/-latest$|-0$/, '');
            const rest = String(run.model).startsWith(base) ? String(run.model).slice(base.length) : null;
            if (!(rest != null && /^[-@](\d{8}|\d{4}-\d{2}-\d{2})$/.test(rest))) {
              const e = new Error(`served model ${run.model} != requested ${ctx.model}`);
              e.failure_class = 'serving_substitution';
              throw e;
            }
          }
          const g = await withBackoff(() => gradeCase(c, run, null, ctx), judgeRetry, deadline);
          return { run, g, latency_s };
        })(), args.timeoutS, `${c.id} rep${rep}`);
        const row = {
          prompt_id: safeId, rep, prompt: c.prompt ?? c.id,
          tags: c.tags, attachments: c.attachments,
          meta: { expected: c.expected, baseSha: c.baseSha, category: c.category, priority: c.priority,
            ...(appRetry.count ? { retries: appRetry.count } : {}) },
          model: run.model, usage: run.usage, stop_reason: run.stop_reason,
          latency_s, ...perfFrom(run),
          grade: g.grade, explanation: g.explanation,
        };
        appendFileSync(resultsPath, JSON.stringify(row) + '\n');
        rowWritten = true;
        if (run.transcript)
          writeFileSync(join(vdir, 'traces', `${safeId}_rep${rep}.json`), JSON.stringify(run.transcript, null, 2));
        ok++;
        console.error(`  [${args.variant}] ${c.id} rep${rep}: routing ${g.grade.routing} (${Math.round(latency_s)}s)`);
      } catch (e) {
        fail++;
        if (rowWritten) { console.error(`  [${args.variant}] ${c.id} rep${rep} scored, but a post-row write failed: ${e?.message || e}`); continue; }
        appendFileSync(errorsPath, JSON.stringify({
          prompt_id: safeId, rep, failure_class: e?.failure_class ?? 'error', error: String(e?.message || e),
          retries: appRetry.count, model: lastRun?.model, usage: lastRun?.usage, latency_s: (Date.now() - t0) / 1000,
        }) + '\n');
        console.error(`  [${args.variant}] ${c.id} rep${rep} FAILED: ${e?.message || e}`);
      }
    }
  }
  const t0 = Date.now();
  const progress = () => {
    const d = ok + fail, total = tasks.length, el = (Date.now() - t0) / 1000;
    const eta = d ? Math.round((el / d) * (total - d)) : null;
    const line = `[${args.variant}] ${d}/${total} done (${ok} ok, ${fail} failed), ${Math.round(el)}s elapsed` + (eta != null ? `, ~${eta}s left` : '');
    console.error(line);
    try { writeFileSync(join(vdir, 'progress.txt'), line + '\n'); } catch {}
  };
  const tick = setInterval(progress, 30_000);
  await Promise.all(Array.from({ length: Math.max(1, args.concurrency) }, worker));
  clearInterval(tick); progress();
  console.error(`[${args.variant}] done - ${ok} ok, ${fail} failed -> ${resultsPath}`);
  process.exit(fail ? 1 : 0);
}

main();
