// Channel awareness of a checker run (spec §7): which of its checks a Logic Check block leaves out this run.
// Both run.mjs files (`--skip-blocked`, default on) call blockedChecks() before building their --grep, add
// grepInvertFor() to --grep-invert, write the list to <runDir>/blocked.json (the digest reporter lists it under Coverage
// gaps as `blocked by LC-… (card …)`) and record each item with recordDeferrals() → channel.defer().
// Ids come back in the `--only` form: a family row's placeholders become `*` (`GM-<game>-<scenario>` → `GM-*-*`,
// narrowed by a games.<id> block to `GM-wordle-*`), so a catch-up run passes them straight to `run.mjs --only`.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import * as channelMod from './channel.mjs';
import { LOGIC_CHECKS_MD, UI_CHECKS_MD, checksForServices, parseServices } from './services.mjs';

/** `GM-<game>-<scenario>` → `GM-*-*` (the --only / grepFor form). */
export const starForm = (id) => String(id).replace(/<[a-z]+>/g, '*');

/** The services map of one checker's CHECKS.md (empty when the file does not exist). */
export function serviceMapOf(checker) {
  const file = checker === 'logic' ? LOGIC_CHECKS_MD : UI_CHECKS_MD;
  let md;
  try { md = readFileSync(file, 'utf8'); } catch (e) { if (e.code === 'ENOENT') return new Map(); throw e; }
  return parseServices(md, { file: `${path.basename(path.dirname(file))}/CHECKS.md` });
}

/**
 * Checks of `checker` tagged with a blocked service → [{ checkId, service, blockedBy, card, finding }], one per check
 * (the first blocked service in channel order names the block). `channel`: { blockedServices(), blockFor(service) }
 * (default check-core/lib/channel.mjs on <home>/channel.json); `map`: a parseServices map (default the checker's CHECKS.md).
 */
export function blockedChecks({ checker = 'ui', map = null, channel = channelMod } = {}) {
  const services = [...channel.blockedServices()];
  if (!services.length) return [];
  const m = map || serviceMapOf(checker);
  const out = new Map();
  for (const service of services) {
    const b = channel.blockFor(service);
    if (!b) continue;
    for (const id of checksForServices([service], [m])) {
      const checkId = starForm(id);
      if (!out.has(checkId)) out.set(checkId, { checkId, service, blockedBy: b.by, card: b.card || null, finding: b.finding || null });
    }
  }
  return [...out.values()];
}

/** --grep-invert for the blocked checks (`[ID]` titles, `*` within an id), or null when none. */
export function grepInvertFor(list) {
  if (!list.length) return null;
  const ids = list.map((x) => x.checkId.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[\\w.-]*'));
  return `\\[(${ids.join('|')})\\]`;
}

/** channel.defer() for every blocked check of this run → number newly recorded. */
export function recordDeferrals(list, { checker = 'ui', runId = null, channel = channelMod } = {}) {
  let added = 0;
  for (const x of list) {
    const r = channel.defer({ checker, checkId: x.checkId, project: null, blockedBy: x.blockedBy, service: x.service, runId });
    if (r && r.added) added++;
  }
  return added;
}
