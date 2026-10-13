// Shared fixtures: `vp` (the project's VIEWPORTS entry), `audit` (detectors + evidence), `session`
// (the persona's minted login, seeded into `context`), `cap` (network capture), `fiber` (React
// internals) and `mp` (two logged-in players). Options carried in a project's `use`:
// { vpId, persona, suite, mpPair }. Extra audits (other pages) come from createAudit().
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test as base, expect } from '@playwright/test';
import { VIEWPORTS, MP_PAIRS, contextOptions } from './viewports.mjs';
import { REPO_ROOT } from './run-id.mjs';
import { inPage, layoutScan, snapStart, snapCollect, windowStats, perfSnapshot } from './detect.mjs';
import { PROBE_SCRIPT } from './probes.mjs';
import { shotPath, viewportShot, rectShot, locatorShot } from './evidence.mjs';
import { mintTokens, soloUsername } from './accounts.mjs';
import { capture } from './capture.mjs';
import { fiberReader } from './fiber.mjs';

export { expect };
export { L } from './pagemap.mjs';

const AXE_PATH = path.join(REPO_ROOT, 'node_modules', 'axe-core', 'axe.min.js');
let axeSource = null;
const axe = () => (axeSource ??= readFileSync(AXE_PATH, 'utf8'));

const AXE_TAGS = ['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'];
const PERF_BUDGETS = { ttfb: 800, lcp: 2500, cls: 0.1 };
const AUTO_CROPS_PER_CALL = 3;
const AUTO_CROPS_PER_AUDIT = 12;
/** Soft rules: recorded as audit.warnings (same shape as violations), never make done() throw. */
export const SOFT_RULES = new Set(['tap-target-touch', 'not-hydrated', 'skip-explained']);

/** `[G-HOME] home layout` → 'G-HOME'. */
export function checkIdOf(title) {
  const m = /\[([A-Za-z][\w.-]*)\]/.exec(title || '');
  return m ? m[1] : null;
}

/** Route label for a URL: pathname for http(s), file name for file:// fixtures. */
export function routeOf(url) {
  try {
    const u = new URL(url);
    if (u.protocol === 'file:') return path.posix.basename(u.pathname);
    return u.pathname || '/';
  } catch { return String(url || ''); }
}

const trunc = (s, n = 160) => { s = String(s).replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n) + '…' : s; };
const ownHost = (pageUrl, url) => {
  try {
    const a = new URL(pageUrl), b = new URL(url);
    if (!/^https?:$/.test(b.protocol)) return false;
    return b.hostname === a.hostname || b.hostname === 'localhost';
  } catch { return false; }
};
const pathOf = (url) => { try { const u = new URL(url); return u.pathname + u.search; } catch { return url; } };

// Shot paths taken so far in each test (shared by every audit of that test) + the auto-crop counter.
const SHOTS_BY_TEST = new WeakMap();
const testShots = (testInfo) => {
  let s = SHOTS_BY_TEST.get(testInfo);
  if (!s) SHOTS_BY_TEST.set(testInfo, (s = { paths: new Set(), crops: 0 }));
  return s;
};

/**
 * Build an audit for any page (the default `page` fixture or a page from another context).
 * opts: { project = testInfo.project.name, vp = VIEWPORTS entry | null, label = null }
 * `label` tells two audits of one test apart (shot names, attachment) — e.g. 'host' / 'joiner'.
 * Without a label the shot names use vp.id, so two audits at different viewports never share a file;
 * the name is left out when the project already names that viewport (`guest@phone-390`).
 * Two audits that would still write the same shot path in one test throw (pass distinct labels).
 */
