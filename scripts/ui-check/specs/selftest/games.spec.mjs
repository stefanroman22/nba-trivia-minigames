// Selftest for the games driver paths no real adapter exercises yet (Tasks 6/7 rely on them): the `timeout` and
// `giveup` scenarios through the real runScenario, and the in-page recorders (feedback latency, snap sampler) while
// page.clock is installed. Fixture: fixtures/detectors/game-clock.html (the shell's class names, a 30 s countdown,
// Give up, an in-place end). No app server.
//
// page.clock.install() fakes Date, timers, requestAnimationFrame and performance.now, but its time keeps flowing at
// real speed until a test jumps it (clock.runFor): so rAF-driven samplers keep running without driving frames by
// hand, and the timeout adapter ends the 30 s countdown with one runFor instead of waiting.
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { test, expect, createAudit } from '../../lib/fixtures.mjs';
import { capture } from '../../lib/capture.mjs';
import { fiberReader } from '../../lib/fiber.mjs';
import { contextOptions } from '../../lib/viewports.mjs';
import { newCtx, playTurns, runScenario, startGame } from '../../lib/game-driver.mjs';
import { shellIsOver } from '../../games/helpers.mjs';

const PAGE = pathToFileURL(path.join(fileURLToPath(new URL('../../fixtures/detectors/', import.meta.url)), 'game-clock.html')).href;
const TIMER_MS = 30_000;
const clockRun = {};

/** A fake adapter for the fixture: one answer ("Guess A", feedback "It was B"), Give up, a 30 s clock. */
const adapter = {
  id: 'fixture-clock',
  path: PAGE,
  online: false,
  lives: null,
  timerMs: TIMER_MS,
  pointsPerCorrect: 10,
  scenarios: { perfect: 'fixture', wrong: 'fixture', partial: 'fixture', timeout: true, giveup: true, 'daily-lock': 'fixture' },
  async answer(page) {
    await page.click('#guess');
    await page.waitForFunction(() => !document.querySelector('.feedback-slot > *'), null, { timeout: 5000 });
    return { over: await shellIsOver(page), truth: 'B' };
  },
  isOver: shellIsOver,
  async giveUp(page) { await page.click('#giveup'); },
  async timeout(page) {
    clockRun.overBefore = await shellIsOver(page);
    clockRun.shownBefore = await page.textContent('#clock');
    await page.clock.runFor(TIMER_MS + 1000);
    clockRun.overAfter = await shellIsOver(page);
  },
  async endReveal(page) {
    const t = ((await page.textContent('#prompt')) || '').trim();
    return t === 'Answer: B' ? [] : [`prompt shows "${t}"`];
  },
};

/** A second page with its own audit (distinct shot names), capture and fiber. */
async function extraPage(context, testInfo, vp, label) {
  const page = await context.newPage();
  const audit = await createAudit(page, testInfo, { vp, label });
  return { page, audit, cap: capture(page), fiber: fiberReader(page), vp };
}

test('[ST-GAMES] game driver: timeout and give-up through runScenario; feedback and snap recorders under page.clock', async ({ page, audit, cap, fiber, vp, browser }, testInfo) => {
  test.setTimeout(180_000);
  const opened = [];

  await test.step('timeout: page.clock installed by the driver, the countdown run out with clock.runFor', async () => {
    const r = await runScenario({ page, audit, cap, fiber, vp }, adapter, 'timeout', { full: true, logSession: false });
    expect(r.over).toBe(true);
    expect(r.turns).toEqual([]);
    // Still running with time left right before the jump, over right after it: the clock jump ended the game.
    expect(clockRun.overBefore).toBe(false);
    expect(Number(clockRun.shownBefore)).toBeGreaterThan(5);
    expect(clockRun.overAfter).toBe(true);
    expect(audit.violations).toEqual([]); // end checks, Play again → Close game cross-fade: all clean
    await expect(page.locator('#play')).toBeVisible();
  });

  await test.step('giveup: one wrong answer (feedback copy and colour checked), then Give up', async () => {
    const context = await browser.newContext(contextOptions(vp.id));
    const fx = await extraPage(context, testInfo, vp, 'giveup');
    opened.push({ context, audit: fx.audit });
    const r = await runScenario(fx, adapter, 'giveup', { full: true, logSession: false });
    expect(r.over).toBe(true);
    expect(r.turns).toHaveLength(1);
    expect(r.turns[0].feedback.text).toBe('It was B');
    expect(fx.audit.violations).toEqual([]);
  });

  await test.step('recorders keep working while page.clock is installed', async () => {
    // Same context as the timeout step: its clock is installed. Prove it: a 60 s jump moves performance.now 60 s.
    const fx = await extraPage(page.context(), testInfo, vp, 'clock');
    opened.push({ context: null, audit: fx.audit });
    await fx.audit.goto(PAGE, { waitFor: '.stage-col .idle' });
    const before = await fx.page.evaluate(() => performance.now());
    await fx.page.clock.runFor(60_000);
    expect(await fx.page.evaluate(() => performance.now()) - before).toBeGreaterThanOrEqual(60_000);

    await startGame(fx.page);
    const ctx = newCtx(fx, 'clock');
    let turns = [];
    const added = await fx.audit.motion(async () => {
      ({ turns } = await playTurns(fx.page, adapter, ctx, { plan: () => false, stopAfter: 1 }));
      await fx.page.evaluate(() => window.jump());
    }, { watch: ['#jump-box'], settleMs: 400 });
    expect(turns[0].feedback.at).not.toBeNull();
    expect(turns[0].feedback.text).toBe('It was B');
    expect(turns[0].feedback.latency).toBeGreaterThanOrEqual(0);
    expect(turns[0].feedback.latency).toBeLessThan(1000);
    const snaps = added.filter((v) => v.rule === 'snap');
    expect(snaps.length).toBeGreaterThan(0);
    expect(snaps[0].selector).toContain('jump-box');
    fx.audit.violations.length = 0; // the snap was the point
  });

  for (const o of opened) {
    await o.audit.finalize();
    if (o.context) await o.context.close();
  }
  await audit.done();
});
