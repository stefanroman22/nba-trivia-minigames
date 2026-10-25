// A cluster of findings → Notion card properties and a markdown-lite body (scripts/lib/notion-blocks.mjs parses it:
// ##/### headings, "- " bullets, one ![caption](local image) per finding, paragraphs). Pure: image existence is injected.
// Spec: docs/superpowers/specs/2026-10-15-checks-prod-logic-design.md §3.4.
import { createHash } from 'node:crypto';
import path from 'node:path';
import { SEVERITIES, checkId, describeAssertion } from './findings.mjs';

/** Short, comma/space-free key of a fingerprint for the card's Source property (Notion `contains` search). */
export const fpKey = (fp) => createHash('sha1').update(String(fp)).digest('hex').slice(0, 12);
/** Keys of a finding: its fingerprint and every fingerprint merged into it (a later run may report either). */
export const findingKeys = (f) => [...new Set([f.fingerprint, ...(f.mergedFingerprints || [])].filter(Boolean).map(fpKey))];
/** notion.mjs text() keeps 1900 chars of a rich_text value. */
export const SOURCE_MAX = 1900;
/** Findings rendered in full on a card; the rest are listed by id (the attachment holds every finding object). */
export const BODY_FULL = 8;

const CATEGORY = { frontend: 'frontend', backend: 'backend', ci: 'CI/CD' };
const PRIORITY = { blocker: 'P0', major: 'P1' };
const one = (s) => String(s ?? '').replace(/\s*\r?\n\s*/g, ' ').trim();
const sevRank = (s) => { const i = SEVERITIES.indexOf(s); return i < 0 ? SEVERITIES.length : i; };

/** Highest-severity finding first; ties keep cluster order. */
export const bySeverity = (items) => items.map((f, i) => [f, i]).sort((a, b) => sevRank(a[0].severity) - sevRank(b[0].severity) || a[1] - b[1]).map(([f]) => f);

export function cardMeta(cluster, { checker = 'ui', runId, target = 'main', regression = false }) {
  const items = bySeverity(cluster.items);
  const lead = items[0];
  const more = items.length > 1 ? ` (+${items.length - 1})` : '';
  const keys = [...new Set(items.flatMap(findingKeys))];
  return {
    title: `[${checker}-check] ${regression ? 'Regression: ' : ''}${one(lead.title)}${more}`,
    category: CATEGORY[lead.owner] || 'backend',
    priority: PRIORITY[lead.severity] || 'P2',
    difficulty: items.some((f) => f.severity === 'blocker' || (f.owner === 'backend' && f.category === 'security')) ? 'hard' : 'standard',
    source: `${checker}-check fp:${keys.join(',')} ids:${items.map((f) => f.id).join(',')} run:${runId}`,
    target,
    keys,
    ids: items.map((f) => f.id),
  };
}

/** The one image a finding gets on the card: its check's contact sheet, else its first shot (null when none exists). */
export function evidenceImage(f, runDir, exists) {
  const sheet = f.evidence?.checkId ? path.join(runDir, 'sheets', `${f.evidence.checkId}.jpg`) : null;
  if (sheet && exists(sheet)) return sheet;
  const shot = (f.evidence?.shots || []).map((s) => path.join(runDir, s)).find(exists);
  return shot || null;
}

/** The engine protocol section a card points to, per checker. */
export const PROTOCOL = { ui: 'Fixing a UI-check finding', logic: 'Fixing a Logic-check finding' };
/** The verify command a card names for one finding, the same for both checkers: the pipeline lane has no run dir, so it
 *  verifies the attached findings.json in dev mode. (`--run <runId>` stays in the local ui-fix / logic-check skill flows.) */
export const verifyCommand = (f) => `node scripts/ui-check/verify.mjs ${f.id} --from <attached findings.json> --mode dev`;

const metric = (m) => (typeof m === 'string' ? m : `${m.label} ${m.value}${m.unit || ''}${m.vp ? ` @${m.vp}` : ''}`);

/**
 * { markdown, images } for one card. `regressionOf`: [{ url, commit }] of the Done cards the cluster came back after.
 * `exists(path)` decides which evidence files are there (fs.existsSync in production, a stub in tests).
 */
