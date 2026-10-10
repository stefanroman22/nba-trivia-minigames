/**
 * `npm run dev`: the Next.js dev server plus a LOCAL multiplayer server.
 *
 * Multiplayer is billed by usage, so local development must never touch the deployed
 * server. dev-env.mjs (predev) points the site at localhost:4000; this script makes sure
 * something is listening there — it starts multiplayer_server/ unless one already is — and
 * stops it again when the dev server exits.
 *
 * NBA_DEV_ENV_SKIP (pipeline worktrees / QA) runs plain `next dev` and starts nothing else:
 * those runs must never touch the user's local ports (see .claude/agents/browser-qa.md).
 */
import { spawn } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { connect } from 'node:net';
import path from 'node:path';

const SOCKET_PORT = 4000;
const SITE_ORIGIN = 'http://localhost:5173';
const REMOTE_BACKEND_URL = 'https://backend-kappa-one-42.vercel.app/api';

const isPortOpen = (port, timeout = 300) =>
  new Promise((resolve) => {
    const socket = connect({ host: 'localhost', port });
    const done = (result) => { socket.destroy(); resolve(result); };
    socket.setTimeout(timeout);
    socket.once('connect', () => done(true));
    socket.once('timeout', () => done(false));
    socket.once('error', () => done(false));
  });

/** The backend dev-env.mjs picked for the site (it wrote it to .env.local a moment ago). */
function chosenBackendUrl() {
  if (process.env.VITE_BACKEND_URL) return process.env.VITE_BACKEND_URL;
  try {
    const match = readFileSync(path.resolve('.env.local'), 'utf8').match(/^VITE_BACKEND_URL=(.+)$/m);
    if (match) return match[1].trim();
  } catch { /* fall through */ }
  return REMOTE_BACKEND_URL;
}

const children = [];
const run = (args, options = {}) => {
  const child = spawn(process.execPath, args, { stdio: 'inherit', ...options });
  children.push(child);
  return child;
};
const stopAll = () => children.forEach((child) => { if (!child.killed) child.kill(); });
process.on('SIGINT', () => { stopAll(); process.exit(130); });
process.on('SIGTERM', () => { stopAll(); process.exit(143); });

if (!process.env.NBA_DEV_ENV_SKIP) {
  if (await isPortOpen(SOCKET_PORT)) {
    console.log(`multiplayer: using the server already running on :${SOCKET_PORT}`);
  } else if (!existsSync(path.resolve('multiplayer_server/node_modules'))) {
    console.warn('multiplayer: multiplayer_server has no node_modules — run `npm ci --prefix multiplayer_server`. Online play is off.');
  } else {
    console.log(`multiplayer: starting a local server on :${SOCKET_PORT}`);
    run(['multiplayer_server/src/index.js'], {
      env: {
        ...process.env,
        PORT: String(SOCKET_PORT),
        CORS_ORIGINS: SITE_ORIGIN,
        // The relay wants the bare origin: it calls <base>/api/me/ and <base>/trivia/... itself,
        // while the site's VITE_BACKEND_URL ends in /api.
        API_BASE_URL: chosenBackendUrl().replace(/\/api\/?$/, ''),
      },
    });
  }
}

// Extra args (`npm run dev -- --port 5273`) go to next dev, as they did before this script existed.
const extraArgs = process.argv.slice(2);
const hasPort = extraArgs.some((arg) => arg === '-p' || arg === '--port' || arg.startsWith('--port='));
const next = run(['node_modules/next/dist/bin/next', 'dev', ...(hasPort ? [] : ['-p', '5173']), ...extraArgs]);
next.on('exit', (code) => { stopAll(); process.exit(code ?? 0); });
