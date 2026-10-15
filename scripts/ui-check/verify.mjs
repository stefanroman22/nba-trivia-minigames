#!/usr/bin/env node
// Re-run findings' acceptance criteria (checks + DSL assertions) against the local stack — the fix loop's judge.
//   node scripts/ui-check/verify.mjs <findingId…> [--run <id>] [--mode dev|prod] [--expect-fail] [--mark] [--keep-stack]
//   node scripts/ui-check/verify.mjs --from <findings.json> [--mode dev|prod] [--repo <dir>] [--ports django=…,socket=…,web=…]
// Mode: --mode when given; else dev (HMR, no rebuild), except prod for a finding whose acceptance was validated in
// prod (validatedMode). Without --run, each id is looked up in the newest run whose findings.json holds it.
// --from: the finding objects themselves (an array, or { findings: [...] }, e.g. a Notion card's attachment), no run
// needed; ids given as well narrow the file to those; output goes to <home>/adhoc/<timestamp>/verify/.
// --repo: the checkout whose app runs (default this one); --ports: the stack's ports (default the mode's checker set),
// so a pipeline QA lane verifies its worktree on its own ports.
// Prints one line per finding — `PASS|FAIL <id> — <first failing line>` — and totals; the full detail goes to
// <runDir>/verify/<id>.json (guards marked), Playwright's output to <runDir>/verify/pw-<stamp>.log.
// Exit 0 iff every finding passes, guards included (with --expect-fail: iff every finding reproduces: at least one
// criterion FAILS cleanly and none errors); 1 otherwise or on an infra error; 2 on bad usage.
// --mark: passing findings get status 'fixed' + fixedAt in <runDir>/findings.json, and REPORT.md is regenerated.
// Stack: without --keep-stack only what THIS call started is stopped. In a fix loop always pass --keep-stack and stop
// once at the end with `node scripts/ui-check/run.mjs --stop` (`--stop --ports …` for a lane's ports).
import { existsSync } from 'node:fs';
import path from 'node:path';
import { readFindingsDoc, readJson, runOfFinding, runPath, writeJson, writeReport } from './lib/findings.mjs';
import { resultDir, stamp, verifyFindings, withStack, writeDetail } from './lib/verify-core.mjs';
import { parsePorts } from '../check-core/lib/ports.mjs';

const USAGE = [
  'usage: node scripts/ui-check/verify.mjs <findingId…> [--run <id>] [--mode dev|prod] [--expect-fail] [--mark] [--keep-stack]',
  '       node scripts/ui-check/verify.mjs --from <findings.json> [<findingId…>] [--mode dev|prod] [--repo <dir>] [--ports django=…,socket=…,web=…]',
  '  --mode        default dev; prod for findings validated in prod (validatedMode)',
  '  --from        finding objects from a file (array or {findings}); no run needed; output in <home>/adhoc/<ts>/',
  '  --repo        run the app from this checkout (default: this one)',
  '  --ports       stack ports (default the mode\'s: prod 8200/4200/5374, dev 8000/4000/5173)',
  '  --keep-stack  leave the stack running. Without it only what this call started is stopped.',
  '                In a fix loop always pass --keep-stack; stop once at the end with `node scripts/ui-check/run.mjs --stop`.',
  '  --mark        set status fixed + fixedAt on passing findings and regenerate REPORT.md (not with --from)',
  '  --expect-fail exit 0 iff every finding reproduces (≥ 1 criterion fails cleanly, none errors)',
].join('\n');

function parseArgs(argv) {
  const o = { ids: [], run: null, mode: null, expectFail: false, mark: false, keepStack: false, from: null, repo: null, ports: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const val = () => { const v = argv[++i]; if (v === undefined || v.startsWith('--')) throw new Error(`${a} needs a value`); return v; };
    if (a === '--run') o.run = val();
    else if (a === '--mode') o.mode = val();
    else if (a === '--from') o.from = val();
    else if (a === '--repo') o.repo = val();
    else if (a === '--ports') o.ports = parsePorts(val());
    else if (a === '--expect-fail') o.expectFail = true;
    else if (a === '--mark') o.mark = true;
    else if (a === '--keep-stack') o.keepStack = true;
    else if (a === '--help' || a === '-h') o.help = true;
    else if (a.startsWith('--')) throw new Error(`unknown argument ${a}`);
    else o.ids.push(a);
  }
  return o;
}

