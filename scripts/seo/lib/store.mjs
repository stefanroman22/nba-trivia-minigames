// The SEO agent's state on the checks' store (branch `checks-state`, check-core/lib/state-store.mjs):
//   seo/ledger.json   the per-URL ledger (lib/ledger.mjs), one of the store's JSON_FILES: sync() merges it 3-way
//                     (state-merge.mjs mergeSeoLedger) and mirrors it to <home>/seo/ledger.json
//   seo/lease.json    { holder, since, until }: one weekly SEO run at a time (the checks' acquireLease is weekly.json's)
// Nothing here holds a secret: the token reaches git through storeGit's env extraheader only.
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { ROOT } from '../../check-core/lib/home.mjs';
import { DEFAULT_BRANCH, storeGit, sync, update } from '../../check-core/lib/state-store.mjs';
import { emptyLedger } from './ledger.mjs';

export const LEDGER_FILE = 'seo/ledger.json';
export const LEASE_FILE = 'seo/lease.json';
const iso = (t) => new Date(t).toISOString();
const jsonText = (v) => JSON.stringify(v, null, 2) + '\n';
const parse = (buf) => {
  if (buf === undefined) return undefined;
  try { return JSON.parse(String(buf).replace(/^﻿/, '')); } catch { return undefined; }
};

/** The local mirror of the ledger: <home>/seo/ledger.json. */
export const ledgerPath = (home) => path.join(home, ...LEDGER_FILE.split('/'));

/** The local ledger, or an empty one when the file is missing or unreadable. */
export function readLocalLedger(home) {
  const p = ledgerPath(home);
  return (existsSync(p) && parse(readFileSync(p))) || emptyLedger();
}

/** Writes the local ledger (atomically: a tmp file, then a rename). */
export function writeLocalLedger(home, ledger) {
  const p = ledgerPath(home);
  mkdirSync(path.dirname(p), { recursive: true });
  const tmp = `${p}.${process.pid}.tmp`;
  writeFileSync(tmp, jsonText(ledger));
  renameSync(tmp, p);
}

/**
 * Git access to the store (storeGit). `token`: CHECKS_STATE_TOKEN on GitHub Actions (null: git's own credentials);
 * `branch` defaults to CHECKS_STATE_BRANCH, else checks-state.
 */
export function seoStore({ token = null, branch = process.env.CHECKS_STATE_BRANCH || DEFAULT_BRANCH, remote = 'origin', cwd = ROOT } = {}) {
  return storeGit({ cwd, remote, branch, token });
}

/** sync() the home with the store, then the merged ledger (empty when neither side has one). */
export function pullLedger(git, home) {
  sync({ git, home, message: 'seo: pull ledger' });
  return readLocalLedger(home);
}

/** Writes `ledger` as the local copy and sync()s it up (3-way: another writer's changes meanwhile survive). → sync's result. */
export function pushLedger(git, home, ledger, message = 'seo: ledger') {
  writeLocalLedger(home, ledger);
  return sync({ git, home, message });
}

/** The store's ledger and lease, read-only (no local file written) → { sha, ledger, lease }. */
export function readStoreState(git) {
  const sha = git.fetch();
  const files = git.files(sha);
  return { sha, ledger: parse(files[LEDGER_FILE]) || emptyLedger(), lease: parse(files[LEASE_FILE]) || null };
}

/**
 * The weekly SEO run's lease on seo/lease.json, through update() (fetch → change → fast-forward push, retried).
 *   acquire: 'busy' (no write) while another holder's lease is unexpired; else the lease is ours for `ttlMin` → 'free'.
 *   release: our lease removed → 'released'; another holder's unexpired lease is left alone → 'busy'.
 * @returns {{ status: 'free'|'busy'|'released', holder: string|null }} holder: the lease's holder after the call
 */
export function lease(git, { holder, action, ttlMin = 90, now = Date.now() }) {
  if (!holder) throw new Error('lease: holder required');
  if (!['acquire', 'release'].includes(action)) throw new Error(`lease: action must be acquire or release, not ${action}`);
  return update(git, (files) => {
    const cur = parse(files[LEASE_FILE]) || null;
    const live = cur && Date.parse(cur.until) > now && cur.holder !== holder;
    if (live) return { result: { status: 'busy', holder: cur.holder } };
    if (action === 'release') {
      if (!cur) return { result: { status: 'released', holder: null } };
      const next = { ...files };
      delete next[LEASE_FILE];
      return { files: next, message: `seo: release ${holder}`, result: { status: 'released', holder: null } };
    }
    const doc = { holder, since: iso(now), until: iso(now + ttlMin * 60_000) };
    return { files: { ...files, [LEASE_FILE]: jsonText(doc) }, message: `seo: lease ${holder}`, result: { status: 'free', holder } };
  }).result;
}
