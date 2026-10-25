#!/usr/bin/env node
// Direct mode: run the pipeline's build → verify → review loop on an existing branch without a Notion card (the security
// gate's auto-fix on a PR branch, scripts/security/run.mjs). This node stands in for intake + classify: it writes the
// same .team/run/<slug>/card.json, classify.json and state.json from a spec file, then calls brief.mjs, so the engines
// get the brief they always get. The `team-direct` skill drives the rest; it never commits, pushes or touches Notion/Slack.
// Usage: node scripts/team/direct.mjs <slug> --spec-file <md> --title <text> --base <sha> --branch <name> [--repo <dir>] [--files a,b]
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { ROOT } from "../lib/team-config.mjs";
import { classifyTouched } from "./lib/touched.mjs";
import { runDir, writeJson, writeState } from "./lib/state.mjs";

const argv = process.argv.slice(2);
const slug = argv[0];
const arg = (k, d = null) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
if (!slug || slug.startsWith("--") || !arg("--spec-file") || !arg("--base") || !arg("--branch")) {
  console.error("usage: direct.mjs <slug> --spec-file <md> --title <text> --base <sha> --branch <name> [--repo <dir>] [--files a,b]");
  process.exit(2);
}
const repo = resolve(arg("--repo", ROOT));
const spec = readFileSync(resolve(arg("--spec-file")), "utf8");
const files = (arg("--files", "") || "").split(",").map((s) => s.trim()).filter(Boolean);

// Areas from the files the findings name (the engines are per area; multiplayer and services are backend-engine work).
const cls = classifyTouched(files);
const areas = [];
if (cls.backend || cls.multiplayer || files.some((f) => /^(moderation_service|scripts|infra|\.github)\//.test(f))) areas.push("backend");
if (cls.frontend) areas.push("frontend");
if (!areas.length) areas.push("backend");
const docs = [
  ...(areas.includes("backend") ? ["docs/constraints/BACKEND_CONSTRAINTS.md", "docs/constraints/AUTH_CONSTRAINTS.md"] : []),
  ...(cls.multiplayer ? ["docs/constraints/MULTIPLAYER_CONSTRAINTS.md"] : []),
  ...(areas.includes("frontend") ? ["docs/constraints/UI_SHELL_CONSTRAINTS.md"] : []),
];

const dir = runDir(slug);
writeJson(resolve(dir, "card.json"), {
  id: `direct:${slug}`, title: arg("--title", slug), spec, priority: "P0",
  category: areas.length > 1 ? "fullstack" : areas[0], attachments: [], source: "security-check direct", target: arg("--branch"),
});
// Security work: risk high → opus engine, fable review (docs/team/PIPELINE.md §14); no design round in direct mode.
writeJson(resolve(dir, "classify.json"), {
  difficulty: "standard", areas, risk: "high", engineModel: "opus", engineEffort: "high", docs, codeMapHits: [], needsDesignRound: false,
});
writeState(slug, { pageId: null, stage: "brief", tier: "standard", baseSha: arg("--base"), branch: arg("--branch"), worktree: repo, direct: true });
const out = execFileSync(process.execPath, [resolve(ROOT, "scripts/team/brief.mjs"), slug, "--repo", repo], { encoding: "utf8" });
const brief = JSON.parse(out);
console.log(JSON.stringify({ slug, areas, brief: brief.brief, hasPlan: brief.hasPlan, lines: brief.lines }, null, 2));
