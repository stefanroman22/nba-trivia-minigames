// Multiplayer: leaving and coming back. A 1v1 player leaving mid-game ends the match for the other ("Match ended"); a
// reload mid-match resumes inside the relay's 30 s grace window (multiplayer_server GRACE_MS: the seat is kept and a
// `resumeMatch` snapshot puts the player back); a friend-room host stopping the match takes both back to the lobby.
import { test, expect, L } from '../../lib/fixtures.mjs';
import { realUserAgent } from '../../lib/game-driver.mjs';
import { gameById } from '../../lib/guest.mjs';
import {
  both, finishBoth, layoutBoth, motionBoth, openPair, recordTexts, releasePair, roomWithBoth, shotBoth, shownName, startMatch, startRoom,
  waitNotice, waitState,
} from '../../lib/mp.mjs';

test.use({ userAgent: realUserAgent });
test.afterEach(async () => { await releasePair(); });

const SW = gameById('series-winner');
const GRACE_MS = 30_000;
const text = (loc) => loc.first().textContent({ timeout: 3000 }).then((t) => (t || '').replace(/\s+/g, ' ').trim(), () => null);

test('[MP-RES-01] the host leaves a 1v1 mid-game → the joiner sees "Match ended" / "Your opponent left the match." with Find new match / Exit game; a reload mid-match resumes within the grace window; a friend-room host\'s Stop match takes both back to the lobby', async ({ mp }) => {
  test.setTimeout(360_000);
  const pair = await openPair(mp, SW.path);
  const { host, joiner } = pair;

  // 1. 1v1, the host exits mid-game (the only leave control a 1v1 player has: "Exit game").
  await startMatch(pair);
  await shotBoth(pair, 'playing');
  await motionBoth(pair, 'host Exit game mid-match', async () => {
    await L(host.page, 'multiplayer.exitGameLink').click();
    await waitState(host, 'idle');
    await waitState(joiner, 'ended', 10_000);
  }, ['.stage-shell', '.stage-inner .om']);
  expect(await text(L(joiner.page, 'multiplayer.endedTitle'))).toBe('Match ended');
  const msg = await text(L(joiner.page, 'multiplayer.endedMsg'));
  if (msg !== 'Your opponent left the match.') joiner.audit.violation('ended', { selector: '.om-ended-msg', measured: `"${msg}"`, expected: '"Your opponent left the match."' });
  await expect(L(joiner.page, 'multiplayer.findNew')).toBeVisible();
  await expect(L(joiner.page, 'multiplayer.endedExit')).toBeVisible();
  await layoutBoth(pair);
  await shotBoth(pair, 'opponent-left');
  // Exit game from "Match ended" → the idle card.
  await L(joiner.page, 'multiplayer.endedExit').click();
  await waitState(joiner, 'idle');

  // 2. A new 1v1; the joiner reloads mid-match → back on the playing screen of the same match (resumeMatch), well
  // within the 30 s grace; the host is told "<joiner> disconnected. Trying to reconnect..." then "<joiner> reconnected.".
  await startMatch(pair);
  const code = host.cap.frames('matchFound', { dir: 'in' }).pop()?.code;
  const jName = shownName(joiner, 'match');
  let resumeMs = null;
  const notices = await recordTexts(host.page, '.stage-inner .om .om-notice', async () => {
    const chip = await recordTexts(host.page, '.stage-inner .om-stage .om-playbar .om-chip .om-chip-state', async () => {
      const t0 = Date.now();
      await joiner.page.reload({ waitUntil: 'domcontentloaded' });
      await expect(L(joiner.page, 'multiplayer.gameRoot')).toBeVisible({ timeout: GRACE_MS });
      resumeMs = Date.now() - t0;
      await waitNotice(host, /reconnected\.$/, { timeout: 10_000 });
    }, { tail: 300 });
    if (!chip.texts.includes('Reconnecting')) host.audit.violation('resume', { selector: '.om-chip-state', measured: `opponent chip ${chip.texts.join(' → ')}`, expected: 'Reconnecting while the joiner is away, then Playing' });
  }, { tail: 300 });
  joiner.audit.metrics.push({ kind: 'timing', label: 'reload → back on the playing screen', value: resumeMs, unit: 'ms', budget: GRACE_MS, route: joiner.audit.route });
  if (!notices.texts.includes(`${jName} disconnected. Trying to reconnect...`)) host.audit.violation('resume', { selector: '.om-notice', measured: `notices ${JSON.stringify(notices.texts)}`, expected: `"${jName} disconnected. Trying to reconnect..."` });
  if (!notices.texts.includes(`${jName} reconnected.`)) host.audit.violation('resume', { selector: '.om-notice', measured: `notices ${JSON.stringify(notices.texts)}`, expected: `"${jName} reconnected."` });
  const resumed = joiner.cap.frames('resumeMatch', { dir: 'in' }).pop();
  if (!resumed || resumed.code !== code || resumed.phase !== 'playing') joiner.audit.violation('resume', { selector: 'resumeMatch', measured: JSON.stringify(resumed && { code: resumed.code, phase: resumed.phase }), expected: `the same match (${code}) resumed in playing` });
  await both(pair, async (p) => {
    expect(await waitState(p, 'playing')).toBe('playing');
    expect(await text(L(p.page, 'multiplayer.stageTitleChip'))).toBe('ONLINE 1V1');
  });
  await layoutBoth(pair);
  await shotBoth(pair, 'resumed');
  // Leave: the host exits, the joiner exits "Match ended".
  await L(host.page, 'multiplayer.exitGameLink').click();
  await waitState(joiner, 'ended', 10_000);
  await L(joiner.page, 'multiplayer.endedExit').click();
  await both(pair, (p) => waitState(p, 'idle'));

  // 3. Friend room: the host's Stop match mid-game → both back in the lobby (same code), the joiner told
  // "The host ended the match.", the host can start again.
  const room = await roomWithBoth(pair);
  await startRoom(pair);
  await motionBoth(pair, 'host Stop match', async () => {
    await L(host.page, 'multiplayer.stopMatch').click();
    await both(pair, (p) => waitState(p, 'lobby', 10_000));
  }, ['.stage-shell', '.stage-inner', 'aside.game-aside .mp-panel']);
  const stopped = await waitNotice(joiner, /ended the match/, { where: 'card' });
  if (stopped !== 'The host ended the match.') joiner.audit.violation('notice', { selector: '.mp-panel .mp-hint', measured: `"${stopped}"`, expected: '"The host ended the match."' });
  await both(pair, async (p) => {
    const tiles = (await L(p.page, 'multiplayer.lobbyCode').innerText()).replace(/\D/g, '');
    if (tiles !== room) p.audit.violation('lobby', { selector: '.fp-tiles', measured: `code ${tiles}`, expected: `the same room ${room}` });
    await expect(L(p.page, 'multiplayer.seats')).toHaveCount(2);
  });
  await expect(L(host.page, 'multiplayer.startBtn')).toBeVisible();
  await layoutBoth(pair);
  await shotBoth(pair, 'stopped');
  await finishBoth(pair);
});
