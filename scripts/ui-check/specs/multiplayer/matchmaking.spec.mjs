// Multiplayer: random 1v1 matchmaking (MultiplayerPanel "Play 1v1" → OnlineMatch searching / intro / playing).
// The relay pairs a searcher at once with anyone waiting for the same game (rank only orders the candidates:
// multiplayer_server/src/index.js pickOpponent), and the local relay has no other players, so testuser1 searching
// first and testuser2 pressing Play 1v1 on the same game always meet each other. Helpers lib/mp.mjs.
import { test, expect, L } from '../../lib/fixtures.mjs';
import { realUserAgent } from '../../lib/game-driver.mjs';
import { gameById, fadeSummary, recordFrames } from '../../lib/guest.mjs';
import {
  ASIDE, both, finishBoth, layoutBoth, motion, motionBoth, mpState, openPair, play1v1Label, readIntro, readStateLog, recordTexts, releasePair,
  shotBoth, shownName, startStateLog, stateTrail, waitState,
} from '../../lib/mp.mjs';

test.use({ userAgent: realUserAgent });
test.afterEach(async () => { await releasePair(); });

const SW = gameById('series-winner');
const innerText = (loc) => loc.first().innerText({ timeout: 3000 }).then((t) => t.replace(/\s+/g, ' ').trim(), () => null);

