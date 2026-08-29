/**
 * Browser-QA harness for the autonomous pipeline.
 *
 * The browser-qa agent writes a short per-task script that imports these helpers,
 * rather than hand-rolling Playwright each time. That keeps three things it would
 * otherwise get wrong consistent across every task:
 *   - the browser launch is CLOUD-PORTABLE (see launchBrowser)
 *   - screenshots and the verdict land where team-run expects them (.team/qa/<slug>/)
 *   - the verdict file keeps the exact shape the qa stage parses
 *
 * Typical per-task script:
 *
 *   import { launchBrowser, waitForServer, openApp, startGame, shot, writeVerdict }
 *     from './scripts/qa-browser.mjs';
 *
 *   const base = 'http://localhost:5273';
 *   await waitForServer(base);
 *   const browser = await launchBrowser();
 *   const page = await browser.newPage({ viewport: { width: 1100, height: 900 } });
 *   const failures = [];
 *   await openApp(page, base, '/leaderboard');
 *   await shot(page, 'my-slug', 'leaderboard');
 *   if (!(await page.locator('.lb-row').count())) failures.push('leaderboard rendered no rows');
 *   await browser.close();
 *   await writeVerdict('my-slug', failures.length === 0, failures);
 */
import { chromium } from 'playwright-core';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

export const QA_ROOT = '.team/qa';

/**
 * Launch a browser that works both locally and on a cloud routine VM.
 *
 * Local (Windows) has Edge/Chrome installed, so we use those and skip any download.
 * A cloud VM has neither — it falls through to Playwright's own bundled Chromium,
 * which the pipeline installs during the cloud deps step:
 *   node node_modules/playwright-core/cli.js install --with-deps chromium
 * Never hardcode `channel: 'msedge'` in a QA script; it fails on Linux.
 */
export async function launchBrowser({ headless = true } = {}) {
  const attempts = [{ channel: 'msedge' }, { channel: 'chrome' }, {}];
  let lastErr;
  for (const opts of attempts) {
    try {
      return await chromium.launch({ headless, ...opts });
    } catch (err) {
      lastErr = err;
    }
  }
  throw new Error(
    `no usable browser. On a cloud VM run: node node_modules/playwright-core/cli.js install --with-deps chromium\n` +
    `last error: ${String(lastErr?.message || lastErr).split('\n')[0]}`
  );
}

/**
 * Poll until the dev server answers, so QA never races a slow Vite boot.
 * Always use `localhost` in the URL, never `127.0.0.1` — Vite may bind IPv6-only,
 * in which case the literal IPv4 address is unreachable while `localhost` resolves.
 */
export async function waitForServer(url, timeoutMs = 90000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(3000) });
      if (res.ok || res.status < 500) return true;
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`server at ${url} did not come up within ${timeoutMs}ms`);
}

/** Navigate to a route and wait for React to paint something. */
export async function openApp(page, base, urlPath = '/') {
  await page.goto(base + urlPath, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#root *', { timeout: 20000 });
}

/**
 * Games gate behind an idle screen — click Play and wait for the playing shell.
 * Mirrors the flow scripts/ui-audit.mjs uses, including the ~2s loader hold.
 */
export async function startGame(page) {
  const play = page.locator('button.btn.btn-primary.btn-lg');
  await play.waitFor({ timeout: 15000 });
  await play.click();
  await page.waitForSelector('.playing-wrap', { timeout: 30000 });
  await page.waitForTimeout(1200); // let entry animations settle
}

/**
 * Screenshot evidence into .team/qa/<slug>/<name>.png.
 * Pass a locator to capture just that element (e.g. the game shell).
 */
export async function shot(page, slug, name, locator = null) {
  const dir = path.resolve(QA_ROOT, slug);
  await mkdir(dir, { recursive: true });
  const file = path.join(dir, `${name}.png`);
  // The sticky nav overlaps the stage once an element is scrolled into view.
  await page.addStyleTag({ content: '.nav3 { visibility: hidden !important; }' }).catch(() => {});
  if (locator) await locator.screenshot({ path: file, scale: 'css' });
  else await page.screenshot({ path: file, fullPage: false });
  return file;
}

/**
 * Write the verdict the qa stage reads. Shape is fixed — team-run treats
 * pass:false as a build-stage bounce that counts toward the fix-cycle cap.
 */
export async function writeVerdict(slug, pass, failures = [], notes = '') {
  const dir = path.resolve(QA_ROOT, slug);
  await mkdir(dir, { recursive: true });
  const verdict = { pass: !!pass, failures, notes, at: new Date().toISOString() };
  await writeFile(path.join(dir, 'verdict.json'), JSON.stringify(verdict, null, 2));
  console.log(pass ? `✓ QA pass (${slug})` : `✗ QA fail (${slug}): ${failures.join(' | ')}`);
  return verdict;
}
