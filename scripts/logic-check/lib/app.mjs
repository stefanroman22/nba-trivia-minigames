// Facts about the app under test, read from its checkout (UI_CHECK_REPO / appRepo(): the `--ref main` worktree, or the
// harness checkout on GitHub Actions, which runs on main): public routes, the deployed origins the build bakes in
// (.env.production: VITE_BACKEND_URL, VITE_SOCKET_URL, VITE_DATA_BASE, VITE_QUESTIONS_BASE), the Google client id, and
// which pool games the manifest-v3 data host serves. No TS import: plain text parsing, like ui-check's games-catalog.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { appRepo } from '../../ui-check/lib/stack.mjs';
import { visibleGames } from '../../ui-check/lib/games-catalog.mjs';

/** A path no route serves (LC-LIVE-01 / LC-PAGES-01 expect the 404 page with a real 404 status). */
export const NOT_FOUND_ROUTE = '/lc-check-no-such-page';

const read = (rel, repo = appRepo()) => { try { return readFileSync(path.join(repo, rel), 'utf8').replace(/^﻿/, ''); } catch { return null; } };

function parseEnv(text) {
  const out = {};
  for (const line of String(text || '').split(/\r?\n/)) {
    const m = /^\s*(?:export\s+)?([A-Za-z_]\w*)\s*=\s*(.*)\s*$/.exec(line);
    if (m && !(m[1] in out)) out[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
  }
  return out;
}

/**
 * The production values the deployed build bakes in: `.env.production`, then `.env` (never `.env.local`, which
 * scripts/dev-env.mjs points at a local backend). LOGIC_LIVE_<KEY> overrides one (e.g. LOGIC_LIVE_VITE_BACKEND_URL).
 * → { VITE_BACKEND_URL, VITE_SOCKET_URL, VITE_DATA_BASE, VITE_QUESTIONS_BASE } (trailing slashes removed, '' when unset)
 */
export function prodEnv(repo = appRepo()) {
  const files = ['.env.production', '.env'].map((f) => parseEnv(read(f, repo)));
  const out = {};
  for (const k of ['VITE_BACKEND_URL', 'VITE_SOCKET_URL', 'VITE_DATA_BASE', 'VITE_QUESTIONS_BASE']) {
    out[k] = (process.env[`LOGIC_LIVE_${k}`] ?? files.find((f) => k in f)?.[k] ?? '').replace(/\/+$/, '');
  }
  return out;
}

/** VITE_BACKEND_URL without its /api suffix (src/configurations/backend.tsx BACKEND_ORIGIN): where /trivia/ lives. */
export const backendOrigin = (apiBase) => String(apiBase).replace(/\/api\/?$/, '');

/** Every public route: landing, each visible game (catalogue order, incl. coming-soon), legal pages, profile, admin. */
export function publicRoutes() {
  return ['/', ...visibleGames().map((g) => g.path), '/privacy', '/terms', '/profile', '/admin'];
}

const CLIENT_ID = /\b(\d{6,}-[a-z0-9]{8,}\.apps\.googleusercontent\.com)\b/;
/** The Google OAuth client id the app ships (GoogleOAuthProvider clientId in src/), or null. */
export function googleClientId(repo = appRepo()) {
  for (const rel of ['src/components/LogInSignUp.tsx', 'src/app/providers.tsx', '.env.production']) {
    const m = CLIENT_ID.exec(read(rel, repo) || '');
    if (m) return m[1];
  }
  return null;
}

/** The pool games the manifest-v3 data host publishes (src/utils/gameData.ts POOL_GAMES); others read /data/<key>.json. */
export function poolGames(repo = appRepo()) {
  const m = /POOL_GAMES\s*=\s*new Set\(\[([^\]]*)\]/.exec(read('src/utils/gameData.ts', repo) || '');
  return new Set(m ? [...m[1].matchAll(/["']([^"']+)["']/g)].map((x) => x[1]) : []);
}