test('[MP-MATCH-01] Play 1v1 on the same game: searching → match found → VS intro → playing on both; a lone search cancels back to the idle card without a snap', async ({ mp }) => {
  test.setTimeout(240_000);
  const pair = await openPair(mp, SW.path);
  const { host, joiner } = pair;
  await both(pair, async (p) => {
    expect(await play1v1Label(p)).toBe('Play 1v1');
    await startStateLog(p.page);
  });

  // Host searches alone: the stage shows the searching screen, the same button now reads Cancel, the title chip ONLINE 1V1.
  const hostBtn = await recordTexts(host.page, 'aside.game-aside .mp-row button:first-child', async () => {
    await motion(host, 'host Play 1v1 → searching', async () => {
      await L(host.page, 'multiplayer.play1v1').click();
      await waitState(host, 'searching');
    });
  });
  await expect(L(host.page, 'multiplayer.searching')).toContainText('Finding an opponent');
  expect(await play1v1Label(host)).toBe('Cancel');
  expect(await innerText(L(host.page, 'multiplayer.stageTitleChip'))).toBe('ONLINE 1V1');
  await host.audit.layout({ scope: 'section.stage-col' });
  await shotBoth(pair, 'host-searching');

  // The joiner presses Play 1v1 on the same game: matched at once; both through the VS intro to playing.
  const t0 = Date.now();
  const joinerBtn = await recordTexts(joiner.page, 'aside.game-aside .mp-row button:first-child', async () => {
    await motionBoth(pair, 'joiner Play 1v1 → match found', async () => {
      await L(joiner.page, 'multiplayer.play1v1').click();
      await both(pair, (p) => waitState(p, ['intro', 'playing'], 20_000));
    });
  });
  joiner.audit.metrics.push({ kind: 'timing', label: 'Play 1v1 → match found (second player)', value: Date.now() - t0, unit: 'ms', budget: 5000, route: joiner.audit.route });
  // Intro: "Match found", You vs Opponent with both names (mirrored), the loading / get-ready line. Asserted from the
  // snapshot the state log took on the first complete intro frame (the 2.6 s intro may be over before the test looks).
  const intros = new Map();
  await both(pair, async (p) => {
    if ((await mpState(p.page)) === 'intro') { await p.audit.layout({ scope: 'section.stage-col' }); await p.audit.shot('intro'); }
    const snap = await readIntro(p.page);
    if (!snap) {
      p.audit.violation('intro', { selector: '.om-stage .om-matchup', measured: `no complete VS intro frame sampled (screens ${stateTrail(await readStateLog(p.page))})`, expected: 'the VS intro with both cards before playing' });
      return;
    }
    if (snap.eyebrow !== 'Match found') p.audit.violation('intro', { selector: '.om-eyebrow', measured: `"${snap.eyebrow}"`, expected: '"Match found"' });
    if (!/^(Loading the game\.\.\.|Get ready\.\.\.)$/.test(snap.line || '')) p.audit.violation('intro', { selector: '.om-introline', measured: `"${snap.line}"`, expected: '"Loading the game..." or "Get ready..."' });
    const other = p === host ? joiner : host;
    const want = [{ side: 'You', name: p.username }, { side: 'Opponent', name: shownName(other, 'match') }];
    const got = snap.cards.map(({ side, name }) => ({ side, name }));
    if (JSON.stringify(got) !== JSON.stringify(want)) p.audit.violation('intro', { selector: '.om-matchup', measured: JSON.stringify(got), expected: JSON.stringify(want) });
    intros.set(p, snap);
    p.audit.metrics.push({ kind: 'note', label: 'intro snapshot at', value: snap.t, unit: 'ms', route: p.audit.route });
  });
  // No masking (no age rules since 2026-10-26.2; testuser1/2 never gave an age): each stranger's card carries the
  // same permanent #id the other player sees on their own "You" card.
  for (const [p, other] of [[host, joiner], [joiner, host]]) {
    const mine = intros.get(p), theirs = intros.get(other);
    if (!mine || !theirs || !mine.cards[1] || !theirs.cards[0]) continue;
    if (!mine.cards[1].tag || mine.cards[1].tag !== theirs.cards[0].tag) p.audit.violation('masking', { selector: '.om-matchup .om-pc-tag', measured: `the opponent card shows ${mine.cards[1].tag ? `#id ${mine.cards[1].tag}` : 'no player ID'}, the opponent's own card ${theirs.cards[0].tag || 'none'}`, expected: 'the opponent\'s permanent #id (the relay masks nobody)' });
  }
  await both(pair, (p) => waitState(p, 'playing', 30_000));
  await both(pair, async (p) => {
    await expect(L(p.page, 'multiplayer.gameRoot')).toBeVisible();
    expect(await play1v1Label(p)).toBe('In a match');
    await expect(L(p.page, 'multiplayer.play1v1')).toHaveAttribute('aria-disabled', 'true');
    expect(await innerText(L(p.page, 'multiplayer.stageTitleChip'))).toBe('ONLINE 1V1');
    const other = p === host ? joiner : host;
    expect(await innerText(L(p.page, 'multiplayer.playbarChip').locator('.om-chip-name'))).toBe(shownName(other, 'match'));
    await expect(L(p.page, 'multiplayer.exitGameLink')).toBeVisible();
  });
  // Both rounds are the same round (one deal per room).
  const [hr, jr] = [host.cap.frames('roundData', { dir: 'in' }), joiner.cap.frames('roundData', { dir: 'in' })];
  if (!hr.length || JSON.stringify(hr[hr.length - 1].gameData) !== JSON.stringify(jr[jr.length - 1]?.gameData)) host.audit.violation('round', { selector: 'roundData', measured: `${hr.length} / ${jr.length} roundData frames, same rows: ${hr.length && jr.length ? JSON.stringify(hr[hr.length - 1].gameData) === JSON.stringify(jr[jr.length - 1].gameData) : false}`, expected: 'one round, the same rows for both players' });
  await layoutBoth(pair);
  await shotBoth(pair, 'playing');

  // Screens passed through: both showed searching (the joiner at least its Cancel label for a moment), the intro and playing.
  const [ht, jt] = [await readStateLog(host.page), await readStateLog(joiner.page)];
  const order = (rows, list) => { let i = 0; for (const r of rows) if (r.state === list[i]) i++; return i === list.length; };
  if (!order(ht, ['searching', 'intro', 'playing'])) host.audit.violation('match-flow', { selector: '.om-stage', measured: stateTrail(ht), expected: 'searching > intro > playing' });
  if (!order(jt, ['intro', 'playing'])) joiner.audit.violation('match-flow', { selector: '.om-stage', measured: stateTrail(jt), expected: '(searching >) intro > playing' });
  // The second player is paired on arrival (the relay never makes a player wait when someone is queued), usually before
  // the searching screen or the button's Cancel label had a frame to show: recorded, not required.
  const joinerSaw = jt.some((r) => r.state === 'searching') || joinerBtn.texts.includes('Cancel');
  joiner.audit.metrics.push({ kind: 'note', label: 'second player saw the searching state', value: joinerSaw ? 'yes' : `no (paired on arrival; button ${joinerBtn.texts.join(' → ')})`, unit: '', route: joiner.audit.route });
  if (!hostBtn.texts.includes('Cancel') || hostBtn.remounts) host.audit.violation('swap', { selector: '.mp-row button', measured: `${hostBtn.texts.join(' → ')} (${hostBtn.remounts} remounts)`, expected: 'Play 1v1 → Cancel inside the same button' });
  for (const [p, t] of [[host, ht], [joiner, jt]]) p.audit.metrics.push({ kind: 'note', label: 'screens', value: stateTrail(t), unit: '', route: p.audit.route });

  // Leave the match (both): Exit game on the host ends it for the joiner too (MP-RES-01 owns that screen).
  await L(host.page, 'multiplayer.exitGameLink').click();
  await waitState(host, 'idle');
  await waitState(joiner, 'ended');
  await L(joiner.page, 'multiplayer.endedExit').click();
  await waitState(joiner, 'idle');

  // Second sub-step: the host searches alone and cancels from the stage: the searching screen fades out, the idle
  // card is back, nothing snaps, the side button reads Play 1v1 again.
  await L(host.page, 'multiplayer.play1v1').click();
  await waitState(host, 'searching');
  await host.page.waitForTimeout(500);
  const frames = await recordFrames(host.page, '.stage-inner .om-stage--compact', async () => {
    await motion(host, 'Cancel the search', async () => {
      await L(host.page, 'multiplayer.searchingCancel').click();
      await expect(L(host.page, 'guest.gameIdle')).toBeVisible({ timeout: 10_000 });
    }, [ASIDE, '.stage-shell', '.stage-col']);
  }, { tail: 400 });
  const fade = fadeSummary(frames);
  if (fade.intermediate < 1) host.audit.violation('snap', { selector: '.om-stage--compact', measured: `no part-way frame among ${fade.frames} sampled while the searching screen left`, expected: 'an animated exit' });
  await waitState(host, 'idle');
  expect(await play1v1Label(host)).toBe('Play 1v1');
  await expect(L(host.page, 'multiplayer.play1v1')).not.toHaveAttribute('aria-disabled', 'true');
  expect(await waitState(joiner, 'idle')).toBe('idle');
  await layoutBoth(pair);
  await shotBoth(pair, 'after-cancel');
  await finishBoth(pair);
});
