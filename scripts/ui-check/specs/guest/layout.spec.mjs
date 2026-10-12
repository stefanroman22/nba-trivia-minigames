// Guest layout: every public route + every visible game's idle screen, and scrolling.
import { test, expect, L } from '../../lib/fixtures.mjs';
import { playableGames, gameById, slugOf, LOCAL_LOAD } from '../../lib/guest.mjs';

// The 404 route answers HTTP 404 on purpose: Chrome logs it as a console error and the detector sees the response.
const EXPECTED_404 = [/^404 GET \S+\/definitely-not-a-route$/, /status of 404/];

const ROUTES = [
  { path: '/', ready: '#games-grid .gtile', shell: true },
  { path: '/privacy', ready: 'main article h1' },
  { path: '/terms', ready: 'main article h1' },
  { path: '/coming-soon', ready: 'h1:text-is("404")' },
  { path: '/profile', ready: 'section.ps-empty', shell: true },
  { path: '/admin', ready: '.admin-placeholder', shell: true },
  { path: '/definitely-not-a-route', ready: 'h1:text-is("404")' },
  ...playableGames().map((g) => ({ path: g.path, ready: '.stage-col .idle', shell: true, game: g })),
];

test('[G-LAYOUT-01] every public route and each game idle screen lays out cleanly', async ({ page, audit }) => {
  test.setTimeout(300_000);
  for (const r of ROUTES) {
    await test.step(r.path, async () => {
      await audit.goto(r.path, { waitFor: r.ready });
      if (r.shell) {
        // UI_SHELL acceptance check 1: the shell and main.page exist on real pages.
        const shell = await page.evaluate(() => ({ shell: !!document.querySelector('.app-shell'), main: !!document.querySelector('main.page') }));
        if (!shell.shell || !shell.main) audit.violation('shell-missing', { selector: '.app-shell / main.page', measured: JSON.stringify(shell), expected: 'both present', route: r.path });
      }
      if (r.game) await expect(L(page, 'guest.gameTitle')).toHaveText(r.game.name);
      await audit.layout();
      await audit.shot(`idle-${slugOf(r.path)}`);
      await audit.console({ allow: r.path === '/definitely-not-a-route' ? [...LOCAL_LOAD, ...EXPECTED_404] : LOCAL_LOAD });
    });
  }
  await audit.done();
});

/** Scroll to `y` without the page's smooth scrolling, then report what the shell does. */
const scrollTo = (page, y) => page.evaluate((y) => {
  window.scrollTo({ top: y, behavior: 'instant' });
  const nav = document.querySelector('nav.nav3');
  const foot = document.querySelector('footer.site-footer');
  const de = document.documentElement;
  return {
    y: window.scrollY, max: de.scrollHeight - window.innerHeight, vh: window.innerHeight,
    navTop: nav ? nav.getBoundingClientRect().top : null,
    footTop: foot ? foot.getBoundingClientRect().top : null, footBottom: foot ? foot.getBoundingClientRect().bottom : null,
    scrollWidth: de.scrollWidth, clientWidth: de.clientWidth,
  };
}, y);

test('[G-LAYOUT-02] pages scroll to the footer, the nav stays at the top, nothing is wider than the viewport', async ({ page, audit }) => {
  test.setTimeout(120_000);
  const routes = [{ path: '/', ready: '#games-grid .gtile' }, { path: '/privacy', ready: 'main article h1' }, { path: gameById('series-winner').path, ready: '.stage-col .idle' }];
  for (const r of routes) {
    await test.step(r.path, async () => {
      await audit.goto(r.path, { waitFor: r.ready });
      const first = await scrollTo(page, 0);
      expect(first.max, `${r.path} is taller than the viewport`).toBeGreaterThan(0);
      const stepPx = Math.max(200, Math.floor(first.vh * 0.8));
      const positions = [];
      for (let y = stepPx; y < first.max; y += stepPx) positions.push(y);
      positions.push(first.max);
      for (const y of positions) {
        const s = await scrollTo(page, y);
        await page.waitForTimeout(60);
        if (s.navTop === null || Math.abs(s.navTop) > 0.5) {
          audit.violation('sticky-nav', { selector: 'nav.nav3', measured: `top ${s.navTop === null ? 'missing' : Math.round(s.navTop) + 'px'} at scrollY ${Math.round(s.y)}`, expected: 'top 0 while scrolling', route: r.path });
          break;
        }
        if (s.scrollWidth > s.clientWidth + 1) {
          await audit.layout({ rules: ['overflow-x'] });
          break;
        }
      }
      // Bottom: the footer is on screen and the page really reached its end.
      const end = await scrollTo(page, 1e6);
      if (end.footTop === null || end.footBottom > end.vh + 1 || end.footTop >= end.vh) {
        audit.violation('footer-reach', { selector: 'footer.site-footer', measured: `top ${end.footTop === null ? 'missing' : Math.round(end.footTop)} bottom ${Math.round(end.footBottom)}, viewport ${end.vh}`, expected: 'footer fully visible at the bottom', route: r.path });
      }
      await audit.layout({ rules: ['overflow-x', 'offscreen'] });
      await audit.shot(`bottom-${slugOf(r.path)}`);
      // Sideways: the page does not scroll horizontally.
      const side = await page.evaluate(() => { window.scrollTo({ left: 300, top: window.scrollY, behavior: 'instant' }); return window.scrollX; });
      if (side > 0) audit.violation('overflow-x', { selector: 'html', measured: `scrolled sideways to x=${side}`, expected: 'no horizontal scroll', route: r.path });
      await scrollTo(page, 0);
    });
  }
  await audit.console({ allow: LOCAL_LOAD });
  await audit.done();
});
