/**
 * UI audit harness — renders every game and MEASURES it.
 *
 * This exists because static/grep-level checks ("does the root set height:100%?",
 * "is the stagger 260ms?") can all pass while a game still looks nothing like the
 * others. Compliance with docs/GAME_DESIGN_CONSTRAINTS.md is a VISUAL property, so
 * it has to be verified by rendering.
 *
 * Usage:
 *   npm run dev            # in another terminal (or pass --url)
 *   node scripts/ui-audit.mjs
 *   node scripts/ui-audit.mjs --url http://localhost:5174 --width 1100 --height 900
 *   node scripts/ui-audit.mjs --only heatmap,fan-favorites
 *   node scripts/ui-audit.mjs --label baseline     # names the output folder
 *
 * Output:
 *   docs/ui-audit/<label>/<game>.png   one screenshot of the stage per game
 *   docs/ui-audit/<label>/report.md    measurements + PASS/FAIL per rule
 *   docs/ui-audit/<label>/report.json  same data, machine-readable
 */
import { chromium } from 'playwright-core';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const args = Object.fromEntries(
  process.argv.slice(2).join(' ').split('--').filter(Boolean)
    .map((s) => { const [k, ...v] = s.trim().split(/\s+/); return [k, v.join(' ') || true]; })
);

const BASE = args.url || 'http://localhost:5173';
const WIDTH = Number(args.width) || 1100;
const HEIGHT = Number(args.height) || 900;
const LABEL = args.label || 'latest';
const OUT = path.resolve('docs/ui-audit', String(LABEL));

// id -> urlPath, mirrored from src/utils/GameUtils.tsx.
const GAMES = [
  ['series-winner', '/series-winner'],
  ['name-logo', '/name-logo'],
  ['guess-mvps', '/guess-mvps'],
  ['starting-five', '/starting-five'],
  ['wordle', '/wordle'],
  ['fan-favorites', '/fan-favorites'],
  ['heatmap', '/heatmap'],
  ['connections', '/connections'],
  ['career-path', '/career-path'],
  ['nba-grid', '/nba-grid'],
  ['who-are-ya', '/who-are-ya'],
  ['tictactoe', '/tictactoe'],
  ['bingo', '/bingo'],
  ['contexto', '/contexto'],
  ['pack-five', '/pack-five'],
  ['superdraft', '/superdraft'],
  ['imposter', '/imposter'],
];

const only = args.only ? String(args.only).split(',').map((s) => s.trim()) : null;
const targets = only ? GAMES.filter(([id]) => only.includes(id)) : GAMES;

