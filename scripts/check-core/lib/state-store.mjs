// The checks' durable state on the orphan branch `checks-state` (never dev or main), so the weekly run on GitHub
// Actions, the weekly run on the PC, the live-probe workflow and a skill run all share one channel and one ledger.
// Design: docs/superpowers/specs/2026-10-17-checks-cloud-design.md.
//
// Branch layout (flat files, no app code):
//   channel.json            the Logic↔UI block channel (lib/channel.mjs)
//   notion-cards.json       the cards ledger (lib/cards-ledger.mjs), entries without title/url (the repo is public)
//   logic-live-state.json   the live probes' consecutive-failure state (logic-check/lib/live-triage.mjs)
//   weekly.json             { lease, runs[] }: one weekly run at a time, and "already ran since Sunday 00:00 Paris"
//   seo/ledger.json         the SEO agent's per-URL ledger (scripts/seo/lib/ledger.mjs); seo/lease.json its run lease
//   notes/<checker>/…       the judges' and the triage's notes (scripts/<checker>/notes/), canonical copy
//   notes-base/<checker>/…  dev's version of those notes at the last merge (so a notes edit on dev flows in)
//
// Every write is optimistic: fetch the branch, apply the change to what is there now (3-way merges,
// lib/state-merge.mjs), commit with the fetched commit as the only parent, push WITHOUT force. Git refuses a push that
// is not a fast-forward, so two writers can never clobber each other: the loser fetches again, re-applies its own
// change on top and retries. No working tree, index or checkout is touched (plumbing only: hash-object, a temporary
// index, write-tree, commit-tree, push), so it is safe from any checkout, the owner's included.
//
// A home (<uicHome>) mirrors the JSON files; <home>/state-base/<branch>/ holds the store copy it last merged (the
// "base"). sync(): local changes since the base are pushed, everything else comes from the store.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ROOT } from './home.mjs';
import { mergeChannel, mergeLedger, mergeSeoLedger, merge3Value } from './state-merge.mjs';
import { lastSundayMidnight } from './weekly-slot.mjs';

export const DEFAULT_BRANCH = 'checks-state';
export const JSON_FILES = ['channel.json', 'notion-cards.json', 'logic-live-state.json', 'seo/ledger.json'];
export const NOTES = [
  { checker: 'ui-check', dir: path.join('scripts', 'ui-check', 'notes') },
  { checker: 'logic-check', dir: path.join('scripts', 'logic-check', 'notes') },
];
const LEASE_TTL_MIN = 420; // 7 h: longer than the 6 h job / task limit
const RUNS_KEPT = 20;
const README = `# checks-state

Durable state of the weekly checks (Logic Check + UI check) and the live probes. Written only by
scripts/check-core/lib/state-store.mjs (fast-forward pushes, never force). Do not merge this branch anywhere.
See docs/superpowers/specs/2026-10-17-checks-cloud-design.md.
`;

const sleepSync = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
const iso = (t) => new Date(t).toISOString();
const posix = (p) => p.split(path.sep).join('/');
// Notes are compared and merged as LF text: a Windows checkout may hold CRLF copies of the same lines.
const lf = (s) => String(s).replace(/\r\n/g, '\n');
const lfTree = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, lf(v)]));

/**
 * Git access for one store: `cwd` a repo (the tooling checkout), `remote` a remote name or URL, `branch`.
 * `token` (CHECKS_STATE_TOKEN on GitHub Actions) is passed as an http extraheader through git's env config, so it never
 * lands in a git config file or on a command line, and the children of the run (agents) never see it.
 */
