#!/usr/bin/env node
// v2 intake node (design §4): pause check, resume of this machine's unfinished cards, stale sweep,
// Slack reactions → follow-up cards, the To Do queue, then the lane picker. Writes
// .team/run/<slug>/card.json per pick and prints
//   { picks: [{ slug, id, title, tier, budgetMin, laneKeys, category, priority, resumed, stage }], leftTodo, remainingMin }
// Usage: node scripts/team/intake.mjs --remaining <min> [--only <pageId>] [--running <slug,...>] [--lanes 2]
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
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

const node = (script, ...args) => execFileSync(process.execPath, [resolve(ROOT, script), ...args], { encoding: "utf8", cwd: ROOT, stdio: ["ignore", "pipe", "pipe"] }).trim();
const notion = (...args) => node("scripts/notion.mjs", ...args);
const notionStatus = (...args) => { try { notion(...args); return 0; } catch (e) { return e.status ?? 1; } };
const fail = (msg, code = 1) => { console.log(JSON.stringify({ error: msg, picks: [], leftTodo: null, remainingMin })); process.exit(code); };

const cfg = loadConfig();
const sameId = (a, b) => String(a || "").replace(/-/g, "") === String(b || "").replace(/-/g, "");
const runDirs = () => (existsSync(RUN_ROOT) ? readdirSync(RUN_ROOT) : []).map((slug) => ({ slug, card: readJson(resolve(RUN_ROOT, slug, "card.json")), state: readJson(resolve(RUN_ROOT, slug, "state.json")) })).filter((r) => r.card?.id);

// 0. pause flag
if (notionStatus("check-pause") === 3) { console.log(JSON.stringify({ paused: true, picks: [], leftTodo: null, remainingMin })); process.exit(3); }

// 0a. In-progress cards: ours (a run dir on this machine → resume) vs. others' (stale → sweep, live → leave)
let inProgress = [];
try { inProgress = JSON.parse(notion("list-in-progress") || "[]"); } catch (e) { fail(`notion list-in-progress failed: ${String(e.message).split("\n")[0]}`); }
const maxRun = cfg.maxRunMinutes || 90;
const ours = runDirs();
const resumes = [];
for (const c of inProgress) {
  const mine = ours.find((r) => sameId(r.card.id, c.id));
  if (mine) {
    if (!running.includes(mine.slug) && (!only || sameId(c.id, only))) resumes.push({ ...mine.card, id: c.id, _slug: mine.slug, _stage: mine.state?.stage || "classify" });
    continue;
  }
  const edited = c.lastEditedTime ? Date.parse(c.lastEditedTime) : NaN;
  if (Number.isFinite(edited) && Date.now() - edited > maxRun * 60_000) {
    notionStatus("set-status", c.id, "To Do");
    notionStatus("comment", c.id, "↩️ previous run died before finishing this card — back in To Do");
    console.error(`[intake] swept stale card ${c.id}`);
  }
}
// run dirs whose card is no longer In progress belong to a finished/failed run that did not clean up
for (const r of ours) if (!inProgress.some((c) => sameId(c.id, r.card.id)) && !running.includes(r.slug)) console.error(`[intake] orphan run dir .team/run/${r.slug} (card not In progress) — delete it if the card is done`);

// 0b. Slack reactions → follow-up cards (non-fatal)
try {
  const items = JSON.parse(node("scripts/slack.mjs", "poll-reactions") || "[]");
  for (const it of items) {
    if (it.action !== "followup") continue;
    notionStatus("create-card", `Follow-up: ${it.title}`, "--category", it.category || "frontend", "--body", `Slack feedback on ${it.title}: ${it.note || ""} (original card: ${it.pageId})`);
    console.error(`[intake] follow-up card created for ${it.title}`);
  }
} catch (e) { console.error(`[intake] reactions skipped: ${String(e.message).split("\n")[0]}`); }

// 1. queue — resumes first (they are already claimed and budgeted), then To Do by priority
let queue = [];
try { queue = JSON.parse(notion("list-todo") || "[]"); } catch (e) { fail(`notion list-todo failed: ${String(e.message).split("\n")[0]}`); }
const leftTodo = queue.length;
if (only) queue = queue.filter((c) => sameId(c.id, only));

const runningLanes = running.map((slug) => { const r = ours.find((x) => x.slug === slug); return { slug, laneKeys: r ? [...laneKeys(r.card)] : [], tier: r?.state?.tier || r?.card?.tier || "standard" }; });
const picks = pickNext([...resumes, ...queue], remainingMin, { lanes, running: runningLanes });

const out = [];
for (const c of picks) {
  const resumed = Boolean(c._slug);
  const slug = c._slug || slugFor(c.title, c.id);
  const dir = runDir(slug);
  if (!resumed) {
    let spec = "";
    try { spec = notion("get-spec", c.id); } catch (e) { fail(`notion get-spec ${c.id} failed: ${String(e.message).split("\n")[0]}`); }
    const attachments = [...spec.matchAll(/\[(?:Image|File) attached: ([^\]]+)\]/g)].map((m) => m[1].trim());
    const tier = c.difficulty || "standard";
    writeJson(resolve(dir, "card.json"), { ...c, slug, spec, attachments, tier, budgetMin: tierBudget(tier), areas: [...areasOf(c)], laneKeys: [...laneKeys(c)] });
    writeState(slug, { pageId: c.id, tier, stage: "classify", resumed: false });
  } else {
    writeState(slug, { resumed: true });
  }
  const st = readState(slug);
  out.push({ slug, id: c.id, title: c.title, tier: st.tier, budgetMin: tierBudget(st.tier), laneKeys: [...laneKeys(c)], category: c.category, priority: c.priority, resumed, stage: st.stage });
}
console.log(JSON.stringify({ picks: out, leftTodo, remainingMin }, null, 2));
