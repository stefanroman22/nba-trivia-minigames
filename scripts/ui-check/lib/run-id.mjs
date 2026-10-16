// One id per run, shared by the runner, every worker and the reporter through UI_CHECK_RUN
// (workers inherit the env the config set). Output lives under uicHome() (lib/home.mjs).
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { uicHome } from './home.mjs';

export const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url));
export const UIC_ROOT = uicHome();

const pad = (n) => String(n).padStart(2, '0');
const minuteId = (d, suffix) => `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${suffix}`;
/** A real run's id (what retain.mjs counts as a run): YYYYMMDD-HHmm, optionally `x` or `-<word>` (-live, -logic). */
export const isRunId = (id) => /^\d{8}-\d{4}(x|-[a-z]+)?$/.test(String(id));

/** The run id (UI_CHECK_RUN, else YYYYMMDD-HHmm + `suffix`, e.g. '-live' for run.mjs --live, fixed for the process).
 *  Only a real UI check run id moves the `latest` pointer: never a Logic Check run (UI_CHECK_CHECKER=logic), a selftest
 *  or a verify/probe scratch run (`<run>/verify/pw-…`, `../adhoc/…`, `../selftest/…`). */
export function runId(suffix = '') {
  if (!process.env.UI_CHECK_RUN) process.env.UI_CHECK_RUN = minuteId(new Date(), suffix);
  const id = process.env.UI_CHECK_RUN;
  if (process.env.UI_CHECK_CHECKER === 'logic' || !isRunId(id)) return id;
  const latest = path.join(UIC_ROOT, 'latest');
  try {
    let current = null;
    try { current = readFileSync(latest, 'utf8').trim(); } catch { /* first run */ }
    if (current !== id) {
      mkdirSync(UIC_ROOT, { recursive: true });
      writeFileSync(latest, id);
    }
  } catch { /* never fail a run over the pointer file */ }
  return id;
}

/**
 * The id of a new run.mjs run: UI_CHECK_RUN when the caller set it (returned as is — the caller owns it), else the
 * first minute id from now on (YYYYMMDD-HHmm + suffix, at most 30 minutes ahead) whose run dir holds no results.json,
 * so two runs started in the same minute (a catch-up then the full run, a selftest) never refuse each other.
 * → { id, preset } and UI_CHECK_RUN set.
 */
export function freshRunId(suffix = '', { now = new Date(), root = UIC_ROOT } = {}) {
  if (process.env.UI_CHECK_RUN) return { id: process.env.UI_CHECK_RUN, preset: true };
  let id = minuteId(now, suffix);
  for (let k = 1; k <= 30 && existsSync(path.join(root, 'runs', id, 'results.json')); k++) id = minuteId(new Date(now.getTime() + k * 60_000), suffix);
  process.env.UI_CHECK_RUN = id;
  return { id: runId(suffix), preset: false };
}

/**
 * A Playwright invocation of only the `selftest` project (npm run ui:selftest / logic:selftest) writes under
 * <home>/selftest/<stamp>/ (UI_CHECK_RUN `../selftest/<stamp>`), never a run dir: no `latest` move, no clash with a
 * real run's minute id. Called by both configs before runId(). → true when isolated.
 */
export function isolateSelftest(argv = process.argv) {
  if (process.env.UI_CHECK_RUN) return false;
  const projects = [];
  argv.forEach((a, i) => {
    if (a === '--project' && argv[i + 1]) projects.push(argv[i + 1]);
    else if (a.startsWith('--project=')) projects.push(a.slice('--project='.length));
  });
  if (!projects.length || !projects.every((p) => p === 'selftest')) return false;
  const d = new Date();
  process.env.UI_CHECK_RUN = `../selftest/${minuteId(d, '')}${pad(d.getSeconds())}`;
  return true;
}

export function runDir() {
  return path.join(UIC_ROOT, 'runs', runId());
}
