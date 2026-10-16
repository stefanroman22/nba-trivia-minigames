#!/usr/bin/env node
// The owner advisories of scripts/logic-check/notes/logic.md ("Owner advisories") as Logic findings, filed once.
// They are no failing LC check (spec ruling: not a permanently red check), so the triage agent adds them to a run's
// findings/logic.json with this script; each has a fixed fingerprint (rule `advisory`, its route, its selector) and an
// API acceptance that FAILS on today's code, so report.mjs --validate keeps it and notion-push makes one card. Once
// <home>/notion-cards.json holds the fingerprint (any decision), it is never filed again; notion-push's Source dedupe
// covers the rest (an open card is commented, a card closed by hand is skipped).
//   node scripts/logic-check/lib/advisories.mjs --run <id>-logic [--home <dir>] [--dry-run]
// Appends the advisories not carded yet to <runDir>/findings/logic.json (creating it) and prints one line.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { uicHome } from '../../check-core/lib/home.mjs';
import { fingerprint } from '../../check-core/lib/findings.mjs';

// 11 sign-up POSTs from one machine, each with its own X-Forwarded-For: the signup throttle (10/hour) never answers
// 429 because DRF keys a guest on the whole client-supplied header while NUM_PROXIES is unset.
const xffPosts = Array.from({ length: 11 }, (_, i) => ({
  api: { persona: 'guest', method: 'POST', path: '/api/signup/', body: {}, headers: { 'X-Forwarded-For': `198.51.100.${i + 1}` } },
  expect: { status: i < 10 ? 400 : 429 },
}));

export const ADVISORIES = [
  {
    checker: 'logic',
    rule: 'advisory',
    title: 'Guest rate limits key on the client-supplied X-Forwarded-For (NUM_PROXIES unset): owner decision',
    severity: 'minor',
    category: 'security',
    owner: 'ci',
    suite: 'signup',
    persona: 'guest',
    where: { route: '/api/signup/', viewports: ['api'], selector: 'x-forwarded-for' },
    current: 'DRF throttles (login 30/h, signup 10/h, refresh 60/h) and the sign-up strike IP lock key a guest on the X-Forwarded-For header as sent; NUM_PROXIES is unset, so a new header value is a new bucket: 11 sign-up POSTs with 11 header values all reach the view (no 429).',
    expected: 'A guest is keyed on the address the host\'s proxy saw: the 11th sign-up POST from one machine within the hour is throttled (429), whatever X-Forwarded-For it sends.',
    evidence: { checkId: null, metrics: ['11 POST /api/signup/ with distinct X-Forwarded-For → 11 × 400, 0 × 429'], shots: [] },
    files: [
      { path: 'backend/backend/settings.py', line: 160, why: 'REST_FRAMEWORK: no NUM_PROXIES, so DRF uses the whole X-Forwarded-For header as the guest ident' },
      { path: 'backend/backend/throttles.py', why: 'the UserRateThrottle subclasses (auth-login, auth-signup, auth-refresh, …) that key guests by that ident' },
      { path: 'scripts/logic-check/notes/logic.md', why: '"Owner advisories": safe only behind a proxy that overwrites the header' },
    ],
    fix: {
      change: [
        'Owner decision first: Django runs behind the host\'s proxy; set REST_FRAMEWORK NUM_PROXIES from an env var (0 locally = REMOTE_ADDR, the host\'s proxy count in production) so DRF takes the hop the proxy appended.',
        'This ends the per-request X-Forwarded-For technique Logic Check\'s auth and signup suites use to stay off the real 10/h sign-up and 30/h login buckets (scripts/logic-check/lib/auth.mjs clientIp, notes/logic.md): plan their budget in the same change.',
      ],
      rules: ['AUTH-9', 'BE-19'],
    },
    acceptance: {
      criteria: ['From one machine, the 11th sign-up POST within the hour answers 429 even though each POST sends a different X-Forwarded-For (the first 10 answer 400 "All fields are required.").'],
      assertions: xffPosts,
    },
  },
  {
    checker: 'logic',
    rule: 'advisory',
    title: 'log-session credits every POST and an unknown game up to 1000 points: owner decision',
    severity: 'minor',
    category: 'data',
    owner: 'backend',
    suite: 'game-data',
    persona: 'logic.actor',
    where: { route: '/trivia/log-session/', viewports: ['api'], selector: 'log-session-replay' },
    current: 'POST /trivia/log-session/ has no play id: the same finished play can be replayed up to 60/h (score-submit), and a game id that is no game falls back to MAX_SESSION_POINTS = 1000, so one account can add up to 60 000 points an hour.',
    expected: 'A game id that is not a visible game is credited nothing (or refused), and a replayed play is credited once.',
    evidence: { checkId: 'LC-GAMEDATA-02', metrics: ['POST log-session { game: "lc-no-such-game", score: 1000000 } → awarded 1000'], shots: [] },
    files: [
      { path: 'backend/trivia/views.py', line: 312, why: 'log_session: credits every POST; the cap falls back to MAX_SESSION_POINTS for any game string' },
      { path: 'backend/trivia/views.py', line: 269, why: 'MAX_SESSION_POINTS = 1000 and PER_GAME_MAX_POINTS' },
      { path: 'src/views/Trivia/MiniGame.tsx', line: 80, why: 'awardedRef: the client sends one log-session per play (the only replay guard today)' },
    ],
    fix: {
      change: [
        'Owner decision first: refuse (400) or credit 0 for a `game` that is not a visible game id, and decide whether a play gets a one-time id the server checks.',
        'Keep LC-GAMEDATA-02 green: a known game\'s single play is still credited exactly its capped score.',
      ],
      rules: ['AUTH-6'],
    },
    acceptance: {
      criteria: ['A log-session POST for a game id that is no game is credited at most 0 points (awarded 0, or a 400 refusal: then this criterion is rewritten to the 400).'],
      assertions: [{
        api: { persona: 'logic.actor', method: 'POST', path: '/trivia/log-session/', body: { game: 'lc-no-such-game', mode: 'single', score: 1000000, duration_ms: 60000 } },
        expect: { status: 200, json: [['awarded', '==', 0]] },
      }],
    },
  },
];

