#!/usr/bin/env node
// Re-run findings' acceptance criteria (checks + DSL assertions) against the local stack — the fix loop's judge.
//   node scripts/ui-check/verify.mjs <findingId…> [--run <id>] [--mode dev|prod] [--expect-fail] [--mark] [--keep-stack]
// Default mode dev (HMR, no rebuild). Without --run, each id is looked up in the newest run whose findings.json holds it.
// Prints one line per finding — `PASS|FAIL <id> — <first failing line>` — and totals; the full detail goes to
// <runDir>/verify/<id>.json, Playwright's output to <runDir>/verify/pw-<stamp>.log.
// Exit 0 iff every finding passes (with --expect-fail: iff every finding's criteria all FAIL cleanly); 2 on bad usage.
// --mark: passing findings get status 'fixed' + fixedAt in <runDir>/findings.json, and REPORT.md is regenerated.
import path from 'node:path';
import { readFindingsDoc, runOfFinding, runPath, writeJson, writeReport } from './lib/findings.mjs';
import { stamp, verifyFindings, withStack, writeDetail } from './lib/verify-core.mjs';

function parseArgs(argv) {
  const o = { ids: [], run: null, mode: 'dev', expectFail: false, mark: false, keepStack: false };
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
  if (o.help || !o.ids.length) {
    console.log('usage: node scripts/ui-check/verify.mjs <findingId…> [--run <id>] [--mode dev|prod] [--expect-fail] [--mark] [--keep-stack]');
    return o.help ? 0 : 2;
  }
  if (!['dev', 'prod'].includes(o.mode)) { console.error('verify: --mode must be dev or prod'); return 2; }
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

  const t0 = Date.now();
  const log = path.join(runPath(runId), 'verify', `pw-${stamp()}.log`);
  let results;
  try {
    results = await withStack({ mode: o.mode, keepStack: o.keepStack, log }, () => verifyFindings(findings, { runId, expectFail: o.expectFail, log, mode: o.mode }));
  } catch (e) {
    console.error(`verify: ${e.message}`);
    return 1;
  }
  const secs = Math.round((Date.now() - t0) / 1000);

  for (const r of results) {
    writeDetail(runId, r, { mode: o.mode, expectFail: o.expectFail, log });
    const tag = r.outcome === 'pass' ? 'PASS' : 'FAIL';
    const note = o.expectFail && !r.asExpected && r.reason ? ` [expect-fail: ${r.reason}]` : '';
    console.log(`${tag} ${r.id} — ${r.firstLine}${note}`);
  }
  const pass = results.filter((r) => r.outcome === 'pass').length;
  const ok = results.every((r) => r.asExpected);
  console.log(`verify: ${results.length} finding(s) · ${pass} pass · ${results.length - pass} fail · ${secs}s · mode ${o.mode}${o.expectFail ? ' · expect-fail' : ''} · detail ${path.join(runPath(runId), 'verify')}`);

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
