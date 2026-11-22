// Selftest for MP-RES-01's opponent-chip rule (lib/mp.mjs recordClasses + resumedChip) on a page.setContent fixture,
// no app server: a `.om-chip` whose class flips `is-playing` → `is-offline` → `is-playing` while its label (a
// mode=wait SwapText in the app) never repaints is recorded as that state sequence and passes; a sub-frame offline
// flash (set and unset inside one task) is still recorded; a chip that never goes offline, or stays offline, fails.
import { test, expect } from '@playwright/test';
import { recordClasses, recordTexts, resumedChip } from '../../lib/mp.mjs';

const CHIP = '.stage-inner .om-stage .om-playbar .om-chip';
const PAGE = `<!doctype html><html><body>
<div class="stage-inner"><div class="om-stage om-stage--play"><div class="om-playbar">
  <div class="om-chip is-playing"><span class="om-chip-meta"><span class="om-chip-name">testuser2</span>
    <span class="om-chip-state"><span class="om-dots"><i></i><i></i><i></i></span><span class="lbl">Playing</span></span></span></div>
</div></div></div>
<script>
  const chip = () => document.querySelector('.om-chip');
  // Like OnlineMatch's OpponentChip: the class follows the state at once; the label (mode=wait SwapText) only swaps
  // after its exit animation, so with labelDelay longer than the offline window it never shows "Reconnecting".
  window.flip = (offlineMs, labelDelay = 10_000) => {
    chip().className = 'om-chip is-offline';
    const t = setTimeout(() => { chip().querySelector('.lbl').textContent = 'Reconnecting'; }, labelDelay);
    setTimeout(() => { clearTimeout(t); chip().className = 'om-chip is-playing'; }, offlineMs);
  };
  window.flash = () => { chip().className = 'om-chip is-offline'; chip().className = 'om-chip is-playing'; };
  window.stuck = () => { chip().className = 'om-chip is-offline'; };
</script></body></html>`;

test('[ST-MP-CHIP] MP-RES-01 opponent chip: class is-offline then is-playing passes even when the label never repaints; a sub-frame flash is seen; never-offline and stuck-offline fail', async ({ page }) => {
  test.setTimeout(60_000);
  const fresh = () => page.setContent(PAGE);

  // Pure rule.
  expect(resumedChip(['is-playing', 'is-offline', 'is-playing'])).toBe(true);
  expect(resumedChip(['is-offline', 'is-playing'])).toBe(true);
  expect(resumedChip(['is-playing'])).toBe(false);
  expect(resumedChip(['is-playing', 'is-offline'])).toBe(false);
  expect(resumedChip(['is-playing', 'is-finished', 'is-offline'])).toBe(false);
  expect(resumedChip([])).toBe(false);
  expect(resumedChip(undefined)).toBe(false);

  // (a) 600 ms offline window, label never updated: the old text check (needs "Reconnecting") failed here; the class
  // check passes.
  await fresh();
  let labels = null;
  const a = await recordClasses(page, CHIP, async () => {
    labels = await recordTexts(page, `${CHIP} .om-chip-state`, async () => {
      await page.evaluate(() => window.flip(600));
      await page.waitForTimeout(800);
    }, { tail: 100 });
  }, { tail: 100 });
  expect(a.states).toEqual(['is-playing', 'is-offline', 'is-playing']);
  expect(a.classes).toEqual(['om-chip is-playing', 'om-chip is-offline']);
  expect(a.remounts).toBe(0);
  expect(resumedChip(a.states)).toBe(true);
  expect(labels.texts).not.toContain('Reconnecting');

  // (b) offline for less than one frame (set and unset inside one task): only the MutationObserver can see it.
  await fresh();
  const b = await recordClasses(page, CHIP, async () => {
    await page.evaluate(() => window.flash());
    await page.waitForTimeout(200);
  }, { tail: 100 });
  expect(b.states).toEqual(['is-playing', 'is-offline', 'is-playing']);
  expect(resumedChip(b.states)).toBe(true);

  // (c) the chip never reflects the disconnect: the spec's rule flags it.
  await fresh();
  const c = await recordClasses(page, CHIP, async () => { await page.waitForTimeout(400); }, { tail: 100 });
  expect(c.states).toEqual(['is-playing']);
  expect(resumedChip(c.states)).toBe(false);

  // (d) the chip goes offline and never comes back: flagged too.
  await fresh();
  const d = await recordClasses(page, CHIP, async () => {
    await page.evaluate(() => window.stuck());
    await page.waitForTimeout(400);
  }, { tail: 100 });
  expect(d.states).toEqual(['is-playing', 'is-offline']);
  expect(resumedChip(d.states)).toBe(false);

  // A remount (the chip replaced by a new element) is counted and its class still recorded.
  await fresh();
  const e = await recordClasses(page, CHIP, async () => {
    await page.evaluate(() => {
      const old = document.querySelector('.om-chip');
      const n = old.cloneNode(true);
      n.className = 'om-chip is-offline';
      old.replaceWith(n);
    });
    await page.waitForTimeout(100);
    await page.evaluate(() => { document.querySelector('.om-chip').className = 'om-chip is-playing'; });
    await page.waitForTimeout(100);
  }, { tail: 100 });
  expect(e.remounts).toBe(1);
  expect(e.states).toEqual(['is-playing', 'is-offline', 'is-playing']);
});
