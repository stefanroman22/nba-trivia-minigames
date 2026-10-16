// Logic Check fixtures, extending ui-check's (lib/fixtures.mjs: its `context`/`request` live guards and createAudit
// come along). Logic Check measures whether actions work; it never calls the layout/motion/a11y/perf detectors
// (catalog.mjs rejects an LC- spec that does).
//   lc     (auto, every test) a thin audit with the attachment shape of ui-check's createAudit, so results.json and the
//          digest read the same:
//            lc.violation(rule, { selector, measured, expected, note, route })   a hard failure (recorded, not thrown)
//            lc.warn(rule, { … })                                                a soft one (digest ## Warnings)
//            lc.metric(label, value, { unit = 'ms', budget, route, kind = 'timing' })
//            await lc.page(page, { label })   → a ui-check audit (createAudit) on that page: its goto/console/violation;
//                                              in env live its context gets guardLive (non-GET aborted = live-write)
//            await lc.console({ allow })      → the page audits' console(): console errors, page errors, own-host 4xx/5xx
//            await lc.done()                  attach; throw when anything (here or in a page audit) was recorded
//          Teardown (finalize) attaches when the test threw before done().
//   guard  the request guard of the test (lib/api.mjs createGuard): remote non-GET/HEAD refused + `live-write` violation;
//          in env live its counters are attached as liveRequests (run.mjs prints and checks them).
//   api    lib/api.mjs makeApi on the active stack's API (localhost only; env live: the live API from .env.production)
//          with persona tokens minted through check-core/lib/accounts.mjs (guest = none; logic.admin gets ensureAdmin).
// Project `use`: { suite, suiteByPrefix, env: 'local' | 'live', vpId }.
import { test as base, expect, checkIdOf, createAudit, envOf } from '../../ui-check/lib/fixtures.mjs';
import { readStack } from '../../ui-check/lib/stack.mjs';
import { activePorts } from '../../check-core/lib/ports.mjs';
import { assertLocalApi, ensureAdmin, mintTokens, userForRole } from '../../check-core/lib/accounts.mjs';
import { createGuard, makeApi } from './api.mjs';
import { prodEnv } from './app.mjs';

export { expect };

/** The live API base: LOGIC_LIVE_API, else VITE_BACKEND_URL of the app's .env.production. */
export const liveApiBase = () => (process.env.LOGIC_LIVE_API || prodEnv().VITE_BACKEND_URL).replace(/\/+$/, '');
/** The local stack's API (stack.json of the active ports), else the mode's Django port. */
export const localApiBase = () => (readStack()?.api || `http://localhost:${activePorts().django}/api`).replace(/\/+$/, '');

/** One test's thin audit (see the header). `pageAudit` makes the page audits (createAudit by default). */
export function createLc(testInfo, { project = testInfo.project.name, env = envOf(testInfo), guard = null, pageAudit = createAudit } = {}) {
  const checkId = checkIdOf(testInfo.title) || 'NOID';
  const violations = [], warnings = [], metrics = [], routes = [];
  const pages = [];
  let attached = false;
  const late = [];
  const noteRoute = (r) => { if (r && !routes.includes(r)) routes.push(r); };
  const record = (list, rule, { selector, measured, expected, note, route } = {}) => {
    const v = { rule, route: route || '-', selector: selector ?? '', measured: String(measured ?? ''), expected: String(expected ?? '') };
    if (note) v.note = String(note);
    noteRoute(route);
    list.push(v);
    return v;
  };
  if (guard) {
    guard.listeners.add((w) => {
      const v = record(violations, 'live-write', { selector: `${w.method} ${w.url.split('?')[0]}`, measured: `a ${w.method} request (refused by the guard)`, expected: 'GET/HEAD only to a remote origin' });
      if (attached) late.push(v);
    });
  }
  const body = () => ({
    checkId, project, vp: null, label: null, env, routes, metrics, violations, warnings, shots: [],
    ...(env === 'live' && guard ? { liveRequests: { read: guard.read, write: guard.write } } : {}),
  });
  const attach = async () => {
    attached = true;
    await testInfo.attach('uicheck', { body: JSON.stringify(body()), contentType: 'application/json' });
  };
  const all = () => [...violations, ...pages.flatMap((a) => a.violations)];
  const lc = {
    checkId, project, env, violations, warnings, metrics, routes,
    violation: (rule, o) => record(violations, rule, o),
    warn: (rule, o) => record(warnings, rule, o),
    metric(label, value, { unit = 'ms', budget, route, kind = 'timing' } = {}) {
      const m = { kind, label, value, unit, route: route || '-' };
      if (budget !== undefined) m.budget = budget;
      metrics.push(m);
      return m;
    },
    async page(page, { label = null } = {}) {
      const a = await pageAudit(page, testInfo, { project, label });
      pages.push(a);
      return a;
    },
    async console(opts = {}) {
      const out = [];
      for (const a of pages) out.push(...(await a.console(opts)));
      return out;
    },
    /** Attach every audit's data; throw when any violation was recorded. */
    async done() {
      for (const a of pages) { try { await a.done(); } catch { /* counted below */ } }
      await attach();
      const vs = all();
      if (!vs.length) return;
      const lines = vs.slice(0, 10).map((v) => `- ${v.rule} \`${v.selector}\` on ${v.route}: ${v.measured} (expected ${v.expected})`);
      if (vs.length > 10) lines.push(`+${vs.length - 10} more`);
      throw new Error(`${vs.length} logic violation(s) in ${checkId} @ ${project}:\n${lines.join('\n')}`);
    },
    /** Fixture teardown: attach when the test threw before done(); a refused write after done() fails the test. */
    async finalize() {
      for (const a of pages) await a.finalize();
      if (!attached) { await attach(); return; }
      if (!late.length) return;
      await testInfo.attach('uicheck', { body: JSON.stringify({ ...body(), routes: [], metrics: [], warnings: [], violations: late, liveRequests: undefined }), contentType: 'application/json' });
      throw new Error(`${late.length} refused write(s) after done() in ${checkId}: ${late[0].selector}`);
    },
  };
  return lc;
}

export const test = base.extend({
  suiteByPrefix: [null, { option: true }],
  guard: async ({}, use) => { await use(createGuard()); },
  lc: [async ({ guard }, use, testInfo) => {
    const lc = createLc(testInfo, { guard });
    await use(lc);
    await lc.finalize();
  }, { auto: true }],
  api: async ({ guard }, use, testInfo) => {
    const env = envOf(testInfo);
    const tokens = new Map(); // a fresh token per persona per test; the worker's mint server stays up between tests
    const tokenFor = async (persona) => {
      if (env === 'live') throw new Error(`logic-check: persona ${persona} on the live site — the live suite is guest only`);
      if (!tokens.has(persona)) {
        const username = userForRole(persona);
        if (persona === 'logic.admin') await ensureAdmin(username);
        tokens.set(persona, (await mintTokens([username]))[username].access);
      }
      return tokens.get(persona);
    };
    const apiBase = env === 'live' ? liveApiBase() : assertLocalApi(localApiBase());
    await use(makeApi({ base: apiBase, guard, tokenFor, env }));
  },
});
