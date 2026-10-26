// robots.txt as Google reads it (RFC 9309 + Google's robots spec): groups of User-agent lines with their Allow and
// Disallow rules, Sitemap lines anywhere, and every other directive reported as unsupported (Google ignores noindex,
// crawl-delay, host and the rest, so a site that relies on one is relying on nothing).

const SUPPORTED = new Set(['user-agent', 'allow', 'disallow', 'sitemap']);

/**
 * @param {string} text the robots.txt body
 * @returns {{ groups: { agents: string[], allow: string[], disallow: string[] }[], sitemaps: string[], unsupported: string[] }}
 *   `unsupported` holds each line whose directive Google does not support (or that has no `directive:`), as written
 *   without its comment. An empty Allow/Disallow value adds no rule.
 */
export function parseRobots(text) {
  const groups = [];
  const sitemaps = [];
  const unsupported = [];
  let group = null;
  let inRules = false;
  for (const raw of String(text ?? '').replace(/^﻿/, '').split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, '').trim();
    if (!line) continue;
    const colon = line.indexOf(':');
    const directive = colon < 0 ? '' : line.slice(0, colon).trim().toLowerCase();
    const value = colon < 0 ? '' : line.slice(colon + 1).trim();
    if (!SUPPORTED.has(directive)) { unsupported.push(line); continue; }
    if (directive === 'sitemap') { if (value) sitemaps.push(value); continue; }
    if (directive === 'user-agent') {
      // Consecutive User-agent lines share one group; a User-agent after a rule starts the next group.
      if (!group || inRules) { group = { agents: [], allow: [], disallow: [] }; groups.push(group); inRules = false; }
      group.agents.push(value);
      continue;
    }
    if (!group) continue; // a rule before any User-agent line belongs to no group (Google ignores it)
    inRules = true;
    if (value) group[directive].push(value);
  }
  return { groups, sitemaps, unsupported };
}

/** True when a robots path pattern (`*` = any run of characters, a trailing `$` = end of the path) matches `path`. */
function matches(pattern, path) {
  const anchored = pattern.endsWith('$');
  const body = (anchored ? pattern.slice(0, -1) : pattern).split('*').map((s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*');
  return new RegExp(`^${body}${anchored ? '$' : ''}`).test(path);
}

/**
 * Whether `agent` may crawl `url` under `robots` (a parseRobots result): the groups naming the agent (case-insensitive),
 * else the `*` groups, merged; among their rules matching the path (with the query), the longest pattern wins and a tie
 * goes to Allow; no matching rule (or no group) allows.
 *
 * @param {ReturnType<typeof parseRobots>} robots
 * @param {string} url
 * @param {string} [agent]
 * @returns {boolean}
 */
export function robotsAllows(robots, url, agent = '*') {
  const name = agent.toLowerCase();
  const named = robots.groups.filter((g) => g.agents.some((a) => a.toLowerCase() === name));
  const selected = named.length ? named : robots.groups.filter((g) => g.agents.includes('*'));
  const u = new URL(url);
  const path = `${u.pathname}${u.search}`;
  const longest = (kind) => Math.max(-1, ...selected.flatMap((g) => g[kind]).filter((p) => matches(p, path)).map((p) => p.length));
  return longest('disallow') <= longest('allow');
}