export async function createAudit(page, testInfo, { project = testInfo.project.name, vp = null, label = null } = {}) {
  await page.addInitScript(PROBE_SCRIPT);
  const checkId = checkIdOf(testInfo.title) || 'NOID';
  const fileLabel = label || (vp ? vp.id : null);
  const fileProject = fileLabel && !project.endsWith(`@${fileLabel}`) ? `${project}-${fileLabel}` : project;
  const claimed = testShots(testInfo);
  const claimShot = (name) => {
    const p = shotPath(checkId, fileProject, name);
    if (claimed.paths.has(p.rel)) {
      throw new Error(`ui-check: shot ${p.rel} already taken in this test (checkId ${checkId}, project ${project}, label ${fileLabel}, name ${name}) — use a distinct shot name or audit label`);
    }
    claimed.paths.add(p.rel);
    return p;
  };
  const violations = [], warnings = [], metrics = [], shots = [], routes = [];
  const logs = { console: [], pageErrors: [], responses: [], slowApi: [] };
  let crops = 0, attached = false;

  const route = () => routeOf(page.url());
  const noteRoute = (r) => { if (r && !routes.includes(r)) routes.push(r); };

  page.on('console', (m) => { if (m.type() === 'error') logs.console.push({ text: m.text(), route: route() }); });
  page.on('pageerror', (e) => logs.pageErrors.push({ text: String((e && e.message) || e), route: route() }));
  page.on('response', (r) => {
    const status = r.status();
    if (status >= 400 && ownHost(page.url(), r.url())) logs.responses.push({ status, method: r.request().method(), url: r.url(), route: route() });
  });
  page.on('requestfinished', (req) => {
    if (!['xhr', 'fetch'].includes(req.resourceType()) || !ownHost(page.url(), req.url()) || !/\/api\//.test(req.url())) return;
    const t = req.timing();
    if (t && t.responseEnd > 1000) logs.slowApi.push({ ms: Math.round(t.responseEnd), method: req.method(), url: req.url(), route: route() });
  });

  /** Record one violation (or, for a SOFT_RULES rule, one warning) in the exact shape { rule, route, selector, measured, expected, note?, shot? }. */
  const record = ({ rule, route: r, selector, measured, expected, note, shot }) => {
    const v = { rule, route: r ?? route(), selector: selector ?? '', measured: String(measured ?? ''), expected: String(expected ?? '') };
    if (note) v.note = String(note);
    if (shot) v.shot = shot;
    noteRoute(v.route);
    (SOFT_RULES.has(rule) ? warnings : violations).push(v);
    return v;
  };

  /** Record in-page detector results, cropping evidence for the first few violations. Returns the violations (not warnings) added. */
  const recordAll = async (items) => {
    const out = [];
    const perRule = {};
    for (const { rect, ...item } of items) {
      let shot;
      const soft = SOFT_RULES.has(item.rule);
      perRule[item.rule] = (perRule[item.rule] || 0) + 1;
      if (!soft && rect && perRule[item.rule] <= AUTO_CROPS_PER_CALL && crops < AUTO_CROPS_PER_AUDIT) {
        crops++;
        const { abs, rel } = claimShot(`${item.rule}-${++claimed.crops}`); // numbered per test: audits never collide
        if (await rectShot(page, rect, abs).catch(() => false)) { shot = rel; shots.push(rel); }
      }
      const v = record({ ...item, shot });
      if (!soft) out.push(v);
    }
    return out;
  };

  const attach = async () => {
    attached = true;
    const body = { checkId, project, vp: vp ? vp.id : null, label, routes, metrics, violations, warnings, shots };
    await testInfo.attach('uicheck', { body: JSON.stringify(body), contentType: 'application/json' });
  };

  const audit = {
    page, checkId, project, vp, label, violations, warnings, metrics, shots, routes,
    get route() { return route(); },

    /** Navigate (baseURL-relative or absolute), wait for content, fonts, ≤5s network idle, settle 400ms, reset probe windows. */
    async goto(target, { waitFor } = {}) {
      await page.goto(target, { waitUntil: 'domcontentloaded' });
      await page.waitForSelector(waitFor || 'main.page, #root *', { timeout: 20_000 });
      // Wait for React to attach to the page (event props on an interactive element): a click or a synthetic
      // input before hydration is silently ignored, which a loaded machine turns into false failures.
      if (/^https?:/.test(page.url())) await page.waitForFunction(() => {
        const els = document.querySelectorAll('button, input, a[href]');
        for (let i = 0; i < els.length && i < 60; i++) if (Object.keys(els[i]).some((k) => k.startsWith('__reactProps$'))) return true;
        return false;
      }, null, { timeout: 10_000 }).catch(() => {
        record({ rule: 'not-hydrated', route: route(), selector: 'document', measured: 'no React event props on any button/input/link after 10s', expected: 'hydrated page', note: 'clicks on this page may be ignored' });
      });
      await page.evaluate(() => (document.fonts ? document.fonts.ready.then(() => true) : true)).catch(() => {});
      await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
      await page.waitForTimeout(400);
      await page.evaluate(() => window.__uic && window.__uic.mark()).catch(() => {});
      noteRoute(route());
    },

    /** overflow-x, offscreen, clipped, occluded, tap-target. Returns the violations it added. */
    async layout({ scope = null, ignore = [], rules = null } = {}) {
      const touch = vp ? !!vp.hasTouch : false;
      const found = await page.evaluate(inPage(layoutScan, { scope, ignore, rules, touch }));
      noteRoute(route());
      return recordAll(found);
    },

    /** Run `fn` while sampling: snap (watched boxes), cls and loaf in the window. Returns the violations it added. */
    async motion(fn, { watch = 'auto', settleMs = 600, ignore = [] } = {}) {
      const start = await page.evaluate(inPage(snapStart, { watch, ignore }));
      await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
      await fn();
      await page.waitForTimeout(settleMs);
      const snap = await page.evaluate(inPage(snapCollect)).catch(() => null);
      const ws = await page.evaluate(inPage(windowStats, { since: start.now, origin: start.origin })).catch(() => null);
      const items = [];
      for (const j of (snap && snap.jumps) || []) {
        items.push({ rule: 'snap', selector: j.selector, measured: j.measured, expected: '≤ 8px per frame, or animated', rect: j.rect });
      }
      if (ws && ws.cls > PERF_BUDGETS.cls) items.push({ rule: 'cls', selector: ws.clsSource || 'document', measured: `CLS ${ws.cls}`, expected: `≤ ${PERF_BUDGETS.cls}` });
      if (ws && ws.longestLoaf > 100) {
        items.push({ rule: 'loaf', selector: 'document', measured: `longest frame ${ws.longestLoaf}ms (${ws.longLoafs} over 100ms)`, expected: '≤ 100ms', note: ws.loafScript ? trunc(ws.loafScript, 120) : undefined });
      }
      noteRoute(route());
      return recordAll(items);
    },

    /** Time actionFn → doneFn. Metric always; slow-action when over budget. Returns the violations it added. */
    async timing(label, actionFn, doneFn, budgetMs) {
      const t0 = performance.now();
      await actionFn();
      await doneFn();
      const ms = Math.round(performance.now() - t0);
      metrics.push({ kind: 'timing', label, value: ms, unit: 'ms', budget: budgetMs, route: route() });
      if (ms <= budgetMs) return [];
      return [record({ rule: 'slow-action', selector: label, measured: `${ms}ms`, expected: `≤ ${budgetMs}ms` })];
    },

    /** ttfb, fcp, lcp, cls, longestLoaf metrics; budgets (ttfb 800, lcp 2500, cls 0.1) only when UI_CHECK_MODE=prod. */
    async perf(label) {
      const p = await page.evaluate(inPage(perfSnapshot));
      const r = route();
      for (const k of ['ttfb', 'fcp', 'lcp', 'cls', 'longestLoaf']) {
        if (p[k] === null || p[k] === undefined) continue;
        metrics.push({ kind: 'perf', label: `${label} ${k}`, value: p[k], unit: k === 'cls' ? '' : 'ms', budget: PERF_BUDGETS[k], route: r });
      }
      if (process.env.UI_CHECK_MODE !== 'prod') return [];
      const out = [];
      if (p.ttfb > PERF_BUDGETS.ttfb) out.push(record({ rule: 'perf', selector: 'document', measured: `TTFB ${p.ttfb}ms`, expected: `≤ ${PERF_BUDGETS.ttfb}ms` }));
      if (p.lcp > PERF_BUDGETS.lcp) out.push(record({ rule: 'perf', selector: p.lcpEl || 'document', measured: `LCP ${p.lcp}ms`, expected: `≤ ${PERF_BUDGETS.lcp}ms` }));
      if (p.cls > PERF_BUDGETS.cls) out.push(record({ rule: 'cls', selector: 'document', measured: `CLS ${p.cls} (page load)`, expected: `≤ ${PERF_BUDGETS.cls}` }));
      return out;
    },

    /** axe-core (wcag2a/aa, 2.1aa, 2.2aa): serious/critical → violations, the rest → metrics. */
    async a11y({ include, exclude } = {}) {
      const loaded = await page.evaluate(() => !!window.axe);
      if (!loaded) {
        await page.addScriptTag({ content: axe() }).catch(() => page.evaluate(axe()));
      }
      const found = await page.evaluate(async ({ include, exclude, tags }) => {
        const ctx = include || exclude ? { ...(include ? { include } : {}), exclude: exclude || [] } : document;
        const res = await window.axe.run(ctx, { runOnly: { type: 'tag', values: tags }, resultTypes: ['violations'] });
        return res.violations.map((v) => ({
          id: v.id, impact: v.impact, help: v.help, count: v.nodes.length,
          nodes: v.nodes.slice(0, 5).map((n) => ({ target: n.target.join(' '), summary: (n.failureSummary || '').split('\n').slice(0, 2).join(' ') })),
        }));
      }, { include, exclude, tags: AXE_TAGS });
      const out = [];
      for (const v of found) {
        if (v.impact === 'serious' || v.impact === 'critical') {
          for (const n of v.nodes) out.push(record({ rule: 'a11y', selector: n.target, measured: `${v.id} (${v.impact}): ${v.help}`, expected: 'no serious/critical axe violations', note: trunc(n.summary) }));
        } else {
          metrics.push({ kind: 'a11y', label: `a11y ${v.id}`, value: v.count, unit: '', impact: v.impact, route: route() });
        }
      }
      return out;
    },

    /** Console errors, page errors, own-host 5xx and unexpected 4xx, slow API (>1000ms). Clears what it reported. */
    async console({ allow = [] } = {}) {
      const ok = (s) => allow.some((re) => re.test(s));
      const items = [];
      const grouped = new Map();
      const group = (key, v) => { const g = grouped.get(key); if (g) g.n++; else grouped.set(key, { ...v, n: 1 }); };
      for (const c of logs.console) if (!ok(c.text)) group(`c|${c.route}|${c.text}`, { rule: 'console', route: c.route, selector: 'console.error', measured: trunc(c.text), expected: 'no console errors' });
      for (const e of logs.pageErrors) if (!ok(e.text)) group(`e|${e.route}|${e.text}`, { rule: 'console', route: e.route, selector: 'pageerror', measured: trunc(e.text), expected: 'no uncaught errors' });
      for (const r of logs.responses) {
        if (ok(`${r.status} ${r.method} ${r.url}`)) continue;
        group(`r|${r.route}|${r.status}|${r.method}|${pathOf(r.url)}`, {
          rule: 'console', route: r.route, selector: `${r.method} ${pathOf(r.url)}`, measured: `HTTP ${r.status}`,
          expected: r.status >= 500 ? 'no 5xx' : 'no unexpected 4xx',
        });
      }
      for (const s of logs.slowApi) {
        if (ok(`slow ${s.method} ${s.url}`)) continue;
        items.push({ rule: 'slow-api', route: s.route, selector: `${s.method} ${pathOf(s.url)}`, measured: `${s.ms}ms`, expected: '≤ 1000ms' });
      }
      for (const g of grouped.values()) { const { n, ...v } = g; items.push(n > 1 ? { ...v, note: `×${n}` } : v); }
      logs.console.length = logs.pageErrors.length = logs.responses.length = logs.slowApi.length = 0;
      return items.map(record);
    },

    /** Record a check-specific violation. */
    violation(rule, { selector, measured, expected, note, route: r } = {}) {
      return record({ rule, route: r, selector, measured, expected, note });
    },

    /** JPEG into <runDir>/shots/<checkId>/<project>-<name>.jpg (crop when a locator is given). Returns the rel path or null. */
    async shot(name, locator) {
      const { abs, rel } = claimShot(name);
      const ok = locator ? await locatorShot(page, locator, abs) : await viewportShot(page, abs);
      if (!ok) return null;
      shots.push(rel);
      return rel;
    },

    /** Attach the 'uicheck' JSON; fail the test with a compact message when anything was recorded. */
    async done() {
      await attach();
      if (!violations.length) return;
      const lines = violations.slice(0, 10).map((v) => `- ${v.rule} \`${v.selector}\` on ${v.route}: ${v.measured} (expected ${v.expected})`);
      if (violations.length > 10) lines.push(`+${violations.length - 10} more`);
      throw new Error(`${violations.length} UI violation(s) in ${checkId} @ ${fileProject}:\n${lines.join('\n')}`);
    },

    /** Fixture teardown: attach the data even when the test threw before done(). */
    async finalize() {
      if (!attached) await attach();
    },
  };
  return audit;
}

/**
 * Init script: put a minted session where the app looks for it (utils/Api.tsx `accessToken` /
 * `refreshToken`, utils/session.ts `nba3via-session-user`) — once per context, on the app's origin
 * only. Later loads keep whatever the app did with it (a rotated refresh token, a logout).
 */
function seedSession({ origin, access, refresh, user }) {
  try {
    if (location.origin !== origin || localStorage.getItem('uicheck-seeded')) return;
    localStorage.setItem('accessToken', access);
    localStorage.setItem('refreshToken', refresh);
    localStorage.setItem('nba3via-session-user', JSON.stringify(user));
    localStorage.setItem('uicheck-seeded', '1');
  } catch { /* storage unavailable: the page loads as a guest */ }
}

const originOf = (baseURL) => { try { return new URL(baseURL).origin; } catch { return null; } };

/** Log a context in as a freshly minted session (a real return visit: tokens + cached /me/ payload). */
export async function seedContext(context, baseURL, { access, refresh, user }) {
  const origin = originOf(baseURL);
  if (!origin) throw new Error('ui-check: a logged-in persona needs a baseURL (run through run.mjs or a suite project)');
  await context.addInitScript(seedSession, { origin, access, refresh, user });
}

/** FNV-1a of a string: a hash that is the same in every worker and every run. */
const stableHash = (s) => { let h = 0x811c9dc5; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; } return h; };

