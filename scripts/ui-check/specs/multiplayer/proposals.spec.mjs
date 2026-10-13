// Multiplayer: after a 1v1 match, the play-again / switch-game handshake (OnlineMatch ResultActions, relay
// proposeAgain / proposeSwitch / respondProposal / cancelProposal). Friend rooms have no handshake (the host restarts
// for everyone), so these run on random 1v1 matches. Rounds are played with the Series Winner adapter.
import { test, expect, L } from '../../lib/fixtures.mjs';
import { realUserAgent } from '../../lib/game-driver.mjs';
import { gameById } from '../../lib/guest.mjs';
import { adapterFor } from '../../games/index.mjs';
import {
  STAGE_BOX, both, checkResults, finishBoth, layoutBoth, motionBoth, openPair, releasePair, shotBoth, shownName, startMatch, waitNotice, waitState,
} from '../../lib/mp.mjs';
import { playBoth } from '../../lib/mp-play.mjs';

test.use({ userAgent: realUserAgent });
test.afterEach(async () => { await releasePair(); });

const SW = gameById('series-winner');
const adapter = adapterFor('series-winner');
const text = (loc) => loc.first().textContent({ timeout: 3000 }).then((t) => (t || '').replace(/\s+/g, ' ').trim(), () => null);
const WATCH = ['.stage-shell', '.stage-inner .om-stage--results', '.stage-inner .om-stage--results .om-prompt, .stage-inner .om-stage--results .om-result-actions'];

/** Both players on the results of a finished 1v1 (host all right, joiner all wrong). */
async function toResults(pair, tag = '') {
  await startMatch(pair);
  const { h, j } = await playBoth(pair, adapter, { tag });
  await checkResults(pair, { host: { outcome: 'win', score: h.expected }, joiner: { outcome: 'loss', score: j.expected } });
}

/** The default result actions (Play again + Change game) are back on a player's screen. */
const actionsBack = (p) => expect(L(p.page, 'multiplayer.playAgain')).toBeVisible({ timeout: 5000 });

test('[MP-PROP-01] rematch: request → decline (notice on the host) → request → cancel (the joiner\'s request goes away) → request → accept starts a new match for both; equal scores are split by time ("Same score, faster time wins")', async ({ mp }) => {
  test.setTimeout(420_000);
  const pair = await openPair(mp, SW.path);
  const { host, joiner } = pair;
  await toResults(pair);
  const hostShown = shownName(host, 'match');

  // 1. Request → the host waits ("Rematch request sent"), the joiner is asked (Accept / Decline). The actions box glides.
  await motionBoth(pair, 'Play again → request', async () => {
    await L(host.page, 'multiplayer.playAgain').click();
    await expect(L(host.page, 'multiplayer.cancelRequest')).toBeVisible({ timeout: 5000 });
    await expect(L(joiner.page, 'multiplayer.accept')).toBeVisible({ timeout: 5000 });
  }, WATCH);
  expect(await text(L(host.page, 'multiplayer.promptText'))).toBe('Rematch request sent. Waiting for your opponent...');
  expect(await text(L(joiner.page, 'multiplayer.promptText'))).toBe(`${hostShown} wants a rematch`);
  await expect(L(joiner.page, 'multiplayer.decline')).toBeVisible();
  await layoutBoth(pair);
  await shotBoth(pair, 'request');

  // 2. Decline → the host is told "<joiner> declined." and both are back on the plain result actions. (The relay tells
  // only the proposer: respondProposal(false) sends proposalDeclined to the others and nothing to the decliner, and the
  // client clears nothing locally, so the decliner's own prompt is checked separately.)
  await motionBoth(pair, 'Decline', async () => {
    await L(joiner.page, 'multiplayer.decline').click();
    await actionsBack(host);
  }, WATCH);
  const declined = await waitNotice(host, /declined\.$/);
  if (declined !== `${shownName(joiner, 'match')} declined.`) host.audit.violation('notice', { selector: '.om-notice', measured: `"${declined}"`, expected: `"${shownName(joiner, 'match')} declined."` });
  await expect(L(host.page, 'multiplayer.prompt')).toHaveCount(0);
  const stale = await expect(L(joiner.page, 'multiplayer.prompt')).toHaveCount(0, { timeout: 5000 }).then(() => false, () => true);
  if (stale) {
    const what = await text(L(joiner.page, 'multiplayer.promptText'));
    joiner.audit.violation('stale-prompt', { selector: '.om-prompt', measured: `5 s after Decline the decliner still sees "${what}" with Accept / Decline (Accept now does nothing: the relay already dropped the request)`, expected: 'the declined request leaves the decliner\'s screen too; the result actions come back' });
  }
  await shotBoth(pair, 'declined');

  // 3. Request again, then the host cancels it: the joiner's request disappears with "The request was withdrawn."
  await L(host.page, 'multiplayer.playAgain').click();
  await expect(L(joiner.page, 'multiplayer.accept')).toBeVisible({ timeout: 5000 });
  await motionBoth(pair, 'Cancel request', async () => {
    await L(host.page, 'multiplayer.cancelRequest').click();
    await both(pair, actionsBack);
  }, WATCH);
  const withdrawn = await waitNotice(joiner, /withdrawn/);
  if (withdrawn !== 'The request was withdrawn.') joiner.audit.violation('notice', { selector: '.om-notice', measured: `"${withdrawn}"`, expected: '"The request was withdrawn."' });
  await both(pair, (p) => expect(L(p.page, 'multiplayer.prompt')).toHaveCount(0));
  await shotBoth(pair, 'withdrawn');

  // 4. Request → Accept: a new match for both (VS intro, a fresh round), same game.
  const rounds = host.cap.frames('roundData', { dir: 'in' }).length;
  await L(host.page, 'multiplayer.playAgain').click();
  await expect(L(joiner.page, 'multiplayer.accept')).toBeVisible({ timeout: 5000 });
  await motionBoth(pair, 'Accept → new match', async () => {
    await L(joiner.page, 'multiplayer.accept').click();
    await both(pair, (p) => waitState(p, ['intro', 'playing'], 15_000));
  }, STAGE_BOX);
  await both(pair, (p) => waitState(p, 'playing', 30_000));
  if (host.cap.frames('roundData', { dir: 'in' }).length !== rounds + 1) host.audit.violation('rematch', { selector: 'roundData', measured: `${host.cap.frames('roundData', { dir: 'in' }).length - rounds} new rounds`, expected: 'exactly one new round dealt' });
  await shotBoth(pair, 'rematch-started');

  // The rematch, both all right: equal scores, the host finishes first (the joiner waits while the host plays), so the
  // clock decides: host "You win!", joiner "You lost", both with "Same score, faster time wins".
  const { h, j } = await playBoth(pair, adapter, { host: 'perfect', joiner: 'perfect', tag: 'rematch-' });
  await checkResults(pair, { host: { outcome: 'win', score: h.expected }, joiner: { outcome: 'loss', score: j.expected }, timeTie: true });
  await layoutBoth(pair);
  await shotBoth(pair, 'rematch-results');
  await finishBoth(pair);
});

