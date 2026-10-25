// Named locators: L(page, 'area.name') → a Playwright locator from pagemap/<area>.json, so specs
// share one place to fix when the app's markup changes. An entry is one of
//   { "role": "button", "name": "Log in", "exact": true }   → page.getByRole(role, { name, exact })
//   { "css": "nav.nav3 button.nav3-user:visible" }          → page.locator(css)
//   { "text": "Admins only", "exact": false }               → page.getByText(text, { exact })
// Keys starting with "_" are comments.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const DIR = fileURLToPath(new URL('../pagemap/', import.meta.url));
const cache = new Map();

function area(name) {
  if (!cache.has(name)) {
    let data;
    try { data = JSON.parse(readFileSync(`${DIR}${name}.json`, 'utf8')); } catch (e) {
      throw new Error(`pagemap: cannot read pagemap/${name}.json (${e.code || e.message})`);
    }
    cache.set(name, data);
  }
  return cache.get(name);
}

/** Locator for a pagemap key 'area.name' (relative to `page`, or to any locator passed instead). */
export function L(page, key) {
  const dot = key.indexOf('.');
  if (dot < 1) throw new Error(`pagemap: key "${key}" must look like "area.name"`);
  const map = area(key.slice(0, dot));
  const name = key.slice(dot + 1);
  const e = map[name];
  if (!e || name.startsWith('_')) {
    const known = Object.keys(map).filter((k) => !k.startsWith('_'));
    throw new Error(`pagemap: no "${name}" in pagemap/${key.slice(0, dot)}.json (known: ${known.join(', ')})`);
  }
  if (e.role) return page.getByRole(e.role, { ...(e.name !== undefined ? { name: e.name } : {}), ...(e.exact !== undefined ? { exact: e.exact } : {}) });
  if (e.css) return page.locator(e.css);
  if (e.text) return page.getByText(e.text, { exact: !!e.exact });
  throw new Error(`pagemap: entry "${key}" needs role, css or text`);
}

/** Choose `label` in the app's dropdown at pagemap `key` (src/components/ui/Select.tsx: a `role="combobox"` button
 *  whose listbox renders in a portal, never a native select) as a player does: open it, click the option, and wait
 *  until the trigger shows it. */
export async function pick(page, key, label) {
  const trigger = L(page, key);
  await trigger.click();
  const name = await trigger.getAttribute('aria-label');
  const list = name ? page.getByRole('listbox', { name, exact: true }) : page.getByRole('listbox');
  await list.getByRole('option', { name: label, exact: true }).click();
  await trigger.locator('.sel-sr').filter({ hasText: label }).waitFor({ state: 'attached', timeout: 5000 });
}
