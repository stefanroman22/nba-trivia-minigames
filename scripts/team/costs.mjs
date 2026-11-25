#!/usr/bin/env node
// Cost ledger of the team pipeline (docs/team/PIPELINE.md §19). The commit is the ledger: a run records each agent
// it spawns in its own state.json, the ship skill puts one `Cost:` line in the commit body, and the report reads
// the commits back. No shared file, no network, no model.
//
//   costs.mjs spawn <slug> --stage <classify|plan|design|build|fix|qa|review> --agent <name> --model <alias>
//                          [--tokens <n>] [--tool-uses <n>] [--ms <n>]     record one returned Agent(...) in state.json
//   costs.mjs trailer <slug>                                               print the `Cost:` line for the commit body
//   costs.mjs report [--since <git date>] [--ref <ref>] [--html <file>] [--json]
//                                                                          one row per shipped card (default ref origin/dev)
// A usage number the harness did not report is left out (stored as null): nothing here estimates tokens.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { ROOT } from "../lib/team-config.mjs";
import { RUN_ROOT, SPAWN_STAGES, appendSpawn, readJson, writeState } from "./lib/state.mjs";
import { costFields, formatCost, inputRates, modelAlias } from "./lib/cost.mjs";
import { ESTIMATE_NOTE, readCommits, renderHtml, renderMarkdown, rowsOf, summarize } from "./lib/cost-report.mjs";

const USAGE = `usage:
  costs.mjs spawn <slug> --stage <${SPAWN_STAGES.join("|")}> --agent <name> --model <alias> [--tokens <n>] [--tool-uses <n>] [--ms <n>]
  costs.mjs trailer <slug>
  costs.mjs report [--since <git date>] [--ref <ref>] [--html <file>] [--json]`;

const [cmd, ...argv] = process.argv.slice(2);
const arg = (k, d = null) => { const i = argv.indexOf(k); return i >= 0 && argv[i + 1] !== undefined ? argv[i + 1] : d; };
const fail = (msg, code = 1) => { console.error(msg); process.exit(code); };
// `report | head` closes the pipe early: that is not an error
process.stdout.on("error", (e) => { if (e.code === "EPIPE") process.exit(0); throw e; });

const registry = (() => { try { return JSON.parse(readFileSync(resolve(ROOT, ".claude/models.json"), "utf8")); } catch { return null; } })();

// A run dir is made by intake (or direct.mjs), never here: a dir this command created would look like a dead run.
function statePath(slug) {
  if (!slug || slug.startsWith("--")) fail(USAGE, 2);
  const path = resolve(RUN_ROOT, slug, "state.json");
  if (!existsSync(path)) fail(`no run state for "${slug}" (.team/run/${slug}/state.json): nothing recorded`);
  return path;
}

function cmdSpawn() {
  const slug = argv[0];
  const state = readJson(statePath(slug));
  if (!SPAWN_STAGES.includes(arg("--stage"))) fail(`--stage must be one of ${SPAWN_STAGES.join(", ")}\n${USAGE}`, 2);
  const given = { tokens: arg("--tokens"), toolUses: arg("--tool-uses"), ms: arg("--ms") };
  const next = appendSpawn(state, { stage: arg("--stage"), agent: arg("--agent"), model: modelAlias(arg("--model"), registry), ...given });
  const record = next.spawns[next.spawns.length - 1];
  for (const [k, v] of Object.entries(given)) if (v !== null && record[k] === null) console.error(`${k} "${v}" is not a whole number: stored as null`);
  writeState(slug, { spawns: next.spawns });
  console.log(JSON.stringify({ slug, spawns: next.spawns.length, recorded: record }));
}

function cmdTrailer() {
  const slug = argv[0];
  const state = readJson(statePath(slug));
  const line = formatCost(costFields({ state, classify: readJson(resolve(RUN_ROOT, slug, "classify.json"), {}) }));
  if (!line) fail(`nothing known about "${slug}": no Cost line`);
  console.log(line);
}

function cmdReport() {
  const git = (args) => execFileSync("git", ["-C", ROOT, ...args], { encoding: "utf8", maxBuffer: 256 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] });
  const asked = arg("--ref");
  const since = arg("--since");
  let log;
  try { log = readCommits({ ref: asked || "origin/dev", since, fallback: asked ? null : "HEAD", git }); }
  catch (e) { fail(`costs report: ${String(e.stderr || e.message).trim().split("\n").pop()}`, 2); }
  if (log.ref !== (asked || "origin/dev")) console.error(`costs report: origin/dev not found, reading ${log.ref}`);
  const rates = inputRates(registry);
  const rows = rowsOf(log.commits, { registry, rates });
  const meta = { ref: log.ref, since, generatedAt: new Date().toISOString().slice(0, 16).replace("T", " ") + " UTC", rates };
  const html = arg("--html");
  if (html) {
    const out = resolve(html);
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, renderHtml(rows, meta));
    if (!argv.includes("--json")) console.log(`wrote ${out} (${rows.length} cards, ${rows.filter((r) => r.cost).length} with cost data)`);
  }
  if (argv.includes("--json")) process.stdout.write(JSON.stringify({ ...meta, estimateNote: ESTIMATE_NOTE, rows, totals: summarize(rows) }, null, 2) + "\n");
  else if (!html) process.stdout.write(renderMarkdown(rows, meta));
}

const run = { spawn: cmdSpawn, trailer: cmdTrailer, report: cmdReport }[cmd];
if (!run) fail(USAGE, 2);
run();
