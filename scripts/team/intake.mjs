#!/usr/bin/env node
// v2 intake node (design §4): pause check, stale sweep, Slack reactions → follow-up cards, the
// To Do queue, then the lane picker. Writes .team/run/<slug>/card.json per pick and prints
//   { picks: [{ slug, id, title, tier, budgetMin, laneKeys, category, priority }], leftTodo, remainingMin }
// Usage: node scripts/team/intake.mjs --remaining <min> [--only <pageId>] [--running <slug,...>] [--lanes 2]
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { ROOT, loadConfig, loadEnvTeam } from "../lib/team-config.mjs";
import { tierBudget, areasOf, laneKeys, pickNext } from "./lib/budget.mjs";
import { runDir, writeJson, readJson, readState, writeState, slugFor, RUN_ROOT } from "./lib/state.mjs";

loadEnvTeam();
const argv = process.argv.slice(2);
const arg = (k, d = null) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const remainingMin = Number(arg("--remaining", "90"));
const only = arg("--only") || process.env.TEAM_ONLY || null;
const lanes = Number(arg("--lanes", "2"));
const running = (arg("--running", "") || "").split(",").map((s) => s.trim()).filter(Boolean);

const notion = (...args) => {
  const r = execFileSync(process.execPath, [resolve(ROOT, "scripts/notion.mjs"), ...args], { encoding: "utf8", cwd: ROOT, stdio: ["ignore", "pipe", "pipe"] });
  return r.trim();
};
const notionStatus = (...args) => {
  try { execFileSync(process.execPath, [resolve(ROOT, "scripts/notion.mjs"), ...args], { encoding: "utf8", cwd: ROOT, stdio: ["ignore", "pipe", "pipe"] }); return 0; }
  catch (e) { return e.status ?? 1; }
};
const slack = (...args) => {
  try { return execFileSync(process.execPath, [resolve(ROOT, "scripts/slack.mjs"), ...args], { encoding: "utf8", cwd: ROOT, stdio: ["ignore", "pipe", "pipe"] }).trim(); }
  catch (e) { console.error(`[intake] slack ${args[0]} failed: ${String(e.message).split("\n")[0]}`); return "[]"; }
};

const cfg = loadConfig();

// 0. pause flag
if (notionStatus("check-pause") === 3) { console.log(JSON.stringify({ paused: true, picks: [], leftTodo: null, remainingMin })); process.exit(3); }

// 0b. stale sweep — In progress cards nobody owns and nobody touched for maxRunMinutes
const maxRun = cfg.maxRunMinutes || 90;
let inProgress = [];
try { inProgress = JSON.parse(notion("list-in-progress") || "[]"); } catch { inProgress = []; }
const owned = new Set();
if (existsSync(RUN_ROOT)) {
  for (const slug of (await import("node:fs")).readdirSync(RUN_ROOT)) {
    const card = readJson(resolve(RUN_ROOT, slug, "card.json"));
    if (card?.id) owned.add(card.id);
  }
}
for (const c of inProgress) {
  if (owned.has(c.id)) continue;
  const edited = c.lastEditedTime ? Date.parse(c.lastEditedTime) : NaN;
  if (Number.isFinite(edited) && Date.now() - edited > maxRun * 60_000) {
    notionStatus("set-status", c.id, "To Do");
    notionStatus("comment", c.id, "↩️ previous run died before finishing this card — back in To Do");
    console.error(`[intake] swept stale card ${c.id}`);
  }
}

// 0c. Slack reactions → follow-up cards (non-fatal)
try {
  const items = JSON.parse(slack("poll-reactions") || "[]");
  for (const it of items) {
    if (it.kind !== "followup") continue;
    notionStatus("create-card", `Follow-up: ${it.title}`, "--category", it.category || "frontend", "--body", `Slack feedback on ${it.title}: ${it.note || ""} (original card: ${it.pageId})`);
  }
} catch (e) { console.error(`[intake] reactions skipped: ${String(e.message).split("\n")[0]}`); }

// 1. queue
let queue = JSON.parse(notion("list-todo") || "[]");
const leftTodo = queue.length;
if (only) queue = queue.filter((c) => c.id === only || c.id.replace(/-/g, "") === only.replace(/-/g, ""));

// resumable cards first: a run dir with state.stage not in {shipped, failed} and the card still To Do/In progress
const runningLanes = running.map((slug) => { const card = readJson(resolve(RUN_ROOT, slug, "card.json")) || {}; return { slug, laneKeys: [...laneKeys(card)] }; });
const picks = pickNext(queue, remainingMin, { lanes, running: runningLanes });

const out = [];
for (const c of picks) {
  const existing = [...(existsSync(RUN_ROOT) ? (await import("node:fs")).readdirSync(RUN_ROOT) : [])]
    .find((s) => readJson(resolve(RUN_ROOT, s, "card.json"))?.id === c.id);
  const slug = existing || slugFor(c.title);
  const dir = runDir(slug);
  const spec = notion("get-spec", c.id);
  const attachments = [...spec.matchAll(/\[(?:Image|File) attached: ([^\]]+)\]/g)].map((m) => m[1].trim());
  const tier = c.difficulty || "standard";
  const card = { ...c, slug, spec, attachments, tier, budgetMin: tierBudget(tier), areas: [...areasOf(c)], laneKeys: [...laneKeys(c)] };
  writeJson(resolve(dir, "card.json"), card);
  const st = readState(slug);
  writeState(slug, { pageId: c.id, tier, stage: existing && st.stage !== "intake" ? st.stage : "classify", resumed: Boolean(existing) });
  out.push({ slug, id: c.id, title: c.title, tier, budgetMin: card.budgetMin, laneKeys: card.laneKeys, category: c.category, priority: c.priority, resumed: Boolean(existing), stage: readState(slug).stage });
}
console.log(JSON.stringify({ picks: out, leftTodo, remainingMin }, null, 2));