test('[MP-PROP-02] change-game proposal from the results: the picker (1v1 notes "up to N pts"), the request on both sides, accept → both on the new game', async ({ mp }) => {
  test.setTimeout(360_000);
  const pair = await openPair(mp, SW.path);
  const { host, joiner } = pair;
  const target = gameById('name-logo');
  await toResults(pair);

  await L(host.page, 'multiplayer.resultsChangeGame').click();
  await expect(L(host.page, 'multiplayer.pickerGrid')).toBeVisible();
  await host.page.waitForTimeout(400);
  const items = await host.page.evaluate(() => [...document.querySelectorAll('.modal-panel .gp-grid button.gp-item')].map((b) => ({ name: b.querySelector('.gp-name')?.textContent.trim(), note: b.querySelector('.gp-note')?.textContent.trim(), disabled: b.disabled })));
  const cur = items.find((i) => i.name === SW.name);
  if (!cur || !cur.disabled || cur.note !== 'Playing now') host.audit.violation('picker', { selector: '.gp-item.is-current', measured: JSON.stringify(cur), expected: '"Playing now", disabled' });
  const other = items.find((i) => i.name === target.name);
  if (!other || !/^up to \d+ pts$/.test(other.note || '')) host.audit.violation('picker', { selector: '.gp-note', measured: JSON.stringify(other), expected: '1v1 tiles name the points: "up to N pts"' });
  await host.audit.layout({ scope: '.modal-panel' });
  await host.audit.shot('picker');

  await motionBoth(pair, `propose ${target.name}`, async () => {
    await L(host.page, 'multiplayer.pickerItems').filter({ has: host.page.locator('.gp-name', { hasText: target.name }) }).click();
    await expect(L(host.page, 'guest.modalBackdrop')).toHaveCount(0, { timeout: 5000 });
    await expect(L(host.page, 'multiplayer.cancelRequest')).toBeVisible({ timeout: 5000 });
    await expect(L(joiner.page, 'multiplayer.accept')).toBeVisible({ timeout: 5000 });
  }, WATCH);
  expect(await text(L(host.page, 'multiplayer.promptText'))).toBe(`Switch to ${target.name} sent. Waiting for your opponent...`);
  expect(await text(L(joiner.page, 'multiplayer.promptText'))).toBe(`${shownName(host, 'match')} wants to switch to ${target.name}`);
  await layoutBoth(pair);
  await shotBoth(pair, 'switch-request');

  await motionBoth(pair, 'Accept the switch', async () => {
    await L(joiner.page, 'multiplayer.accept').click();
    await both(pair, (p) => waitState(p, ['intro', 'playing'], 15_000));
  }, STAGE_BOX);
  await both(pair, (p) => waitState(p, 'playing', 30_000));
  await both(pair, async (p) => {
    await expect(p.page).toHaveURL(new RegExp(`${target.path}$`), { timeout: 10_000 });
    await expect(L(p.page, 'multiplayer.stageGameName')).toHaveText(target.name);
    await expect(L(p.page, 'multiplayer.gameRoot')).toBeVisible();
    const rd = p.cap.frames('roundData', { dir: 'in' }).pop();
    if (!rd || !rd.game || rd.game.id !== target.id) p.audit.violation('switch', { selector: 'roundData', measured: `newest round is for ${rd && rd.game ? rd.game.id : 'nothing'}`, expected: `a ${target.id} round` });
  });
  await layoutBoth(pair);
  await shotBoth(pair, 'switched');
  await finishBoth(pair);
});
