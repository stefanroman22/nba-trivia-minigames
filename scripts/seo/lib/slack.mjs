// The weekly SEO run's one Slack line (spec §5 run.mjs), posted through check-core/lib/slack-line.mjs to the channel
// config.json `slackChannel` names. Counts only: no Search Analytics number, no secret.
import { postLine } from '../../check-core/lib/slack-line.mjs';
import { loadConfig } from './config.mjs';

/** "42 s" under a minute, else whole minutes ("7 min"). */
export const duration = (ms) => (ms < 60_000 ? `${Math.max(0, Math.round(ms / 1000))} s` : `${Math.round(ms / 60_000)} min`);

/**
 * The run's state → one line:
 * `seo: run <id> · <n> urls · indexed <i> · not indexed <k> · audit fails <f> · cards <c> new/<s> seen · owner actions <o>
 *  · <duration>`, then ` · judgement needed` when the agent did not run and ` · failed: <why>` per
 * infra failure. ` · onpage fails <n>` follows `audit fails` only when the on-page step ran (`onpageFails` a number).
 * @param {{ runId: string, urls: number, indexed: number, notIndexed: number, auditFails: number, onpageFails?: number|null,
 *   cards: { new: number, seen: number }, ownerActions: number, durationMs: number, judgementNeeded?: boolean,
 *   failures?: string[] }} s
 */
export function seoLine(s) {
  const parts = [
    `seo: run ${s.runId}`, `${s.urls} urls`, `indexed ${s.indexed}`, `not indexed ${s.notIndexed}`, `audit fails ${s.auditFails}`,
    ...(typeof s.onpageFails === 'number' ? [`onpage fails ${s.onpageFails}`] : []),
    `cards ${s.cards.new} new/${s.cards.seen} seen`, `owner actions ${s.ownerActions}`, duration(s.durationMs),
  ];
  if (s.judgementNeeded) parts.push('judgement needed');
  for (const f of s.failures ?? []) parts.push(`failed: ${f}`);
  return parts.join(' · ');
}

/** Posts `line` to config.slackChannel (postLine never throws). → postLine's { ok, line, error? } */
export function postSeoLine(line, { channel = loadConfig().slackChannel, ...rest } = {}) {
  return postLine(line, { channel, ...rest });
}
