// Guest motion: route fades, segmented-tab thumb, reduced motion.
import { test, expect, L } from '../../lib/fixtures.mjs';
import { openLogin, recordFrames, valleys, playableGames, LOCAL_LOAD } from '../../lib/guest.mjs';

test('[G-MOTION-01] route transitions fade once and settle at opacity 1', async ({ page, audit }) => {
  test.setTimeout(150_000);
  const games = playableGames();

  await test.step('hard load: no entrance animation on first paint (UI-14)', async () => {
    await page.addInitScript(() => {
      window.__first = [];
      const tick = () => {
        const el = document.querySelector('#root > div');
        if (el) window.__first.push(+getComputedStyle(el).opacity);
        if (performance.now() < 6000) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
    await audit.goto(games[4].path, { waitFor: '.stage-col .idle' });
    await page.waitForTimeout(1200);
    const first = await page.evaluate(() => window.__first);
    expect(first.length, "frames sampled during the first paint").toBeGreaterThan(0);
    const min = Math.min(...first);
    if (min < 0.99) audit.violation('double-transition', { selector: '#root > div', measured: `opacity ${min.toFixed(2)} during the first paint of ${games[4].path}`, expected: '1 (no entrance animation on a hard load)' });
  });

  /** Click-driven navigations. */
  const hops = [
    { from: '/', label: 'home -> game (card)', go: async () => { await L(page, 'guest.gameTiles').nth(1).scrollIntoViewIfNeeded(); await L(page, 'guest.gameTiles').nth(1).click(); }, url: games[1].path },
    { from: games[0].path, label: 'game -> home (brand)', go: () => L(page, 'common.navBrand').click(), url: '/' },
    { from: '/', label: 'home -> game (Play today)', go: () => L(page, 'guest.heroPlayToday').click(), url: null },
  ];
  const fadeProblems = []; // one violation per kind at the end
  for (const h of hops) {
    await test.step(h.label, async () => {
      await audit.goto(h.from, { waitFor: h.from === '/' ? '#games-grid .gtile' : '.stage-col .idle' });
      const frames = await recordFrames(page, '#root > div', async () => {
        await audit.motion(async () => {
          await h.go();
          if (h.url) await expect(page).toHaveURL(new RegExp(h.url === '/' ? '/$' : `${h.url}$`));
          else await expect(page).not.toHaveURL(/\/$/);
          await page.waitForTimeout(700);
        }, { settleMs: 200 });
      }, { tail: 900 });
      const ops = frames.filter((f) => f.present).map((f) => f.o);
      const route = new URL(page.url()).pathname;
      if (Math.min(...ops) > 0.9) fadeProblems.push({ rule: 'no-fade', h, route, measured: `opacity never below ${Math.min(...ops).toFixed(2)}` });
      if (ops[ops.length - 1] < 0.99) fadeProblems.push({ rule: 'fade-stuck', h, route, measured: `opacity ${ops[ops.length - 1].toFixed(2)} at the end` });
      if (valleys(ops) > 1) fadeProblems.push({ rule: 'double-transition', h, route, measured: `${valleys(ops)} fade dips (the wrapper's opacity reverts after an animation ends)` });
    });
  }
  for (const rule of ['no-fade', 'fade-stuck', 'double-transition']) {
    const hits = fadeProblems.filter((p) => p.rule === rule);
    if (hits.length) {
      audit.violation(rule, { selector: '#root > div', measured: hits[0].measured, expected: rule === 'double-transition' ? '1: out once, in once (UI-14)' : rule === 'fade-stuck' ? '1' : 'the page fades during the route change', route: hits[0].route, note: `${hits.length} of ${hops.length} transitions: ${hits.map((p) => p.h.label).join('; ')}` });
    }
  }
  await audit.console({ allow: LOCAL_LOAD });
  await audit.done();
});

test('[G-MOTION-02] segmented tabs: the thumb slides and the panel height glides', async ({ page, audit, vp }) => {
  test.setTimeout(90_000);
  // The leaderboard's Global/Friends tabs only exist for a signed-in player (account suite). The guest
  // has the same SegmentedTabs in the login modal: Log in <-> Sign up.
  await audit.goto('/', { waitFor: '#games-grid .gtile' });
  await openLogin(page, vp);
  await expect(L(page, 'guest.segThumb')).toHaveCount(1);
  await page.waitForTimeout(500);

  for (const [label, tab] of [['Sign up', 'guest.authTabSignup'], ['Log in', 'guest.authTabLogin']]) {
    const frames = await recordFrames(page, '.modal-panel .seg-thumb', async () => {
      await audit.motion(async () => { await L(page, tab).click(); }, { watch: ['.modal-panel', '.modal-panel .auth-stack', '.modal-panel form'], settleMs: 700 });
    }, { tail: 600 });
    const xs = frames.filter((f) => f.present).map((f) => f.x);
    // A slide leaves frames strictly between the start and end x; a jump leaves none.
    const from = xs[0], to = xs[xs.length - 1];
    const between = xs.filter((x) => x > Math.min(from, to) + 2 && x < Math.max(from, to) - 2).length;
    if (Math.abs(to - from) < 4) audit.violation('snap', { selector: '.seg-thumb', measured: `${label}: thumb moved ${Math.round(to - from)}px`, expected: 'the thumb moves to the chosen tab' });
    else if (between < 1) audit.violation('snap', { selector: '.seg-thumb', measured: `${label}: thumb jumped ${Math.round(from)} -> ${Math.round(to)}px, no frame in between`, expected: 'a slide' });
    await expect(L(page, tab)).toHaveAttribute('aria-selected', 'true');
    await expect(L(page, 'guest.segThumb')).toHaveCount(1);
    await audit.shot(`tabs-${label.replace(/\W+/g, '').toLowerCase()}`);
  }
  await audit.layout({ scope: '.modal-panel' });
  await audit.console({ allow: LOCAL_LOAD });
  await audit.done();
});

test('[G-MOTION-03] reduced motion: the hero grain stops, no hydration warnings', async ({ page, audit }) => {
  test.setTimeout(90_000);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const messages = [];
  page.on('console', (m) => { if (['warning', 'error'].includes(m.type())) messages.push(m.text()); });
  page.on('pageerror', (e) => messages.push(String((e && e.message) || e)));
  const HYDRATION = /hydrat|did not match|server rendered|Minified React error #(418|423|425)/i;

  for (const route of ['/', playableGames()[0].path]) {
    await test.step(route, async () => {
      await audit.goto(route, { waitFor: route === '/' ? '#games-grid .gtile' : '.stage-col .idle' });
      if (route === '/') {
        const grain = await L(page, 'guest.heroGrain').evaluate((el) => getComputedStyle(el).animationName);
        if (grain !== 'none') audit.violation('reduced-motion', { selector: '.hero-grain', measured: `animation-name ${grain}`, expected: 'none (UI-20)' });
        // Hover must not lift the primary button.
        const btn = L(page, 'guest.heroPlayToday');
        const rest = await btn.evaluate((el) => getComputedStyle(el).transform);
        await btn.hover();
        await page.waitForTimeout(400);
        const hover = await btn.evaluate((el) => getComputedStyle(el).transform);
        if (hover !== rest) audit.violation('reduced-motion', { selector: 'button (hero Play today)', measured: `transform ${rest} -> ${hover} on hover`, expected: 'unchanged (UI-20)' });
      }
    });
  }
  const bad = messages.filter((t) => HYDRATION.test(t));
  if (bad.length) audit.violation('hydration', { selector: 'console', measured: bad[0].slice(0, 150), expected: 'no hydration warnings under reduced motion', note: bad.length > 1 ? `x${bad.length}` : undefined });
  await audit.console({ allow: LOCAL_LOAD });
  await audit.done();
});
