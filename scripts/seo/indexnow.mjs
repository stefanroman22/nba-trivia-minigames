// IndexNow from the command line (lib/indexnow.mjs): ping the URLs whose audit result changed since the previous
// ledger, once the key file is live.
//
//   node scripts/seo/indexnow.mjs --run <runId> [--dry-run] [--run-dir <dir>] [--ledger <file>] [--previous <file>] [--home <dir>]
//
// The run dir defaults to <home>/seo/runs/<runId> (home: uicHome()), the ledger to <home>/seo/ledger.json and the
// previous ledger to <runDir>/ledger-previous.json (missing: every audited URL counts as changed). No indexNowKey in
// config.json, or a key file that is not live, prints one `indexnow: skipped (<reason>)` line and exits 0. --dry-run
// checks the key file but sends no ping. The outcome goes to <runDir>/indexnow.json { at, status, count, urls, dryRun }
// and one line on the console. Exit 0 ok, skipped or dry; 1 the ping failed or was refused; 2 bad arguments.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { uicHome } from '../check-core/lib/home.mjs';
import { loadConfig } from './lib/config.mjs';
import { fetcher as makeFetcher } from './lib/fetcher.mjs';
import { STATUS_TEXT, changedUrls, keyFileLive, keyFileUrl, pingIndexNow } from './lib/indexnow.mjs';
import { readLocalLedger } from './lib/store.mjs';

/** CLI args → { run, runDir, ledger, previous, home, dryRun }; throws on an unknown flag, a missing value or no run. */
export function parseArgs(argv) {
  const o = { run: null, runDir: null, ledger: null, previous: null, home: null, dryRun: false };
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
    else if (a === '--previous') o.previous = value();
    else if (a === '--home') o.home = value();
    else if (a === '--dry-run') o.dryRun = true;
    else throw new Error(`unknown argument ${a}`);
  }
  if (!o.run && !o.runDir) throw new Error('--run <runId> (or --run-dir <dir>) required');
  return o;
}

const readJson = (file) => JSON.parse(readFileSync(file, 'utf8').replace(/^﻿/, ''));

/**
 * @param {string[]} argv
 * @param {{ log?: Function, err?: Function, config?: object, fetch?: typeof fetch, fetcher?: object, now?: number }} [deps]
 * @returns {Promise<number>} the exit code
 */
export async function cli(argv, { log = console.log, err = console.error, config, fetch: fetchImpl = globalThis.fetch, fetcher, now = Date.now() } = {}) {
  let o;
  try { o = parseArgs(argv); } catch (e) { err(`indexnow: ${e.message}`); return 2; }
  const home = o.home ? path.resolve(o.home) : uicHome();
  const runDir = path.resolve(o.runDir ?? path.join(home, 'seo', 'runs', o.run));
  try {
    const { site, indexNowKey: key } = config ?? loadConfig();
    if (!key) { log('indexnow: skipped (no indexNowKey in config.json)'); return 0; }
    if (!(await keyFileLive({ site, key, fetcher: fetcher ?? makeFetcher() }))) {
      log(`indexnow: skipped (key file ${keyFileUrl(site, key)} not live)`);
      return 0;
    }
    if (o.ledger && !existsSync(o.ledger)) { err(`indexnow: no ledger at ${path.resolve(o.ledger)}`); return 2; }
    const ledger = o.ledger ? readJson(o.ledger) : readLocalLedger(home);
    const previousFile = o.previous ?? path.join(runDir, 'ledger-previous.json');
    const previous = existsSync(previousFile) ? readJson(previousFile) : null;
    const urls = changedUrls(ledger, previous);
    const record = (status, count) => {
      mkdirSync(runDir, { recursive: true });
      writeFileSync(path.join(runDir, 'indexnow.json'), `${JSON.stringify({ at: new Date(now).toISOString(), status, count, urls, dryRun: o.dryRun }, null, 2)}\n`);
    };
    if (!urls.length) { record(null, 0); log('indexnow: 0 url(s) changed, nothing to ping'); return 0; }
    if (o.dryRun) { record(null, urls.length); log(`indexnow: dry · ${urls.length} url(s) would be pinged`); return 0; }
    const { status, count } = await pingIndexNow({ site, key, urls, fetch: fetchImpl });
    record(status, count);
    const line = `indexnow: ${status} ${STATUS_TEXT[status] ?? 'unexpected status'} · ${count} url(s)`;
    if (status === 200 || status === 202) { log(line); return 0; }
    err(line);
    return 1;
  } catch (e) {
    err(`indexnow: ${String(e.message || e).replace(/^indexnow: /, '').split('\n')[0]}`);
    return 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await cli(process.argv.slice(2));
}
