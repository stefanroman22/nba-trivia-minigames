#!/usr/bin/env node
// The security agent, two modes (docs/security/README.md):
//
//   weekly  full-repo scan (gitleaks over the full history, osv-scanner, Claude review) → state by fingerprint on the
//           branch security-state (new / still open / resolved) → ONE parent Notion ticket for the team pipeline with
//           the new findings (confidence ≥ 8, deduped, grouped by root cause and area, most severe first); none when
//           nothing is new.
//     node scripts/security/run.mjs weekly --run-id <id> [--run-url <url>] [--slot <iso>] [--notion live|backlog|dry]
//          [--state-branch security-state] [--llm on|off] [--model fable] [--force]
//
//   pr      diff-only scan of the checked-out branch against --base. High/critical with confidence ≥ 8 → the commit
//           status `security/pr-scan` fails and (trusted, --fix on) the team pipeline's direct mode fixes the branch
//           (`team-direct` skill), the fix is committed and pushed, the branch is re-scanned; at most --max-rounds
//           auto-fix rounds per PR, then a human. Medium/low → the PR comment + the state (the weekly run tickets them).
//           Never Notion, except a pipeline gate branch (security-gate/*): its blocking findings go to the card the
//           commit names, as a comment, so the pipeline's next attempt has them.
//     node scripts/security/run.mjs pr --base <ref> --branch <name> [--pr <n>] [--trusted] [--fix on|off] [--llm on|off]
//          [--model opus] [--max-rounds 2] [--state-branch security-state] [--status on|off] [--gate-card]
//
// Console output is counts only (public repo, public logs); raw output and findings stay in $RUNNER_TEMP/security.
// Exit 0 = pass / weekly ok, 1 = blocked or a failed run, 2 = usage.
import { spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MIN_CONFIDENCE, applyIgnore, blocking, bySeverity, dedupe, normalise } from './lib/finding.mjs';
import { claude, gitleaks, mergeBase, osv } from './lib/detect.mjs';
import { countText, counts, fixSpec, prComment, weeklyTicket, COMMENT_MARKER } from './lib/report.mjs';
import { STATE_BRANCH, addRun, markTicketed, openStore, readState, reconcile, recordPr, slotDone, writeState } from './lib/state.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const WIN = process.platform === 'win32';
const REPO = process.env.GITHUB_REPOSITORY || 'stefanroman22/nba-trivia-minigames';
const CONTEXT = 'security/pr-scan';

const argv = process.argv.slice(2);
const cmd = argv[0];
const arg = (k, d = null) => { const i = argv.indexOf(k); return i >= 0 && argv[i + 1] !== undefined && !argv[i + 1].startsWith('--') ? argv[i + 1] : d; };
const flag = (k) => argv.includes(k);
const log = (s) => console.log(`security: ${s}`);
const output = (o) => { if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, Object.entries(o).map(([k, v]) => `${k}=${v}`).join('\n') + '\n'); };

const sh = (c, a, opts = {}) => spawnSync(c, a, { cwd: ROOT, encoding: 'utf8', maxBuffer: 256 << 20, windowsHide: true, ...opts });
const git = (a, opts) => {
  const r = sh('git', a, opts);
  if (r.status !== 0) throw new Error(`git ${a[0]} failed: ${String(r.stderr).trim().split('\n').pop()}`);
  return r.stdout.trim();
};
const node = (script, a, opts = {}) => sh(process.execPath, [path.join(ROOT, script), ...a], opts);
const gh = (a, input) => sh('gh', a, { input, shell: WIN });
const tmpDir = () => {
  const base = process.env.RUNNER_TEMP ? path.join(process.env.RUNNER_TEMP, 'security') : path.join(os.tmpdir(), 'security');
  mkdirSync(base, { recursive: true });
  return mkdtempSync(path.join(base, 'run-'));
};
const readIgnore = () => { try { return JSON.parse(readFileSync(path.join(ROOT, '.security', 'ignore.json'), 'utf8')).ignore || []; } catch { return []; } };
const secret = process.env.SECURITY_STATE_KEY || null;