export function storeGit({ cwd = ROOT, remote = 'origin', branch = DEFAULT_BRANCH, token = null } = {}) {
  const env = { ...process.env, GIT_TERMINAL_PROMPT: '0' };
  if (token) {
    Object.assign(env, {
      GIT_CONFIG_COUNT: '1',
      GIT_CONFIG_KEY_0: 'http.https://github.com/.extraheader',
      GIT_CONFIG_VALUE_0: `AUTHORIZATION: basic ${Buffer.from(`x-access-token:${token}`).toString('base64')}`,
    });
  }
  const ref = `refs/nba-checks/${branch}`;
  const run = (args, { input, allowFail = false, extraEnv = {} } = {}) => {
    const r = spawnSync('git', args, { cwd, env: { ...env, ...extraEnv }, input: input === undefined ? undefined : Buffer.from(input), maxBuffer: 64 << 20, windowsHide: true });
    const out = { status: r.status, stdout: r.stdout || Buffer.alloc(0), stderr: String(r.stderr || r.error?.message || '') };
    if (r.status !== 0 && !allowFail) throw new Error(`git ${args[0]} failed: ${out.stderr.trim().split('\n').slice(-2).join(' ')}`);
    return out;
  };
  return {
    branch, remote, cwd,
    /** Fetch the branch → its commit sha, or null when the branch does not exist yet. */
    fetch() {
      const ls = run(['ls-remote', '--heads', remote, `refs/heads/${branch}`]);
      if (!String(ls.stdout).trim()) return null;
      run(['fetch', '--quiet', '--no-tags', remote, `+refs/heads/${branch}:${ref}`]);
      return String(run(['rev-parse', ref]).stdout).trim();
    },
    /** The files of a commit → { path: Buffer }. */
    files(sha) {
      if (!sha) return {};
      const out = {};
      for (const ent of String(run(['ls-tree', '-r', '-z', sha]).stdout).split('\0').filter(Boolean)) {
        const m = /^\d+ blob ([0-9a-f]+)\t(.+)$/.exec(ent);
        if (m) out[m[2]] = run(['cat-file', 'blob', m[1]]).stdout;
      }
      return out;
    },
    /** Commit `files` ({ path: string|Buffer }) on top of `parent` (null: a root commit) → sha. */
    commit(files, parent, message) {
      const tmp = mkdtempSync(path.join(os.tmpdir(), 'checks-state-'));
      try {
        const index = path.join(tmp, 'index');
        const lines = Object.keys(files).sort().map((p) => {
          const sha = String(run(['hash-object', '-w', '--stdin'], { input: Buffer.from(files[p]) }).stdout).trim();
          return `100644 ${sha}\t${p}`;
        });
        run(['update-index', '--add', '--index-info'], { input: lines.join('\n') + '\n', extraEnv: { GIT_INDEX_FILE: index } });
        const tree = String(run(['write-tree'], { extraEnv: { GIT_INDEX_FILE: index } }).stdout).trim();
        const who = { GIT_AUTHOR_NAME: 'nba-checks', GIT_AUTHOR_EMAIL: 'nba-checks@users.noreply.github.com', GIT_COMMITTER_NAME: 'nba-checks', GIT_COMMITTER_EMAIL: 'nba-checks@users.noreply.github.com' };
        return String(run(['commit-tree', tree, ...(parent ? ['-p', parent] : []), '-m', message], { extraEnv: who }).stdout).trim();
      } finally { rmSync(tmp, { recursive: true, force: true }); }
    },
    /** Fast-forward push (never force) of `sha` made on `parent` → 'ok' | 'rejected' (another writer moved the
     *  branch, or holds its lock right now: fetch and retry); any other failure throws. */
    push(sha, parent) {
      const r = run(['push', '--porcelain', remote, `${sha}:refs/heads/${branch}`], { allowFail: true });
      if (r.status === 0) { run(['update-ref', ref, sha]); return 'ok'; }
      const text = `${r.stdout}\n${r.stderr}`;
      if (/rejected|non-fast-forward|fetch first|cannot lock ref|failed to update ref|incorrect old value/i.test(text)) return 'rejected';
      const now = run(['ls-remote', '--heads', remote, `refs/heads/${branch}`], { allowFail: true });
      const head = String(now.stdout).trim().split(/\s/)[0] || null;
      if (now.status === 0 && head !== (parent || null)) return 'rejected';
      throw new Error(`git push ${branch} failed: ${text.trim().split('\n').slice(-3).join(' ')}`);
    },
    /** `git show <ref>:<path>` of the tooling checkout (dev's notes) → Buffer | undefined. */
    show(rev, p) {
      const r = run(['show', `${rev}:${posix(p)}`], { allowFail: true });
      return r.status === 0 ? r.stdout : undefined;
    },
    /** git merge-file --union (3-way, conflicts keep both sides) → string. */
    mergeText(current, base, other) {
      const tmp = mkdtempSync(path.join(os.tmpdir(), 'checks-notes-'));
      try {
        const [c, b, o] = ['current', 'base', 'other'].map((n) => path.join(tmp, n));
        writeFileSync(c, current); writeFileSync(b, base); writeFileSync(o, other);
        const r = run(['merge-file', '-p', '--union', c, b, o], { allowFail: true });
        if (r.status < 0 || r.status === null) throw new Error(`git merge-file failed: ${r.stderr}`);
        return String(r.stdout);
      } finally { rmSync(tmp, { recursive: true, force: true }); }
    },
  };
}

