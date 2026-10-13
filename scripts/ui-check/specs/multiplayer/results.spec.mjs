// Multiplayer: the end of a 1v1 match (OnlineMatch waiting + results, AnswerReviewModal). The match is played with
// the Series Winner adapter (games/series-winner.mjs, answers from the round the relay dealt: lib/mp-pool.mjs): the
// host right every round, the joiner wrong every round, so the host wins on score. 1v1 matches are credited to both
// profiles by the relay (/trivia/multiplayer-result/, local sqlite only; see notes/multiplayer.md).
import { test, expect, L } from '../../lib/fixtures.mjs';
import { realUserAgent } from '../../lib/game-driver.mjs';
import { gameById } from '../../lib/guest.mjs';
import { adapterFor } from '../../games/index.mjs';
import { both, checkResults, creditsEnabled, finishBoth, layoutBoth, openPair, recordTexts, releasePair, reviewRoundTrip, shotBoth, startMatch } from '../../lib/mp.mjs';
import { playBoth } from '../../lib/mp-play.mjs';

test.use({ userAgent: realUserAgent });
test.afterEach(async () => { await releasePair(); });

const SW = gameById('series-winner');
const adapter = adapterFor('series-winner');

test('[MP-RESULT-01] a full 1v1 match: the host (all right) sees "You win!", the joiner (all wrong) "You lost"; scores, names and times mirror on both screens; no "faster time" line; points credited; the answer review opens and closes on both', async ({ mp }) => {
  test.setTimeout(300_000);
  const pair = await openPair(mp, SW.path);
  const { host, joiner } = pair;
  await startMatch(pair);

  // The "+N pts added to your profile" toast on the host's results (a 1.5 s overlay) is recorded from before the end.
  let played;
  const toast = await recordTexts(host.page, '.stage-inner .om-stage--results .om-points', async () => {
    played = await playBoth(pair, adapter, { host: 'perfect', joiner: 'wrong' });
    await expect(L(host.page, 'multiplayer.results')).toBeVisible({ timeout: 30_000 });
    await host.page.waitForTimeout(1500);
  }, { tail: 200 });
  const { h, j } = played;
  expect(h.expected).toBe(50);
  expect(j.expected).toBe(0);

  await checkResults(pair, { host: { outcome: 'win', score: h.expected }, joiner: { outcome: 'loss', score: j.expected }, timeTie: false });
  await layoutBoth(pair);
  await shotBoth(pair, 'results');
  // 1v1 actions on both sides: Play again + Change game, and Exit game.
  await both(pair, async (p) => {
    await expect(L(p.page, 'multiplayer.playAgain')).toBeVisible();
    await expect(L(p.page, 'multiplayer.resultsChangeGame')).toBeVisible();
    await expect(L(p.page, 'multiplayer.exitGameLink')).toBeVisible();
  });

  // Points: the relay credits a 1v1 match (the host's 50; a 0 awards nothing, so no toast for the joiner).
  if (creditsEnabled()) {
    const awarded = host.cap.frames('pointsAwarded', { dir: 'in' }).map((f) => f.awarded);
    if (JSON.stringify(awarded) !== JSON.stringify([h.expected])) host.audit.violation('points', { selector: 'pointsAwarded', measured: `awarded ${JSON.stringify(awarded)}`, expected: `[${h.expected}] (one credit for the match)` });
    if (!toast.texts.some((t) => t.startsWith(`+${h.expected} pts`))) host.audit.violation('points', { selector: '.om-points', measured: `toast ${JSON.stringify(toast.texts)}`, expected: `"+${h.expected} pts added to your profile" on the results` });
    if (joiner.cap.frames('pointsAwarded', { dir: 'in' }).length) joiner.audit.violation('points', { selector: 'pointsAwarded', measured: JSON.stringify(joiner.cap.frames('pointsAwarded', { dir: 'in' })), expected: 'nothing awarded for a 0' });
  } else {
    host.audit.metrics.push({ kind: 'note', label: 'points credit not checked: the relay or Django was not started by ui-check (no shared relay key)', value: 0, unit: '', route: host.audit.route });
  }

  // See answers on both: the review modal shows the player's own score, closes with its X.
  await reviewRoundTrip(host, h.expected);
  await reviewRoundTrip(joiner, j.expected);
  await finishBoth(pair);
});
