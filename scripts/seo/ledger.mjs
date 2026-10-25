// The per-URL ledger (spec §6, lib/ledger.mjs) from the command line. The ledger lives on the store (seo/ledger.json
// on `checks-state`, lib/store.mjs) and is mirrored at <home>/seo/ledger.json.
//
//   node scripts/seo/ledger.mjs summary                       ledger-summary.md on stdout
//   node scripts/seo/ledger.mjs csv                           the ledger as CSV on stdout
//   node scripts/seo/ledger.mjs baseline --out <file>         the full-run Baseline { url: failing ids } ({} when no audit yet)
//   node scripts/seo/ledger.mjs requested <url> [--note "…"]  the owner asked Google for <url> (default note:
//                                                             "URL Inspection → Request indexing"); pushes the store
//   node scripts/seo/ledger.mjs record-audit --run <runId>    applyAudit from <home>/seo/runs/<runId>/results.json; pushes the store
//   node scripts/seo/ledger.mjs weekly-status [--github-output]
//       `seo-weekly free|busy|done` (read-only): what a weekly run starting now would find; --github-output also
//       appends `weekly=<status>` to $GITHUB_OUTPUT
//
// summary, csv, baseline and weekly-status read the store without writing anything; requested and record-audit pull,
// change and push it. --no-state: the local file only (no git). Common: --home <dir> (default uicHome()),
// --branch <name> (default CHECKS_STATE_BRANCH, else checks-state). CHECKS_STATE_TOKEN (GitHub Actions) authenticates
// the push. Exit 0 ok, 1 a store or file error, 2 bad arguments (a --run without results.json included).
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { uicHome } from '../check-core/lib/home.mjs';
import { loadConfig } from './lib/config.mjs';
import { applyAudit, baselineFrom, markRequested, summary, toCsv, weeklyStatus } from './lib/ledger.mjs';
import { pullLedger, pushLedger, readLocalLedger, readStoreState, seoStore, writeLocalLedger } from './lib/store.mjs';

const COMMANDS = ['summary', 'csv', 'baseline', 'requested', 'record-audit', 'weekly-status'];
export const DEFAULT_NOTE = 'URL Inspection → Request indexing';

/** CLI args → { command, target, note, out, run, home, branch, noState, githubOutput }; throws on a bad command or flag. */
export function parseArgs(argv) {
  const o = { command: null, target: null, note: DEFAULT_NOTE, out: null, run: null, home: null, branch: null, noState: false, githubOutput: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const value = () => {
      const v = argv[++i];
      if (v === undefined || v.startsWith('--')) throw new Error(`${a} needs a value`);
      return v;
    };
    if (a === '--note') o.note = value();
    else if (a === '--out') o.out = value();
    else if (a === '--run') o.run = value();
    else if (a === '--home') o.home = value();
    else if (a === '--branch') o.branch = value();
    else if (a === '--no-state') o.noState = true;
    else if (a === '--github-output') o.githubOutput = true;
    else if (a.startsWith('--')) throw new Error(`unknown argument ${a}`);
    else if (!o.command) o.command = a;
    else if (!o.target) o.target = a;
    else throw new Error(`unexpected argument ${a}`);
  }
  if (!COMMANDS.includes(o.command)) throw new Error(`command must be one of ${COMMANDS.join(', ')}`);
  if (o.command === 'requested') {
    if (!o.target) throw new Error('requested needs a <url>');
    let u;
    try { u = new URL(o.target); } catch { throw new Error(`requested: ${o.target} is not an absolute URL`); }
    if (!/^https?:$/.test(u.protocol)) throw new Error(`requested: ${o.target} is not an http(s) URL`);
    o.target = u.href;
  } else if (o.target) throw new Error(`${o.command} takes no argument`);
  if (o.command === 'baseline' && !o.out) throw new Error('baseline needs --out <file>');
  if (o.command === 'record-audit' && !o.run) throw new Error('record-audit needs --run <runId>');
  return o;
}

export async function cli(argv, { log = console.log, err = console.error, now = Date.now() } = {}) {
  let o;
  try { o = parseArgs(argv); } catch (e) { err(`ledger: ${e.message}`); return 2; }
  const home = o.home ? path.resolve(o.home) : uicHome();
  const git = o.noState ? null : seoStore({ token: process.env.CHECKS_STATE_TOKEN || null, ...(o.branch ? { branch: o.branch } : {}) });
  /** Read-only commands: the store's ledger (and lease), or the local file under --no-state. */
  const readOnly = () => (git ? readStoreState(git) : { ledger: readLocalLedger(home), lease: null });
  /** Changing commands: pull, change, push (or the local file only). → how it was saved. */
  const change = (mutate, message) => {
    const ledger = mutate(git ? pullLedger(git, home) : readLocalLedger(home));
    if (!git) { writeLocalLedger(home, ledger); return { ledger, saved: 'local only (--no-state)' }; }
    const r = pushLedger(git, home, ledger, message);
    return { ledger, saved: r.pushed ? `pushed ${String(r.sha).slice(0, 7)}` : 'store up to date' };
  };
  try {
    if (o.command === 'summary') { log(summary(readOnly().ledger, { now }).trimEnd()); return 0; }
    if (o.command === 'csv') { process.stdout.write(toCsv(readOnly().ledger)); return 0; }
    if (o.command === 'baseline') {
      const b = baselineFrom(readOnly().ledger);
      const out = path.resolve(o.out);
      mkdirSync(path.dirname(out), { recursive: true });
      writeFileSync(out, `${JSON.stringify(b, null, 2)}\n`);
      log(`ledger: baseline · ${Object.keys(b).length} url(s) → ${out}`);
      return 0;
    }
    if (o.command === 'weekly-status') {
      const { ledger, lease } = readOnly();
      const st = weeklyStatus(ledger, lease, { now });
      const why = st === 'busy' ? `lease ${lease.holder} until ${lease.until}` : st === 'done' ? 'an ok run since Monday 00:00 Paris' : 'no ok run yet this week';
      log(`seo-weekly ${st} ${why}`);
      if (o.githubOutput && process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `weekly=${st}\n`);
      return 0;
    }
    if (o.command === 'requested') {
      const { ledger, saved } = change((l) => markRequested(l, o.target, o.note, { now }), `seo: requested ${o.target}`);
      log(`ledger: requested ${o.target} (${o.note}) · ${ledger.urls[o.target].requests.length} request(s) on record · ${saved}`);
      return 0;
    }
    const resultsPath = path.join(home, 'seo', 'runs', o.run, 'results.json');
    if (!existsSync(resultsPath)) { err(`ledger: no results.json for run ${o.run} (${resultsPath})`); return 2; }
    const result = JSON.parse(readFileSync(resultsPath, 'utf8'));
    const expectNoindex = loadConfig().expectedNoindex ?? [];
    const { saved } = change((l) => applyAudit(l, result, { expectNoindex, now }), `seo: audit ${result.runId}`);
    log(`ledger: record-audit ${result.runId} · ${Object.keys(result.urls).length} url(s)${result.only ? ` · only ${result.only.join(',')}` : ''} · ${saved}`);
    return 0;
  } catch (e) {
    err(`ledger: ${String(e.message || e).split('\n')[0]}`);
    return 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await cli(process.argv.slice(2));
}
