// Gate 2's built-page SEO check (design 2026-10-26-seo-dev-gate §5): when the diff touches an SEO path and the
// production build is served, scripts/seo/audit.mjs (IX) and scripts/seo/onpage.mjs (OP) run against it as
// https://swishquest.com. IX failures are QA failures, one per id; a transient (`transient: true`) result,
// an infra exit (2) or a timeout is a note; OP failures are warnings (notes) only. A non-SEO diff runs nothing.
// Runners are injected so the decision and the line formats are tested without a server.
import { readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { touchesSeo } from "../../seo/lib/seo-paths.mjs";

export const SEO_ORIGIN = "https://swishquest.com";
const EVIDENCE_LINES = 3;
const LINE_MAX = 300;

/** Arguments (after `node`) for the worktree's audit.mjs / onpage.mjs against the served build. */
export function seoArgs({ repo, script, baseUrl, runDir, asOrigin = SEO_ORIGIN }) {
  return [join(repo, `scripts/seo/${script}.mjs`), "--site", baseUrl, "--as", asOrigin, "--run-dir", runDir];
}

const isTransient = (f) => f.transient === true; // audit.mjs drops the flag when a real reason joins a failed request
const evidenceLine = (f) => `${f.url}: ${f.evidence}`.slice(0, LINE_MAX);
const lastLine = (r) => `${r.stderr || ""}\n${r.stdout || ""}`.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).pop() || "no output";
const urlCount = (stdout) => String(stdout || "").match(/· (\d+) urls ·/)?.[1] ?? "?";

/**
 * An audit results.json (AuditResult) → { failures: one `seo IX-nn: <evidence> | …` per failing id (≤ 3 evidence
 * lines, transient ones left out), transient: the left-out lines, ids: the failing ids }.
 */
export function auditFailureLines(result) {
  const all = [...Object.values(result.urls || {}).flatMap((u) => u.failures || []), ...(result.siteFailures || [])]
    .sort((a, b) => a.id.localeCompare(b.id) || a.url.localeCompare(b.url));
  const byId = new Map();
  const transient = [];
  for (const f of all) {
    if (isTransient(f)) { transient.push(evidenceLine(f)); continue; }
    if (!byId.has(f.id)) byId.set(f.id, []);
    byId.get(f.id).push(evidenceLine(f));
  }
  const failures = [...byId].map(([id, lines]) => {
    const more = lines.length - EVIDENCE_LINES;
    return `seo ${id}: ${lines.slice(0, EVIDENCE_LINES).join(" | ")}${more > 0 ? ` (+${more} more)` : ""}`;
  });
  return { failures, transient, ids: [...byId.keys()] };
}

/** onpage-summary.md → [{ id, area, urls }], one per `## FAIL OP-nn <area>` header (urls = its `- ` lines). */
export function onpageWarnings(summary) {
  const out = [];
  for (const line of String(summary || "").split(/\r?\n/)) {
    const h = line.match(/^## FAIL (OP-\d+)\s*(.*)$/);
    if (h) { out.push({ id: h[1], area: h[2].trim(), urls: 0 }); continue; }
    if (line.startsWith("## ")) { out.push(null); continue; } // a later section ends the current FAIL list
    if (line.startsWith("- ") && out.at(-1)) out.at(-1).urls += 1;
  }
  return out.filter(Boolean);
}

/**
 * @param {{ touched: string[], prodBuild: boolean, baseUrl: string, runDir: string, repo: string,
 *   run: (args: string[], timeoutMs: number) => Promise<{ status: number|null, timedOut?: boolean, stdout: string, stderr: string }>,
 *   readFile?: (path: string) => string, reset?: (dir: string) => void, asOrigin?: string, timeoutMs?: number }} opts
 *   A run killed on its timeout reports `timedOut: true` (on Windows `taskkill /F` leaves status 1, not null).
 * @returns {Promise<{ ran: boolean, failures: string[], notes: string[] }>} notes[0] is the one-line SEO result
 */
export async function seoGate({ touched, prodBuild, baseUrl, runDir, repo, run, readFile = (p) => readFileSync(p, "utf8"), reset = (d) => rmSync(d, { recursive: true, force: true }), asOrigin = SEO_ORIGIN, timeoutMs = 5 * 60000 }) {
  if (!touchesSeo(touched)) return { ran: false, failures: [], notes: [] };
  if (!prodBuild) return { ran: false, failures: [], notes: ["seo: built-page check skipped (served by next dev, it needs the production build)"] };
  reset(runDir);
  const failures = [];
  const warnings = [];
  const timedOut = (r) => r.timedOut === true || r.status === null;
  const minutes = `${Math.round(timeoutMs / 60000)} min`;
  let ix;

  const audit = await run(seoArgs({ repo, script: "audit", baseUrl, runDir, asOrigin }), timeoutMs);
  if (timedOut(audit)) ix = `IX not judged (seo audit timed out after ${minutes})`;
  else if (audit.status === 0) ix = `IX pass (${urlCount(audit.stdout)} urls)`;
  else if (audit.status === 1 || audit.status === 3) {
    let parsed = null;
    try { parsed = auditFailureLines(JSON.parse(readFile(join(runDir, "results.json")))); }
    catch (e) {
      const fails = String(audit.stdout || "").split(/\r?\n/).map((l) => l.match(/^seo-audit: FAIL (IX-\d+) · (.*)$/)).filter(Boolean);
      const why = String(e.message || e).split("\n")[0].slice(0, 120);
      failures.push(...(fails.length ? fails.map((m) => `seo ${m[1]}: ${m[2]} (results.json unreadable: ${why})`) : [`seo audit: exit ${audit.status}, results.json unreadable: ${why}`]));
      ix = `IX FAIL (${urlCount(audit.stdout)} urls)`;
    }
    if (parsed) {
      failures.push(...parsed.failures);
      if (parsed.failures.length) ix = `IX FAIL ${parsed.ids.join(", ")} (${urlCount(audit.stdout)} urls${parsed.transient.length ? `; transient left out: ${parsed.transient.length}` : ""})`;
      else ix = `IX not judged, only transient failures (${parsed.transient.length}): ${parsed.transient[0] || "-"}`;
    }
  } else ix = `IX not judged (exit ${audit.status}): ${lastLine(audit).slice(0, 200)}`;

  let op;
  const onpage = await run(seoArgs({ repo, script: "onpage", baseUrl, runDir, asOrigin }), timeoutMs);
  if (timedOut(onpage)) op = `on-page not judged (seo on-page timed out after ${minutes})`;
  else if (onpage.status === 0) op = "on-page 0 warning(s)";
  else if (onpage.status === 1) {
    let list = null;
    try { list = onpageWarnings(readFile(join(runDir, "onpage-summary.md"))); } catch { /* below */ }
    if (list) {
      warnings.push(...list.map((w) => `seo warning ${w.id} ${w.area} (${w.urls} url(s))`.replace(/ {2,}/g, " ")));
      op = `on-page ${list.length} warning(s)`;
    } else op = "on-page failed checks (onpage-summary.md unreadable)";
  } else op = `on-page not judged (exit ${onpage.status}): ${lastLine(onpage).slice(0, 200)}`;

  return { ran: true, failures, notes: [`seo: ${ix} · ${op}`, ...warnings] };
}
