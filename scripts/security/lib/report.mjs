// What the scan writes for people and agents (pure): the weekly parent ticket (one Notion card, groups by root cause and
// area, ordered by severity), the PR comment (public repo: no exploit paths) and the fix spec the team pipeline's direct
// mode builds from (scripts/team/direct.mjs).
import { SEVERITIES, bySeverity, sevRank } from './finding.mjs';

const SEV_LABEL = { critical: 'CRITICAL', high: 'HIGH', medium: 'MEDIUM', low: 'LOW' };
const loc = (f) => `${f.file || '(repo)'}${f.line ? `:${f.line}` : ''}`;
const human = (s) => String(s).replace(/::.*$/, '').replace(/-/g, ' ');

/** findings → groups [{ key, severity, priority, category, area, findings }] ordered by severity, then priority, then size. */
export function groupFindings(findings) {
  const by = new Map();
  for (const f of findings) {
    const key = f.category === 'secret' ? 'leaked-secrets' : f.category === 'dependency' ? f.rootCause : `${f.rootCause}::${f.area}`;
    if (!by.has(key)) by.set(key, []);
    by.get(key).push(f);
  }
  return [...by.entries()].map(([key, fs]) => {
    fs.sort(bySeverity);
    return { key, severity: fs[0].severity, priority: Math.min(...fs.map((f) => f.priority)), category: fs[0].category, area: [...new Set(fs.map((f) => f.area))].join(', '), findings: fs };
  }).sort((a, b) => sevRank(b.severity) - sevRank(a.severity) || a.priority - b.priority || b.findings.length - a.findings.length || a.key.localeCompare(b.key));
}

export function groupTitle(g) {
  if (g.key === 'leaked-secrets') return `Leaked secrets (${g.findings.length})`;
  if (g.findings.length === 1) return g.findings[0].title;
  if (g.category === 'dependency') return `Vulnerable dependencies in ${g.findings[0].file} (${g.findings.length} packages)`;
  return `${human(g.key)} (${g.findings.length} places)`;
}

export function counts(findings) {
  const c = Object.fromEntries(SEVERITIES.map((s) => [s, 0]));
  for (const f of findings) c[f.severity] = (c[f.severity] || 0) + 1;
  return c;
}
export const countText = (c) => SEVERITIES.filter((s) => c[s]).map((s) => `${c[s]} ${s}`).join(', ') || 'none';

const CARD_CATEGORY = { backend: 'backend', multiplayer: 'backend', frontend: 'frontend', ci: 'CI/CD', tooling: 'pipeline', deps: 'fullstack', other: 'fullstack' };
export function cardCategory(findings) {
  const cats = new Set(findings.map((f) => CARD_CATEGORY[f.area] || 'fullstack'));
  return cats.size === 1 ? [...cats][0] : 'fullstack';
}
export function cardPriority(findings) {
  const top = Math.max(...findings.map((f) => sevRank(f.severity)));
  return top >= 3 ? 'P0' : top === 2 ? 'P1' : 'P2';
}

/** Group fix steps: each finding's steps, prefixed with its location when the group has several, duplicates dropped. */
function groupSteps(g) {
  const seen = new Set(), out = [];
  for (const f of g.findings) for (const s of f.fix) {
    const text = g.findings.length > 1 && !s.includes(f.file) ? `(\`${loc(f)}\`) ${s}` : s;
    if (!seen.has(text)) { seen.add(text); out.push(text); }
  }
  return out;
}

/**
 * The weekly parent ticket → { title, body (markdown-lite for scripts/lib/notion-blocks.mjs), priority, category, source }.
 * Numbered fix steps run across the whole card (1..N) and name files, so the pipeline's brief takes them as the plan.
 */
export function weeklyTicket(findings, { date, runUrl = '', runId = '' }) {
  const groups = groupFindings(findings);
  const c = counts(findings);
  const lines = [
    `## Security scan ${date}: ${findings.length} new finding(s) — ${countText(c)}`,
    `Weekly full-repository security scan (gitleaks over the full git history, osv-scanner on the lockfiles, Claude security review with .security/scan-instructions.md)${runUrl ? `, run ${runUrl}` : ''}. Only findings with confidence ≥ 8 that are not already ticketed; groups are one root cause each, most severe first. The attached findings.json holds every finding with its fingerprint. See docs/security/README.md.`,
    `Work order: fix the groups top to bottom, one commit is fine. Every step below names its file. Do not weaken a check to make a finding disappear; a false positive goes into .security/ignore.json with a reason instead.`,
  ];
  let n = 0;
  groups.forEach((g, gi) => {
    lines.push(`## ${gi + 1}. [${SEV_LABEL[g.severity]}] ${groupTitle(g)}`);
    lines.push(`Category ${g.category} · area ${g.area} · ${g.findings.length} finding(s) · confidence ${Math.min(...g.findings.map((f) => f.confidence))}–${Math.max(...g.findings.map((f) => f.confidence))}`);
    lines.push('### Affected files');
    for (const f of g.findings) lines.push(`- \`${loc(f)}\`${f.commit ? ` (commit ${f.commit.slice(0, 7)})` : ''} — ${f.title} [${f.severity}, confidence ${f.confidence}, fp ${f.fingerprint}]`);
    lines.push('### Why it is exploitable');
    for (const f of g.findings) lines.push(`- ${f.exploitPath || f.title}`);
    if (g.key === 'leaked-secrets') {
      lines.push('### Owner actions first (the pipeline cannot do these)');
      lines.push('- Revoke / rotate every credential below at its provider BEFORE anything else: the leaked value stays valid, and readable by anyone who clones this public repository, until it is revoked. Deleting it from the code alone is not a fix.');
      lines.push('- Purge it from git history (git filter-repo --replace-text <file of the leaked values>, then a force-push of every branch that carries it; GitHub support for cached views). The pipeline never force-pushes, so this is a human step.');
      lines.push('- Update docs/CREDENTIALS.md (new expiry, where the new value lives).');
    }
    lines.push('### Fix steps');
    for (const s of groupSteps(g)) lines.push(`${++n}. ${s}`);
    lines.push('### Acceptance criteria');
    for (const a of [...new Set(g.findings.map((f) => f.acceptance).filter(Boolean))]) lines.push(`- ${a}`);
    lines.push(`- A re-scan (security workflow, workflow_dispatch) reports none of these fingerprints: ${g.findings.map((f) => f.fingerprint).join(', ')}.`);
    lines.push('### How to verify (test to add)');
    for (const v of [...new Set(g.findings.map((f) => f.verify).filter(Boolean))]) lines.push(`- ${v}`);
  });
  const fps = findings.map((f) => f.fingerprint);
  const source = `security-check fp:${fps.slice(0, 60).join(',')}${fps.length > 60 ? `,+${fps.length - 60}` : ''} run:${runId}`;
  return { title: `[security] Weekly scan ${date}: ${findings.length} new (${countText(c)})`, body: lines.join('\n') + '\n', priority: cardPriority(findings), category: cardCategory(findings), source };
}