/**
 * The CAS loop: fetch → mutate(files of the store now, sha) → commit on that sha → fast-forward push; on 'rejected'
 * fetch again and re-apply. mutate returns { files, message, result } or null (nothing to write: result of the read).
 * → { result, sha, pushed, attempts }.
 */
export function update(git, mutate, { attempts = 12, wait = (n) => 200 * n + Math.floor(Math.random() * 300) } = {}) {
  for (let n = 1; n <= attempts; n++) {
    const parent = git.fetch();
    const before = git.files(parent);
    const r = mutate(before, parent);
    if (!r || !r.files) return { result: r?.result, sha: parent, pushed: false, attempts: n };
    const files = { 'README.md': README, ...r.files };
    if (parent && sameFiles(before, files)) return { result: r.result, sha: parent, pushed: false, attempts: n };
    const sha = git.commit(files, parent, r.message || 'checks-state: update');
    if (git.push(sha, parent) === 'ok') return { result: r.result, sha, pushed: true, attempts: n };
    sleepSync(wait(n));
  }
  throw new Error(`checks-state: push still rejected after ${attempts} attempts (another writer keeps winning)`);
}

function sameFiles(a, b) {
  const ka = Object.keys(a).sort(), kb = Object.keys(b).sort();
  if (ka.length !== kb.length || ka.some((k, i) => k !== kb[i])) return false;
  return ka.every((k) => Buffer.compare(Buffer.from(a[k]), Buffer.from(b[k])) === 0);
}

const parseJson = (buf) => {
  if (buf === undefined) return undefined;
  try { return JSON.parse(String(buf).replace(/^﻿/, '')); } catch { return undefined; }
};
const jsonText = (v) => JSON.stringify(v, null, 2) + '\n';
function readLocalJson(file) {
  if (!existsSync(file)) return undefined;
  return parseJson(readFileSync(file));
}
function writeAtomic(file, text) {
  mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, text);
  renameSync(tmp, file);
}

export const baseDir = (home, branch = DEFAULT_BRANCH) => path.join(home, 'state-base', branch.replace(/[^\w.-]+/g, '-'));

/** Every file under dir (relative posix paths) → { rel: Buffer }. */
function readTree(dir) {
  const out = {};
  const walk = (d, rel) => {
    let ents = [];
    try { ents = readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of ents) {
      const p = path.join(d, e.name), r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) walk(p, r);
      else if (e.isFile() && !/\.tmp$/.test(e.name)) out[r] = readFileSync(p);
    }
  };
  walk(dir, '');
  return out;
}

/**
 * One merge of the JSON files (pure apart from reading the arguments) → { store: {name: value}, local: {name: value} }.
 * base/local/remote: { name: parsed JSON | undefined }.
 */
