// One SEO finding → an ordinary Notion team card (spec §8): properties for scripts/notion.mjs create-card and a
// markdown-lite body (scripts/lib/notion-blocks.mjs: ##/### headings, "- " bullets, paragraphs). Not a check card: Source
// `seo-check …` (never `ui-check`/`logic-check`), Target always dev, no attachment; the finding itself is the last
// fenced JSON block of the body. Pure apart from the default catalogue (CHECKS.md) and config (expectedNoindex) reads.
import { fpKey } from '../../check-core/lib/card-body.mjs';
import { readCatalogue } from './digest.mjs';
import { loadConfig } from './config.mjs';
import { GSC_CHECK } from './findings.mjs';

/** IX checks whose failure on a sitemap URL means the page cannot be indexed (P0, spec §8). */
const BLOCKING = ['IX-01', 'IX-02', 'IX-03', 'IX-04'];
const one = (s) => String(s ?? '').replace(/\s*\r?\n\s*/g, ' ').trim();
const pathOf = (u) => { try { return new URL(u).pathname.replace(/\/+$/, '') || '/'; } catch { return String(u); } };

/** P0 for a post-deploy regression and for IX-01..04 on a sitemap URL (any URL off the expected-noindex list), P2 for IX-12, else P1. */
export function priorityFor(f, { expectedNoindex = loadConfig().expectedNoindex } = {}) {
  if (f.regression === true) return 'P0';
  const noindex = new Set(expectedNoindex.map(pathOf));
  if (BLOCKING.includes(f.check) && (f.urls || []).some((u) => !noindex.has(pathOf(u)))) return 'P0';
  if (f.check === 'IX-12') return 'P2';
  return 'P1';
}

/** CI/CD when every file of the finding is a workflow (.github/), else frontend. */
export const categoryFor = (f) => ((f.files || []).length && f.files.every((x) => String(x).startsWith('.github/')) ? 'CI/CD' : 'frontend');

/**
 * { title, category, priority, difficulty, source, target, keys, body } for one finding. `regressionOf`: [{ id, url,
 * commit }] of the Done cards it came back after (a regression: P0); `priority` overrides the computed one (notion-push --priority).
 */
export function renderCard(f, { runId, site, regressionOf = [], priority = null, catalogue = readCatalogue(), expectedNoindex } = {}) {
  const what = f.check === GSC_CHECK ? 'Search Console' : (catalogue.get(f.check)?.what ?? '');
  const n = (f.urls || []).length;
  const key = fpKey(f.fingerprint);
  const card = {
    title: `[seo] ${regressionOf.length ? 'Regression: ' : ''}${`${f.check} ${what}`.trim()} on ${n} page(s)`,
    category: categoryFor(f),
    priority: priority || (regressionOf.length ? 'P0' : priorityFor(f, expectedNoindex ? { expectedNoindex } : {})),
    difficulty: 'standard',
    source: `seo-check fp:${key} run:${runId}`,
    target: 'dev',
    keys: [key],
  };
  const L = [];
  L.push(`SEO check run ${runId} (site ${site}) found ${f.check} ${what} failing on ${n} page(s)${f.regression ? ' after a production deploy (it passed in the baseline)' : ''}. Finding ${f.id}, severity ${f.severity}. Target: dev.`);
  if (regressionOf.length) L.push(`Regression: this came back after ${regressionOf.map((r) => `${r.url} (Done, commit ${String(r.commit || '?').slice(0, 7)} on origin/main)`).join(', ')}.`);
  L.push('## Current');
  L.push(one(f.current));
  for (const u of f.urls || []) L.push(`- ${u}`);
  L.push('## Expected');
  L.push(one(f.expected));
  L.push('## Files');
  for (const x of f.files || []) L.push(`- ${one(x)}`);
  L.push('## How to fix');
  L.push(one(f.howToFix));
  L.push('## Acceptance');
  L.push(`- ${one(f.acceptance?.audit)} passes (before shipping, run it with --site set to a dev preview or localhost)`);
  (f.acceptance?.qa || []).forEach((q, i) => L.push(`- QA assertion #${i + 1}: on ${q.route}, ${q.selector} → ${one(q.expect)}`));
  L.push(`- Fingerprint (Source key): ${key} = ${f.fingerprint}`);
  L.push('## QA assertions');
  L.push('```json', JSON.stringify(f.acceptance?.qa || [], null, 2), '```');
  L.push('## Finding');
  L.push('```json', JSON.stringify(f, null, 2), '```');
  card.body = L.join('\n') + '\n';
  return card;
}