/** All three detectors → { findings (deduped, ignore applied, confidence ≥ 8), dropped, failed: [tool], notes } */
function scan({ mode, base = null, llm, model, tmp }) {
  const runs = { gitleaks: gitleaks({ root: ROOT, mode, base, tmp }), osv: osv({ root: ROOT, mode, base, tmp }) };
  if (llm) runs.claude = claude({ root: ROOT, mode, base, tmp, model, maxTurns: mode === 'weekly' ? 400 : 120, timeoutMin: mode === 'weekly' ? 150 : 40 });
  const failed = Object.entries(runs).filter(([, r]) => !r.ok).map(([k]) => k);
  const all = applyIgnore(dedupe(Object.values(runs).flatMap((r) => r.findings)), readIgnore());
  const findings = all.filter((f) => f.confidence >= MIN_CONFIDENCE).sort(bySeverity);
  for (const [k, r] of Object.entries(runs)) log(`${k}: ${r.ok ? `${r.findings.length} raw finding(s)` : 'FAILED'}${r.note ? ` (${r.note})` : ''}`);
  writeFileSync(path.join(tmp, 'findings.json'), JSON.stringify({ mode, base, findings, dropped: all.length - findings.length }, null, 2));
  return { findings, dropped: all.length - findings.length, failed, notes: Object.fromEntries(Object.entries(runs).map(([k, r]) => [k, r.note || ''])) };
}

/** An open claude finding the model did not re-report: still there while its file holds its sink line. Deterministic
 *  tools (gitleaks, osv) re-find what is there, unless they failed this run. */
const stillPresentFn = (failed) => (entry, details) => {
  if (failed.includes(entry.tool)) return true;
  if (entry.tool !== 'claude') return false;
  if (!details) return true; // no key to read the details: never resolve blind
  const p = path.join(ROOT, details.file || '');
  if (!details.file || !existsSync(p)) return false;
  const want = normalise(details.snippet);
  return !!want && readFileSync(p, 'utf8').split(/\r?\n/).some((l) => normalise(l) === want);
};

function notion(args) {
  const r = node('scripts/notion.mjs', args);
  if (r.status !== 0) throw new Error(`notion ${args[0]} failed: ${String(r.stderr).trim().split('\n').pop()}`);
  return r.stdout.trim();
}

// ---------------------------------------------------------------- weekly

