#!/usr/bin/env node
// Deploy the Railway relay (multiplayer_server/) for one commit on main: .github/workflows/relay-deploy.yml runs it on
// every push to main that changes multiplayer_server/ — a shipped pipeline card, a promotion, a hotfix — so no relay
// change waits for a hand-run `railway up`. Order (the relay rule: frontend first, relay second, one window):
//   1. the production frontend of the commit is live (GitHub commit status "Vercel – nba-minigames" = success);
//   2. live rooms drain: wait up to --idle-wait-min (default 10) while /health reports rooms > 0, then deploy anyway;
//   3. `railway up --ci --service <id>` from multiplayer_server/ (RAILWAY_TOKEN = a project token of the production
//      environment; the service is RAILWAY_SERVICE, else the project's only service, found through Railway's API);
//   4. /health answers from a NEW instance (uptime shorter than the time since the deploy started);
//   5. report: a comment on every card whose Commit is in the push (scripts/notion.mjs find-by-commit) and one line in
//      #pipeline. Without RAILWAY_TOKEN it reports that and exits 1.
//   node scripts/team/relay-deploy.mjs --sha <sha> [--before <sha>] [--run-url <url>] [--idle-wait-min 10] [--dry-run]
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const RELAY_URL = process.env.RELAY_URL || 'https://nba-multiplayer-production.up.railway.app';
export const FRONTEND_CONTEXT = /^Vercel\s+[–-]\s+nba-minigames$/;
const RAILWAY_CLI = '@railway/cli@5.64.1';
const GQL = 'https://backboard.railway.com/graphql/v2';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** The production frontend's state for a commit from its GitHub statuses (newest first): success | failure | pending | null. */
export function frontendState(statuses) {
  const s = (statuses || []).find((x) => FRONTEND_CONTEXT.test(String(x.context || '')));
  if (!s) return null;
  return s.state === 'success' ? 'success' : ['failure', 'error'].includes(s.state) ? 'failure' : 'pending';
}

/** /health of a relay instance started after `since` (ms epoch, at `now`)? */
export const isNewInstance = (health, since, now = Date.now()) =>
  !!health && health.ok === true && Number.isFinite(health.uptimeS) && health.uptimeS * 1000 < now - since;

/** The one-line report of a deploy (Notion comment and Slack). */
export function reportLine(r) {
  const at = `${String(r.sha).slice(0, 7)}${r.runUrl ? ` · ${r.runUrl}` : ''}`;
  if (r.ok) return `🚀 relay deployed (${at}): new instance up${r.uptimeS != null ? `, uptime ${r.uptimeS}s` : ''}${r.liveRooms ? ` · deployed with ${r.liveRooms} live room(s) after the idle wait` : ''}`;
  return `❌ relay NOT deployed (${at}): ${r.error}`;
}

async function health() {
  try {
    const res = await fetch(`${RELAY_URL}/health`, { signal: AbortSignal.timeout(15_000), headers: { 'cache-control': 'no-cache' } });
    return res.ok ? await res.json() : null;
  } catch { return null; }
}

async function statuses(sha) {
  const repo = process.env.GITHUB_REPOSITORY;
  const res = await fetch(`https://api.github.com/repos/${repo}/commits/${sha}/statuses?per_page=100`, {
    headers: { authorization: `Bearer ${process.env.GH_TOKEN}`, accept: 'application/vnd.github+json' }, signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`GitHub statuses ${res.status}`);
  return res.json();
}

async function waitFrontend(sha, log, { timeoutMin = 25 } = {}) {
  const end = Date.now() + timeoutMin * 60_000;
  while (Date.now() < end) {
    const st = frontendState(await statuses(sha).catch(() => []));
    if (st === 'success') { log(`frontend: production deploy of ${sha.slice(0, 7)} is live`); return; }
    if (st === 'failure') throw new Error(`the production frontend of ${sha.slice(0, 7)} failed to deploy: the relay stays on the previous version (frontend first)`);
    log(`frontend: ${st || 'no Vercel status yet'}, waiting`);
    await sleep(30_000);
  }
  throw new Error(`the production frontend of ${sha.slice(0, 7)} was not live after ${timeoutMin} min`);
}

async function gql(query, variables = {}) {
  const res = await fetch(GQL, {
    method: 'POST', signal: AbortSignal.timeout(20_000),
    headers: { 'content-type': 'application/json', 'project-access-token': process.env.RAILWAY_TOKEN },
    body: JSON.stringify({ query, variables }),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok || j.errors) throw new Error(`Railway API: ${res.status} ${JSON.stringify(j.errors || j).slice(0, 200)}`);
  return j.data;
}

async function serviceId(log) {
  if (process.env.RAILWAY_SERVICE) return process.env.RAILWAY_SERVICE;
  const { projectToken } = await gql('query { projectToken { projectId environmentId } }');
  const { project } = await gql('query($id: String!) { project(id: $id) { services { edges { node { id name } } } } }', { id: projectToken.projectId });
  const services = project.services.edges.map((e) => e.node);
  if (services.length !== 1) throw new Error(`the project has ${services.length} services (${services.map((s) => s.name).join(', ')}): set the repo variable RAILWAY_SERVICE`);
  log(`railway: service ${services[0].name} (${services[0].id})`);
  return services[0].id;
}

function notion(...a) {
  const r = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'notion.mjs'), ...a], { cwd: ROOT, encoding: 'utf8' });
  if (r.status !== 0) throw new Error((r.stderr || r.stdout || '').trim().split('\n').pop());
  return r.stdout.trim();
}

