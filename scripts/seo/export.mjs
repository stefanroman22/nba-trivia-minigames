// The weekly Drive export (spec §5/§6): three files into the folder config.json `driveFolderId` names
// (SEO/Indexing/exports), through the Drive API with the owner's OAuth token (lib/google-auth.mjs, lib/drive.mjs).
//
//   node scripts/seo/export.mjs --run <runId> [--dry-run] [--run-dir <dir>] [--ledger <file>] [--home <dir>]
//
//   ledger-<YYYY-MM-DD>.csv          the ledger (lib/ledger.mjs toCsv); default <home>/seo/ledger.json
//   gsc-analytics-<YYYY-MM-DD>.csv   Search Analytics from <runDir>/gsc-analytics.json, when present
//   REPORT-<YYYY-MM-DD>.md           <runDir>/REPORT.md
//
// The date is today's (UTC); a re-run the same day replaces the files in Drive. The files are always written into the
// run dir too; --dry-run stops there (no credentials read, no request). No driveFolderId or no Google credentials →
// one `export: skipped (<reason>)` line, exit 0. Search Analytics numbers go to the CSV and Drive only: the console
// gets `export: <n> files → <folderId>`, an error its step and HTTP status. Exit 0 done, dry or skipped; 1 a failed
// upload or auth; 2 bad arguments or no REPORT.md in the run dir.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { uicHome } from '../check-core/lib/home.mjs';
import { loadConfig } from './lib/config.mjs';
import { driveUpload } from './lib/drive.mjs';
import { credentialsFromEnv, tokenSource } from './lib/google-auth.mjs';
import { toCsv } from './lib/ledger.mjs';
import { readLocalLedger } from './lib/store.mjs';

export const ANALYTICS_COLUMNS = ['page', 'clicks', 'impressions', 'ctr', 'position'];

/** CLI args → { run, runDir, ledger, home, dryRun }; throws on an unknown flag, a missing value or no run. */
export function parseArgs(argv) {
  const o = { run: null, runDir: null, ledger: null, home: null, dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const value = () => {
      const v = argv[++i];
      if (v === undefined || v.startsWith('--')) throw new Error(`${a} needs a value`);
      return v;
    };
    if (a === '--run') o.run = value();
    else if (a === '--run-dir') o.runDir = value();
    else if (a === '--ledger') o.ledger = value();
    else if (a === '--home') o.home = value();
    else if (a === '--dry-run') o.dryRun = true;
    else throw new Error(`unknown argument ${a}`);
  }
  if (!o.run && !o.runDir) throw new Error('--run <runId> (or --run-dir <dir>) required');
  return o;
}

const cell = (v) => {
  const s = v === null || v === undefined ? '' : String(v);
  return /[",\r\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
};

/** Search Analytics rows ({ keys, clicks, impressions, ctr, position }) as CSV; several keys are joined with ' | '. */
export function analyticsCsv(rows) {
  const lines = (rows ?? []).map((r) => [(r.keys ?? []).join(' | '), r.clicks, r.impressions, r.ctr, r.position]);
  return [ANALYTICS_COLUMNS, ...lines].map((r) => r.map(cell).join(',')).join('\n') + '\n';
}

/** A JSON file, parsed; a parse error names the file only (the SyntaxError would quote its content). */
function readJsonFile(file) {
  try { return JSON.parse(readFileSync(file, 'utf8').replace(/^﻿/, '')); } catch { throw new Error(`${file} is not JSON`); }
}

/**
 * The export files of a run → [{ name, mimeType, body }]: the ledger CSV, the analytics CSV (when the run has
 * gsc-analytics.json, as { rows } or a bare row array) and the report.
 */
export function exportFiles({ runDir, ledger, date }) {
  const files = [{ name: `ledger-${date}.csv`, mimeType: 'text/csv', body: toCsv(ledger) }];
  const analyticsFile = path.join(runDir, 'gsc-analytics.json');
  if (existsSync(analyticsFile)) {
    const doc = readJsonFile(analyticsFile);
    files.push({ name: `gsc-analytics-${date}.csv`, mimeType: 'text/csv', body: analyticsCsv(Array.isArray(doc) ? doc : doc?.rows) });
  }
  files.push({ name: `REPORT-${date}.md`, mimeType: 'text/markdown', body: readFileSync(path.join(runDir, 'REPORT.md'), 'utf8') });
  return files;
}

/**
 * @param {string[]} argv
 * @param {{ log?: Function, err?: Function, config?: object, credentials?: () => object|null, fetch?: typeof fetch,
 *   now?: number }} [deps]
 * @returns {Promise<number>} the exit code
 */
export async function cli(argv, { log = console.log, err = console.error, config, credentials = credentialsFromEnv, fetch: fetchImpl = globalThis.fetch, now = Date.now() } = {}) {
  let o;
  try { o = parseArgs(argv); } catch (e) { err(`export: ${e.message}`); return 2; }
  const home = o.home ? path.resolve(o.home) : uicHome();
  const runDir = path.resolve(o.runDir ?? path.join(home, 'seo', 'runs', o.run));
  if (!existsSync(path.join(runDir, 'REPORT.md'))) { err(`export: no REPORT.md in ${runDir}`); return 2; }
  if (o.ledger && !existsSync(o.ledger)) { err(`export: no ledger at ${path.resolve(o.ledger)}`); return 2; }
  try {
    const ledger = o.ledger ? readJsonFile(path.resolve(o.ledger)) : readLocalLedger(home);
    const files = exportFiles({ runDir, ledger, date: new Date(now).toISOString().slice(0, 10) });
    for (const f of files) writeFileSync(path.join(runDir, f.name), f.body);
    if (o.dryRun) { log(`export: dry · ${files.length} files → ${runDir}`); return 0; }

    const { driveFolderId: folderId } = config ?? loadConfig();
    if (!folderId) { log('export: skipped (no driveFolderId in config.json)'); return 0; }
    const creds = credentials();
    if (!creds) { log('export: skipped (no Google credentials)'); return 0; }
    const token = tokenSource({ ...creds, fetch: fetchImpl });
    for (const f of files) await driveUpload({ token, folderId, ...f, fetch: fetchImpl });
    log(`export: ${files.length} files → ${folderId}`);
    return 0;
  } catch (e) {
    err(`export: ${String(e.message || e).split('\n')[0]}`); // drive / auth errors are "<step>: <status>", never a value
    return 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await cli(process.argv.slice(2));
}
