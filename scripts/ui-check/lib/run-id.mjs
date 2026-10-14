// One id per run, shared by the runner, every worker and the reporter through UI_CHECK_RUN
// (workers inherit the env the config set). Output lives under uicHome() (lib/home.mjs).
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { uicHome } from './home.mjs';

export const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url));
export const UIC_ROOT = uicHome();

const pad = (n) => String(n).padStart(2, '0');

export function runId() {
  if (!process.env.UI_CHECK_RUN) {
    const d = new Date();
    process.env.UI_CHECK_RUN = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
  }
  const id = process.env.UI_CHECK_RUN;
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

export function runDir() {
  return path.join(UIC_ROOT, 'runs', runId());
}
