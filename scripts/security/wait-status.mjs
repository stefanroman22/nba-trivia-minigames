#!/usr/bin/env node
// Wait for the security gate's commit status (`security/pr-scan`) on a commit → prints `<state> <description>` and exits
// 0 on success, 1 on failure/error, 3 on timeout. Used by the ship skill before a Target = main push (the ruleset on main
// requires that status on the pushed commit). Auth: GH_TOKEN, else `gh auth token`, else unauthenticated (the repo is
// public; 60 requests/h, so it polls once a minute and waits out a rate-limit reset instead of counting it as "pending").
// A PR-mode scan takes up to ~45 min (tool install + the Claude review), hence the 60-min default.
//   node scripts/security/wait-status.mjs <sha> [--timeout-min 60] [--every-sec 60]
import { spawnSync } from 'node:child_process';

const argv = process.argv.slice(2);
const sha = argv[0];
const arg = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
if (!sha || sha.startsWith('--')) { console.error('usage: wait-status.mjs <sha> [--timeout-min 60] [--every-sec 60]'); process.exit(2); }
const repo = process.env.GITHUB_REPOSITORY || 'stefanroman22/nba-trivia-minigames';
const until = Date.now() + Number(arg('--timeout-min', '60')) * 60_000;
const every = Number(arg('--every-sec', '60')) * 1000;
const token = process.env.GH_TOKEN || (() => {
  const r = spawnSync('gh', ['auth', 'token'], { encoding: 'utf8', shell: process.platform === 'win32', windowsHide: true });
  return r.status === 0 ? String(r.stdout).trim() : '';
})();
const headers = { Accept: 'application/vnd.github+json', 'User-Agent': 'nba-security-gate', ...(token ? { Authorization: `Bearer ${token}` } : {}) };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

for (;;) {
  let latest = null, wait = every;
  try {
    const r = await fetch(`https://api.github.com/repos/${repo}/commits/${sha}/statuses?per_page=100`, { headers });
    if (r.ok) latest = (await r.json()).find((s) => s.context === 'security/pr-scan') || null; // newest first
    else if ((r.status === 403 || r.status === 429) && r.headers.get('x-ratelimit-remaining') === '0') {
      const reset = Number(r.headers.get('x-ratelimit-reset')) * 1000;
      if (reset > Date.now()) wait = Math.min(reset - Date.now() + 1000, Math.max(0, until - Date.now()));
      console.error(`wait-status: rate limited, waiting ${Math.round(wait / 1000)} s`);
    }
  } catch { /* network blip: retry */ }
  if (latest && latest.state !== 'pending') {
    console.log(`${latest.state} ${latest.description || ''}`.trim());
    process.exit(latest.state === 'success' ? 0 : 1);
  }
  if (Date.now() > until) { console.log(`timeout ${latest ? latest.description || 'pending' : 'no security/pr-scan status yet'}`); process.exit(3); }
  await sleep(wait);
}
