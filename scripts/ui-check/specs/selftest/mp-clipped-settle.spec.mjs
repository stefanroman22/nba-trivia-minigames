// Selftest for the settle wait in audit.layout() (lib/detect.mjs settleBoxes, lib/fixtures.mjs layout) that MP-MATCH-01
// and MP-PROP-02 rely on, on a page.setContent fixture, no app server. The online playing screen's AutoHeight wrapper
// (`.stage-shell > div:nth-of-type(2)`, overflow:hidden while it glides) is still growing on the first playing frame,
// so an immediate scan reads `button.om-exit` ("Exit game") as `clipped`. With the wait, the scan runs once the box
// rests: a label the box fits is quiet, a label still cut at rest is still `clipped`, a box that never rests is
// scanned at the cap (and leaves a note).
import { test, expect } from '../../lib/fixtures.mjs';

// Fixed geometry (no font metrics guessed): each row is 40px tall with a 32px label, so the label's text box spans
// ~1.5-38.5px of its row and the `clipped` rule (cut by more than 0.3 em + 1 = 10.6px) fires while the wrapper is
// between ~2px and ~27px tall; at 80px both rows fit.
const PAGE = `<!doctype html><html><head><style>
  body { margin: 0; font-family: sans-serif; }
  .stage-shell > div:nth-of-type(1) { height: 40px; }
  .stage-shell > div:nth-of-type(2) { overflow: hidden; height: 80px; }
  .glide-inner > * { display: block; height: 40px; margin: 0; padding: 0 8px; border: 0; font: 32px/40px sans-serif; white-space: nowrap; }
</style></head><body><main>
<div class="stage-shell">
  <div class="stage-head">Online 1v1</div>
  <div class="glide">
    <div class="glide-inner">
      <button class="om-exit" type="button">Exit game</button>
      <div class="om-chip"><span class="om-chip-name">testuser2</span> <span class="om-chip-state">Playing</span></div>
    </div>
  </div>
</div>
</main>
<script>
  const box = () => document.querySelector('.stage-shell > div:nth-of-type(2)');
  let run = 0;
  // Like AutoHeight: the wrapper's height glides from \`from\` to \`to\` over \`ms\` with rAF (ease-in here, so the
  // label stays cut for the first ~390 ms and an immediate scan reliably lands in the glide). \`release\` mimics
  // AutoHeight's overflow: visible at rest.
  window.glide = (to, { from = 4, ms = 700, release = false } = {}) => {
    const id = ++run, el = box(), t0 = performance.now();
    el.style.overflow = 'hidden';
    el.style.height = from + 'px';
    const step = () => {
      if (id !== run) return;
      const p = Math.min(1, (performance.now() - t0) / ms);
      el.style.height = (from + (to - from) * p * p) + 'px';
      if (p < 1) requestAnimationFrame(step);
      else if (release) el.style.overflow = 'visible';
    };
    requestAnimationFrame(step);
  };
  // A box that never rests: 10-20px tall forever, so the label is always cut.
  window.wobble = () => {
    const id = ++run, el = box(), t0 = performance.now();
    el.style.overflow = 'hidden';
    const step = () => {
      if (id !== run) return;
      el.style.height = (15 + 5 * Math.sin((performance.now() - t0) / 60)) + 'px';
      requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  };
  window.stop = () => { run++; };
</script></body></html>`;

const EXIT = 'button.om-exit';
const clippedOn = (vs, sel) => vs.filter((v) => v.rule === 'clipped' && v.selector.includes(sel));
const capNotes = (audit) => audit.metrics.filter((m) => m.kind === 'note' && m.label === 'layout settle cap hit');
const timed = async (fn) => { const t0 = Date.now(); const out = await fn(); return { out, ms: Date.now() - t0 }; };

test('[ST-MP-CLIPPED-SETTLE] layout() waits for a gliding overflow box before clipped: quiet once it fits, still clipped when it rests too short, scanned at the cap when it never rests', async ({ page, audit }) => {
  test.setTimeout(60_000);
  await page.setContent(PAGE);
  await page.evaluate(() => document.fonts && document.fonts.ready);

  // Settled page: the wait costs a few frames, no cap note, nothing clipped.
  const rest = await timed(() => audit.layout({ rules: ['clipped'] }));
  expect(rest.out).toEqual([]);
  expect(rest.ms).toBeLessThan(1000);
  expect(capNotes(audit)).toHaveLength(0);

  // (a) The card's failure reproduced: scanned at once (settle: false) mid-glide, "Exit game" is `clipped` by the
  // wrapper. That is the old behaviour of layout().
  await page.evaluate(() => window.glide(80));
  const old = await audit.layout({ rules: ['clipped'], settle: false });
  expect(clippedOn(old, EXIT), JSON.stringify(old)).toHaveLength(1);
  expect(old.find((v) => v.selector.includes(EXIT)).note).toContain('Exit game');
  audit.violations.length = 0; // the failure was the point
  await page.evaluate(() => window.stop());

  // (a) With the wait, the same glide to a height that fits both rows reports nothing, and it did wait (≥ the glide).
  await page.evaluate(() => window.glide(80));
  const glided = await timed(() => audit.layout({ rules: ['clipped'] }));
  expect(glided.out).toEqual([]);
  expect(glided.ms).toBeGreaterThan(400);
  expect(await page.evaluate(() => document.querySelector('.stage-shell > div:nth-of-type(2)').getBoundingClientRect().height)).toBeCloseTo(80, 0);
  // … and the AutoHeight way (overflow: visible once it rests: the box leaves the watched set mid-wait).
  await page.evaluate(() => window.glide(80, { release: true }));
  expect(await audit.layout()).toEqual([]);
  expect(capNotes(audit)).toHaveLength(0);

  // (b) The rule is not loosened: a glide that rests at 20px (the label cut by ~18px, over 0.3 em) is still `clipped`,
  // naming the label, once the box is at rest.
  await page.evaluate(() => window.glide(20));
  const short = await audit.layout({ rules: ['clipped'] });
  expect(clippedOn(short, EXIT), JSON.stringify(short)).toHaveLength(1);
  expect(short.find((v) => v.selector.includes(EXIT)).note).toMatch(/"Exit game" cut by .*glide/);
  expect(capNotes(audit)).toHaveLength(0);
  audit.violations.length = 0;

  // (c) A box that never rests: layout() returns at the cap (2.5 s, well under 4 s), still reports the cut label and
  // records the cap as a note naming the moving box.
  await page.evaluate(() => window.wobble());
  const never = await timed(() => audit.layout({ rules: ['clipped'] }));
  expect(clippedOn(never.out, EXIT), JSON.stringify(never.out)).toHaveLength(1);
  expect(never.ms).toBeGreaterThanOrEqual(2400);
  expect(never.ms).toBeLessThan(4000);
  const notes = capNotes(audit);
  expect(notes).toHaveLength(1);
  expect(notes[0].value).toBe(2500);
  expect(notes[0].note).toContain('glide');
  audit.violations.length = 0;
  await page.evaluate(() => window.stop());

  // Rules that read no gliding box skip the wait entirely (no cap even on a box that never rests).
  await page.evaluate(() => window.wobble());
  const quick = await timed(() => audit.layout({ rules: ['overflow-x', 'offscreen'] }));
  expect(quick.out).toEqual([]);
  expect(quick.ms).toBeLessThan(1000);
  expect(capNotes(audit)).toHaveLength(1);
  await page.evaluate(() => window.stop());
});