export const COMMENT_MARKER = '<!-- security-scan -->';

/**
 * The PR comment (one per PR, edited in place). Public repository: location, category, severity and fix steps only;
 * exploit paths stay in the private state and the fix brief.
 */
export function prComment({ blockingFindings = [], otherFindings = [], result, rounds = 0, maxRounds = 2, autofix = true, note = '' }) {
  const lines = [COMMENT_MARKER];
  if (result === 'pass') lines.push(`### Security scan: passed${rounds ? ` after ${rounds} auto-fix round(s)` : ''}`);
  else lines.push(`### Security scan: blocked — ${blockingFindings.length} high/critical finding(s)`);
  if (note) lines.push('', note);
  const table = (fs) => ['| Severity | Category | Location | Finding |', '|---|---|---|---|', ...fs.map((f) => `| ${f.severity} | ${f.category} | \`${loc(f)}\` | ${f.title.replace(/\|/g, '\\|')} |`)];
  if (blockingFindings.length) {
    lines.push('', result === 'pass' ? 'Fixed on this branch:' : 'Blocking (required check `security/pr-scan`):', '', ...table(blockingFindings));
    if (result !== 'pass') {
      lines.push('', autofix
        ? `The fix pipeline ran ${rounds} of ${maxRounds} round(s) and the findings are still there: **a human has to fix or dismiss them** (a false positive goes into \`.security/ignore.json\` with a reason). Push a fix and the scan re-runs.`
        : 'Auto-fix does not run for this PR (fork, untrusted author, or a gate branch): **a human has to fix or dismiss these.**');
      for (const f of blockingFindings) { lines.push('', `**${f.title}** (\`${loc(f)}\`)`); for (const s of f.fix) lines.push(`- ${s}`); }
    }
  }
  if (otherFindings.length) {
    lines.push('', `Not blocking (medium/low, added to the weekly security ticket):`, '', ...table(otherFindings));
    for (const f of otherFindings) { lines.push('', `**${f.title}** (\`${loc(f)}\`)`); for (const s of f.fix) lines.push(`- ${s}`); }
  }
  if (blockingFindings.some((f) => f.category === 'secret') || otherFindings.some((f) => f.category === 'secret')) {
    lines.push('', '**A secret reached this public branch: revoke / rotate it at the provider now.** Removing it from the code does not un-publish it; squash-merge so the commit that holds it never reaches `main`, and delete this branch afterwards.');
  }
  if (!blockingFindings.length && !otherFindings.length) lines.push('', 'No findings with confidence ≥ 8 in this diff.');
  lines.push('', '<sub>gitleaks + osv-scanner + Claude security review on the diff · docs/security/README.md</sub>');
  return lines.join('\n') + '\n';
}

/** The team pipeline's direct-mode spec for a PR branch: numbered steps naming files first (the brief's plan), then the findings in full. */
export function fixSpec(findings, { branch, pr = null, round = 1 }) {
  const sorted = [...findings].sort(bySeverity);
  const lines = [
    `Security auto-fix, round ${round}, on branch \`${branch}\`${pr ? ` (PR #${pr} → main)` : ''}. These findings block the merge (required check security/pr-scan).`,
    `Fix each at its root with the smallest change that removes the exploit path; keep behaviour otherwise. Add the test named under "How to verify" where the area has a test suite. Do not suppress a finding (no ignore entries, no disabling checks); if one is a false positive, change nothing for it and say why in build-report.json "assumed".`,
    '',
  ];
  let n = 0;
  // a step that names no file gets the finding's, so the brief's plan detection (scripts/team/lib/steps.mjs) sees one
  for (const f of sorted) for (const s of f.fix) lines.push(`${++n}. ${!f.file || /[\w.-]+\/[\w./-]+/.test(s) ? s : `In \`${f.file}\`: ${s}`}`);
  lines.push('', '## Findings');
  for (const f of sorted) {
    lines.push('', `### ${f.title} [${f.severity}, confidence ${f.confidence}, ${f.category}]`);
    lines.push(`- Location: \`${loc(f)}\`${f.snippet && f.tool === 'claude' ? ` — \`${f.snippet}\`` : ''}`);
    lines.push(`- Exploit path: ${f.exploitPath}`);
    if (f.acceptance) lines.push(`- Acceptance: ${f.acceptance}`);
    if (f.verify) lines.push(`- How to verify: ${f.verify}`);
  }
  return lines.join('\n') + '\n';
}
