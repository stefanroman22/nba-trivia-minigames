// Evidence screenshots: JPEG q70, CSS scale, crops padded 16px and kept inside the viewport.
// Files live at <runDir>/shots/<checkId>/<project>-<name>.jpg; callers get the path relative to runDir.
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { runDir } from './run-id.mjs';

export const JPEG = { type: 'jpeg', quality: 70, scale: 'css' };
export const PAD = 16;

const safe = (s) => String(s).replace(/[^\w@.+-]+/g, '-').replace(/^-+|-+$/g, '') || 'x';

/** { abs, rel } for a shot; creates the folder. */
export function shotPath(checkId, project, name) {
  const rel = `shots/${safe(checkId)}/${safe(project)}-${safe(name)}.jpg`;
  const abs = path.join(runDir(), ...rel.split('/'));
  mkdirSync(path.dirname(abs), { recursive: true });
  return { abs, rel };
}

/** Full-viewport JPEG (named states only). */
export async function viewportShot(page, abs) {
  await page.screenshot({ path: abs, ...JPEG });
  return true;
}

/** Crop a viewport-coord rect {x,y,w,h} padded by PAD; false when nothing of it is on screen. */
export async function rectShot(page, rect, abs) {
  const vs = page.viewportSize() || { width: 1280, height: 720 };
  const x = Math.max(0, Math.floor(rect.x - PAD));
  const y = Math.max(0, Math.floor(rect.y - PAD));
  const right = Math.min(vs.width, Math.ceil(rect.x + rect.w + PAD));
  const bottom = Math.min(vs.height, Math.ceil(rect.y + rect.h + PAD));
  if (right - x < 4 || bottom - y < 4) return false;
  await page.screenshot({ path: abs, ...JPEG, clip: { x, y, width: right - x, height: bottom - y } });
  return true;
}

/** Crop around a locator (scrolled into view first). */
export async function locatorShot(page, locator, abs) {
  await locator.scrollIntoViewIfNeeded({ timeout: 5000 }).catch(() => {});
  const box = await locator.boundingBox({ timeout: 5000 }).catch(() => null);
  if (!box) return false;
  return rectShot(page, { x: box.x, y: box.y, w: box.width, h: box.height }, abs);
}