/** The advisories whose fingerprint has no entry in the cards ledger yet. Pure. */
export function pendingAdvisories(ledger = {}, list = ADVISORIES) {
  return list.filter((a) => !ledger[fingerprint(a)]);
}

/** Append `adds` to a judge file's content (an array or { findings }) → the new content. Pure. */
export function appendFindings(current, adds) {
  if (current && !Array.isArray(current) && Array.isArray(current.findings)) return { ...current, findings: [...current.findings, ...adds] };
  return [...(Array.isArray(current) ? current : []), ...adds];
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const a = process.argv.slice(2);
  const arg = (n) => { const i = a.indexOf(n); return i >= 0 ? a[i + 1] : undefined; };
  const run = arg('--run');
  if (!run) { console.error('usage: node scripts/logic-check/lib/advisories.mjs --run <id>-logic [--home <dir>] [--dry-run]'); process.exit(2); }
  const home = arg('--home') ? path.resolve(arg('--home')) : uicHome();
  const read = (f, d) => { try { return JSON.parse(readFileSync(f, 'utf8').replace(/^﻿/, '')); } catch { return d; } };
  const pending = pendingAdvisories(read(path.join(home, 'notion-cards.json'), {}));
  const file = path.join(home, 'runs', run, 'findings', 'logic.json');
  const current = read(file, []);
  const have = new Set((Array.isArray(current) ? current : current.findings || []).map((f) => fingerprint(f)));
  const adds = pending.filter((f) => !have.has(fingerprint(f)));
  if (adds.length && !a.includes('--dry-run')) {
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify(appendFindings(current, adds), null, 2) + '\n');
  }
  console.log(`advisories: ${adds.length} filed${adds.length ? ` (${adds.map((f) => f.where.selector).join(', ')})` : ''} · ${ADVISORIES.length - pending.length} already carded${a.includes('--dry-run') ? ' (dry run)' : ''} → ${file}`);
}