export function mergeJsonFiles(base, local, remote) {
  const store = {}, out = {};
  const c = mergeChannel(base['channel.json'], local['channel.json'], remote['channel.json']);
  store['channel.json'] = c; out['channel.json'] = c;
  const l = mergeLedger(base['notion-cards.json'], local['notion-cards.json'], remote['notion-cards.json']);
  store['notion-cards.json'] = l.store; out['notion-cards.json'] = l.local;
  const s = merge3Value(base['logic-live-state.json'], local['logic-live-state.json'], remote['logic-live-state.json']);
  if (s !== undefined) { store['logic-live-state.json'] = s; out['logic-live-state.json'] = s; }
  const g = mergeSeoLedger(base['seo/ledger.json'], local['seo/ledger.json'], remote['seo/ledger.json']);
  if (g !== undefined) { store['seo/ledger.json'] = g; out['seo/ledger.json'] = g; }
  return { store, local: out };
}

/**
 * The notes of one checker (pure but for git merge-file): S store copy, B local base, L working copy, D store's dev
 * reference, H dev's version (the tooling checkout's HEAD) — each { rel: string }.
 * 1. local edits up: with a base (an overlay is in place) every file's L−B change is merged onto S (union);
 *    an empty store is seeded from L. 2. dev edits in: a file whose H differs from D gets H−D merged in (union), D := H.
 * → { notes, devBase } (the new S and D).
 */
export function mergeNotes({ S = {}, B = null, L = {}, D = {}, H = {} }, mergeText) {
  const notes = { ...S }, devBase = { ...D };
  const seeding = !Object.keys(S).length;
  if (seeding) Object.assign(notes, L);
  else if (B) {
    for (const [f, text] of Object.entries(L)) {
      const b = B[f];
      if (b === text) continue;
      notes[f] = notes[f] === undefined ? text : mergeText(notes[f], b ?? '', text);
    }
  }
  for (const [f, h] of Object.entries(H)) {
    if (devBase[f] === h) continue;
    if (seeding || devBase[f] === undefined) { devBase[f] = h; if (notes[f] === undefined) notes[f] = h; continue; }
    notes[f] = notes[f] === undefined ? h : mergeText(notes[f], devBase[f], h);
    devBase[f] = h;
  }
  return { notes, devBase };
}

/**
 * Sync a home with the store: push its changes since the last sync, take everything else.
 *   home: the checkers' home (channel.json, notion-cards.json, logic-live-state.json, state-base/).
 *   notes: true → also the notes of `repo` (scripts/<checker>/notes, written as an overlay into that checkout);
 *   headRev: dev's version of the notes (default origin/dev, else HEAD).
 *   dryRun: compute and report, write nothing (no push, no local file).
 * → { pushed, sha, changed: [store files changed], attempts }.
 */
