// Check cards (docs/team/PIPELINE.md § "Check cards"): Notion cards made by scripts/check-core/notion-push.mjs
// from ui-check / logic-check findings. Their `findings.json` attachment is the source of truth for the brief's
// `## Check findings` section and for gate 2, which runs `verify.mjs --from <file>` (spec §3.5).
import { basename } from "node:path";

/** A card whose Source starts with ui-check / logic-check. */
export const isCheckCard = (card) => /^(ui|logic)-check\b/.test(String(card?.source || ""));

/**
 * The findings.json path from get-spec's `[File attached: <path> (<label>)]` lines. The label is the
 * file name Notion holds, so it is stripped before the path is used; null when the card has none.
 */
export function findingsFileFrom(spec) {
  for (const m of String(spec || "").matchAll(/\[File attached: ([^\]]+)\]/g)) {
    const [, path, label] = m[1].trim().match(/^(.*?)(?: \(([^()]*)\))?$/);
    if (basename(path.replace(/\\/g, "/")) === "findings.json" || label === "findings.json") return path;
  }
  return null;
}

/** card.json fields of a Notion row + its spec: { source, target, findingsFile }. `readable(path)` checks the file. */
export function checkFields(row, spec, readable = () => true) {
  const file = findingsFileFrom(spec);
  return {
    source: row?.source ? String(row.source) : null,
    target: row?.target === "main" ? "main" : "dev",
    findingsFile: file && readable(file) ? file : null,
  };
}

/** The finding objects of a findings.json document (an array or { findings }) → array, or null. */
export function findingsOf(doc) {
  const list = Array.isArray(doc) ? doc : Array.isArray(doc?.findings) ? doc.findings : null;
  return list && list.every((f) => f && typeof f.id === "string") ? list : null;
}

// fix.rules entry → constraint doc (spec §3.5: UI-→UI_SHELL, RULE→GAME_DESIGN, MP-→MULTIPLAYER, AUTH-→AUTH, BE-→BACKEND).
const PREFIX_DOCS = {
  UI: "docs/constraints/UI_SHELL_CONSTRAINTS.md",
  MP: "docs/constraints/MULTIPLAYER_CONSTRAINTS.md",
  AUTH: "docs/constraints/AUTH_CONSTRAINTS.md",
  BE: "docs/constraints/BACKEND_CONSTRAINTS.md",
};
const GAME_DOC = "docs/GAME_DESIGN_CONSTRAINTS.md";

/** One fix.rules entry → { id, doc } (id as rules.mjs extracts it: "UI-23", "6.2") or { ref } for anything else. */
export function ruleRef(entry) {
  const s = String(entry || "").trim();
  const game = s.match(/^(?:RULE|Rule)\s+(\d+(?:\.\d+)?[a-z]?)$/);
  if (game) return { id: game[1], doc: GAME_DOC };
  const pre = s.replace(/^(?:RULE|Rule)\s+/, "").match(/^([A-Z]+)-\d+$/);
  if (pre && PREFIX_DOCS[pre[1]]) return { id: pre[0], doc: PREFIX_DOCS[pre[1]] };
  return { ref: s };
}

/** Every fix.rules entry of the findings → { byDoc: Map(doc → Set(id)), docs: [doc], refs: [non-rule references] }. */
export function rulesOfFindings(findings) {
  const byDoc = new Map();
  const refs = [];
  for (const f of findings || []) for (const r of f.fix?.rules || []) {
    const x = ruleRef(r);
    if (x.doc) { if (!byDoc.has(x.doc)) byDoc.set(x.doc, new Set()); byDoc.get(x.doc).add(x.id); }
    else if (x.ref && !refs.includes(x.ref)) refs.push(x.ref);
  }
  return { byDoc, docs: [...byDoc.keys()], refs };
}

const bullets = (arr, fmt = (x) => x) => (arr || []).map((x) => `- ${fmt(x)}`);

/** One finding → markdown lines, verbatim from the JSON, capped at `max` lines. */
export function renderFinding(f, max = 60) {
  const w = f.where || {};
  const fix = f.fix || {};
  const acc = f.acceptance || {};
  const out = [
    `### ${f.id} · ${f.title || "(untitled)"}`,
    [f.severity, f.owner, w.route ? `route ${w.route}` : null, (w.viewports || []).length ? `viewports ${w.viewports.join(", ")}` : null].filter(Boolean).join(" · "),
    `**Current:** ${f.current || "—"}`,
    `**Expected:** ${f.expected || "—"}`,
    `**Files:**`,
    ...((f.files || []).length ? bullets(f.files, (x) => `${x.path}${x.line ? `:${x.line}` : ""} — ${x.why || ""}`.trim()) : ["- _none named_"]),
    `**How to fix:**`,
    ...bullets(fix.change, (x) => `Change: ${x}`),
    ...bullets(fix.reuse, (x) => `Reuse: ${x}`),
    ...bullets(fix.build, (x) => `Build: ${x}`),
    ...((fix.rules || []).length ? [`- Rules: ${fix.rules.join(", ")}`] : []),
    `**Acceptance:**`,
    ...bullets(acc.criteria),
    ...bullets(acc.checks, (c) => `check ${c.id} @ ${(c.projects || []).join(", ")} passes`),
    ...((acc.assertions || []).length ? [`- ${acc.assertions.length} DSL assertion(s) pass (see the findings file)`] : []),
    ``,
  ];
  if (out.length <= max) return out;
  const keep = out.slice(0, max - 1);
  keep.push(`_(… ${out.length - keep.length} more line(s) of ${f.id} in the findings file)_`);
  return keep;
}

