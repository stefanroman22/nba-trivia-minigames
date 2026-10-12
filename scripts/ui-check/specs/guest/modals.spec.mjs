// Guest modals: the five public overlays obey the single-host contract (UI_SHELL acceptance checks 2-3).
import { test, expect, L } from '../../lib/fixtures.mjs';
import { drawerMode, openDrawer, openLogin, overlayState, recordFrames, fadeSummary, playableGames, LOCAL_LOAD } from '../../lib/guest.mjs';

const Z = { fab: 35, nav: 40, modal: 60, drawer: 70 };

test('[G-MODAL-01] login, feedback, leaderboard, instructions and multiplayer-info modals follow the overlay contract', async ({ page, audit, vp }) => {
  test.setTimeout(240_000);
  const game = playableGames()[0];

  /** The five modals: where to open them and what their title says. */
  const modals = [
    { kind: 'login', title: 'Welcome back', route: '/', ready: '#games-grid .gtile', open: () => openLogin(page, vp) },
    { kind: 'feedback', title: 'Share feedback', route: '/', ready: '#games-grid .gtile', open: async () => { const t = L(page, 'guest.feedbackFab'); await t.click(); return t; } },
    { kind: 'leaderboard', title: 'Global Top 100', route: '/', ready: '#games-grid .gtile', open: async () => { const t = L(page, 'guest.leaderboardViewAll'); await t.scrollIntoViewIfNeeded(); await t.click(); return t; } },
    { kind: 'instructions', title: 'How to play', route: game.path, ready: '.stage-col .idle', open: async () => { const t = L(page, 'guest.gameInfoBtn'); await t.click(); return t; } },
    { kind: 'multiplayer-info', title: 'How multiplayer works', route: game.path, ready: '.stage-col .idle', open: async () => { const t = L(page, 'guest.mpInfoBtn'); await t.click(); return t; }, titleRe: /multiplayer/i },
  ];

  let zChecked = false;
  for (const m of modals) {
    await test.step(m.kind, async () => {
      if (!page.url().endsWith(m.route)) await audit.goto(m.route, { waitFor: m.ready });

      // Pass 1 closes with Escape, pass 2 with the X button.
      for (const closeWith of ['escape', 'button']) {
        const before = await overlayState(page);
        expect(before.backdrops, 'no overlay before opening').toBe(0);

        let trigger;
        const frames = await recordFrames(page, '.modal-panel', async () => {
          trigger = await m.open();
          await expect(L(page, 'guest.modalPanel')).toBeVisible();
        }, { tail: 600 });
        const enter = fadeSummary(frames);
        if (enter.intermediate < 1) {
          audit.violation('snap', { selector: '.modal-panel', measured: `entrance: no part-way frame among ${enter.frames} sampled (first frame opacity ${enter.first})`, expected: 'an animated entrance (fade/slide)' });
        }

        const open = await overlayState(page);
        if (open.backdrops !== 1) audit.violation('modal-host', { selector: '.modal-backdrop', measured: `${open.backdrops} backdrops`, expected: 'exactly 1 (UI-8)' });
        if (open.panelsInBackdrop !== 1 || open.panels !== 1) audit.violation('modal-host', { selector: '.modal-panel', measured: `${open.panelsInBackdrop} panel(s) inside the backdrop, ${open.panels} in the page`, expected: 'one .modal-panel inside the .modal-backdrop' });
        if (open.bodyOverflow !== 'hidden') audit.violation('scroll-lock', { selector: 'body', measured: `overflow ${open.bodyOverflow} while the modal is open`, expected: 'hidden' });
        if (m.titleRe) await expect(L(page, 'guest.modalTitle')).toHaveText(m.titleRe);
        else await expect(L(page, 'guest.modalTitle')).toHaveText(m.title);
        const focusInside = await page.evaluate(() => !!document.activeElement && !!document.activeElement.closest('.modal-panel'));
        if (!focusInside) audit.violation('focus', { selector: '.modal-panel', measured: `focus on ${open.active}`, expected: 'focus moves into the modal on open' });

        if (closeWith === 'escape') {
          if (!zChecked && m.route === '/') {
            zChecked = true;
            if (open.z.fab !== Z.fab || open.z.nav !== Z.nav || open.z.modal !== Z.modal) {
              audit.violation('z-index', { selector: '.feedback-fab / .nav3 / .modal-backdrop', measured: `fab ${open.z.fab}, nav ${open.z.nav}, modal ${open.z.modal}`, expected: `fab ${Z.fab}, nav ${Z.nav}, modal ${Z.modal} (UI-12)` });
            }
          }
          await audit.layout({ scope: '.modal-panel' });
          await audit.shot(`open-${m.kind}`);
        }

        const exitFrames = await recordFrames(page, '.modal-panel', async () => {
          if (closeWith === 'escape') await page.keyboard.press('Escape');
          else await L(page, 'guest.modalClose').click();
          await expect(L(page, 'guest.modalBackdrop')).toHaveCount(0);
        }, { tail: 600 });
        const exit = fadeSummary(exitFrames);
        if (exit.intermediate < 1 && closeWith === 'escape') {
          audit.violation('snap', { selector: '.modal-panel', measured: `exit: no part-way frame among ${exit.frames} sampled before removal`, expected: 'an animated exit' });
        }

        const after = await overlayState(page);
        if (after.backdrops !== 0) audit.violation('modal-host', { selector: '.modal-backdrop', measured: `${after.backdrops} left after ${closeWith}`, expected: '0' });
        if (after.bodyOverflow === 'hidden') audit.violation('scroll-lock', { selector: 'body', measured: 'overflow hidden after the modal closed', expected: 'released' });
        if (!(await trigger.evaluate((el) => el === document.activeElement))) {
          audit.violation('focus', { selector: await trigger.evaluate((el) => el.className || el.tagName), measured: `focus on ${after.active} after ${closeWith}`, expected: 'focus returns to the trigger' });
        }
      }
    });
  }

  if (drawerMode(vp)) {
    await test.step('drawer z-index and focus trap', async () => {
      await audit.goto('/', { waitFor: '#games-grid .gtile' });
      await openDrawer(page);
      const s = await overlayState(page);
      if (s.z.drawer !== Z.drawer) audit.violation('z-index', { selector: '.drawer-panel', measured: `${s.z.drawer}`, expected: `${Z.drawer} (UI-12)` });
      await audit.shot('open-drawer');
      await L(page, 'common.drawerClose').click();
    });
  }
  await audit.console({ allow: LOCAL_LOAD });
  await audit.done();
});
