#!/usr/bin/env node
// The checks state store (branch `checks-state`, lib/state-store.mjs) from the command line.
//   node scripts/check-core/state.mjs sync [--notes] [--release-notes] [--dry-run] [-m <message>]
//       push this home's channel / ledger / live-state changes since its last sync, take everything else (3-way, never
//       clobbers another writer). --notes: also this checkout's scripts/{ui,logic}-check/notes (as an overlay; only on
//       a tooling checkout: the weekly run's, or CI's). --release-notes: then restore those notes to HEAD (end of a run).
//   node scripts/check-core/state.mjs show                 the store's blocks, pending deferrals, lease and last runs
//   node scripts/check-core/state.mjs weekly-status [--force] [--github-output]
//       `weekly free|busy|done …` (read-only): what a weekly run starting now would find
//   node scripts/check-core/state.mjs lease acquire --holder <id> [--force] [--scheduled] [--where <text>]
//       exit 0 acquired · 3 busy (another run holds an unexpired lease) · 4 done (a run finished ok since Sunday 00:00
//       Paris time; --force runs anyway)
//   node scripts/check-core/state.mjs lease release --holder <id> [--status ok|failed]
//   node scripts/check-core/state.mjs notes-export   write the store's notes into this checkout (to PR them to dev)
// Common: --home <dir> (default UI_CHECK_HOME / uicHome()), --branch <name> (default checks-state, or
// CHECKS_STATE_BRANCH), --remote <name|url> (default origin). CHECKS_STATE_TOKEN (GitHub Actions) authenticates the
// push; locally git's own credentials do.
import { appendFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ROOT, uicHome } from './lib/home.mjs';
import { DEFAULT_BRANCH, acquireLease, exportNotes, readStore, releaseLease, releaseNotes, storeGit, sync, weeklyStatus } from './lib/state-store.mjs';

function parse(argv) {
  const o = { _: [] };
  const flags = new Set(['--notes', '--release-notes', '--dry-run', '--force', '--scheduled', '--github-output']);
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (flags.has(a)) o[a.slice(2)] = true;
    else if (a === '-m' || a.startsWith('--')) { const v = argv[++i]; if (v === undefined) throw new Error(`${a} needs a value`); o[a === '-m' ? 'message' : a.slice(2)] = v; }
    else o._.push(a);
  }
  return o;
}

export function gitFor(o) {
  const token = process.env.CHECKS_STATE_TOKEN || null;
  return storeGit({ cwd: ROOT, remote: o.remote || 'origin', branch: o.branch || process.env.CHECKS_STATE_BRANCH || DEFAULT_BRANCH, token });
}

export async function cli(argv, { log = console.log, err = console.error } = {}) {
  let o;
  try { o = parse(argv); } catch (e) { err(`state: ${e.message}`); return 2; }
  const home = o.home ? path.resolve(o.home) : uicHome();
  const git = gitFor(o);
  const [cmd, sub] = o._;
  try {
    if (cmd === 'sync') {
      const r = sync({ git, home, notes: !!o.notes, message: o.message || 'checks-state: sync', dryRun: !!o['dry-run'], log });
      if (o['dry-run']) log(`checks-state ${git.branch} (dry run): would change ${r.changed.join(', ') || 'nothing'}`);
      if (o['release-notes'] && !o['dry-run']) { releaseNotes({ home, repo: ROOT, branch: git.branch }); log('checks-state: notes overlay released'); }
      return 0;
    }
    if (cmd === 'show') {
      const { sha, files } = readStore(git);
      if (!sha) { log(`checks-state ${git.branch}: does not exist yet (the first sync creates it)`); return 0; }
      const j = (f) => { try { return JSON.parse(String(files[f])); } catch { return null; } };
      const c = j('channel.json') || { blocks: [], deferred: [], resolved: [] };
      const w = j('weekly.json') || { lease: null, runs: [] };
      log(`checks-state ${git.branch} @ ${sha.slice(0, 7)}`);
      log(`blocks ${c.blocks.length}${c.blocks.map((b) => `\n  ${b.service} by ${b.by} (card ${b.card}, since ${b.since})`).join('')}`);
      log(`deferred ${c.deferred.filter((d) => !d.resolvedAt).length} pending · resolved ${c.resolved.length}`);
      log(`ledger ${Object.keys(j('notion-cards.json') || {}).length} entr(ies) · notes ${Object.keys(files).filter((k) => k.startsWith('notes/')).length} file(s)`);
      log(`lease ${w.lease ? `${w.lease.holder} until ${w.lease.until}` : 'free'}`);
      for (const r of (w.runs || []).slice(-5)) log(`  run ${r.holder} ${r.status} ${r.startedAt || ''}${r.endedAt ? ` → ${r.endedAt}` : ''}`);
      return 0;
    }
    if (cmd === 'weekly-status') {
      const { files } = readStore(git);
      const st = weeklyStatus(files, { force: !!o.force });
      const why = st.status === 'busy' ? `lease ${st.lease.holder} until ${st.lease.until}` : st.status === 'done' ? `run ${st.run.holder} ok at ${st.run.startedAt}` : 'no run yet this week';
      log(`weekly ${st.status} ${why}`);
      if (o['github-output'] && process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `weekly=${st.status}\n`);
      return 0;
    }
    if (cmd === 'lease' && sub === 'acquire') {
      if (!o.holder) { err('state: lease acquire needs --holder'); return 2; }
      const r = acquireLease(git, { holder: o.holder, force: !!o.force, scheduled: !!o.scheduled, where: o.where || null });
      if (r.status === 'acquired') { log(`lease acquired ${o.holder} until ${r.lease.until}`); return 0; }
      if (r.status === 'busy') { log(`lease busy: ${r.lease.holder} until ${r.lease.until}`); return 3; }
      log(`lease done: run ${r.run.holder} finished ok at ${r.run.startedAt} (since Sunday 00:00 Paris; --force runs anyway)`);
      return 4;
    }
    if (cmd === 'lease' && sub === 'release') {
      if (!o.holder) { err('state: lease release needs --holder'); return 2; }
      releaseLease(git, { holder: o.holder, status: o.status || 'ok' });
      log(`lease released ${o.holder} (${o.status || 'ok'})`);
      return 0;
    }
    if (cmd === 'notes-export') {
      const w = exportNotes({ git, repo: ROOT });
      log(`checks-state: ${w.length} notes file(s) written into ${ROOT} (commit them on a branch for dev)`);
      return 0;
    }
  } catch (e) { err(`state: ${String(e.message || e).split('\n')[0]}`); return 1; }
  err('usage: node scripts/check-core/state.mjs sync [--notes] [--release-notes] [--dry-run] | show | weekly-status | lease acquire|release --holder <id> | notes-export');
  return 2;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = await cli(process.argv.slice(2));