/** Findings of a --from file → { findings } or { error }. */
function fromFile(file, ids) {
  const data = readJson(file);
  const list = Array.isArray(data) ? data : data && Array.isArray(data.findings) ? data.findings : null;
  if (!list) return { error: `${file}: expected an array of findings or { "findings": [...] }` };
  const bad = list.findIndex((f) => !f || typeof f.id !== 'string' || !f.acceptance);
  if (bad >= 0) return { error: `${file}: finding [${bad}] needs an id and an acceptance` };
  const findings = ids.length ? ids.map((id) => list.find((f) => f.id === id)) : list;
  const missing = ids.filter((id, i) => !findings[i]);
  if (missing.length) return { error: `${file} has no finding ${missing.join(', ')}` };
  if (!findings.length) return { error: `${file} holds no findings` };
  return { findings };
}

async function main() {
  let o;
  try { o = parseArgs(process.argv.slice(2)); } catch (e) { console.error(`verify: ${e.message}`); return 2; }
  if (o.help || (!o.ids.length && !o.from)) { console.log(USAGE); return o.help ? 0 : 2; }
  if (o.mode && !['dev', 'prod'].includes(o.mode)) { console.error('verify: --mode must be dev or prod'); return 2; }
  if (o.mark && o.expectFail) { console.error('verify: --mark and --expect-fail exclude each other'); return 2; }
  if (o.from && (o.mark || o.run)) { console.error('verify: --from takes no --run and no --mark (there is no run to update)'); return 2; }
  if (o.repo && !existsSync(path.join(path.resolve(o.repo), 'package.json'))) { console.error(`verify: --repo ${o.repo} is not a checkout of the app`); return 2; }

  let runId, doc = null;
  const findings = [];
  if (o.from) {
    const r = fromFile(path.resolve(o.from), o.ids);
    if (r.error) { console.error(`verify: ${r.error}`); return 2; }
    findings.push(...r.findings);
    runId = `adhoc/${stamp()}`;
  } else {
    runId = o.run || runOfFinding(o.ids[0]);
    doc = runId && readFindingsDoc(runId);
    if (!doc) { console.error(`verify: no findings.json ${o.run ? `in run ${o.run}` : `holds ${o.ids[0]}`} (run report.mjs first)`); return 2; }
    for (const id of o.ids) {
      const f = doc.findings.find((x) => x.id === id);
      if (!f) { console.error(`verify: ${id} is not in ${path.join(runPath(runId), 'findings.json')}${o.run ? '' : ' (pass --run for ids of another run)'}`); return 2; }
      findings.push(f);
    }
  }

  // One stack per mode, in order (dev first).
  const modeOf = (f) => o.mode || (f.validatedMode === 'prod' ? 'prod' : 'dev');
  const groups = ['dev', 'prod'].map((m) => [m, findings.filter((f) => modeOf(f) === m)]).filter(([, list]) => list.length);

  const t0 = Date.now();
  const outDir = path.join(resultDir(runId), 'verify');
  const log = path.join(outDir, `pw-${stamp()}.log`);
  const results = [];
  for (const [mode, list] of groups) {
    try {
      // Always re-run (no `reuse`): the fix loop judges the code as it is now.
      const rs = await withStack({ mode, keepStack: o.keepStack, log, repo: o.repo, ports: o.ports }, () => verifyFindings(list, { runId, expectFail: o.expectFail, log, mode }));
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
  console.log(`verify: ${results.length} finding(s) · ${pass} pass · ${results.length - pass} fail · ${secs}s · mode ${groups.map(([m]) => m).join('+')}${o.expectFail ? ' · expect-fail' : ''} · detail ${outDir}`);

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
