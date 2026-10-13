// Multiplayer: friend rooms (FriendPlay.tsx in the game page's Multiplayer card). Both players (mp.pair(): testuser1
// host, testuser2 joiner) are asserted and shot at every step; helpers in lib/mp.mjs, locators in
// pagemap/multiplayer.json. Every test starts both players on the idle card (openPair) and afterEach leaves whatever
// room is left (releasePair). One worker, tests in file order (the mp projects run with fullyParallel off).
import { test, expect, L } from '../../lib/fixtures.mjs';
import { realUserAgent } from '../../lib/game-driver.mjs';
import { gameById } from '../../lib/guest.mjs';
import {
  ASIDE, both, createRoom, finishBoth, joinRoom, layoutBoth, lobbyCode, motion, motionBoth, mpState, openPair, recordTexts,
  releasePair, shotBoth, startRoom, waitNotice, waitState,
} from '../../lib/mp.mjs';

test.use({ userAgent: realUserAgent });
test.afterEach(async () => { await releasePair(); });

const SW = gameById('series-winner');
const innerText = (loc) => loc.first().innerText({ timeout: 3000 }).then((t) => t.replace(/\s+/g, ' ').trim(), () => null);

/** One SwapText label: the swap happened inside the same element (UI-21), never by replacing the control. */
function swapOk(p, what, rec, want) {
  const seen = want.every((t) => rec.texts.includes(t));
  if (rec.remounts) p.audit.violation('swap', { selector: what, measured: `label replaced by a new element ${rec.remounts}× (${rec.texts.join(' → ')})`, expected: 'the label swaps inside the same control (SwapText, UI-21)' });
  return seen;
}

