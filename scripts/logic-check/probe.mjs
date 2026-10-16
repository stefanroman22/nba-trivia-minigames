#!/usr/bin/env node
// Logic triage's confirmation tool: run ONE `api` acceptance assertion (the shared DSL, check-core/lib/api-assert.mjs)
// against the stack of a Logic run and print what it measured.
//   node scripts/logic-check/probe.mjs --api '<json>' | --api-file <file> [--run <id>-logic] [--mode prod|dev] [--repo <dir>] [--keep-stack]
// <json> is { "api": { "persona": "guest|logic.actor|logic.peer|logic.admin", "method", "path": "/api/…", "body"?, "headers"? },
//             "expect": { "status", "json"?: [[path, op, value]], "headers"? } }.
// The app and ports are the run's (run-meta.json `repo`, and its ports in its own mode); the mode defaults to the run's
// (a nightly or skill run is prod). The token is minted per persona as verify does. Prints at most 10 lines: the outcome
// and one line per expectation (ok / FAIL / ERROR with the measured value). Scratch output in <runDir>/probe/.
// Exit 0 pass, 1 fail or error, 2 bad usage or an invalid assertion. Without --keep-stack only what this call started is
// stopped; when probing repeatedly pass --keep-stack (the run's stack is already up after `run.mjs --keep-stack`).
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { apiAssertionErrors, describeApiAssertion, isApiAssertion } from '../check-core/lib/api-assert.mjs';
import { latestRunId, listRuns, readJson, runPath } from '../check-core/lib/findings.mjs';
import { runApp, stamp, verifyFindings, withStack } from '../ui-check/lib/verify-core.mjs';

export const MAX_LINES = 10;
export const USAGE = "usage: node scripts/logic-check/probe.mjs --api '<json>' | --api-file <file> [--run <id>-logic] [--mode prod|dev] [--repo <dir>] [--keep-stack]";

/** argv → { api (parsed assertion), run, mode, repo, keepStack, help }; throws a one-line message on bad usage. */
export function parseArgs(argv, { readFile = (f) => readFileSync(f, 'utf8') } = {}) {
  const o = { api: null, run: null, mode: null, repo: null, keepStack: false, help: false };
  let text = null;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const val = () => { const v = argv[++i]; if (v === undefined) throw new Error(`${a} needs a value`); return v; };
    if (a === '--api') text = val();
    else if (a === '--api-file') text = readFile(val());
    else if (a === '--run') o.run = val();
    else if (a === '--mode') o.mode = val();
    else if (a === '--repo') o.repo = val();
    else if (a === '--keep-stack') o.keepStack = true;
    else if (a === '--help' || a === '-h') o.help = true;
    else throw new Error(`unknown argument ${a}`);
  }
  if (o.help) return o;
  if (text === null) throw new Error('--api <json> or --api-file <file> is required');
  if (o.mode !== null && !['prod', 'dev'].includes(o.mode)) throw new Error(`--mode must be prod or dev (got ${o.mode})`);
  let a;
  try { a = JSON.parse(String(text).replace(/^﻿/, '')); } catch (e) { throw new Error(`the assertion is not JSON: ${e.message}`); }
  if (!isApiAssertion(a)) throw new Error('the assertion needs an "api" request ({ api: {…}, expect: {…} }); browser assertions go to scripts/ui-check/probe.mjs');
  const errs = apiAssertionErrors(a, 'assertion');
  if (errs.length) throw new Error(errs.join('; '));
  o.api = a;
  return o;
}

async function main() {
  let o;
  try { o = parseArgs(process.argv.slice(2)); } catch (e) { console.error(`probe: ${e.message}\n${USAGE}`); return 2; }
  if (o.help) { console.log(USAGE); return 0; }
  if (o.repo && !existsSync(path.join(path.resolve(o.repo), 'package.json'))) { console.error(`probe: --repo ${o.repo} is not a checkout of the app`); return 2; }
  // Scratch space: the run named, else the newest Logic run.
  const runId = o.run || [latestRunId(), ...listRuns()].find((r) => r && /^\d{8}-\d{4}-logic$/.test(r)) || 'probe';
  const meta = readJson(path.join(runPath(runId), 'run-meta.json'), {}) || {};
  const mode = o.mode || (['prod', 'dev'].includes(meta.mode) ? meta.mode : 'prod');
  mkdirSync(path.join(runPath(runId), 'probe'), { recursive: true });
  const id = `PROBE-${stamp()}`;
  const log = path.join(runPath(runId), 'probe', `${id}.log`);
  const t0 = Date.now();
  let r;
  try {
    const app = o.run ? runApp(runId, mode) : { repo: null, ports: null };
    if (o.repo) app.repo = path.resolve(o.repo);
    [r] = await withStack({ mode, keepStack: o.keepStack, log, repo: app.repo, ports: app.ports },
      () => verifyFindings([{ id, acceptance: { assertions: [o.api] } }], { runId, log, area: 'probe', mode, say: () => {} }));
  } catch (e) {
    console.error(`probe: ${String(e.message).split('\n')[0]}`);
    return 1;
  }
  const c = r.criteria[0];
  const out = [`probe: ${r.outcome.toUpperCase()} · ${describeApiAssertion(o.api)} · ${Math.round((Date.now() - t0) / 1000)}s · mode ${mode}`.slice(0, 400)];
  const body = c.lines.map((l) => `  ${l.error ? 'ERROR' : l.ok ? 'ok   ' : 'FAIL '} ${l.text}`);
  const room = MAX_LINES - 1;
  out.push(...(body.length > room ? [...body.slice(0, room - 1), `  +${body.length - room + 1} more (see ${log})`] : body));
  console.log(out.join('\n'));
  return r.outcome === 'pass' ? 0 : 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = await main();