function report(r, { before, dryRun, log }) {
  const line = reportLine(r);
  log(line);
  if (dryRun) return;
  const range = before && !/^0+$/.test(before) ? `${before}..${r.sha}` : `${r.sha}~1..${r.sha}`;
  const shas = spawnSync('git', ['rev-list', '--max-count=50', range], { cwd: ROOT, encoding: 'utf8' }).stdout.split(/\s+/).filter(Boolean);
  if (process.env.NOTION_TOKEN) {
    try {
      for (const c of JSON.parse(notion('find-by-commit', ...(shas.length ? shas : [r.sha])) || '[]')) { notion('comment', c.id, line); log(`commented on card ${c.id}`); }
    } catch (e) { log(`notion report failed: ${e.message}`); }
  }
  if (process.env.SLACK_BOT_TOKEN) {
    const s = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'slack.mjs'), 'post-text', 'general', '-'], { cwd: ROOT, input: line, encoding: 'utf8' });
    if (s.status !== 0) log(`slack report failed: ${(s.stderr || '').trim().split('\n').pop()}`);
  }
}

async function main(argv) {
  const o = { idleWaitMin: 10, dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--sha') o.sha = argv[++i];
    else if (a === '--before') o.before = argv[++i];
    else if (a === '--run-url') o.runUrl = argv[++i];
    else if (a === '--idle-wait-min') o.idleWaitMin = Number(argv[++i]);
    else if (a === '--dry-run') o.dryRun = true;
    else { console.error(`relay-deploy: unknown argument ${a}`); return 2; }
  }
  if (!/^[0-9a-f]{7,40}$/i.test(o.sha || '')) { console.error('relay-deploy: --sha <commit> required'); return 2; }
  const log = (m) => console.log(`relay-deploy: ${m}`);
  const r = { sha: o.sha, runUrl: o.runUrl, ok: false };
  try {
    if (!process.env.RAILWAY_TOKEN) throw new Error('the RAILWAY_TOKEN secret is not set (a Railway project token of the production environment): docs/CREDENTIALS.md');
    await waitFrontend(o.sha, log);
    const idleEnd = Date.now() + o.idleWaitMin * 60_000;
    let h = await health();
    while (h && h.rooms > 0 && Date.now() < idleEnd) { log(`relay: ${h.rooms} live room(s), waiting for them to finish`); await sleep(30_000); h = await health(); }
    r.liveRooms = h && h.rooms > 0 ? h.rooms : 0;
    const service = await serviceId(log);
    if (o.dryRun) { log(`dry run: would run npx ${RAILWAY_CLI} up --ci --service ${service} in multiplayer_server/`); r.ok = true; return 0; }
    const since = Date.now();
    const up = spawnSync('npx', ['-y', RAILWAY_CLI, 'up', '--ci', '--service', service], { cwd: path.join(ROOT, 'multiplayer_server'), stdio: 'inherit', env: process.env, shell: process.platform === 'win32' });
    if (up.status !== 0) throw new Error(`railway up exited ${up.status} (build or deploy failed: the previous version keeps serving)`);
    const end = Date.now() + 10 * 60_000;
    while (Date.now() < end) {
      const now = await health();
      if (isNewInstance(now, since)) { r.ok = true; r.uptimeS = now.uptimeS; break; }
      await sleep(15_000);
    }
    if (!r.ok) throw new Error('railway up finished but /health still answers from the old instance after 10 min');
    return 0;
  } catch (e) {
    r.error = String(e.message || e);
    return 1;
  } finally {
    report(r, { before: o.before, dryRun: o.dryRun, log });
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then((code) => { process.exitCode = code; });
}