test('[MP-ROOM-01] friend room: generate code ("Creating…"), copy code ("Code copied"), player stepper seen by the joiner, collapse / expand glide', async ({ mp }) => {
  test.setTimeout(240_000);
  const pair = await openPair(mp, SW.path);
  const { host, joiner } = pair;
  await shotBoth(pair, 'idle');

  // Play with a friend: the card swaps to the friend menu (size stepper, Generate code, Enter code) and glides.
  await motion(host, 'Play with a friend', async () => {
    await L(host.page, 'multiplayer.friendBtn').click();
    await expect(L(host.page, 'multiplayer.generateBtn')).toBeVisible();
  });
  await expect(L(host.page, 'multiplayer.menuStepper')).toBeVisible();
  expect(await innerText(L(host.page, 'multiplayer.menuSizeNum'))).toBe('2');
  await expect(L(host.page, 'multiplayer.enterCodeBtn')).toBeVisible();
  await host.audit.layout({ scope: 'aside.game-aside' });
  await shotBoth(pair, 'friend-menu');

  // Generate code: "Generate code" → "Creating…" in the same button, then the lobby with the code.
  const gen = await recordTexts(host.page, 'aside.game-aside .fp-body:not(:has(.fp-code-row)) .fp-actions--row:not(.fp-actions--single) button.btn-primary', async () => {
    await motion(host, 'Generate code → lobby', async () => {
      await L(host.page, 'multiplayer.generateBtn').click();
      await waitState(host, 'lobby');
    });
  });
  swapOk(host, 'Generate code button', gen, ['Generate code']);
  if (gen.texts.includes('Creating…')) host.audit.metrics.push({ kind: 'note', label: 'Generate code label sequence', value: gen.texts.join(' → '), unit: '', route: host.audit.route });
  else host.audit.metrics.push({ kind: 'note', label: 'Creating… not painted (the relay answered within a frame)', value: gen.texts.join(' → '), unit: '', route: host.audit.route });
  const code = await lobbyCode(host);
  expect(code).toMatch(/^\d{6}$/);
  await expect(L(host.page, 'multiplayer.seats')).toHaveCount(1);
  await expect(L(host.page, 'multiplayer.emptySeats')).toHaveCount(1);
  expect(await innerText(L(host.page, 'multiplayer.seats').first().locator('.fp-seat-name'))).toBe(`${host.username} (you)`);
  await expect(L(host.page, 'multiplayer.seats').first().locator('.fp-host-chip')).toHaveText('HOST');
  expect(await innerText(L(host.page, 'multiplayer.shareHint'))).toBe('Send this code to a friend.');
  expect(await innerText(L(host.page, 'multiplayer.startReason'))).toBe('Waiting for 1 more player');
  await expect(L(host.page, 'multiplayer.startBtn')).toHaveAttribute('aria-disabled', 'true');
  expect(await innerText(L(host.page, 'multiplayer.stageTitleChip'))).toBe('PRIVATE ROOM');
  await host.audit.layout({ scope: 'aside.game-aside' });
  await shotBoth(pair, 'lobby');

  // Copy code: the icon button's label swaps to "Code copied" and the hint to "Copied.", then both swap back.
  await host.context.grantPermissions(['clipboard-read', 'clipboard-write']).catch(() => {});
  const copyRec = await recordTexts(host.page, 'aside.game-aside button.fp-copy', async () => {
    const hintRec = await recordTexts(host.page, 'aside.game-aside .fp-code-row + p.fp-sub', async () => {
      await motion(host, 'Copy code', async () => {
        await L(host.page, 'multiplayer.copyBtn').click();
        await expect(L(host.page, 'multiplayer.copyBtn')).toHaveAttribute('aria-label', 'Code copied');
        await shotBoth(pair, 'copied');
      }, [ASIDE, 'aside.game-aside .fp-code-row', 'aside.game-aside .fp-code-row + p.fp-sub']);
      await expect(L(host.page, 'multiplayer.copyBtn')).toHaveAttribute('aria-label', 'Copy room code', { timeout: 4000 });
    }, { tail: 300 });
    if (!swapOk(host, 'room code hint', hintRec, ['Copied.', 'Send this code to a friend.'])) host.audit.violation('swap', { selector: '.fp-code-row + p.fp-sub', measured: `hint showed ${hintRec.texts.join(' → ')}`, expected: '"Copied." then back to the share hint' });
  });
  if (!swapOk(host, 'copy code button', copyRec, ['Copy room code', 'Code copied'])) host.audit.violation('swap', { selector: 'button.fp-copy', measured: `aria-label went ${copyRec.texts.join(' → ')}`, expected: '"Copy room code" → "Code copied" → back' });
  const clip = await host.page.evaluate(() => navigator.clipboard.readText().catch(() => null)).catch(() => null);
  if (clip !== null && clip !== code) host.audit.violation('copy', { selector: 'button.fp-copy', measured: `clipboard holds "${clip}"`, expected: `the room code ${code}` });
  if (clip === null) host.audit.metrics.push({ kind: 'note', label: 'clipboard not readable in this browser: copy checked by its label only', value: 0, unit: '', route: host.audit.route });

  // The joiner joins (MP-ROOM-02 owns the join flow's details).
  await joinRoom(joiner, code);
  await both(pair, (p) => expect(L(p.page, 'multiplayer.seats')).toHaveCount(2));
  expect(await innerText(L(joiner.page, 'multiplayer.guestSize'))).toBe('2 players');

  // Player stepper: + / − on the host; the joiner's "Room for" and both seat lists follow; bounds 2..4 (seated 2).
  const sizes = async () => ({ host: await innerText(L(host.page, 'multiplayer.lobbySizeNum')), joiner: await innerText(L(joiner.page, 'multiplayer.guestSize')) });
  for (const [btn, want] of [['sizePlus', 3], ['sizePlus', 4], ['sizeMinus', 3], ['sizeMinus', 2]]) {
    await motionBoth(pair, `stepper ${btn === 'sizePlus' ? '+' : '−'} → ${want}`, async () => {
      await L(host.page, `multiplayer.${btn}`).click();
      await expect(L(host.page, 'multiplayer.lobbySizeNum')).toHaveText(String(want), { timeout: 5000 });
      await expect(L(joiner.page, 'multiplayer.guestSize')).toHaveText(`${want} players`, { timeout: 5000 });
    }, [ASIDE, 'aside.game-aside .fp-seats', 'aside.game-aside .fp-meta']);
    await both(pair, (p) => expect(L(p.page, 'multiplayer.emptySeats')).toHaveCount(want - 2, { timeout: 5000 }));
    if (want === 4) {
      await expect(L(host.page, 'multiplayer.sizePlus')).toBeDisabled();
      expect(await innerText(L(joiner.page, 'multiplayer.shareHint'))).toBe('Share this code with up to 2 friends.');
      await shotBoth(pair, 'size-4');
    }
  }
  await expect(L(host.page, 'multiplayer.sizeMinus')).toBeDisabled();
  const s = await sizes();
  expect(s).toEqual({ host: '2', joiner: '2 players' });

  // Collapse / expand (below 1200px wide only): the card glides to the slim overview (code, 2/2) and back.
  let toggled = 0;
  for (const p of [host, joiner]) {
    if (!(await L(p.page, 'multiplayer.collapse').isVisible().catch(() => false))) continue;
    toggled++;
    await motion(p, 'Hide (collapse the room)', async () => {
      await L(p.page, 'multiplayer.collapse').click();
      await expect(L(p.page, 'multiplayer.mini')).toBeVisible();
    });
    expect(await innerText(L(p.page, 'multiplayer.mini').locator('.fp-mini-code'))).toBe(`#${code}`);
    expect(await innerText(L(p.page, 'multiplayer.mini').locator('.fp-mini-meta'))).toBe('2/2');
    await p.audit.layout({ scope: 'aside.game-aside' });
    await p.audit.shot('collapsed');
    await motion(p, 'Expand the room', async () => {
      await L(p.page, 'multiplayer.expand').click();
      await expect(L(p.page, 'multiplayer.lobbyCode')).toBeVisible();
    });
  }
  if (!toggled) throw new Error('neither player shows the collapse toggle (it should show below 1200px wide)');
  await layoutBoth(pair);
  await shotBoth(pair, 'lobby-both');
  await finishBoth(pair);
});

