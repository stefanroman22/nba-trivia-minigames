// UI check test accounts (spec §3). One generated password for all of them, kept with the usernames
// in the git-ignored .ui-check/accounts.json. Accounts are created and tokens minted by
// lib/mint_tokens.py inside `manage.py shell` against the local sqlite DB — one long-lived python
// per Node process (Django needs seconds to start here, a mint takes milliseconds).
import { spawn } from 'node:child_process';
import { randomInt } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { REPO_ROOT, UIC_ROOT } from './run-id.mjs';
import { djangoEnv, readStack, venvPython } from './stack.mjs';

const ACCOUNTS_FILE = path.join(UIC_ROOT, 'accounts.json');
const MINT_SCRIPT = fileURLToPath(new URL('./mint_tokens.py', import.meta.url));
const EMAIL_DOMAIN = 'uicheck.test';
const MARK = 'UICHECK_JSON:';

const acct = (username) => ({ username, email: `${username}@${EMAIL_DOMAIN}` });
export const ACCOUNTS = {
  testuser1: acct('testuser1'), // multiplayer host
  testuser2: acct('testuser2'), // multiplayer joiner
  testuser3: acct('testuser3'), // solo (account + games suites)
};

/** Solo account of a parallel worker: testuser3 for worker 0, testuser3w<i> for the others. */
export function soloUsername(parallelIndex = 0) {
  return parallelIndex ? `testuser3w${parallelIndex}` : 'testuser3';
}

const isTestUsername = (u) => /^testuser\d(w\d{1,2})?$/.test(u);

/** Accounts touch the local DB only: refuse when `api` (required) is anything but a localhost URL. */
export function assertLocalApi(api) {
  let host = '';
  try { host = new URL(api).hostname; } catch { /* not a URL */ }
  if (host !== 'localhost') {
    throw new Error(`ui-check: refusing to use test accounts — API base is "${api || '(no stack — run the stack-setup project or run.mjs)'}", not localhost`);
  }
  return api;
}

/** 20 chars: upper, lower, digit and symbol, so Django's validate_password accepts it. */
function generatePassword() {
  const sets = ['ABCDEFGHJKLMNPQRSTUVWXYZ', 'abcdefghijkmnpqrstuvwxyz', '23456789', '!#%+-_=?'];
  const all = sets.join('');
  const chars = sets.map((s) => s[randomInt(s.length)]);
  while (chars.length < 20) chars.push(all[randomInt(all.length)]);
  for (let i = chars.length - 1; i > 0; i--) { const j = randomInt(i + 1); [chars[i], chars[j]] = [chars[j], chars[i]]; }
  return chars.join('');
}

function readAccountsFile() {
  try { return JSON.parse(readFileSync(ACCOUNTS_FILE, 'utf8')); } catch { return null; }
}

function accountsFile() {
  let data = readAccountsFile();
  if (!data?.password) {
    data = { password: generatePassword(), users: ACCOUNTS };
    mkdirSync(UIC_ROOT, { recursive: true });
    writeFileSync(ACCOUNTS_FILE, JSON.stringify(data, null, 2));
  }
  return data;
}

/** {username, email, password} for a ui-check account (persistent or a worker's solo account). */
export function credentials(username) {
  if (!ACCOUNTS[username] && !isTestUsername(username)) throw new Error(`ui-check: unknown test account "${username}"`);
  const { password } = accountsFile();
  return { ...(ACCOUNTS[username] || acct(username)), password };
}

// --- the mint server (one per process) -----------------------------------------------------
let minter = null;

function startMinter(password) {
  const child = spawn(venvPython(), ['manage.py', 'shell', '-c', `import runpy; runpy.run_path(r'${MINT_SCRIPT}', run_name='uicheck')`], {
    cwd: path.join(REPO_ROOT, 'backend'),
    env: djangoEnv({ UIC_MINT_PASSWORD: password }),
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
  });
  const waiting = [];
  let buf = '', errTail = '';
  // Referenced only while a reply is pending: an idle minter never keeps the process alive
  // (stdin closing at exit ends it), a pending one does.
  const hold = (on) => { for (const h of [child, child.stdout, child.stderr]) (on ? h.ref : h.unref)?.call(h); };
  const failAll = (err) => { while (waiting.length) waiting.shift().reject(err); };
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (d) => {
    buf += d;
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (!line.startsWith(MARK)) continue;
      const w = waiting.shift();
      if (!w) continue;
      if (!waiting.length) hold(false);
      try { w.resolve(JSON.parse(line.slice(MARK.length))); } catch (e) { w.reject(e); }
    }
  });
  child.stderr.on('data', (d) => { errTail = (errTail + d).slice(-2000); });
  child.on('exit', (code) => {
    if (minter?.child === child) minter = null;
    failAll(new Error(`mint_tokens.py exited (code ${code}): ${errTail.trim().split('\n').slice(-4).join(' | ')}`));
  });
  child.on('error', (e) => failAll(e));
  const ask = (req) => new Promise((resolve, reject) => {
    waiting.push({ resolve, reject });
    hold(true);
    if (req) child.stdin.write(JSON.stringify(req) + '\n');
  });
  child.stdin.unref?.();
  const ready = ask(null); // the first line is the ready banner
  return { child, ask, ready };
}

async function mintRequest(req) {
  assertLocalApi(readStack()?.api);
  const { password } = accountsFile();
  if (!minter) minter = startMinter(password);
  const m = minter;
  await m.ready;
  const res = await m.ask(req);
  if (!res.ok) throw new Error(`mint_tokens.py: ${res.error}`);
  return res;
}

/** Create .ui-check/accounts.json once, then make sure testuser1-3 exist with that password. */
export async function ensureAccounts() {
  const data = accountsFile();
  const res = await mintRequest({ op: 'ensure', users: Object.values(ACCOUNTS) });
  const created = Object.entries(res.users).filter(([, v]) => v.created).map(([k]) => k);
  if (created.length) console.log(`accounts: created ${created.join(', ')}`);
  return { ...data, ids: Object.fromEntries(Object.entries(res.users).map(([k, v]) => [k, v.id])) };
}

/** A fresh access/refresh pair (+ the /me/ user payload) per username, minted as login does. */
export async function mintTokens(usernames) {
  for (const u of usernames) if (!ACCOUNTS[u] && !isTestUsername(u)) throw new Error(`ui-check: unknown test account "${u}"`);
  const res = await mintRequest({ op: 'mint', users: usernames.map((u) => ACCOUNTS[u] || acct(u)) });
  return res.tokens;
}

/** End this process's mint server (it also ends on its own when the process exits). */
export function closeMinter() {
  if (minter) { minter.child.stdin.end(); minter = null; }
}
