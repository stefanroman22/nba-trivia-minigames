// One-time Google authorisation for the SEO agent (installed-app flow), run by the owner on their PC:
//
//   node scripts/seo/auth.mjs
//
// Takes GOOGLE_SEO_CLIENT_ID / GOOGLE_SEO_CLIENT_SECRET from env or asks for them in the terminal (never a command-line
// argument), opens Google's consent page (Search Console + Drive), catches the redirect on 127.0.0.1, exchanges the
// code for a refresh token and writes { clientId, clientSecret, refreshToken } (mode 0600) to credentialsPath(). Then
// it writes the three values to three temp files and prints the `gh secret set` commands that read them; no value is
// printed.
import http from 'node:http';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createInterface } from 'node:readline/promises';
import { fileURLToPath } from 'node:url';
import { TOKEN_URL, credentialsPath, readJson } from './lib/google-auth.mjs';

export const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
export const SCOPES = ['https://www.googleapis.com/auth/webmasters', 'https://www.googleapis.com/auth/drive'];
const REPO = 'stefanroman22/nba-trivia-minigames';

/** Google's consent URL for an offline (refresh-token) grant of SCOPES, redirecting to `redirectUri`. */
export function buildAuthUrl({ clientId, redirectUri, state }) {
  const params = {
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: SCOPES.join(' '),
    access_type: 'offline',
    prompt: 'consent',
    state,
  };
  return `${AUTH_URL}?${Object.entries(params).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&')}`;
}

/** Opens `url` in the default browser (best effort; the URL is printed as well). */
function openBrowser(url) {
  const [cmd, args] = process.platform === 'win32' ? ['rundll32', ['url.dll,FileProtocolHandler', url]]
    : process.platform === 'darwin' ? ['open', [url]] : ['xdg-open', [url]];
  try { spawn(cmd, args, { detached: true, stdio: 'ignore' }).on('error', () => {}).unref(); } catch { /* printed below */ }
}

/** Starts a server on 127.0.0.1:<free port> → { redirectUri, code: Promise<string> } (resolves on the redirect). */
async function listenForCode(state) {
  let settle;
  const code = new Promise((resolve, reject) => { settle = { resolve, reject }; });
  const server = http.createServer((req, res) => {
    const q = new URL(req.url, 'http://127.0.0.1').searchParams;
    if (!q.has('code') && !q.has('error')) { res.writeHead(404).end(); return; }
    const ok = q.get('state') === state && q.get('code');
    res.writeHead(ok ? 200 : 400, { 'content-type': 'text/plain' });
    res.end(ok ? 'Swish Quest SEO agent authorised. You can close this tab.' : 'Authorisation failed. See the terminal.');
    server.close();
    if (ok) settle.resolve(q.get('code'));
    else settle.reject(new Error(q.get('error') ? `google auth: consent ${q.get('error')}` : 'google auth: state mismatch'));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { redirectUri: `http://127.0.0.1:${server.address().port}`, code };
}

/** The authorisation code → the refresh token (throws `google auth: <status>`, never the body). */
async function exchangeCode({ clientId, clientSecret, code, redirectUri }) {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ code, client_id: clientId, client_secret: clientSecret, redirect_uri: redirectUri, grant_type: 'authorization_code' }).toString(),
  });
  if (!res.ok) throw new Error(`google auth: ${res.status}`);
  const body = await readJson(res, 'google auth');
  if (typeof body.refresh_token !== 'string' || !body.refresh_token) throw new Error('google auth: no refresh_token in the response');
  return body.refresh_token;
}

/** `content` to `file` with mode 0600 (chmod too, as writeFileSync's mode applies only to a new file). */
function writePrivate(file, content) {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, content, { mode: 0o600 });
  chmodSync(file, 0o600);
}

async function main() {
  let clientId = process.env.GOOGLE_SEO_CLIENT_ID?.trim();
  let clientSecret = process.env.GOOGLE_SEO_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    if (!clientId) clientId = (await rl.question('OAuth client ID (Desktop app): ')).trim();
    if (!clientSecret) clientSecret = (await rl.question('OAuth client secret: ')).trim();
    rl.close();
  }
  if (!clientId || !clientSecret) throw new Error('google auth: a client ID and a client secret are required');

  const state = randomBytes(16).toString('hex');
  const { redirectUri, code } = await listenForCode(state);
  const url = buildAuthUrl({ clientId, redirectUri, state });
  console.log(`seo-auth: opening Google's consent page. If no browser opens, visit:\n${url}`);
  openBrowser(url);
  const refreshToken = await exchangeCode({ clientId, clientSecret, code: await code, redirectUri });

  const file = credentialsPath();
  writePrivate(file, `${JSON.stringify({ clientId, clientSecret, refreshToken }, null, 2)}\n`);
  console.log(`seo-auth: credentials written to ${file}`);

  const dir = mkdtempSync(path.join(os.tmpdir(), 'nba-seo-secrets-'));
  const values = { GOOGLE_SEO_CLIENT_ID: clientId, GOOGLE_SEO_CLIENT_SECRET: clientSecret, GOOGLE_SEO_REFRESH_TOKEN: refreshToken };
  console.log('seo-auth: to give the weekly run the same credentials, run in Git Bash or cmd (PowerShell has no `<`):');
  for (const [name, value] of Object.entries(values)) {
    const tmp = path.join(dir, name);
    writePrivate(tmp, value);
    console.log(`  gh secret set ${name} --repo ${REPO} < "${tmp}"`);
  }
  console.log(`seo-auth: then delete ${dir}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { await main(); } catch (e) {
    console.error(`seo-auth: ${e.message}`);
    process.exitCode = 1;
  }
  process.exit(); // the readline / server handles must not keep the process alive
}