test('[MP-ROOM-02] joining: a wrong code shows an inline error without a jump; the right code joins ("Joining…"); both lists show both players with HOST and Online; the joiner waits for the host', async ({ mp }) => {
  test.setTimeout(240_000);
  const pair = await openPair(mp, SW.path);
  const { host, joiner } = pair;
  const code = await createRoom(host);

  // Enter code: the card swaps to the code entry; Join room stays disabled until six digits.
  await L(joiner.page, 'multiplayer.friendBtn').click();
  await motion(joiner, 'Enter code', async () => {
    await L(joiner.page, 'multiplayer.enterCodeBtn').click();
    await expect(L(joiner.page, 'multiplayer.codeInput')).toBeVisible();
  });
  await expect(L(joiner.page, 'multiplayer.joinBtn')).toBeDisabled();
  await joiner.page.keyboard.type(code.slice(0, 3));
  await expect(L(joiner.page, 'multiplayer.joinBtn')).toBeDisabled();
  await joiner.audit.layout({ scope: 'aside.game-aside' });
  await shotBoth(pair, 'code-entry');

  // A wrong code (another six digits): inline error under the boxes, the boxes marked, nothing jumps.
  const wrong = String((Number(code) + 1) % 900000 + 100000);
  await L(joiner.page, 'multiplayer.codeInput').fill(wrong);
  await motion(joiner, 'wrong code → inline error', async () => {
    await L(joiner.page, 'multiplayer.joinBtn').click();
    await expect(L(joiner.page, 'multiplayer.joinError')).toBeVisible({ timeout: 8000 });
  }, [ASIDE, 'aside.game-aside .fp-codein', 'aside.game-aside .fp-actions--single']);
  expect(await innerText(L(joiner.page, 'multiplayer.joinError'))).toBe('No room found for that code.');
  await expect(L(joiner.page, 'multiplayer.codeBox')).toHaveClass(/\bis-error\b/);
  expect(await mpState(joiner.page)).toBe('friend-menu');
  // The host's lobby is untouched by a failed join: still one seat taken, one waiting.
  expect(await mpState(host.page)).toBe('lobby');
  await expect(L(host.page, 'multiplayer.seats')).toHaveCount(1);
  await expect(L(host.page, 'multiplayer.emptySeats')).toHaveCount(1);
  await shotBoth(pair, 'wrong-code');
  // Editing the code clears the error.
  await L(joiner.page, 'multiplayer.codeInput').fill('');
  await expect(L(joiner.page, 'multiplayer.joinError')).toHaveCount(0, { timeout: 3000 });
  await expect(L(joiner.page, 'multiplayer.codeBox')).not.toHaveClass(/\bis-error\b/);

  // The right code: "Join room" → "Joining…" inside the same button, then the lobby on both sides.
  await L(joiner.page, 'multiplayer.codeInput').fill(code);
  const joinRec = await recordTexts(joiner.page, 'aside.game-aside .fp-actions--single button', async () => {
    await motionBoth(pair, 'Join room → both lobbies', async () => {
      await L(joiner.page, 'multiplayer.joinBtn').click();
      await waitState(joiner, 'lobby');
      await expect(L(host.page, 'multiplayer.seats')).toHaveCount(2);
    });
  });
  swapOk(joiner, 'Join room button', joinRec, ['Join room']);
  joiner.audit.metrics.push({ kind: 'note', label: 'Join room label sequence', value: joinRec.texts.join(' → '), unit: '', route: joiner.audit.route });

  // Both member lists: both names, "(you)" on one's own row, HOST on the host's, both Online.
  await both(pair, async (p) => {
    const rows = await p.page.evaluate(() => [...document.querySelectorAll('aside.game-aside .fp-seats .fp-seat:not(.is-empty)')].map((s) => ({
      name: (s.querySelector('.fp-seat-name')?.textContent || '').trim(), host: !!s.querySelector('.fp-host-chip'), dot: s.querySelector('.fp-dot')?.getAttribute('aria-label') || null,
    })));
    const me = p.label === 'host' ? host : joiner;
    const want = [
      { name: `${host.username}${me === host ? ' (you)' : ''}`, host: true, dot: 'Online' },
      { name: `${joiner.username}${me === joiner ? ' (you)' : ''}`, host: false, dot: 'Online' },
    ];
    if (JSON.stringify(rows) !== JSON.stringify(want)) p.audit.violation('members', { selector: '.fp-seats', measured: JSON.stringify(rows), expected: JSON.stringify(want) });
    expect(await innerText(L(p.page, 'multiplayer.metaGame'))).toBe(SW.name);
    expect(await innerText(L(p.page, 'multiplayer.shareHint'))).toBe('The room is full.');
    expect(await innerText(L(p.page, 'multiplayer.lobbyCode'))).toMatch(new RegExp(code.split('').join('\\s*')));
  });
  expect(await innerText(L(joiner.page, 'multiplayer.startReason'))).toBe('Waiting for the host to start');
  await expect(L(joiner.page, 'multiplayer.startBtn')).toHaveCount(0);
  await expect(L(joiner.page, 'multiplayer.leaveRoom')).toBeVisible();
  expect(await innerText(L(host.page, 'multiplayer.startReason'))).toBe('Ready to start');
  await expect(L(host.page, 'multiplayer.startBtn')).not.toHaveAttribute('aria-disabled', 'true');
  await layoutBoth(pair);
  await shotBoth(pair, 'lobby');
  await finishBoth(pair);
});

