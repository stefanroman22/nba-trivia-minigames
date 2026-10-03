#!/usr/bin/env node
// Review node input (design §5): one file with everything a reviewer needs — verify results,
// QA verdict, commits, stat, diff, brief path — so it never re-runs checks or re-reads docs.
// Prints { path, files, insertions, deletions, motion, protected, reviewModel, scoped }
// Usage: node scripts/team/review-package.mjs <slug> --base <sha> [--repo <dir>] [--since <sha>]
import { execFileSync } from "node:child_process";
import { existsSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { ROOT } from "../lib/team-config.mjs";
import { classifyTouched, touchedFiles, diffText } from "./lib/touched.mjs";
import { runDir, readJson, writeState } from "./lib/state.mjs";

const argv = process.argv.slice(2);
const slug = argv[0];
const arg = (k, d = null) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
if (!slug || slug.startsWith("--")) { console.error("usage: review-package.mjs <slug> --base <sha> [--repo <dir>] [--since <sha>]"); process.exit(2); }
const repo = resolve(arg("--repo", ROOT));
const base = arg("--base", "origin/dev");
const since = arg("--since");
const dir = runDir(slug);
const card = readJson(resolve(dir, "card.json"), {});
const classify = readJson(resolve(dir, "classify.json"), {});
const verify = readJson(resolve(dir, "verify.json"));
const verdictPath = resolve(repo, ".team/qa", slug, "verdict.json");
const verdict = existsSync(verdictPath) ? readJson(verdictPath) : null;

const git = (...a) => { try { return execFileSync("git", ["-C", repo, ...a], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }); } catch { return ""; } };
const touched = touchedFiles(repo, base);
const cls = classifyTouched(touched, diffText(repo, base));
const range = `${since || base}...HEAD`;
const stat = git("diff", "--stat", range) + git("diff", "--stat", "HEAD");
const diff = git("diff", range) + git("diff", "HEAD");
const commits = git("log", "--oneline", `${base}..HEAD`);
const tier = classify.difficulty || card.tier || "standard";
const risk = classify.risk || "low";
const reviewModel = card.priority === "P0" || risk === "high" || tier === "hard" || cls.protected ? "fable" : "sonnet";
const m = stat.match(/(\d+) files? changed(?:, (\d+) insertions?)?(?:, (\d+) deletions?)?/);

const md = [
  `# Review package — ${card.title || slug}`,
  ``,
  `Card ${card.id || "?"} · ${card.priority || "?"} · tier ${tier} · risk ${risk} · engine ${classify.engineModel || "?"} · review model **${reviewModel}** · motion ${cls.motion} · protected paths ${cls.protected}`,
  since ? `**Scoped re-review:** only the fix diff since \`${since}\` is included below; earlier findings were already addressed or waived.` : "",
  ``,
  `Brief (spec + the rules that apply): \`.team/run/${slug}/brief.md\` — read it; do not open the full constraint docs unless a quoted rule points there.`,
  ``,
  `## Verify (gate 1)`,
  verify ? `pass: ${verify.pass} · tests: ${verify.testCount ?? "n/a"} · ran: ${verify.ran.map((r) => `${r.label} (${Math.round(r.ms / 1000)}s, exit ${r.exit})`).join(", ") || "nothing (" + (verify.skipped || []).join(", ") + ")"}` : "_verify.json missing — that is a finding_",
  ``,
  `## QA (gate 2)`,
  verdict ? `pass: ${verdict.pass}${verdict.skipped ? ` (skipped: ${verdict.skipped})` : ""} · failures: ${(verdict.failures || []).length} · screenshots: \`.team/qa/${slug}/\`` : "_no verdict (QA not run or skipped)_",
  ``,
  `## Commits`,
  "```", commits.trim() || "(uncommitted work only)", "```",
  ``,
  `## Stat`,
  "```", stat.trim(), "```",
  ``,
  `## Diff`,
  "```diff", diff.trim(), "```",
  ``,
].join("\n");
const path = resolve(dir, "review-package.md");
writeFileSync(path, md);
writeState(slug, { stage: "review" });
console.log(JSON.stringify({ path: `.team/run/${slug}/review-package.md`, files: m ? Number(m[1]) : touched.length, insertions: m ? Number(m[2] || 0) : null, deletions: m ? Number(m[3] || 0) : null, motion: cls.motion, protected: cls.protected, reviewModel, scoped: Boolean(since), touched }, null, 2));