/**
 * Which solo account a test uses. Games suite only: a full run finishes far more games than one account's
 * 60/h score-submit throttle allows, so each test takes one of 4 accounts per worker (parallelIndex + 4 * hash % 4
 * → testuser3, testuser3w1..w15) by its title. The @perf pass (single worker) stays on testuser3; every other suite
 * keeps one account per worker.
 */
function rotatedIndex(suite, testInfo) {
  if (suite !== 'games' || testInfo.title.includes('@perf')) return testInfo.parallelIndex;
  return testInfo.parallelIndex + 4 * (stableHash(testInfo.titlePath.join('>')) % 4);
}

export const test = base.extend({
  vpId: [null, { option: true }],
  persona: ['guest', { option: true }],
  suite: [null, { option: true }],
  mpPair: [null, { option: true }],
  vp: async ({ vpId }, use) => { await use(vpId ? VIEWPORTS[vpId] : null); },

  /** Who the default page is: { persona: 'guest' } or, for 'solo', { persona, username, access, refresh, user }.
   *  Each parallel worker has its own solo account (soloUsername), each test a fresh token pair. */
  session: async ({ persona, suite }, use, testInfo) => {
    if (persona !== 'solo') { await use({ persona }); return; }
    const username = soloUsername(rotatedIndex(suite, testInfo));
    const minted = (await mintTokens([username]))[username];
    await use({ persona, username, ...minted });
  },
  context: async ({ context, session, baseURL }, use) => {
    if (session.access) await seedContext(context, baseURL, session);
    await use(context);
  },

  audit: async ({ page, vp }, use, testInfo) => {
    const audit = await createAudit(page, testInfo, { project: testInfo.project.name, vp });
    await use(audit);
    await audit.finalize();
  },
  /** JSON responses and socket.io frames of the default page (lib/capture.mjs). */
  cap: async ({ page }, use) => { await use(capture(page)); },
  /** React props/state reader for the default page (lib/fiber.mjs). */
  fiber: async ({ page }, use) => { await use(fiberReader(page)); },

  /**
   * Multiplayer: `await mp.pair()` → { host, joiner }, each { page, audit, cap, context, vp, username, user, label }.
   * Host is testuser1 on MP_PAIRS[project][0], joiner testuser2 on [1], each in its own context with
   * its own fresh token pair. Audits carry labels 'host' / 'joiner'. Contexts close after the test.
   */
  mp: async ({ browser, mpPair, baseURL, userAgent }, use, testInfo) => {
    const opened = [];
    const pair = async () => {
      const vps = MP_PAIRS[mpPair];
      if (!vps) throw new Error(`ui-check: mp.pair() needs an mp project (use.mpPair one of ${Object.keys(MP_PAIRS).join(', ')}), got ${mpPair}`);
      const tokens = await mintTokens(['testuser1', 'testuser2']);
      const player = async (label, username, vpId) => {
        // `userAgent` from test.use (the multiplayer specs pass game-driver's realUserAgent, like the games specs).
        const context = await browser.newContext({ ...contextOptions(vpId), baseURL, ...(userAgent ? { userAgent } : {}) });
        await seedContext(context, baseURL, tokens[username]);
        const page = await context.newPage();
        const vp = VIEWPORTS[vpId];
        const audit = await createAudit(page, testInfo, { project: testInfo.project.name, vp, label });
        opened.push({ context, audit });
        return { page, audit, cap: capture(page), context, vp, username, user: tokens[username].user, label };
      };
      return { host: await player('host', 'testuser1', vps[0]), joiner: await player('joiner', 'testuser2', vps[1]) };
    };
    await use({ pair });
    for (const { context, audit } of opened) {
      await audit.finalize();
      await context.close().catch(() => {});
    }
  },
});
