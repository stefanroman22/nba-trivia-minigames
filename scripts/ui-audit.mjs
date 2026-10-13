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
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { launchBrowser } from './qa-browser.mjs';
import { measureInPage, shellFailures } from './lib/game-shell.mjs';

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
  ['who-would-win', '/who-would-win'],
];

const only = args.only ? String(args.only).split(',').map((s) => s.trim()) : null;
const targets = only ? GAMES.filter(([id]) => only.includes(id)) : GAMES;

async function run() {
  await mkdir(OUT, { recursive: true });
  // Cloud-portable: Edge/Chrome locally, bundled Chromium on a routine VM.
  const browser = await launchBrowser();
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
  const failures = live.flatMap(shellFailures);

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
