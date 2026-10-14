#!/usr/bin/env node
// Merge the judges' findings into one validated, deduplicated report.
//   node scripts/ui-check/report.mjs [--run <id>] [--validate] [--prev <runId>] [--mode dev|prod] [--keep-stack]
// Reads <runDir>/findings/*.json (judge output), validates each finding against findings.schema.json plus the
// acceptance DSL, merges equal fingerprints (rule|route|selector), drops accepted.json fingerprints, assigns ids
// UIC-<runId>-NNN (a fingerprint already seen in this run or the previous run keeps its id: --prev, else the newest
// earlier run with a findings.json), and with --validate proves every new acceptance FAILS on the current code
// (verify --expect-fail, batched; default mode dev): a finding whose acceptance passes, partly passes or cannot run
// moves to <runDir>/rejected.json with the reason. Writes <runDir>/findings.json, rejected.json and REPORT.md.
// Validation results are cached by acceptance hash: an unchanged finding is not re-run.
import { existsSync } from 'node:fs';
import path from 'node:path';
import {
  ACCEPTED_PATH, acceptanceHash, assignIds, dropAccepted, fingerprint, latestRunId, listRuns, loadJudgeFindings,
  mergeFindings, readFindingsDoc, readJson, runMode, runPath, sortFindings, validateFinding, writeJson, writeReport,
} from './lib/findings.mjs';
import { stamp, verifyFindings, withStack, writeDetail } from './lib/verify-core.mjs';

function parseArgs(argv) {
  const o = { run: null, prev: null, validate: false, mode: 'dev', keepStack: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const val = () => { const v = argv[++i]; if (v === undefined || v.startsWith('--')) throw new Error(`${a} needs a value`); return v; };
    if (a === '--run') o.run = val();
    else if (a === '--prev') o.prev = val();
    else if (a === '--validate') o.validate = true;
    else if (a === '--mode') o.mode = val();
    else if (a === '--keep-stack') o.keepStack = true;
    else if (a === '--help' || a === '-h') o.help = true;
    else throw new Error(`unknown argument ${a}`);
  }
  return o;
}

const trunc = (s, n = 160) => { s = String(s); return s.length > n ? `${s.slice(0, n)}…` : s; };

