// Multiplayer: the relay's real-time limits, waited out for real (they live in the relay process and cannot be
// fast-forwarded from the browser): the 30 s matchmaking queue, the 30 s play-again proposal and the 30 s reconnect
// grace (multiplayer_server/src/index.js MATCH_TIMEOUT_MS, PROPOSAL_TIMEOUT_MS, GRACE_MS). Pair A only (playwright
// config), once per run: about two minutes of waiting. Tagged @slow: `run.mjs --skip-slow` leaves it out of verify loops.
import { test, expect, L } from '../../lib/fixtures.mjs';
import { realUserAgent } from '../../lib/game-driver.mjs';
import { gameById } from '../../lib/guest.mjs';
import { adapterFor } from '../../games/index.mjs';
import { both, finishBoth, openPair, releasePair, shotBoth, shownName, startMatch, waitNotice, waitState } from '../../lib/mp.mjs';
import { playBoth } from '../../lib/mp-play.mjs';

test.use({ userAgent: realUserAgent });
test.afterEach(async () => { await releasePair(); });

const SW = gameById('series-winner');
const LIMIT_MS = 30_000;
const SLACK_MS = 6_000;
const text = (loc) => loc.first().textContent({ timeout: 3000 }).then((t) => (t || '').replace(/\s+/g, ' ').trim(), () => null);

/** A limit took about LIMIT_MS: a timing metric, and a `timeout` violation when it fired early or more than SLACK_MS late. */
function limit(p, label, ms) {
  p.audit.metrics.push({ kind: 'timing', label, value: ms, unit: 'ms', budget: LIMIT_MS + SLACK_MS, route: p.audit.route });
  if (ms < LIMIT_MS - 1500 || ms > LIMIT_MS + SLACK_MS) p.audit.violation('timeout', { selector: label, measured: `${Math.round(ms / 100) / 10} s`, expected: `${LIMIT_MS / 1000} s (+ up to ${SLACK_MS / 1000} s)` });
}

test('[MP-TIMEOUT-01] @slow the relay\'s 30 s limits, for real: a lone search ends with "No opponent found", an unanswered rematch request with "No response in time.", a dropped opponent with "Match ended" after the grace window', async ({ mp }) => {
  test.setTimeout(420_000);
  const pair = await openPair(mp, SW.path);
  const { host, joiner } = pair;

  // 1. Matchmaking queue: alone for 30 s → back on the idle card with the reason in the Multiplayer card.
  let t0 = Date.now();
  await L(host.page, 'multiplayer.play1v1').click();
  await waitState(host, 'searching');
  await waitState(host, 'idle', LIMIT_MS + SLACK_MS + 10_000);
  limit(host, 'matchmaking queue timeout', Date.now() - t0);
  const none = await waitNotice(host, /No opponent found/, { where: 'card', timeout: 3000 });
  if (none !== 'No opponent found. Please try again.') host.audit.violation('notice', { selector: '.mp-panel .mp-hint', measured: `"${none}"`, expected: '"No opponent found. Please try again."' });
  await shotBoth(pair, 'no-opponent');

  // 2. Play-again request nobody answers: after 30 s both are told "No response in time." and the request is gone.
  const adapter = adapterFor('series-winner');
  await startMatch(pair);
  await playBoth(pair, adapter, { host: 'perfect', joiner: 'wrong' });
  await both(pair, (p) => waitState(p, 'results', 30_000));
  await L(host.page, 'multiplayer.playAgain').click();
  await expect(L(joiner.page, 'multiplayer.accept')).toBeVisible({ timeout: 5000 });
  t0 = Date.now();
  await both(pair, (p) => expect(L(p.page, 'multiplayer.prompt')).toHaveCount(0, { timeout: LIMIT_MS + SLACK_MS + 10_000 }));
  limit(host, 'play-again proposal timeout', Date.now() - t0);
  const res = await both(pair, (p) => waitNotice(p, /No response in time/, { timeout: 3000 }));
  res.forEach((n, i) => { if (n !== 'No response in time.') [host, joiner][i].audit.violation('notice', { selector: '.om-notice', measured: `"${n}"`, expected: '"No response in time."' }); });
  await both(pair, (p) => expect(L(p.page, 'multiplayer.playAgain')).toBeVisible());
  await shotBoth(pair, 'no-response');
  await L(host.page, 'multiplayer.exitGameLink').click();
  await waitState(joiner, 'ended', 10_000);
  await L(joiner.page, 'multiplayer.endedExit').click();
  await both(pair, (p) => waitState(p, 'idle'));

  // 3. Reconnect grace: the joiner's tab goes away mid-match; the host sees "<joiner> disconnected. Trying to reconnect...",
  // the chip Reconnecting, and after 30 s "Match ended" / "Your opponent left the match.".
  await startMatch(pair);
  await shotBoth(pair, 'before-close');
  t0 = Date.now();
  await joiner.page.close();
  const jName = shownName(joiner, 'match');
  const gone = await waitNotice(host, /disconnected/, { timeout: 15_000 });
  if (gone !== `${jName} disconnected. Trying to reconnect...`) host.audit.violation('notice', { selector: '.om-notice', measured: `"${gone}"`, expected: `"${jName} disconnected. Trying to reconnect..."` });
  await expect(L(host.page, 'multiplayer.playbarChip').first()).toHaveClass(/\bis-offline\b/, { timeout: 5000 }).catch(() => host.audit.violation('grace', { selector: '.om-chip', measured: 'the opponent chip never showed Reconnecting', expected: 'is-offline while the opponent is away' }));
  await host.audit.shot('opponent-away'); // host only from here: the joiner's tab is closed (that is the check)
  await waitState(host, 'ended', LIMIT_MS + SLACK_MS + 20_000);
  // The relay notices a closed tab only after its ping timeout (pingInterval + pingTimeout = 10 + 10 s) at worst, then
  // waits GRACE_MS: measured from the close, so up to 20 s more than the grace itself.
  const graceMs = Date.now() - t0;
  host.audit.metrics.push({ kind: 'timing', label: 'tab closed → "Match ended" (detection + 30 s grace)', value: graceMs, unit: 'ms', budget: LIMIT_MS + 20_000 + SLACK_MS, route: host.audit.route });
  if (graceMs < LIMIT_MS - 1500 || graceMs > LIMIT_MS + 20_000 + SLACK_MS) host.audit.violation('timeout', { selector: 'reconnect grace', measured: `${Math.round(graceMs / 1000)} s`, expected: '30 s grace (+ the disconnect detection, ≤ 20 s)' });
  expect(await text(L(host.page, 'multiplayer.endedTitle'))).toBe('Match ended');
  const left = await text(L(host.page, 'multiplayer.endedMsg'));
  if (left !== 'Your opponent left the match.') host.audit.violation('ended', { selector: '.om-ended-msg', measured: `"${left}"`, expected: '"Your opponent left the match."' });
  await host.audit.layout({ scope: 'section.stage-col' });
  await host.audit.shot('grace-ended');
  await finishBoth(pair);
});
