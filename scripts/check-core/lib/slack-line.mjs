// One Slack line from the checkers (spec §7 token rules: one line per run / per resolution / per live failure), through
// scripts/slack.mjs post-text (SLACK_BOT_TOKEN from .env.team or the env; channel key "general" = #pipeline).
// Never throws and never fails the caller: a Slack outage is logged and reported as { ok: false }.
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { ROOT } from './home.mjs';

export const LINE_MAX = 400;

/** Text squeezed to one line of at most LINE_MAX characters. */
export function oneLine(text) {
  const s = String(text ?? '').trim().replace(/\s*\r?\n\s*/g, ' · ').replace(/\s+/g, ' ').trim();
  return s.length > LINE_MAX ? `${s.slice(0, LINE_MAX - 1)}…` : s;
}

/**
 * Post `text` as one line to `channel` (a slack.mjs config key or a channel id). dryRun: print only.
 * `run(args)` is injectable for tests (default: node scripts/slack.mjs …). → { ok, line, error? }
 */
export function postLine(text, { channel = 'general', dryRun = false, root = ROOT, log = console.log, run } = {}) {
  const line = oneLine(text);
  if (!line) return { ok: false, line, error: 'empty message' };
  if (dryRun) { log(`slack (dry run) ${channel}: ${line}`); return { ok: true, line, dryRun: true }; }
  const exec = run || ((args) => spawnSync(process.execPath, [path.join(root, 'scripts', 'slack.mjs'), ...args], { cwd: root, encoding: 'utf8', timeout: 60_000 }));
  try {
    const r = exec(['post-text', channel, line]);
    if (r.status === 0) return { ok: true, line };
    const error = String(r.stderr || r.stdout || r.error?.message || `exit ${r.status}`).trim().split('\n').pop();
    log(`slack: post failed (${error}) — line was: ${line}`);
    return { ok: false, line, error };
  } catch (e) {
    log(`slack: post failed (${e.message}) — line was: ${line}`);
    return { ok: false, line, error: e.message };
  }
}