export function sync({ git, home, notes = false, repo = git.cwd, headRev = null, message = 'checks-state: sync', dryRun = false, log = () => {} }) {
  const bdir = baseDir(home, git.branch);
  const base = Object.fromEntries(JSON_FILES.map((f) => [f, readLocalJson(path.join(bdir, f))]));
  const local = Object.fromEntries(JSON_FILES.map((f) => [f, readLocalJson(path.join(home, f))]));
  // dev's notes: origin/dev (the same on every machine; the PC's tooling branch may carry commits of its own), else HEAD.
  if (!headRev) headRev = spawnSync('git', ['rev-parse', '--verify', '--quiet', 'refs/remotes/origin/dev'], { cwd: repo, windowsHide: true }).status === 0 ? 'refs/remotes/origin/dev' : 'HEAD';
  // Notes: the working copy and its base, read once (the merge is re-applied on every push attempt).
  const notesIn = notes ? NOTES.map((n) => {
    const hasBase = existsSync(path.join(bdir, 'notes', n.checker));
    const L = lfTree(readTree(path.join(repo, n.dir)));
    const B = hasBase ? lfTree(readTree(path.join(bdir, 'notes', n.checker))) : null;
    // dev's version: the tracked files of the notes dir at headRev.
    const H = {};
    const ls = spawnSync('git', ['ls-tree', '-r', '--name-only', headRev, '--', posix(n.dir)], { cwd: repo, encoding: 'utf8', windowsHide: true });
    for (const p of String(ls.stdout || '').split('\n').filter(Boolean)) {
      const rel = p.slice(posix(n.dir).length + 1);
      const r = spawnSync('git', ['show', `${headRev}:${p}`], { cwd: repo, encoding: 'utf8', maxBuffer: 16 << 20, windowsHide: true });
      if (r.status === 0) H[rel] = lf(r.stdout);
    }
    return { ...n, L, B, H };
  }) : [];

  let merged = null;
  const res = update(git, (files) => {
    const remote = Object.fromEntries(JSON_FILES.map((f) => [f, parseJson(files[f])]));
    const m = mergeJsonFiles(base, local, remote);
    const next = {};
    for (const [k, v] of Object.entries(files)) next[k] = v;
    for (const [f, v] of Object.entries(m.store)) next[f] = jsonText(v);
    const notesOut = [];
    for (const n of notesIn) {
      const pick = (prefix) => Object.fromEntries(Object.entries(files).filter(([k]) => k.startsWith(`${prefix}/${n.checker}/`)).map(([k, v]) => [k.slice(prefix.length + n.checker.length + 2), lf(v)]));
      const r = mergeNotes({ S: pick('notes'), B: n.B, L: n.L, D: pick('notes-base'), H: n.H }, git.mergeText);
      for (const [rel, text] of Object.entries(r.notes)) next[`notes/${n.checker}/${rel}`] = text;
      for (const [rel, text] of Object.entries(r.devBase)) next[`notes-base/${n.checker}/${rel}`] = text;
      notesOut.push({ ...n, notes: r.notes });
    }
    merged = { m, notesOut, remoteFiles: files, next };
    if (dryRun) return { result: 'dry' };
    return { files: next, message };
  });
  const changed = merged ? Object.keys(merged.next).filter((k) => k !== 'README.md' && (merged.remoteFiles[k] === undefined || Buffer.compare(Buffer.from(merged.remoteFiles[k]), Buffer.from(merged.next[k])) !== 0)) : [];
  if (dryRun || !merged) return { pushed: false, sha: res.sha, changed, attempts: res.attempts, dryRun };

  // Local copies and the new base, only after the store holds them.
  for (const [f, v] of Object.entries(merged.m.local)) {
    if ((f === 'logic-live-state.json' || f === 'seo/ledger.json') && v === undefined) continue;
    writeAtomic(path.join(home, f), jsonText(v));
  }
  for (const [f, v] of Object.entries(merged.m.store)) writeAtomic(path.join(bdir, f), jsonText(v));
  for (const n of merged.notesOut) {
    for (const [rel, text] of Object.entries(n.notes)) {
      writeAtomic(path.join(repo, n.dir, ...rel.split('/')), text);
      writeAtomic(path.join(bdir, 'notes', n.checker, ...rel.split('/')), text);
    }
  }
  log(`checks-state ${git.branch}: ${res.pushed ? `pushed ${String(res.sha).slice(0, 7)}` : 'up to date'}${changed.length ? ` (${changed.join(', ')})` : ''}${res.attempts > 1 ? ` after ${res.attempts} attempts` : ''}`);
  return { pushed: res.pushed, sha: res.sha, changed, attempts: res.attempts };
}

/**
 * End of a run on a persistent checkout: the notes overlay goes away (the checkout's notes back to its HEAD, the local
 * notes base removed), so the next update of that checkout (ff from dev) is not blocked and the next sync does not
 * mistake HEAD's notes for local edits.
 */
