// Multiplayer: the end of a 1v1 match (OnlineMatch waiting + results, AnswerReviewModal). The match is played with
// the Series Winner adapter (games/series-winner.mjs, answers from the round the relay dealt: lib/mp-pool.mjs): the
// host right every round, the joiner wrong every round, so the host wins on score. The relay credits 1v1 matches
// (/trivia/multiplayer-result/, local sqlite only; see notes/multiplayer.md): that credit is Logic Check's (LC-ROOMS-08/10);
// this file asserts only the "+N pts" toast rendering.
import { test, expect, L } from '../../lib/fixtures.mjs';
import { realUserAgent } from '../../lib/game-driver.mjs';
import { gameById } from '../../lib/guest.mjs';
import { adapterFor } from '../../games/index.mjs';
import { both, checkResults, creditsEnabled, finishBoth, layoutBoth, openPair, recordTexts, releasePair, reviewRoundTrip, roomWithBoth, shotBoth, startMatch, startRoom } from '../../lib/mp.mjs';
import { TTT_SCORES, playBoth, playDuel } from '../../lib/mp-play.mjs';

test.use({ userAgent: realUserAgent });
test.afterEach(async () => { await releasePair(); });

const SW = gameById('series-winner');
const adapter = adapterFor('series-winner');

test('[MP-RESULT-01] a full 1v1 match: the host (all right) sees "You win!", the joiner (all wrong) "You lost"; scores, names and times mirror on both screens; no "faster time" line; the "+50 pts" toast on the host; the answer review opens and closes on both', async ({ mp }) => {
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
  expect(h.expected).toBe(100);
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

  // The "+N pts" toast renders on the host's results (the relay credits a 1v1 match; a 0 awards nothing). The credit
  // itself (pointsAwarded values, /me/ points) is Logic Check's: LC-ROOMS-10 (spec §5 no-overlap).
  if (creditsEnabled()) {
    if (!toast.texts.some((t) => /^\+\d+ pts/.test(t))) host.audit.violation('points', { selector: '.om-points', measured: `toast ${JSON.stringify(toast.texts)}`, expected: `"+${h.expected} pts added to your profile" on the results` });
  } else {
    host.audit.metrics.push({ kind: 'note', label: 'points credit not checked: the relay or Django was not started by ui-check (no shared relay key)', value: 0, unit: '', route: host.audit.route });
  }

  // See answers on both: the review modal shows the player's own score, closes with its X.
  await reviewRoundTrip(host, h.expected);
  await reviewRoundTrip(joiner, j.expected);
  await finishBoth(pair);
});

// The draw headline needs equal scores AND equal (or no) play times (relay rankRoom): a Tic-Tac-Toe duel scores the board,
// not the clock, and submits no times, so a full board without a line is a deterministic draw (lib/mp-play.mjs
// DUEL_SCRIPTS.draw: X O X / X O O / O X X). Both players claim, so no turn clock is waited out: it runs on every pair.
test('[MP-RESULT-02] a draw: a Tic-Tac-Toe duel filled without a line ends "Draw!" on the board and "It\'s a draw" on both results screens, equal scores (120), both cards marked tie, no crown, no time line', async ({ mp }) => {
  test.setTimeout(300_000);
  const ttt = gameById('tictactoe');
  const pair = await openPair(mp, ttt.path);
  await roomWithBoth(pair);
  await startRoom(pair);
  const duel = await playDuel(pair, adapterFor('tictactoe'), { script: 'draw' });
  pair.host.audit.metrics.push({ kind: 'note', label: 'duel moves', value: duel.moves.map((m) => `${m.who}:${m.kind}@${m.cell + 1}`).join(' '), unit: '', route: pair.host.audit.route });
  await checkResults(pair, { host: { outcome: 'tie', score: TTT_SCORES.draw }, joiner: { outcome: 'tie', score: TTT_SCORES.draw }, times: false });
  // A friend room never credits points: Logic Check's LC-ROOMS-08 (spec §5 no-overlap).
  await layoutBoth(pair);
  await shotBoth(pair, 'draw');
  await reviewRoundTrip(pair.host, TTT_SCORES.draw);
  await reviewRoundTrip(pair.joiner, TTT_SCORES.draw);
  await finishBoth(pair);
});
