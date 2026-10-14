// Runs one acceptance assertion (DSL in lib/findings.mjs) in a page, reusing the audit's detectors:
//   noOverflow → audit.layout (overflow-x, offscreen)   noSnap → audit.motion's snap sampler around the steps
//   maxCls / maxLoafMs → the probe buffers (perfSnapshot / windowStats)   axe → audit.a11y (filtered to the rule ids)
//   noConsoleErrors → audit.console (rule `console` only)
// `style` compares computed strings: colours come back as "rgb(r, g, b)" / "rgba(…)", lengths in px.
// `visible` / `count` with no match in the DOM stay a FAIL (absence can be the defect) but say "0 in DOM", so a
// mistyped selector is easy to spot. A `noSnap` watch selector that matches nothing before and after the steps is an error.
// Every expect yields one line { ok, error, text } with what was measured. Outcome:
//   'pass'  every expect holds
//   'fail'  an expect does not hold (the assertion reproduces the defect)
//   'error' a step failed or an expect could not measure (no element to measure, bad selector): not a clean failure,
//           so report.mjs --validate never counts it as reproducing.
import { L } from './pagemap.mjs';
import { inPage, perfSnapshot, windowStats } from './detect.mjs';
import { parseAssertion } from './findings.mjs';

const WAIT = 5000;
const STEP_TIMEOUT = 15_000;