async function weekly() {
  const runId = arg('--run-id') || `local-${Date.now()}`;
  const slot = arg('--slot') || '';
  const notionMode = arg('--notion', 'live');
  const llm = arg('--llm', 'on') === 'on';
  const store = openStore({ branch: arg('--state-branch', STATE_BRANCH) });
  const prev = readState(store);
  if (slot && slotDone(prev, slot) && !flag('--force')) { log(`slot ${slot} already ran ok: nothing to do`); output({ result: 'skipped' }); return 0; }
  if (!secret) log('WARNING: SECURITY_STATE_KEY is not set: the state keeps fingerprints only (no details)');

  const tmp = tmpDir();
  const s = scan({ mode: 'weekly', llm, model: arg('--model', 'fable'), tmp });
  // Tickets that are Done while their finding is still there get re-ticketed (fixed and regressed, or closed by hand).
  const doneTickets = new Set();
  if (notionMode !== 'dry' && process.env.NOTION_TOKEN) {
    for (const t of new Set(Object.values(prev.entries).filter((e) => e.status === 'open' && e.ticket).map((e) => e.ticket))) {
      try { if (JSON.parse(notion(['get-card', t])).status === 'Done') doneTickets.add(t); } catch { /* archived or unreadable: treat as still open */ }
    }
  }
  const now = Date.now();
  const rec = reconcile(prev, s.findings, { now, secret, doneTickets, stillPresent: stillPresentFn(s.failed) });
  log(`kept ${s.findings.length} (confidence ≥ ${MIN_CONFIDENCE}; ${s.dropped} dropped) → new ${rec.fresh.length} · still open ${rec.still.length} · resolved ${rec.resolved.length}`);

  let ticket = null;
  let state = rec.state;
  if (rec.fresh.length) {
    const t = weeklyTicket(rec.fresh, { date: new Date(now).toISOString().slice(0, 10), runUrl: arg('--run-url', ''), runId });
    const bodyFile = path.join(tmp, 'ticket.md');
    const attach = path.join(tmp, 'findings.json');
    writeFileSync(bodyFile, t.body);
    writeFileSync(attach, JSON.stringify({ runId, findings: rec.fresh }, null, 2));
    if (notionMode === 'dry') {
      log(`DRY: would create "${t.title}" (${t.priority}, ${t.category}); body ${bodyFile}`);
    } else {
      ticket = notion(['create-card', t.title, '--priority', t.priority, '--category', t.category, '--source', t.source, '--target', 'dev', '--body-file', bodyFile, '--attach', attach]).split('\n').pop();
      if (notionMode === 'backlog') notion(['set-status', ticket, 'Backlog']);
      log(`ticket ${ticket} (${countText(counts(rec.fresh))})${notionMode === 'backlog' ? ' in Backlog (test run)' : ''}`);
      state = markTicketed(state, rec.fresh.map((f) => f.fingerprint), ticket, now);
    }
  } else log('nothing new: no ticket');

  const status = s.failed.length ? 'partial' : 'ok';
  const run = { id: runId, mode: 'weekly', at: new Date(now).toISOString(), slot: slot || null, status, failed: s.failed, new: rec.fresh.length, open: rec.still.length + rec.fresh.length, resolved: rec.resolved.length, ticket };
  if (notionMode !== 'dry') {
    // re-apply on top of whatever a PR run wrote meanwhile: our entries win for the fingerprints this run touched
    const touched = new Set([...s.findings.map((f) => f.fingerprint), ...rec.resolved, ...rec.fresh.map((f) => f.fingerprint)]);
    writeState(store, (cur) => {
      const entries = { ...cur.entries };
      for (const fp of touched) if (state.entries[fp]) entries[fp] = state.entries[fp];
      return addRun({ ...cur, entries }, run);
    }, `security-state: weekly ${runId} (${rec.fresh.length} new, ${rec.resolved.length} resolved)`);
  }
  output({ result: status, ticket: ticket || '', new: rec.fresh.length });
  if (s.failed.length) { log(`detector(s) failed: ${s.failed.join(', ')}: run marked partial (a backup trigger retries)`); return 1; }
  return 0;
}

// ---------------------------------------------------------------- pr

function setStatus(sha, state, description) {
  if (arg('--status', 'on') !== 'on') return;
  const r = gh(['api', '-X', 'POST', `repos/${REPO}/statuses/${sha}`, '-f', `state=${state}`, '-f', `context=${CONTEXT}`, '-f', `description=${description.slice(0, 140)}`,
    ...(process.env.RUN_URL ? ['-f', `target_url=${process.env.RUN_URL}`] : [])]);
  if (r.status !== 0) log(`could not set the commit status (${String(r.stderr).trim().split('\n').pop()})`);
}

function upsertComment(pr, body) {
  if (!pr) return;
  const list = gh(['api', `repos/${REPO}/issues/${pr}/comments`, '--paginate', '--jq', `.[] | select(.body | startswith("${COMMENT_MARKER}")) | .id`]);
  const id = String(list.stdout || '').trim().split('\n').filter(Boolean).pop();
  const r = id
    ? gh(['api', '-X', 'PATCH', `repos/${REPO}/issues/comments/${id}`, '-F', 'body=@-'], body)
    : gh(['api', '-X', 'POST', `repos/${REPO}/issues/${pr}/comments`, '-F', 'body=@-'], body);
  if (r.status !== 0) log(`could not write the PR comment (${String(r.stderr).trim().split('\n').pop()})`);
}

const priorRounds = (mb) => git(['log', '--format=%s', `${mb}..HEAD`]).split('\n').filter((s) => /^security: auto-fix round \d+/.test(s)).length;

/** Prepare node_modules and the backend venv once, for verify.mjs (Linux runner). */
let depsReady = false;
function ensureDeps() {
  if (depsReady || WIN) return;
  if (!existsSync(path.join(ROOT, 'node_modules'))) sh('npm', ['ci', '--no-audit', '--no-fund'], { stdio: 'ignore' });
  if (!existsSync(path.join(ROOT, 'backend', '.venv'))) {
    sh('python3', ['-m', 'venv', 'backend/.venv'], { stdio: 'ignore' });
    sh(path.join(ROOT, 'backend/.venv/bin/pip'), ['install', '-q', '-r', 'backend/requirements.txt'], { stdio: 'ignore' });
  }
  depsReady = true;
}