export function releaseNotes({ home, repo, branch = DEFAULT_BRANCH }) {
  for (const n of NOTES) {
    spawnSync('git', ['checkout', 'HEAD', '--', posix(n.dir)], { cwd: repo, windowsHide: true });
    spawnSync('git', ['clean', '-fdq', '--', posix(n.dir)], { cwd: repo, windowsHide: true });
  }
  rmSync(path.join(baseDir(home, branch), 'notes'), { recursive: true, force: true });
}

/** Copy the store's notes into `repo`'s notes dirs (to commit them to dev in a PR). → [paths written] */
export function exportNotes({ git, repo }) {
  const sha = git.fetch();
  const files = git.files(sha);
  const written = [];
  for (const n of NOTES) {
    for (const [k, v] of Object.entries(files)) {
      if (!k.startsWith(`notes/${n.checker}/`)) continue;
      const to = path.join(repo, n.dir, ...k.slice(`notes/${n.checker}/`.length).split('/'));
      writeAtomic(to, v);
      written.push(to);
    }
  }
  return written;
}

// ---- weekly.json: the run lease and the run history ----

const readWeekly = (files) => {
  const w = parseJson(files['weekly.json']) || {};
  return { lease: w.lease || null, runs: Array.isArray(w.runs) ? w.runs : [] };
};

/** What a new weekly run would find, read-only → { status: 'free'|'busy'|'done', lease?, run? }. */
export function weeklyStatus(files, { holder = null, now = Date.now(), force = false } = {}) {
  const w = readWeekly(files);
  if (w.lease && Date.parse(w.lease.until) > now && w.lease.holder !== holder) return { status: 'busy', lease: w.lease };
  if (!force) {
    const since = lastSundayMidnight(now);
    const run = w.runs.find((r) => r.status === 'ok' && Date.parse(r.startedAt) >= since);
    if (run) return { status: 'done', run };
  }
  return { status: 'free' };
}

/**
 * Take the weekly lease → { status: 'acquired'|'busy'|'done', lease?, run? }. busy: another holder's lease has not
 * expired (a run in flight elsewhere); done: a run finished ok since Sunday 00:00 Paris time (unless force).
 */
export function acquireLease(git, { holder, now = Date.now(), ttlMin = LEASE_TTL_MIN, force = false, scheduled = false, where = null }) {
  if (!holder) throw new Error('acquireLease: holder required');
  return update(git, (files) => {
    const st = weeklyStatus(files, { holder, now, force });
    if (st.status !== 'free') return { result: st };
    const w = readWeekly(files);
    w.lease = { holder, since: iso(now), until: iso(now + ttlMin * 60_000) };
    w.runs = [...w.runs.filter((r) => r.holder !== holder), { holder, where, scheduled, startedAt: iso(now), status: 'running' }].slice(-RUNS_KEPT);
    return { files: { ...files, 'weekly.json': jsonText(w) }, message: `checks-state: lease ${holder}`, result: { status: 'acquired', lease: w.lease } };
  }).result;
}

/** Release the lease (when still ours) and record the run's outcome. → true when written. */
export function releaseLease(git, { holder, status = 'ok', now = Date.now(), summary = null }) {
  return update(git, (files) => {
    const w = readWeekly(files);
    const r = w.runs.find((x) => x.holder === holder);
    if (r) Object.assign(r, { status, endedAt: iso(now), ...(summary ? { summary } : {}) });
    else w.runs = [...w.runs, { holder, status, endedAt: iso(now), ...(summary ? { summary } : {}) }].slice(-RUNS_KEPT);
    if (w.lease && w.lease.holder === holder) w.lease = null;
    return { files: { ...files, 'weekly.json': jsonText(w) }, message: `checks-state: ${holder} ${status}`, result: true };
  }).result;
}

/** The store's files (read-only). */
export function readStore(git) {
  const sha = git.fetch();
  return { sha, files: git.files(sha) };
}
