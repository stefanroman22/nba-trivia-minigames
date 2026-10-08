#!/usr/bin/env node
// Brief node (design §6): one context pack per card so no agent re-reads the constraint docs.
// Reads .team/run/<slug>/card.json + classify.json, writes brief.md, prints
//   { brief, hasPlan, needsPlan, lines, rulesQuoted }
// Usage: node scripts/team/brief.mjs <slug> [--design <path>] [--repo <dir>]
import { existsSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { ROOT } from "../lib/team-config.mjs";
import { detectSteps } from "./lib/steps.mjs";
import { extractRules, selectRules, ruleIndex } from "./lib/rules.mjs";
import { classifyTouched } from "./lib/touched.mjs";
import { runDir, readJson, writeState } from "./lib/state.mjs";
import { writeFileSync } from "node:fs";

const argv = process.argv.slice(2);
const slug = argv[0];
const arg = (k, d = null) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
if (!slug || slug.startsWith("--")) { console.error("usage: brief.mjs <slug> [--design <path>] [--repo <dir>]"); process.exit(2); }
const repo = resolve(arg("--repo", ROOT));
const designPath = arg("--design");
const dir = runDir(slug);
const card = readJson(resolve(dir, "card.json"));
const classify = readJson(resolve(dir, "classify.json"), {});
if (!card) { console.error(`no card.json for ${slug} — run intake first`); process.exit(2); }

const MAX_LINES = 400;
const tier = classify.difficulty || card.tier || "standard";
const engine = classify.engineModel || "sonnet";
const steps = detectSteps(card.spec);
const hasPlan = steps.hasPlan && tier !== "hard";
const needsPlan = !hasPlan && !designPath && tier !== "trivial";

// --- keywords for rule selection: files the plan names, CODE_MAP hit basenames, game ids, title words
const planFiles = steps.steps.flatMap((s) => s.files);
const cls = classifyTouched(planFiles);
const kw = new Set();
for (const f of planFiles) kw.add(f.replace(/^.*\//, "").replace(/\.\w+$/, ""));
for (const h of classify.codeMapHits || []) { const m = h.match(/`([^`]+)`/); if (m) kw.add(m[1].replace(/^.*\//, "").replace(/\.\w+$/, "")); }
for (const g of cls.games) kw.add(g);
for (const w of String(card.title).toLowerCase().split(/[^a-z0-9]+/)) if (w.length >= 5) kw.add(w);
for (const a of classify.areas || []) kw.add(a);

// --- rules: a global budget so two docs cannot blow the 400-line cap (6 rules for the first doc,
// 3 for each further one, 25 body lines each — the index still lists every id)
const docs = [...new Set(classify.docs || [])];
const ruleSections = [];
let rulesQuoted = 0;
docs.forEach((d, di) => {
  const p = resolve(repo, d);
  if (!existsSync(p)) return;
  const rules = extractRules(readFileSync(p, "utf8"));
  if (!rules.length) return;
  const picked = selectRules(rules, [...kw], { max: di === 0 ? 6 : 3 });
  rulesQuoted += picked.length;
  ruleSections.push(`### ${d}\nAll rule ids (open the doc only for one of these when a quoted rule points there):\n${ruleIndex(rules)}\n`);
  for (const r of picked) {
    const body = r.body.split("\n");
    ruleSections.push(`#### RULE ${r.id} — ${r.heading}\n${body.slice(0, 25).join("\n")}${body.length > 25 ? `\n_(… ${body.length - 25} more lines in the doc)_` : ""}\n`);
  }
});

// --- keep what a planner already wrote into an earlier brief (design round QA triples, a hand plan)
const prevBrief = existsSync(resolve(dir, "brief.md")) ? readFileSync(resolve(dir, "brief.md"), "utf8") : "";
const prevQa = (prevBrief.match(/## QA assertions[\s\S]*?```json\s*([\s\S]*?)```/) || [])[1]?.trim();
const qaJson = prevQa && prevQa !== "[]" ? prevQa : "[]";

// --- files named (first 40 lines each, max 6)
const named = [];
for (const f of [...new Set(planFiles)].slice(0, 6)) {
  const p = resolve(repo, f);
  if (!existsSync(p)) { named.push(`### ${f}\n_(does not exist yet — the plan creates it)_\n`); continue; }
  if (statSync(p).isDirectory()) continue;
  const head = readFileSync(p, "utf8").split(/\r?\n/).slice(0, 40).join("\n");
  named.push(`### ${f}\n\`\`\`\n${head}\n\`\`\`\n`);
}

// --- test plan from the plan's files
const checks = [];
if (cls.frontend || (!planFiles.length && (classify.areas || []).includes("frontend"))) checks.push("`npm run lint`, `npx next typegen && npx tsc --noEmit`, `npm run build`");
if (cls.backend || (!planFiles.length && (classify.areas || []).includes("backend"))) checks.push("`DATABASE_URL=\"\" python manage.py check && python manage.py test users trivia` (~369 tests expected)");
if (cls.multiplayer) checks.push("`node --check multiplayer_server/src/index.js`");
if (!checks.length) checks.push("docs/config only — verify and QA are skipped");

// --- plan section
let planSection;
if (designPath) {
  planSection = `Design round plan: \`${designPath}\` → implement its \`## Implementation plan\` step by step; do not re-plan.`;
} else if (hasPlan) {
  const tag = engine === "opus" ? "[opus]" : "[sonnet]";
  planSection = steps.steps.map((s) => `${s.n}. ${tag} ${s.text}`).join("\n");
} else if (tier === "trivial") {
  planSection = "Trivial: do exactly what the spec says in one pass; no plan needed.";
} else {
  planSection = "_No numbered steps in the spec. Orchestrator: spawn sonnet to replace this paragraph with 5–12 numbered steps, each naming its file(s) and a done-check, and to fill `## QA assertions`._\n\n## Plan status: needs-plan";
}

const lines = [
  `# Brief — ${card.title}`,
  ``,
  `Card: ${card.id} · ${card.priority} · tier **${tier}** · areas ${(classify.areas || card.areas || []).join(", ")} · risk ${classify.risk || "low"} · engine **${engine}** (${classify.engineEffort || "high"})`,
  `Slug \`${slug}\` · run dir \`.team/run/${slug}/\` · write \`build-report.json\` there when done: \`{ "did": "…", "assumed": "…", "touched": ["path", …], "testsAdded": [] }\`.`,
  ``,
  `## Spec`,
  card.spec.trim(),
  ``,
  `## Attachments`,
  (card.attachments || []).length ? (card.attachments || []).map((a) => `- \`${a}\` — Read it before implementing; it is the visual source of truth.`).join("\n") : "_none_",
  ``,
  `## Plan`,
  planSection,
  ``,
  `## Rules that apply`,
  ruleSections.length ? ruleSections.join("\n") : "_No constraint doc applies to this card._",
  `## Reuse (CODE_MAP hits) — duplicating one of these is a review-reject`,
  (classify.codeMapHits || []).length ? (classify.codeMapHits || []).join("\n") : "_none_",
  ``,
  `## Files named by the plan`,
  named.length ? named.join("\n") : "_none_",
  `## Test plan (what gate 1 runs)`,
  checks.map((c) => `- ${c}`).join("\n"),
  ``,
  `## QA assertions`,
  "Gate 2 runs these against the dev server (fill or extend; `expect` is `text:<substring>`, `count>=N` or `visible`; add `\"flow\": \"...\"` for a multi-step check a script cannot do — that wakes the browser-qa agent):",
  "```json",
  qaJson,
  "```",
  ``,
  `---`,
  `Read this file first and work from it. The constraint docs above are reference: open a section only when a quoted rule points you there. Do not run lint/typecheck/build routinely — gate 1 does.`,
];

let text = lines.join("\n");
let count = text.split("\n").length;
if (count > MAX_LINES) {
  // trim "Files named" first, then hard-truncate the rules section (the index of ids always survives)
  const i = lines.indexOf("## Files named by the plan");
  lines[i + 1] = "_trimmed to keep the brief under 400 lines — read the files directly_";
  text = lines.join("\n"); count = text.split("\n").length;
  if (count > MAX_LINES) {
    const r = lines.indexOf("## Rules that apply");
    const over = count - MAX_LINES;
    const ruleLines = lines[r + 1].split("\n");
    lines[r + 1] = ruleLines.slice(0, Math.max(20, ruleLines.length - over - 1)).join("\n") + "\n_(rules truncated to fit 400 lines — the id index above is complete; open a rule in the doc when needed)_";
    text = lines.join("\n"); count = text.split("\n").length;
  }
}
writeFileSync(resolve(dir, "brief.md"), text + "\n");
writeState(slug, { stage: needsPlan ? "plan" : "build", tier, hasPlan, needsPlan });
console.log(JSON.stringify({ brief: `.team/run/${slug}/brief.md`, hasPlan, needsPlan, lines: count, rulesQuoted, planFiles }, null, 2));