/** One auto-fix round through the team pipeline's direct mode → { changed, result } */
function autofix({ findings, branch, pr, round, mb, tmp }) {
  ensureDeps();
  const slug = `sec-${pr ? `pr${pr}` : 'gate'}-r${round}`;
  const specFile = path.join(tmp, `${slug}.md`);
  writeFileSync(specFile, fixSpec(findings, { branch, pr, round }));
  const files = [...new Set(findings.map((f) => f.file).filter(Boolean))].join(',');
  const prep = node('scripts/team/direct.mjs', [slug, '--spec-file', specFile, '--title', `Security auto-fix${pr ? ` PR #${pr}` : ''} round ${round}`, '--base', mb, '--branch', branch, '--repo', ROOT, '--files', files]);
  if (prep.status !== 0) return { changed: false, result: `DIRECT-FAIL prepare failed: ${String(prep.stderr).trim().split('\n').pop()}` };
  // the fix agents never see a GitHub/Notion/state credential: the caller pushes
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(GH_TOKEN|GITHUB_TOKEN|NOTION_TOKEN|SLACK_BOT_TOKEN|SECURITY_STATE_TOKEN|SECURITY_STATE_KEY|PUSH_TOKEN)$/.test(k)));
  const r = sh('claude', ['--dangerously-skip-permissions', '--model', 'sonnet', '-p'], { input: `/team-direct ${slug}`, env, shell: WIN, timeout: 50 * 60_000 });
  writeFileSync(path.join(tmp, `${slug}.log`), `${r.stdout || ''}\n${r.stderr || ''}`);
  const result = String(r.stdout || '').trim().split('\n').reverse().find((l) => /^DIRECT-(DONE|FAIL)/.test(l.trim())) || `DIRECT-FAIL no result line (exit ${r.status ?? r.error?.code})`;
  const changed = git(['status', '--porcelain', '--', '.', ':!.team']).length > 0;
  return { changed, result: result.trim() };
}

function commitAndPush({ branch, round, findings }) {
  const who = ['-c', 'user.name=github-actions[bot]', '-c', 'user.email=41898282+github-actions[bot]@users.noreply.github.com'];
  git(['add', '-A', '--', '.', ':!.team']);
  const msg = `security: auto-fix round ${round} (${findings.length} finding(s))\n\nFingerprints: ${findings.map((f) => f.fingerprint).join(', ')}\nBy the team pipeline's direct mode (team-direct), from the security gate.`;
  git([...who, 'commit', '-q', '-F', '-'], { input: msg });
  const token = process.env.PUSH_TOKEN;
  const env = { ...process.env, GIT_TERMINAL_PROMPT: '0', ...(token ? { GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'http.https://github.com/.extraheader', GIT_CONFIG_VALUE_0: `AUTHORIZATION: basic ${Buffer.from(`x-access-token:${token}`).toString('base64')}` } : {}) };
  const r = sh('git', ['push', 'origin', `HEAD:refs/heads/${branch}`], { env });
  if (r.status !== 0) throw new Error(`push to ${branch} rejected (the branch moved? a new push re-runs the scan): ${String(r.stderr).trim().split('\n').pop()}`);
  return git(['rev-parse', 'HEAD']);
}

/** The Notion card a pipeline commit names (`Notion: <url>` in the ship skill's commit body) → page id or null. */
function cardOfHead() {
  const body = git(['log', '-1', '--format=%B']);
  const m = /Notion:\s*\S*?([0-9a-f]{32}|[0-9a-f-]{36})\b/i.exec(body);
  return m ? m[1] : null;
}

