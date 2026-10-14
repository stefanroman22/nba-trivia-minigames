#!/usr/bin/env node
// Re-run findings' acceptance criteria (checks + DSL assertions) against the local stack — the fix loop's judge.
//   node scripts/ui-check/verify.mjs <findingId…> [--run <id>] [--mode dev|prod] [--expect-fail] [--mark] [--keep-stack]
// Mode: --mode when given; else dev (HMR, no rebuild), except prod for a finding whose acceptance was validated in
// prod (validatedMode). Without --run, each id is looked up in the newest run whose findings.json holds it.
// Prints one line per finding — `PASS|FAIL <id> — <first failing line>` — and totals; the full detail goes to
// <runDir>/verify/<id>.json (guards marked), Playwright's output to <runDir>/verify/pw-<stamp>.log.
// Exit 0 iff every finding passes, guards included (with --expect-fail: iff every finding reproduces: at least one
// criterion FAILS cleanly and none errors); 1 otherwise or on an infra error; 2 on bad usage.
// --mark: passing findings get status 'fixed' + fixedAt in <runDir>/findings.json, and REPORT.md is regenerated.
// Stack: without --keep-stack only what THIS call started is stopped. In a fix loop always pass --keep-stack and stop
// once at the end with `node scripts/ui-check/run.mjs --stop`.
import path from 'node:path';
import { readFindingsDoc, runOfFinding, runPath, writeJson, writeReport } from './lib/findings.mjs';
import { stamp, verifyFindings, withStack, writeDetail } from './lib/verify-core.mjs';

const USAGE = [
  'usage: node scripts/ui-check/verify.mjs <findingId…> [--run <id>] [--mode dev|prod] [--expect-fail] [--mark] [--keep-stack]',
  '  --mode        default dev; prod for findings validated in prod (validatedMode)',
  '  --keep-stack  leave the stack running. Without it only what this call started is stopped.',
  '                In a fix loop always pass --keep-stack; stop once at the end with `node scripts/ui-check/run.mjs --stop`.',
  '  --mark        set status fixed + fixedAt on passing findings and regenerate REPORT.md',
  '  --expect-fail exit 0 iff every finding reproduces (≥ 1 criterion fails cleanly, none errors)',
].join('\n');

function parseArgs(argv) {
  const o = { ids: [], run: null, mode: null, expectFail: false, mark: false, keepStack: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const val = () => { const v = argv[++i]; if (v === undefined || v.startsWith('--')) throw new Error(`${a} needs a value`); return v; };
    if (a === '--run') o.run = val();
    else if (a === '--mode') o.mode = val();
    else if (a === '--expect-fail') o.expectFail = true;
    else if (a === '--mark') o.mark = true;
    else if (a === '--keep-stack') o.keepStack = true;
    else if (a === '--help' || a === '-h') o.help = true;
    else if (a.startsWith('--')) throw new Error(`unknown argument ${a}`);
    else o.ids.push(a);
  }
  return o;
}

async function main() {
  let o;
  try { o = parseArgs(process.argv.slice(2)); } catch (e) { console.error(`verify: ${e.message}`); return 2; }
  if (o.help || !o.ids.length) { console.log(USAGE); return o.help ? 0 : 2; }
  if (o.mode && !['dev', 'prod'].includes(o.mode)) { console.error('verify: --mode must be dev or prod'); return 2; }
  if (o.mark && o.expectFail) { console.error('verify: --mark and --expect-fail exclude each other'); return 2; }

  const runId = o.run || runOfFinding(o.ids[0]);
  const doc = runId && readFindingsDoc(runId);
  if (!doc) { console.error(`verify: no findings.json ${o.run ? `in run ${o.run}` : `holds ${o.ids[0]}`} (run report.mjs first)`); return 2; }
  const findings = [];
  for (const id of o.ids) {
    const f = doc.findings.find((x) => x.id === id);
    if (!f) { console.error(`verify: ${id} is not in ${path.join(runPath(runId), 'findings.json')}${o.run ? '' : ' (pass --run for ids of another run)'}`); return 2; }
    findings.push(f);
  }

  // One stack per mode, in order (dev first).
  const modeOf = (f) => o.mode || (f.validatedMode === 'prod' ? 'prod' : 'dev');
  const groups = ['dev', 'prod'].map((m) => [m, findings.filter((f) => modeOf(f) === m)]).filter(([, list]) => list.length);

  const t0 = Date.now();
  const log = path.join(runPath(runId), 'verify', `pw-${stamp()}.log`);
  const results = [];
  for (const [mode, list] of groups) {
    try {
      const rs = await withStack({ mode, keepStack: o.keepStack, log }, () => verifyFindings(list, { runId, expectFail: o.expectFail, log, mode }));
      for (const r of rs) { r.mode = mode; results.push(r); }
    } catch (e) {
      console.error(`verify: ${e.message}`);
      return 1;
    }
  }
  const secs = Math.round((Date.now() - t0) / 1000);

  for (const r of results) {
    writeDetail(runId, r, { expectFail: o.expectFail, log });
    const tag = r.outcome === 'pass' ? 'PASS' : 'FAIL';
    const note = o.expectFail && !r.asExpected && r.reason ? ` [expect-fail: ${r.reason}]` : '';
    console.log(`${tag} ${r.id} — ${r.firstLine}${note}`);
  }
  const pass = results.filter((r) => r.outcome === 'pass').length;
  const ok = results.every((r) => r.asExpected);
  console.log(`verify: ${results.length} finding(s) · ${pass} pass · ${results.length - pass} fail · ${secs}s · mode ${groups.map(([m]) => m).join('+')}${o.expectFail ? ' · expect-fail' : ''} · detail ${path.join(runPath(runId), 'verify')}`);

  if (o.mark) {
    const fixed = results.filter((r) => r.outcome === 'pass').map((r) => r.id);
    if (fixed.length) {
      const now = new Date().toISOString();
      for (const f of doc.findings) if (fixed.includes(f.id)) { f.status = 'fixed'; f.fixedAt = now; }
      writeJson(path.join(runPath(runId), 'findings.json'), doc);
      console.log(`verify: marked fixed ${fixed.join(', ')} · ${writeReport(runId)}`);
    }
  }
  return ok ? 0 : 1;
}

process.exitCode = await main();
