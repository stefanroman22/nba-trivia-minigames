import { existsSync } from 'node:fs';
import path from 'node:path';

/**
 * Browser channel, mirroring scripts/qa-browser.mjs#launchBrowser: installed Chrome on win32,
 * then Edge, else Playwright's bundled Chromium. Chosen by checking the install paths so a missing
 * channel never hard-fails the run. UI_CHECK_CHANNEL overrides ('' = bundled).
 * (Its own module so the Logic Check config can use it without loading ui-check's config.)
 */
export function pickChannel() {
  if (process.env.UI_CHECK_CHANNEL !== undefined) return process.env.UI_CHECK_CHANNEL || undefined;
  if (process.platform !== 'win32') return undefined;
  const roots = [process.env.PROGRAMFILES, process.env['PROGRAMFILES(X86)'], process.env.LOCALAPPDATA].filter(Boolean);
  const has = (rel) => roots.some((r) => existsSync(path.join(r, rel)));
  if (has('Google/Chrome/Application/chrome.exe')) return 'chrome';
  if (has('Microsoft/Edge/Application/msedge.exe')) return 'msedge';
  return undefined;
}
