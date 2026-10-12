// Init script injected before any page script (context/page.addInitScript). It buffers
// layout-shift, long-animation-frame and largest-contentful-paint entries into window.__uic so the
// audit can read any window later. Console/network capture is node-side (see fixtures.mjs).
import { cssPath } from './detect.mjs';

const MAX = 2000;

export const PROBE_SCRIPT = `(() => {
  if (window.top !== window || window.__uic) return;
  ${String(cssPath)}
  const u = window.__uic = {
    shifts: [], loafs: [], lcp: [], windowStart: 0,
    mark() { u.windowStart = performance.now(); return u.windowStart; },
  };
  const push = (arr, v) => { arr.push(v); if (arr.length > ${MAX}) arr.shift(); };
  const describe = (n) => !n ? null : n.nodeType === 1 ? cssPath(n) : (n.parentElement ? cssPath(n.parentElement) : null);
  const observe = (type, fn) => {
    try {
      new PerformanceObserver((list) => { for (const e of list.getEntries()) { try { fn(e); } catch (err) { /* keep observing */ } } })
        .observe({ type, buffered: true });
    } catch (err) { /* entry type unsupported in this browser */ }
  };
  observe('layout-shift', (e) => push(u.shifts, {
    t: e.startTime, v: e.value, input: e.hadRecentInput,
    src: (e.sources || []).map((s) => describe(s.node)).filter(Boolean).slice(0, 3),
  }));
  observe('long-animation-frame', (e) => {
    const s = (e.scripts || [])[0];
    push(u.loafs, { t: e.startTime, d: e.duration, blocking: e.blockingDuration || 0, script: s ? (s.invoker || s.sourceURL || '') : '' });
  });
  observe('largest-contentful-paint', (e) => push(u.lcp, { t: e.startTime, size: e.size, el: e.element ? cssPath(e.element) : '' }));
})();`;