/** Runs in the page. Measures the shell contract + the game's own top-level rhythm. */
function measureInPage() {
  const r = (el) => el.getBoundingClientRect();
  const inner = document.querySelector('.stage-inner');
  const shell = document.querySelector('.stage-shell');
  const wrap = document.querySelector('.playing-wrap');
  const exit = document.querySelector('.exit-link');
  if (!inner || !wrap || !exit) return { mounted: false };

  const root = wrap.firstElementChild;
  const cs = getComputedStyle(root);
  const kids = [...root.children].filter((k) => r(k).height > 0);

  return {
    mounted: true,
    // The expected top/bottom offset IS the stage's padding — clamp(14px,2.6vw,30px),
    // so it varies with viewport width. Never hardcode it in an assertion.
    stagePad: +parseFloat(getComputedStyle(inner).paddingTop).toFixed(1),
    // Derived from what the game declared via <GameFrame fill> — there is no
    // is-content class any more (see MiniGame.css).
    isContent: !!root.classList.contains('gf') && !root.classList.contains('gf--fill'),
    usesGameFrame: root.classList.contains('gf'),
    // Shell contract (Rule 4.2) — must be identical in every game.
    shellTop: +(r(root).top - r(inner).top).toFixed(1),
    gameToExit: +(r(exit).top - r(root).bottom).toFixed(1),
    exitToBottom: +(r(inner).bottom - r(exit).bottom).toFixed(1),
    // Rules 1.1 / 1.2
    playAreaFitsViewport: r(exit).bottom <= window.innerHeight,
    shellContainsGame: r(exit).bottom <= r(shell).bottom + 1,
    // The game's own root — this is what actually differs between games.
    rootClass: root.className || '(inline styles)',
    rootMaxWidth: cs.maxWidth,
    rootGap: cs.rowGap,
    rootAlign: cs.alignItems,
    rootWidth: +r(root).width.toFixed(1),
    // Distance from the top of the game root to its first visible element, and
    // the gaps between top-level children. Reveals bespoke HUDs / floating boards.
    firstChildOffset: kids.length ? +(r(kids[0]).top - r(root).top).toFixed(1) : null,
    childGaps: kids.slice(1).map((k, i) => +(r(k).top - r(kids[i]).bottom).toFixed(1)),
    childCount: kids.length,
    // Status row alignment: a lone left label must be centred, a lone right
    // group must stay right-aligned, both present → space-between.
    status: (() => {
      const bar = root.querySelector(':scope > .gf-status');
      if (!bar) return null;
      const l = bar.querySelector(':scope > .gf-status-left');
      const rt = bar.querySelector(':scope > .gf-status-right');
      const br = r(bar);
      const off = (el) => (el ? +((r(el).left + r(el).right) / 2 - (br.left + br.right) / 2).toFixed(1) : null);
      return {
        slots: [l && 'left', rt && 'right'].filter(Boolean),
        // distance from the row's centre; ~0 means centred
        loneOffsetFromCentre: (l && !rt) ? off(l) : (rt && !l) ? off(rt) : null,
        loneRightIsFlush: (rt && !l) ? Math.abs(r(rt).right - br.right) < 1.5 : null,
      };
    })(),
    // Any absolutely-positioned descendant overlapping a sibling is usually a bug
    // (e.g. Heatmap's .hm-center score painted on top of the hex board).
    absoluteOverlays: [...root.querySelectorAll('*')]
      .filter((el) => getComputedStyle(el).position === 'absolute' && r(el).height > 8)
      .map((el) => el.className)
      .filter((c) => typeof c === 'string' && c)
      .slice(0, 6),
  };
}