/** `## Check findings` body for the brief: every finding, ≤ perFinding lines each, ≤ total lines overall. */
export function renderCheckFindings(findings, { file = null, perFinding = 60, total = 400 } = {}) {
  const head = [`Source of truth: \`${file || "findings.json"}\` (${findings.length} finding(s)); gate 2 runs \`verify.mjs --from\` on it and every finding must PASS.`, ``];
  const lines = [...head];
  let shown = 0;
  for (const f of findings) {
    const block = renderFinding(f, perFinding);
    if (lines.length + block.length > total - 1) break;
    lines.push(...block);
    shown += 1;
  }
  if (shown < findings.length) lines.push(`_(${findings.length - shown} more finding(s) not shown to keep the brief short — read them in the findings file; QA verifies all of them)_`);
  return lines.join("\n").trimEnd();
}

/** The QA assertions of a check card: earlier entries kept, exactly one { verify: file } at the end. */
export function withVerifyAssertion(prev, file) {
  const kept = (Array.isArray(prev) ? prev : []).filter((a) => !(a && a.verify));
  return [...kept, { verify: file }];
}

/** `verify` entries of the brief's QA assertions → file paths. */
export const verifyFilesOf = (assertions) => (assertions || []).filter((a) => a && typeof a.verify === "string" && a.verify.trim()).map((a) => a.verify.trim());

/**
 * What gate 2 verifies for a card → { check, files, error }. A check card is known from card.json (Source, or a
 * findingsFile), not only from the brief: with no parsed `verify` entry its findingsFile is used, and a check card
 * without one is an error (never a pass).
 */
export function verifyPlan(card, assertions) {
  const files = verifyFilesOf(assertions);
  const check = isCheckCard(card) || Boolean(card?.findingsFile);
  if (!check || files.length) return { check: check || files.length > 0, files, error: null };
  if (card.findingsFile) return { check, files: [card.findingsFile], error: null };
  return { check, files: [], error: "check card without findings attachment" };
}

/** The Notion comment `ship-card` posts: dev (default), main (Target = main) or a PR to main (relay change). */
export function shipCommentText({ sha, target = "dev", pr = null, devUrl = "" }) {
  const s = String(sha).slice(0, 7);
  if (pr) return `🔀 relay change — PR to main: ${pr} (${s}). Merge the PR with a merge commit (not squash/rebase), then run \`cd multiplayer_server && railway up\` in the same window; do not untick Needs human. main-sync marks this card Done once the PR is merged — a squash or rebase rewrites the SHA, and the card must then be set Done by hand.`;
  if (target === "main") return `✅ on main (${s}) — production deploys from main (swishquest.com); main-sync marks this card Done.`;
  return `✅ on dev (${s}) — check ${devUrl}`;
}

/** Argument list (after `node`) for gate 2's verify run on a lane. ports: { django, socket, vite|web }. */
export function verifyArgs({ root, file, repo, ports }) {
  const web = ports.web || ports.vite;
  return [`${root}/scripts/ui-check/verify.mjs`, "--from", file, "--mode", "dev", "--repo", repo,
    "--ports", `django=${ports.django},socket=${ports.socket},web=${web}`, "--keep-stack"];
}

/**
 * verify.mjs output → QA failures. Every `FAIL <id> — …` line is a failure verbatim; no PASS/FAIL line is
 * `verify infra: <last 3 lines>`; PASS + FAIL lines that do not add up to the summary's finding count (or no summary)
 * are an infra failure too; PASS lines only with a non-zero exit fail. No verdict line at all is never a pass.
 * @returns {{ failures: string[], passes: string[], summary: string|null }}
 */
export function parseVerifyOutput(stdout, stderr, status) {
  const lines = `${stdout || ""}\n${stderr || ""}`.split(/\r?\n/).map((l) => l.trimEnd()).filter((l) => l.trim());
  const fails = lines.filter((l) => /^FAIL \S+ — /.test(l));
  const passes = lines.filter((l) => /^PASS \S+ — /.test(l));
  const summary = lines.find((l) => /^verify: \d+ finding\(s\)/.test(l)) || null;
  const total = summary ? Number(summary.match(/^verify: (\d+)/)[1]) : null;
  const tail = () => lines.slice(-3).join(" | ").slice(0, 600);
  const failures = [...fails];
  if (!fails.length && !passes.length) failures.push(`verify infra: ${tail() || `exit ${status ?? "?"} with no output`}`);
  else if (total !== passes.length + fails.length) failures.push(`verify infra: ${passes.length} PASS + ${fails.length} FAIL line(s) but ${summary ? `the summary counts ${total}` : "no summary line"}: ${tail()}`);
  else if (!fails.length && status !== 0) failures.push(`verify exit ${status ?? "killed"} with ${passes.length} PASS line(s): ${tail()}`);
  return { failures, passes, summary };
}
