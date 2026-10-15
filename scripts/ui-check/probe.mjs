#!/usr/bin/env node
// Judges' confirmation tool: run ONE ad-hoc acceptance assertion (DSL, lib/findings.mjs) and print what it measured.
//   node scripts/ui-check/probe.mjs --assert '<json>' | --assert-file f [--mode dev|prod] [--run <id>] [--keep-stack]
// Prints at most 20 lines: the outcome, one line per expect (ok / FAIL / ERROR with the measured value), then one crop
// path. Use it to confirm a suspicion and to author acceptance assertions that FAIL now (a finding's acceptance must
// fail before the fix: report.mjs --validate rejects one that passes). Default mode dev. Scratch output goes under
// <runDir>/probe/ (runDir = --run, else the latest run): the crop is kept in probe/shots/, the scratch run deleted.
// Without --keep-stack only what this call started is stopped; when probing repeatedly pass --keep-stack and stop
// once with `node scripts/ui-check/run.mjs --stop`. Exit 0 pass, 1 fail or error, 2 bad usage / invalid assertion.
// With --run the app is that run's checkout (run-meta.json `repo`, e.g. the `--ref main` worktree) and, in its mode, its ports.
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { describeAssertion, latestRunId, listRuns, parseAssertion, readText, runPath } from './lib/findings.mjs';
import { runApp, stamp, verifyFindings, withStack } from './lib/verify-core.mjs';

const MAX_LINES = 20;

function parseArgs(argv) {
  const o = { assert: null, file: null, mode: 'dev', run: null, keepStack: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const val = () => { const v = argv[++i]; if (v === undefined) throw new Error(`${a} needs a value`); return v; };
    if (a === '--assert') o.assert = val();
    else if (a === '--assert-file') o.file = val();
    else if (a === '--mode') o.mode = val();
    else if (a === '--run') o.run = val();
    else if (a === '--keep-stack') o.keepStack = true;
    else if (a === '--help' || a === '-h') o.help = true;
    else throw new Error(`unknown argument ${a}`);
  }
  return o;
}

async function main() {
  let o;
  try { o = parseArgs(process.argv.slice(2)); } catch (e) { console.error(`probe: ${e.message}`); return 2; }
  if (o.help || (!o.assert && !o.file)) {
    console.log(`usage: node scripts/ui-check/probe.mjs --assert '<json>' | --assert-file f [--mode dev|prod] [--run <id>] [--keep-stack]`);
    return o.help ? 0 : 2;
  }
  let assertion;
  try {
    assertion = JSON.parse(o.assert ?? readText(o.file));
    parseAssertion(assertion);
  } catch (e) {
    const lines = String(e.message).split('\n');
    console.error(`probe: ${lines.slice(0, MAX_LINES - 1).join('\n')}`);
    return 2;
  }

  // Scratch space: the run named, else the latest real run (a run id is YYYYMMDD-HHMM), else runs/probe.
  const runId = o.run || [latestRunId(), ...listRuns()].find((r) => r && /^\d{8}-\d{4}$/.test(r)) || 'probe';
  mkdirSync(runPath(runId), { recursive: true });
  const id = `PROBE-${stamp()}`;
  const log = path.join(runPath(runId), 'probe', `${id}.log`);
  const t0 = Date.now();
  let r;
  try {
    const app = o.run ? runApp(runId, o.mode) : { repo: null, ports: null };
    [r] = await withStack({ mode: o.mode, keepStack: o.keepStack, log, repo: app.repo, ports: app.ports }, () => verifyFindings([{ id, acceptance: { assertions: [assertion] } }], { runId, log, area: 'probe', mode: o.mode }));
  } catch (e) {
    console.error(`probe: ${e.message}`);
    return 1;
  }
  const c = r.criteria[0];
  const out = [`probe: ${r.outcome.toUpperCase()} · ${describeAssertion(assertion)} · ${Math.round((Date.now() - t0) / 1000)}s · mode ${o.mode}`];
  const body = c.lines.map((l) => `  ${l.error ? 'ERROR' : l.ok ? 'ok   ' : 'FAIL '} ${l.text}`);
  const room = MAX_LINES - 2;
  out.push(...(body.length > room ? [...body.slice(0, room - 1), `  +${body.length - room + 1} more (see ${log})`] : body));
  out.push(`crop: ${c.shot || '(none)'}`);
  console.log(out.join('\n'));
  return r.outcome === 'pass' ? 0 : 1;
}

process.exitCode = await main();