async function run() {
  await mkdir(OUT, { recursive: true });
  const browser = await chromium.launch({ channel: 'msedge' });
  const page = await browser.newPage({ viewport: { width: WIDTH, height: HEIGHT } });
  const results = [];

  for (const [id, urlPath] of targets) {
    const row = { id };
    try {
      await page.goto(BASE + urlPath, { waitUntil: 'domcontentloaded' });
      // Idle screen → press Play.
      const play = page.locator('button.btn.btn-primary.btn-lg');
      await play.waitFor({ timeout: 15000 });
      await play.click();
      // handleStart holds the loader ~2s, then data resolves.
      await page.waitForSelector('.playing-wrap', { timeout: 30000 });
      await page.waitForTimeout(1200); // let entry animations settle
      Object.assign(row, await page.evaluate(measureInPage));
      const shell = page.locator('.stage-shell');
      if (await shell.count()) {
        // The sticky nav (z-index 40) overlaps the stage once Playwright scrolls
        // the element into view, which would hide the game's own status row in
        // the screenshot. Hide it for the capture only.
        await page.addStyleTag({ content: '.nav3 { visibility: hidden !important; }' });
        await shell.screenshot({ path: path.join(OUT, `${id}.png`), scale: 'css' });
        row.screenshot = `${id}.png`;
      }
    } catch (err) {
      row.error = String(err.message || err).split('\n')[0];
    }
    results.push(row);
    console.log(
      row.error ? `✗ ${id}  ${row.error}`
        : `✓ ${id}  top=${row.shellTop} exit=${row.gameToExit} bottom=${row.exitToBottom} gap=${row.rootGap} maxW=${row.rootMaxWidth}`
    );
  }

  await browser.close();

  // ---- Assertions. These fail the run so a regression can't pass unnoticed. ----
  const live = results.filter((x) => !x.error && x.mounted);
  const failures = [];
  const near = (a, b) => Math.abs(a - b) < 1.5;

  for (const x of live) {
    // Expected offset is the stage's own padding at THIS viewport, not a constant.
    const TOP = x.stagePad;
    if (!x.usesGameFrame) failures.push(`${x.id}: root is not <GameFrame> (got .${x.rootClass})`);
    if (!near(x.shellTop, TOP)) failures.push(`${x.id}: top offset ${x.shellTop} ≠ stage padding ${TOP}${x.shellTop < 0 ? ' — NEGATIVE: content is spilling above the shell border' : ''}`);
    if (!near(x.exitToBottom, TOP)) failures.push(`${x.id}: exit→bottom ${x.exitToBottom} ≠ stage padding ${TOP}`);
    if (x.rootGap !== '20px') failures.push(`${x.id}: root gap ${x.rootGap} ≠ 20px — games must not override GameFrame's rhythm`);
    // Game→Exit must match the game's own family: content 28px, fill 12px.
    const expectExit = x.isContent ? 28 : 12;
    if (!near(x.gameToExit, expectExit)) failures.push(`${x.id}: game→exit ${x.gameToExit} ≠ ${expectExit} (${x.isContent ? 'content' : 'fill'} family)`);
    if (!x.shellContainsGame) failures.push(`${x.id}: game renders OUTSIDE the shell border`);
    const s = x.status;
    if (s && s.slots.length === 1) {
      if (s.slots[0] === 'left' && Math.abs(s.loneOffsetFromCentre) > 1.5)
        failures.push(`${x.id}: lone status label is ${s.loneOffsetFromCentre}px off centre — it must centre when there is no right slot`);
      if (s.slots[0] === 'right' && !s.loneRightIsFlush)
        failures.push(`${x.id}: lone status score is not flush right`);
    }
  }

  if (failures.length) {
    console.log(`\n✗ ${failures.length} assertion failure(s):`);
    for (const f of failures) console.log('  - ' + f);
  } else {
    console.log(`\n✓ all ${live.length} games pass the layout assertions`);
  }

  // Reference values come from Series Winner, the spec's reference implementation.
  const ref = results.find((x) => x.id === 'series-winner');
  const ok = (v, e) => (v == null || e == null ? '—' : Math.abs(v - e) < 1.5 ? 'PASS' : `FAIL (${v} vs ${e})`);

  const lines = [
    `# UI audit — ${LABEL}`,
    '',
    `Viewport ${WIDTH}×${HEIGHT} · ${new Date().toISOString()}`,
    '',
    'Reference = `series-winner`. Rule 4.2 requires the three shell distances to be identical',
    'in every game. `root gap` / `max-width` / `align` are the game\'s OWN root — these differing',
    'is why games look unlike each other even when the shell distances pass.',
    '',
    '| game | top | →exit | bottom→ | fits vp | in shell | root gap | max-w | align | children |',
    '|---|---|---|---|---|---|---|---|---|---|',
    ...results.map((x) => x.error
      ? `| ${x.id} | ERROR: ${x.error} | | | | | | | | |`
      : `| ${x.id} | ${ok(x.shellTop, ref?.shellTop)} | ${ok(x.gameToExit, ref?.gameToExit)} | ${ok(x.exitToBottom, ref?.exitToBottom)} | ${x.playAreaFitsViewport ? 'yes' : 'NO'} | ${x.shellContainsGame ? 'yes' : 'NO'} | ${x.rootGap} | ${x.rootMaxWidth} | ${x.rootAlign} | ${x.childCount} |`),
    '',
    '## Per-game detail',
    '',
    ...results.flatMap((x) => x.error ? [`### ${x.id}`, '', `ERROR: ${x.error}`, ''] : [
      `### ${x.id}`,
      '',
      `- root: \`${x.rootClass}\` — width ${x.rootWidth}px, gap \`${x.rootGap}\`, align \`${x.rootAlign}\``,
      `- shell: top ${x.shellTop} · game→exit ${x.gameToExit} · exit→bottom ${x.exitToBottom}`,
      `- first child offset: ${x.firstChildOffset} · gaps between children: ${JSON.stringify(x.childGaps)}`,
      x.absoluteOverlays.length ? `- absolutely-positioned descendants: ${x.absoluteOverlays.join(', ')}` : '',
      x.screenshot ? `- ![${x.id}](${x.screenshot})` : '',
      '',
    ].filter(Boolean)),
  ];

  await writeFile(path.join(OUT, 'report.md'), lines.join('\n'), 'utf8');
  await writeFile(path.join(OUT, 'report.json'), JSON.stringify(results, null, 2), 'utf8');
  console.log(`\nWrote ${OUT}/report.md (${results.length} games)`);
  if (failures.length) process.exitCode = 1;
}

run().catch((e) => { console.error(e); process.exit(1); });
