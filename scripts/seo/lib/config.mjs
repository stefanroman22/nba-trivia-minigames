// SEO agent configuration: scripts/seo/config.json, with env SEO_SITE overriding `site` (e.g. a preview deploy or a
// local server).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const CONFIG_PATH = fileURLToPath(new URL('../config.json', import.meta.url));

/**
 * The parsed config.json → { site, property, expectedNoindex, driveFolderId, indexNowKey, slackChannel, inspectBudget }.
 * A non-empty env SEO_SITE replaces `site` (trailing slashes dropped).
 */
export function loadConfig() {
  const config = JSON.parse(readFileSync(CONFIG_PATH, 'utf8'));
  const override = process.env.SEO_SITE?.trim();
  if (override) config.site = override.replace(/\/+$/, '');
  return config;
}
