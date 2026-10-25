#!/usr/bin/env node
// Wait for the security gate's commit status (`security/pr-scan`) on a commit → prints `<state> <description>` and exits
// 0 on success, 1 on failure/error, 3 on timeout. Used by the ship skill before a Target = main push (the ruleset on main
// requires that status on the pushed commit). Works without gh: the repo is public, so the statuses API answers
// unauthenticated (GH_TOKEN, when set, only raises the rate limit).
//   node scripts/security/wait-status.mjs <sha> [--timeout-min 30] [--every-sec 20]
const argv = process.argv.slice(2);
const sha = argv[0];
const arg = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
if (!sha || sha.startsWith('--')) { console.error('usage: wait-status.mjs <sha> [--timeout-min 30] [--every-sec 20]'); process.exit(2); }
const repo = process.env.GITHUB_REPOSITORY || 'stefanroman22/nba-trivia-minigames';
const until = Date.now() + Number(arg('--timeout-min', '30')) * 60_000;
const every = Number(arg('--every-sec', '20')) * 1000;
const headers = { Accept: 'application/vnd.github+json', 'User-Agent': 'nba-security-gate', ...(process.env.GH_TOKEN ? { Authorization: `Bearer ${process.env.GH_TOKEN}` } : {}) };

for (;;) {
  let latest = null;
  try {
    const r = await fetch(`https://api.github.com/repos/${repo}/commits/${sha}/statuses?per_page=100`, { headers });
    if (r.ok) latest = (await r.json()).find((s) => s.context === 'security/pr-scan') || null; // newest first
  } catch { /* network blip: retry */ }
  if (latest && latest.state !== 'pending') {
    console.log(`${latest.state} ${latest.description || ''}`.trim());
    process.exit(latest.state === 'success' ? 0 : 1);
  }
  if (Date.now() > until) { console.log(`timeout ${latest ? latest.description || 'pending' : 'no security/pr-scan status yet'}`); process.exit(3); }
  await new Promise((r) => setTimeout(r, every));
}