async function prMode() {
  const base = arg('--base');
  const branch = arg('--branch');
  if (!base || !branch) { console.error('pr: --base <ref> --branch <name> required'); return 2; }
  const pr = arg('--pr');
  const trusted = flag('--trusted');
  const fix = arg('--fix', 'on') === 'on' && trusted;
  const llm = arg('--llm', 'on') === 'on';
  const maxRounds = Number(arg('--max-rounds', '2'));
  const tmp = tmpDir();
  const mb = mergeBase(ROOT, base);
  let sha = git(['rev-parse', 'HEAD']);
  let rounds = priorRounds(mb);
  const startRounds = rounds;
  setStatus(sha, 'pending', 'security scan running');

  let s, block = [], other = [], firstBlock = null, lastFix = null;
  for (;;) {
    s = scan({ mode: 'pr', base, llm, model: arg('--model', 'opus'), tmp });
    block = s.findings.filter(blocking);
    other = s.findings.filter((f) => !blocking(f));
    firstBlock ??= block;
    log(`diff findings (confidence ≥ ${MIN_CONFIDENCE}): ${block.length} blocking, ${other.length} not blocking`);
    if (s.failed.length || !block.length) break;
    if (!fix || rounds >= maxRounds) break;
    rounds++;
    setStatus(sha, 'pending', `auto-fix round ${rounds}/${maxRounds}: ${block.length} high/critical finding(s)`);
    lastFix = autofix({ findings: block, branch, pr, round: rounds, mb, tmp });
    log(`auto-fix round ${rounds}: ${lastFix.result.split(' ')[0]}${lastFix.changed ? ', changes made' : ', no change'}`);
    if (!lastFix.changed) break;
    sha = commitAndPush({ branch, round: rounds, findings: block });
    log(`pushed ${sha.slice(0, 7)} to ${branch}; re-scanning`);
    setStatus(sha, 'pending', `re-scan after auto-fix round ${rounds}`);
  }

  const result = s.failed.length ? 'error' : block.length ? 'fail' : 'pass';
  const desc = result === 'error' ? `scan incomplete (${s.failed.join(', ')} failed): re-run the job`
    : result === 'fail' ? `${block.length} high/critical finding(s)${fix ? ` after ${rounds - startRounds} auto-fix round(s): needs a human` : ': needs a human'}`
    : `no high/critical findings${rounds > startRounds ? ` (fixed in ${rounds - startRounds} round(s))` : ''}`;
  setStatus(sha, result === 'pass' ? 'success' : result === 'error' ? 'error' : 'failure', desc);
  const fixedNow = result === 'pass' && rounds > startRounds;
  upsertComment(pr, prComment({
    blockingFindings: result === 'fail' ? block : fixedNow ? firstBlock : [], otherFindings: other, result: result === 'pass' ? 'pass' : 'fail', rounds: rounds - startRounds, maxRounds, autofix: fix,
    note: result === 'error' ? `The scan did not complete (${s.failed.join(', ')}), so the check stays red. Re-run the workflow.` : '',
  }));

  // medium/low → state, so the weekly ticket carries them (needs the store token; a fork PR has none)
  if (other.length && process.env.SECURITY_STATE_TOKEN) {
    try {
      writeState(openStore({ branch: arg('--state-branch', STATE_BRANCH) }), (cur) => addRun(recordPr(cur, other, { secret, pr }), { id: `pr-${pr || branch}-${sha.slice(0, 7)}`, mode: 'pr', at: new Date().toISOString(), status: result, pr, new: other.length }), `security-state: PR ${pr || branch} (${other.length} medium/low)`);
    } catch (e) { log(`state not written: ${e.message}`); }
  }
  // a pipeline gate branch: blocking findings go to its Notion card (private), so the next attempt can fix them
  if (flag('--gate-card') && result === 'fail' && process.env.NOTION_TOKEN) {
    const card = cardOfHead();
    if (card) {
      try { notion(['comment', card, `🔒 security gate blocked the push to main (${block.length} high/critical). Fix these first:\n\n${fixSpec(block, { branch, round: 0 })}`.slice(0, 1900)]); log(`findings commented on card ${card}`); } catch (e) { log(`card comment failed: ${e.message}`); }
    } else log('gate branch: no Notion card named in the head commit');
  }
  output({ result, sha, blocking: block.length, rounds: rounds - startRounds });
  log(`result ${result}: ${desc}`);
  return result === 'pass' ? 0 : 1;
}

const code = cmd === 'weekly' ? await weekly() : cmd === 'pr' ? await prMode() : (console.error('usage: run.mjs weekly … | pr …'), 2);
process.exit(code);