test('[MP-ROOM-03] game picker: the host changes the game, both see the new game (name swaps, chip glides); start takes both to playing; Leave room and Close room return both to idle with the right notice', async ({ mp }) => {
  test.setTimeout(300_000);
  const pair = await openPair(mp, SW.path);
  const { host, joiner } = pair;
  const target = gameById('name-logo');
  await createRoom(host).then((code) => joinRoom(joiner, code));

  // Change game → the picker modal: every online game, the current one marked "Playing now" and disabled.
  await L(host.page, 'multiplayer.lobbyChangeGame').click();
  await expect(L(host.page, 'multiplayer.pickerGrid')).toBeVisible();
  await host.page.waitForTimeout(400);
  const items = await host.page.evaluate(() => [...document.querySelectorAll('.modal-panel .gp-grid button.gp-item')].map((b) => ({ name: b.querySelector('.gp-name')?.textContent.trim(), note: b.querySelector('.gp-note')?.textContent.trim(), disabled: b.disabled })));
  const current = items.filter((i) => i.disabled);
  if (current.length !== 1 || current[0].name !== SW.name || current[0].note !== 'Playing now') host.audit.violation('picker', { selector: '.gp-item.is-current', measured: JSON.stringify(current), expected: `only "${SW.name}" disabled, noted "Playing now"` });
  if (items.some((i) => /who would win|coming soon/i.test(i.name))) host.audit.violation('picker', { selector: '.gp-grid', measured: items.map((i) => i.name).join(', '), expected: 'only games with an online mode (no Who Would Win, no coming-soon)' });
  await host.audit.layout({ scope: '.modal-panel' });
  await shotBoth(pair, 'picker');

  // Pick: the modal closes and both players' pages move to the new game's route (MultiplayerContext navigates every
  // member to the room's game), where the lobby shows the new game. The lobby is re-mounted by that route change, so
  // its game name is not a SwapText swap in place: recorded as a note, the route change is what is asserted.
  const nameRec = await recordTexts(joiner.page, 'aside.game-aside .fp-meta .fp-meta-game', async () => {
    await motionBoth(pair, `pick ${target.name}`, async () => {
      await L(host.page, 'multiplayer.pickerItems').filter({ has: host.page.locator('.gp-name', { hasText: target.name }) }).click();
      await expect(L(host.page, 'guest.modalBackdrop')).toHaveCount(0, { timeout: 5000 });
      await both(pair, (p) => expect(L(p.page, 'multiplayer.metaGame')).toHaveText(target.name, { timeout: 8000 }));
    }, [ASIDE, 'aside.game-aside .fp-meta', '.stage-col .stage-title']);
  });
  joiner.audit.metrics.push({ kind: 'note', label: 'lobby game name after the pick', value: `${nameRec.texts.join(' → ')} (${nameRec.remounts ? 're-mounted by the route change' : 'swapped in place'})`, unit: '', route: joiner.audit.route });
  await both(pair, async (p) => {
    await expect(p.page).toHaveURL(new RegExp(`${target.path}$`), { timeout: 10_000 });
    await expect(L(p.page, 'multiplayer.stageGameName')).toHaveText(target.name, { timeout: 10_000 });
    expect(await innerText(L(p.page, 'multiplayer.stageTitleChip'))).toBe('PRIVATE ROOM');
  });
  await layoutBoth(pair);
  await shotBoth(pair, 'new-game');

  // Start: both through the VS intro ("Private match") to the playing screen; the title chip glides to PRIVATE MATCH.
  const chipRec = await recordTexts(joiner.page, '.stage-col .stage-title .chip', async () => {
    await motionBoth(pair, 'Start game → intro → playing', async () => { await startRoom(pair); });
  });
  if (!chipRec.texts.includes('PRIVATE MATCH')) joiner.audit.violation('swap', { selector: '.stage-title .chip', measured: chipRec.texts.join(' → '), expected: 'PRIVATE ROOM → PRIVATE MATCH' });
  await both(pair, async (p) => {
    await expect(L(p.page, 'multiplayer.gameRoot')).toBeVisible();
    expect(await innerText(L(p.page, 'multiplayer.stageTitleChip'))).toBe('PRIVATE MATCH');
  });
  await expect(L(host.page, 'multiplayer.stopMatch')).toBeVisible();
  await expect(L(joiner.page, 'multiplayer.leaveRoomLink')).toBeVisible();
  await layoutBoth(pair);
  await shotBoth(pair, 'playing');

  // Leave room (the joiner, mid-match): the joiner is back on the idle card; a 2-player room cannot go on, so the
  // host is back in the lobby with "<joiner> left, so the match ended."
  await motionBoth(pair, 'joiner Leave room', async () => {
    await L(joiner.page, 'multiplayer.leaveRoomLink').click();
    await waitState(joiner, 'idle');
    await waitState(host, 'lobby');
  });
  const hostMsg = await waitNotice(host, /left, so the match ended/, { where: 'card' });
  if (hostMsg !== `${joiner.username} left, so the match ended.`) host.audit.violation('notice', { selector: '.mp-panel .mp-hint', measured: `"${hostMsg}"`, expected: `"${joiner.username} left, so the match ended."` });
  await expect(L(host.page, 'multiplayer.seats')).toHaveCount(1);
  await shotBoth(pair, 'after-leave');

  // The joiner joins again; the host closes the room: both out of the room, the joiner told "The host closed the room."
  // A player who opened "Play with a friend" on this page keeps that card open (its friend menu, usable again).
  const code = await lobbyCode(host);
  await joinRoom(joiner, code);
  await motionBoth(pair, 'host Close room', async () => {
    await L(host.page, 'multiplayer.closeRoom').click();
    await both(pair, (p) => waitState(p, ['idle', 'friend-menu']));
  });
  const joinerMsg = await waitNotice(joiner, /closed the room/, { where: 'card' });
  if (joinerMsg !== 'The host closed the room.') joiner.audit.violation('notice', { selector: '.mp-panel .mp-hint', measured: `"${joinerMsg}"`, expected: '"The host closed the room."' });
  await both(pair, async (p) => {
    await expect(L(p.page, 'multiplayer.om')).toHaveCount(0);
    if ((await mpState(p.page)) === 'idle') {
      expect((await L(p.page, 'multiplayer.play1v1').innerText()).trim()).toBe('Play 1v1');
      await expect(L(p.page, 'multiplayer.play1v1')).not.toHaveAttribute('aria-disabled', 'true');
    } else {
      await expect(L(p.page, 'multiplayer.generateBtn')).toBeEnabled();
    }
  });
  await shotBoth(pair, 'closed');
  await finishBoth(pair);
});