export function renderBody(cluster, { checker = 'ui', runId, runDir, meta = {}, target = 'main', regressionOf = [], exists = () => false }) {
  const items = bySeverity(cluster.items);
  const L = [];
  const head = meta.head ? ` · code ${meta.ref ? `${meta.ref}@` : ''}${String(meta.head).slice(0, 7)}` : '';
  L.push(`${checker === 'ui' ? 'UI' : 'Logic'} check run ${runId} (${meta.mode || '?'} build${head}) found ${items.length} open finding(s) that share files or acceptance checks, so they are fixed together by ${cluster.engine}${cluster.prod ? ' (perf budgets: verify in a prod build)' : ''}. Target: ${target}.`);
  if (regressionOf.length) L.push(`Regression: these came back after ${regressionOf.map((r) => `${r.url} (Done, commit ${String(r.commit || '?').slice(0, 7)} on origin/main)`).join(', ')}.`);
  L.push('## Findings');
  const used = new Set();
  for (const f of items.slice(0, BODY_FULL)) {
    L.push(`### ${f.id} · ${one(f.title)}`);
    L.push(`${f.severity} · ${f.owner} · ${f.category || '-'} · route ${f.where?.route || '/'} · viewports ${(f.where?.viewports || []).join(', ') || '-'}${f.where?.state ? ` · state: ${one(f.where.state)}` : ''}`);
    L.push(`Current: ${one(f.current)}`);
    L.push(`Expected: ${one(f.expected)}`);
    const ev = f.evidence || {};
    L.push(`Evidence: check ${ev.checkId || '-'}${(ev.metrics || []).length ? ` · ${ev.metrics.map(metric).join('; ')}` : ''} · selector ${one(f.where?.selector) || '-'}`);
    const img = evidenceImage(f, runDir, exists);
    if (img && !used.has(img)) { used.add(img); L.push(`![${f.id} ${ev.checkId || ''}](${img})`); } else if (img) L.push(`- contact sheet (above): ${img}`);
    for (const s of ev.shots || []) if (path.join(runDir, s) !== img) L.push(`- shot (run dir): ${s}`);
    L.push('Files:');
    for (const x of f.files || []) L.push(`- ${x.path}${x.line ? `:${x.line}` : ''} — ${one(x.why)}`);
    L.push('How to fix:');
    const fix = f.fix || {};
    for (const c of fix.change || []) L.push(`- Change: ${one(c)}`);
    for (const c of fix.reuse || []) L.push(`- Reuse: ${one(c)}`);
    for (const c of fix.build || []) L.push(`- Build: ${one(c)}`);
    if ((fix.rules || []).length) L.push(`- Rules: ${fix.rules.join(', ')}`);
    L.push('Acceptance:');
    const ac = f.acceptance || {};
    for (const c of ac.criteria || []) L.push(`- ${one(c)}`);
    for (const c of ac.checks || []) L.push(`- check ${checkId(c)}${(c.projects || []).length ? ` @ ${c.projects.join(', ')}` : ''} passes`);
    (ac.assertions || []).forEach((a, i) => L.push(`- assertion #${i + 1}: ${one(describeAssertion(a))}`));
    L.push(`- verify: ${verifyCommand(f)}`);
  }
  const rest = items.slice(BODY_FULL);
  if (rest.length) L.push(`Also in this cluster (${rest.length} more; full objects in the attached findings.json): ${rest.map((f) => `${f.id} ${f.severity}`).join(', ')}`);
  L.push('## Pipeline');
  L.push(`- Engine protocol: "${PROTOCOL[checker] || PROTOCOL.ui}" in .claude/agents/${cluster.engine}.md; the full finding objects are in the attached findings.json (this body is a summary).`);
  L.push('- QA: verify assertion runs the attached findings (node scripts/ui-check/verify.mjs --from <attached findings.json>); every finding must PASS.');
  L.push(target === 'main'
    ? `- Ship: Target main — branch from origin/main, PR into main, then back-merge main into dev.${items.some((f) => (f.files || []).some((x) => String(x.path).startsWith('multiplayer_server/'))) ? ' Relay (multiplayer_server/): the PR to main deploys it on merge (relay-deploy.yml, after the production frontend).' : ''}`
    : '- Ship: Target dev — the normal pipeline flow.');
  L.push('- Fingerprints (Source key = rule|route|selector):');
  for (const f of items) for (const fp of [f.fingerprint, ...(f.mergedFingerprints || [])]) L.push(`- ${fpKey(fp)} = ${fp}`);
  return { markdown: L.join('\n') + '\n', images: [...used] };
}

/** The attachment: the cluster's full finding objects (verify.mjs --from reads { findings }). */
export function attachmentDoc(cluster, { checker = 'ui', runId, meta = {}, source }) {
  return { checker, runId, mode: meta.mode || null, ref: meta.ref || null, head: meta.head || null, source, generatedAt: new Date().toISOString(), findings: cluster.items };
}