const firstLine = (e) => String((e && e.message) || e).replace(/\u001b\[[0-9;]*m/g, '').split('\n').map((l) => l.trim()).find(Boolean)?.slice(0, 220) || 'error';
const trunc = (s, n = 60) => { s = String(s ?? '').replace(/\s+/g, ' ').trim(); return s.length > n ? `${s.slice(0, n)}…` : s; };
const r1 = (n) => Math.round(n * 10) / 10;
const pathOf = (u) => { try { const x = new URL(u); return x.pathname + x.search; } catch { return u; } };
const kebab = (p) => p.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`);

class MeasureError extends Error {}

/** Poll `fn` every 100 ms until `ok(value)` or `ms` passed → the last value. */
async function poll(fn, ok, ms = WAIT) {
  const end = Date.now() + ms;
  let v = await fn();
  while (!ok(v) && Date.now() < end) {
    await new Promise((r) => setTimeout(r, 100));
    v = await fn();
  }
  return v;
}

/** → { outcome, lines: [{ ok, error, text }], shot, url } */
export async function runAssertion({ page, audit, assertion }) {
  const a = parseAssertion(assertion);
  const vs = page.viewportSize() || { width: 0, height: 0 };
  const loc = (s) => (s.startsWith('@') ? L(page, s.slice(1)) : page.locator(s));
  const visible = (s) => loc(s).filter({ visible: true }).first();
  /** The first visible match, or a MeasureError (nothing to measure is not a clean failure). */
  const needVisible = async (s) => {
    const el = visible(s);
    if (!(await el.waitFor({ state: 'visible', timeout: WAIT }).then(() => true, () => false))) {
      throw new MeasureError(`${s} matched no visible element (${await loc(s).count()} in the DOM)`);
    }
    return el;
  };

  const responses = [];
  page.on('response', (r) => responses.push({ url: r.url(), status: r.status() }));

  const lines = [];
  const add = (ok, text, focus = null) => lines.push({ ok, error: false, text, focus });
  let stepError = null;

  const STEP = {
    click: (s) => visible(s).click({ timeout: STEP_TIMEOUT }),
    fill: ([s, text]) => visible(s).fill(text, { timeout: STEP_TIMEOUT }),
    press: (key) => page.keyboard.press(key),
    hover: (s) => visible(s).hover({ timeout: STEP_TIMEOUT }),
    waitFor: (s) => visible(s).waitFor({ state: 'visible', timeout: STEP_TIMEOUT }),
    wait: (ms) => page.waitForTimeout(ms),
    scroll: async (to) => {
      await page.evaluate((y) => window.scrollTo(0, y === 'bottom' ? document.documentElement.scrollHeight : y === 'top' ? 0 : Number(y)), to);
      await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
      await page.waitForTimeout(150);
    },
  };
  const show = (arg) => (Array.isArray(arg) ? arg.join(' ') : String(arg));
  const runSteps = async () => {
    for (const [i, s] of a.steps.entries()) {
      try { await STEP[s.kind](s.arg); } catch (e) { stepError = `step ${i + 1} ${s.kind} ${show(s.arg)}: ${firstLine(e)}`; return; }
    }
  };

  let win = null, snaps = [];
  try { await audit.goto(a.route); } catch (e) { stepError = `goto ${a.route}: ${firstLine(e)}`; }
  if (!stepError) {
    win = await page.evaluate(() => ({ since: performance.now(), origin: performance.timeOrigin }));
    if (a.expect.some((x) => x.kind === 'noSnap')) {
      // The steps run inside the audit's motion window: its rAF snap sampler watches `watch` (or 'auto').
      const counts = () => Promise.all(a.watch.map((s) => page.locator(s).count().catch(() => 0)));
      const before = await counts();
      try {
        const added = await audit.motion(runSteps, { watch: a.watch.length ? a.watch : 'auto' });
        snaps = added.filter((v) => v.rule === 'snap');
      } catch (e) { stepError ||= `snap sampler: ${firstLine(e)}`; }
      const after = await counts();
      const unwatched = a.watch.filter((_, i) => !before[i] && !after[i]);
      if (!stepError && unwatched.length) stepError = `noSnap watch ${unwatched.join(', ')}: 0 in DOM before and after the steps — nothing was watched`;
    } else {
      await runSteps();
      if (a.steps.length) await page.waitForTimeout(300);
    }
  }

  const EXPECT = {
    visible: async (s) => {
      const ok = await visible(s).waitFor({ state: 'visible', timeout: WAIT }).then(() => true, () => false);
      const n = ok ? null : await loc(s).count();
      add(ok, `visible ${s}: ${ok ? 'visible' : n === 0 ? 'not visible — 0 in DOM (check the selector)' : `not visible (${n} in DOM)`}`, s);
    },
    hidden: async (s) => {
      const n = await poll(() => loc(s).filter({ visible: true }).count(), (c) => c === 0);
      add(n === 0, `hidden ${s}: ${n === 0 ? 'hidden' : `${n} visible`}`, s);
    },
    count: async ([s, op, n]) => {
      const cmp = (c) => (op === '>=' ? c >= n : op === '<=' ? c <= n : c === n);
      const c = await poll(() => loc(s).count(), cmp);
      add(cmp(c), `count ${s}: ${c === 0 ? '0 in DOM' : c} (expected ${op} ${n})`, s);
    },
    text: async ([s, sub]) => {
      const el = await needVisible(s);
      const t = await poll(() => el.innerText().catch(() => ''), (x) => x.includes(sub));
      add(t.includes(sub), `text ${s}: ${t.includes(sub) ? 'contains' : 'does not contain'} "${sub}" (text "${trunc(t)}")`, s);
    },
    noOverflow: async () => {
      const found = await audit.layout({ rules: ['overflow-x', 'offscreen'] });
      const v = found[0];
      add(!v, v ? `noOverflow: ${v.rule} ${v.selector}: ${v.measured} (expected ${v.expected})${found.length > 1 ? ` +${found.length - 1} more` : ''}` : `noOverflow: fits ${vs.width}px`, v && v.selector !== 'html' ? v.selector : null);
    },
    withinViewport: async (s) => {
      const box = await (await needVisible(s)).boundingBox();
      const ok = box.x >= -1 && box.y >= -1 && box.x + box.width <= vs.width + 1 && box.y + box.height <= vs.height + 1;
      add(ok, `withinViewport ${s}: x ${Math.round(box.x)}–${Math.round(box.x + box.width)}, y ${Math.round(box.y)}–${Math.round(box.y + box.height)} in ${vs.width}×${vs.height}`, s);
    },
    minSize: async ([s, w, h]) => {
      const box = await (await needVisible(s)).boundingBox();
      const ok = box.width + 0.01 >= w && box.height + 0.01 >= h;
      add(ok, `minSize ${s}: ${r1(box.width)}×${r1(box.height)}px (need ≥ ${w}×${h})`, s);
    },
    style: async ([s, prop, value]) => {
      const el = await needVisible(s);
      const actual = await el.evaluate((e, p) => getComputedStyle(e).getPropertyValue(p).trim(), kebab(prop));
      const ok = actual === String(value).trim();
      add(ok, `style ${s} ${kebab(prop)}: "${trunc(actual, 50)}" (expected "${value}")`, s);
    },
    transition: async ([s, prop]) => {
      const el = await needVisible(s);
      const r = await el.evaluate((e, p) => {
        const cs = getComputedStyle(e);
        const props = cs.transitionProperty.split(',').map((x) => x.trim());
        const durs = cs.transitionDuration.split(',').map((x) => parseFloat(x) || 0);
        const i = props.findIndex((x) => x === p || x === 'all');
        const dur = i < 0 ? 0 : durs[i % durs.length];
        const anim = e.getAnimations().some((an) => {
          if (an.transitionProperty) return an.transitionProperty === p;
          try { return an.effect.getKeyframes().some((k) => Object.keys(k).some((q) => q.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`) === p)); } catch { return false; }
        });
        return { ok: dur > 0 || anim, desc: `transition-property "${cs.transitionProperty}", duration "${cs.transitionDuration}"${anim ? ', running animation' : ''}` };
      }, kebab(prop));
      add(r.ok, `transition ${s} ${kebab(prop)}: ${trunc(r.desc, 90)}`, s);
    },
    noSnap: async () => {
      const v = snaps[0];
      add(!v, v ? `noSnap: ${v.selector}: ${v.measured}${snaps.length > 1 ? ` +${snaps.length - 1} more` : ''}` : `noSnap: no element jumped (watch ${a.watch.length ? a.watch.join(', ') : 'auto'})`, v ? v.selector : null);
    },
    maxCls: async (max) => {
      const p = await page.evaluate(inPage(perfSnapshot));
      add(p.cls <= max, `maxCls: CLS ${p.cls} since load (max ${max})`);
    },
    maxLoafMs: async (max) => {
      // With steps: frames since the steps began (windowStats); without: since load (perfSnapshot).
      if (a.steps.length && win) {
        const w = await page.evaluate(inPage(windowStats, win));
        add(w.longestLoaf <= max, `maxLoafMs: longest frame ${w.longestLoaf}ms during the steps${w.loafScript ? ` [${trunc(w.loafScript, 50)}]` : ''} (max ${max})`);
      } else {
        const p = await page.evaluate(inPage(perfSnapshot));
        add(p.longestLoaf <= max, `maxLoafMs: longest frame ${p.longestLoaf}ms since load (max ${max})`);
      }
    },
    status: async ([re, code]) => {
      const rx = new RegExp(re);
      const hits = await poll(() => responses.filter((r) => rx.test(r.url)), (h) => h.some((r) => r.status === code));
      const ok = hits.some((r) => r.status === code);
      add(ok, ok ? `status /${re}/: ${code}` : hits.length ? `status /${re}/: got ${[...new Set(hits.map((r) => r.status))].join(', ')} (expected ${code})` : `status /${re}/: no response matched (expected ${code})`);
    },
    url: async (re) => {
      const rx = new RegExp(re);
      const u = await poll(() => page.url(), (x) => rx.test(x));
      add(rx.test(u), `url ${pathOf(u)} ${rx.test(u) ? 'matches' : 'does not match'} /${re}/`);
    },
    noConsoleErrors: async () => {
      const found = (await audit.console()).filter((v) => v.rule === 'console');
      const v = found[0];
      add(!v, v ? `noConsoleErrors: ${v.selector}: ${trunc(v.measured, 120)}${found.length > 1 ? ` +${found.length - 1} more` : ''}` : 'noConsoleErrors: none');
    },
    axe: async (ids) => {
      const before = audit.metrics.length;
      const hits = (await audit.a11y()).filter((v) => ids.some((id) => v.measured.startsWith(`${id} (`)));
      const minor = audit.metrics.slice(before).filter((m) => m.kind === 'a11y' && ids.includes(m.label.replace(/^a11y /, '')));
      const v = hits[0];
      const text = v ? `axe: ${v.measured.split(':')[0]} on ${v.selector}${v.note ? ` — ${trunc(v.note, 90)}` : ''}${hits.length > 1 ? ` +${hits.length - 1} more` : ''}`
        : minor.length ? `axe: ${minor.map((m) => `${m.label.replace(/^a11y /, '')} (${m.impact}) ×${m.value}`).join(', ')}` : `axe ${ids.join(', ')}: no violations`;
      add(!v && !minor.length, text, v ? v.selector : null);
    },
  };

  if (stepError) lines.push({ ok: false, error: true, text: stepError, focus: null });
  else {
    for (const x of a.expect) {
      try { await EXPECT[x.kind](x.arg); } catch (e) { lines.push({ ok: false, error: true, text: `${x.kind}: ${firstLine(e)}`, focus: null }); }
    }
  }
  const outcome = lines.some((l) => l.error) ? 'error' : lines.every((l) => l.ok) ? 'pass' : 'fail';

  // One piece of evidence: a crop of the first failing expect's element, else of the first measured element, else the viewport.
  let shot = null;
  const focus = (lines.find((l) => !l.ok && l.focus) || lines.find((l) => l.focus) || {}).focus;
  if (focus) shot = await audit.shot('crop', loc(focus).first()).catch(() => null);
  if (!shot) shot = await audit.shot('view').catch(() => null);
  return { outcome, lines: lines.map(({ ok, error, text }) => ({ ok, error, text })), shot, url: page.url() };
}