async function main() {
  let o;
  try { o = parseArgs(process.argv.slice(2)); } catch (e) { console.error(`report: ${e.message}`); return 2; }
  if (o.help) {
    console.log('usage: node scripts/ui-check/report.mjs [--run <id>] [--validate] [--prev <runId>] [--mode dev|prod] [--keep-stack]');
    return 0;
  }
  const runId = o.run || latestRunId();
  const dir = runId && runPath(runId);
  if (!dir || !existsSync(dir)) { console.error(`report: no run directory ${dir || '(no latest run)'}`); return 2; }
  const files = { findings: path.join(dir, 'findings.json'), rejected: path.join(dir, 'rejected.json') };

  // 1. Judge files → schema + DSL validation.
  const { items, errors } = loadJudgeFindings(dir);
  const rejected = errors.map((e) => ({ source: e.source, reason: `file: ${e.error}`, kind: 'file' }));
  const valid = [], sources = new Map();
  for (const { finding, source } of items) {
    const errs = validateFinding(finding);
    if (errs.length) { rejected.push({ source, title: finding && finding.title, reason: `schema: ${errs.join('; ')}`, kind: 'schema', errors: errs }); continue; }
    valid.push(finding);
    const fp = fingerprint(finding);
    sources.set(fp, [...(sources.get(fp) || []), source]);
  }

  // 2. Merge, drop accepted.
  const merged = mergeFindings(valid);
  const { kept, dropped } = dropAccepted(merged, readJson(ACCEPTED_PATH, []));

  // 3. Ids: this run's findings.json, then its rejected.json, then the previous run's findings.json.
  const own = readFindingsDoc(runId);
  const ownRejected = readJson(files.rejected, []);
  const prevId = o.prev || listRuns().find((r) => r < runId && /^\d{8}-\d{4}$/.test(r) && readFindingsDoc(r));
  const prev = prevId ? readFindingsDoc(prevId) : null;
  const known = new Map();
  for (const f of (prev && prev.findings) || []) known.set(f.fingerprint, { id: f.id });
  for (const r of ownRejected) if (r.fingerprint && r.id) known.set(r.fingerprint, { id: r.id });
  const ownByFp = new Map(((own && own.findings) || []).map((f) => [f.fingerprint, f]));
  for (const [fp, f] of ownByFp) known.set(fp, { id: f.id });
  let findings = assignIds(sortFindings(kept), runId, known).map((f) => {
    const was = ownByFp.get(f.fingerprint);
    const hash = acceptanceHash(f);
    const out = { ...f, status: (was && was.status) || 'open' };
    if (was && was.fixedAt) out.fixedAt = was.fixedAt;
    if (was && was.validatedHash === hash) { out.validatedAt = was.validatedAt; out.validatedHash = hash; }
    return out;
  });

  // 4. Validation (or its cached verdicts).
  const cachedReject = new Map(ownRejected.filter((r) => r.kind === 'validation').map((r) => [`${r.fingerprint}|${r.acceptanceHash}`, r]));
  const rejectFor = (f, reason, detail) => ({
    id: f.id, fingerprint: f.fingerprint, title: f.title, suite: f.suite, source: (sources.get(f.fingerprint) || []).join(', '),
    reason, kind: 'validation', acceptanceHash: acceptanceHash(f), ...(detail ? { detail } : {}),
  });
  const keep = [];
  const toRun = [];
  for (const f of findings) {
    const cached = cachedReject.get(`${f.fingerprint}|${acceptanceHash(f)}`);
    if (cached) rejected.push({ ...cached, id: f.id });
    else if (o.validate && f.status !== 'fixed' && !f.validatedHash) toRun.push(f);
    else keep.push(f);
  }
  let validateLine = null;
  if (toRun.length) {
    const t0 = Date.now();
    const log = path.join(dir, 'verify', `pw-${stamp()}.log`);
    let results;
    try {
      results = await withStack({ mode: o.mode, keepStack: o.keepStack, log }, () => verifyFindings(toRun, { runId, expectFail: true, log, mode: o.mode }));
    } catch (e) {
      console.error(`report: validation failed to run: ${e.message}`);
      return 1;
    }
    const now = new Date().toISOString();
    let ok = 0;
    for (const r of results) {
      const f = toRun.find((x) => x.id === r.id);
      const detail = writeDetail(runId, r, { mode: o.mode, expectFail: true, log });
      if (r.asExpected) { ok++; keep.push({ ...f, validatedAt: now, validatedHash: acceptanceHash(f) }); }
      else rejected.push(rejectFor(f, r.reason || 'acceptance did not fail as expected', detail));
    }
    validateLine = `validate: ${toRun.length} finding(s) · mode ${o.mode} · ${Math.round((Date.now() - t0) / 1000)}s → ${ok} reproduce, ${toRun.length - ok} rejected`;
  } else if (o.validate) validateLine = 'validate: nothing new to validate (unchanged acceptance is cached)';
  findings = sortFindings(keep);

  // 5. Write.
  writeJson(files.findings, { runId, mode: runMode(dir), generatedAt: new Date().toISOString(), previousRun: prevId || null, findings });
  writeJson(files.rejected, rejected);
  const report = writeReport(runId);

  const carried = prev ? findings.filter((f) => !f.id.startsWith(`UIC-${runId}-`)).length : 0;
  console.log(`report: run ${runId} · ${items.length} judge finding(s) from ${new Set(items.map((x) => x.source.split('[')[0])).size} file(s) → ${merged.length} after dedupe · ${dropped.length} accepted dropped${prevId ? ` · previous run ${prevId} (${carried} id(s) carried)` : ''}`);
  if (validateLine) console.log(validateLine);
  for (const r of rejected) console.log(`rejected: ${r.id || r.source} ${trunc(r.title || '', 60)} — ${trunc(r.reason)}`);
  const unvalidated = findings.filter((f) => !f.validatedAt && f.status !== 'fixed').length;
  console.log(`report: ${findings.length} finding(s) in findings.json · ${rejected.length} in rejected.json${unvalidated ? ` · ${unvalidated} not validated (add --validate)` : ''}`);
  console.log(`report: ${report}`);
  return 0;
}

process.exitCode = await main();
