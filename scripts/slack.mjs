#!/usr/bin/env node
// Deterministic Slack I/O for the team pipeline. Zero deps (Node 18+ fetch).
// Env: SLACK_BOT_TOKEN (from .env.team or process env). Config: .claude/team/config.json
import { readFileSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { CONFIG_PATH, loadEnvTeam, loadConfig, channelsFor } from "./lib/team-config.mjs";
import { qaCardText, failCardText, runSummaryText, sessionReportText, parseAgentNotes } from "./lib/slack-format.mjs";

loadEnvTeam();
const TOKEN = process.env.SLACK_BOT_TOKEN;
if (!TOKEN) { console.error("SLACK_BOT_TOKEN missing (set in .env.team or env)"); process.exit(2); }
const cfg = loadConfig();
const sh = (c) => execSync(c, { encoding: "utf8" });
const readJson = (p) => JSON.parse(readFileSync(p, "utf8"));

async function api(method, params = {}, post = false) {
  const r = await apiTry(method, params, post);
  if (!r.ok) { console.error(`Slack ${method} error: ${r.error}`); process.exit(1); }
  return r;
}
// Non-fatal: returns the json even on ok:false, never exits.
async function apiTry(method, params = {}, post = false) {
  try {
    const url = `https://slack.com/api/${method}`;
    const res = post
      ? await fetch(url, { method: "POST", headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json; charset=utf-8" }, body: JSON.stringify(params) })
      : await fetch(`${url}?${new URLSearchParams(params).toString()}`, { headers: { Authorization: `Bearer ${TOKEN}` } });
    return await res.json();
  } catch { return { ok: false, error: "fetch_failed" }; }
}

const agentChannelId = (key) => cfg.slack?.agentChannels?.[key];

async function cmdPing(channel, ...text) {
  const r = await api("chat.postMessage", { channel, text: text.join(" ") || "ping from nba-team-pipeline" }, true);
  console.log(`posted ts=${r.ts} channel=${r.channel}`);
}

async function cmdResolveChannels() {
  const want = { "pipeline": "generalChannel", "agent-frontend": "frontend", "agent-backend": "backend" };
  const found = {};
  let cursor;
  do {
    const r = await api("conversations.list", { limit: "200", types: "public_channel,private_channel", ...(cursor ? { cursor } : {}) });
    for (const c of r.channels) if (want[c.name]) found[c.name] = c.id;
    cursor = r.response_metadata?.next_cursor || "";
  } while (cursor);
  const conf = readJson(CONFIG_PATH);
  conf.slack = conf.slack || {};
  conf.slack.agentChannels = conf.slack.agentChannels || {};
  for (const [name, id] of Object.entries(found)) {
    if (name === "pipeline") conf.slack.generalChannel = id; else conf.slack.agentChannels[want[name]] = id;
  }
  writeFileSync(CONFIG_PATH, JSON.stringify(conf, null, 2) + "\n");
  const missing = Object.keys(want).filter((n) => !found[n]);
  console.log(`resolved: ${Object.keys(found).join(", ") || "none"}`);
  if (missing.length) console.error(`MISSING (invite the bot to these): ${missing.join(", ")}`);
}

// One QA card per agent channel the Category routes to. Fullstack cards carry `halves`
// ({frontend:{did,model,effort}, backend:{...}}) so each channel gets its own half.
async function cmdPostQaCard(jsonPath) {
  const t = readJson(jsonPath);
  const keys = channelsFor(t.category, cfg);
  const refs = [];
  for (const key of keys) {
    const chan = agentChannelId(key);
    if (!chan) { console.error(`no agentChannels.${key} in config (skipping)`); continue; }
    const half = keys.length > 1 ? key : undefined;
    const h = t.halves?.[key] || {};
    const text = qaCardText({ ...t, ...h, half, devUrl: t.devUrl || cfg.devSiteUrl });
    const r = await apiTry("chat.postMessage", { channel: chan, text }, true);
    if (r.ok) refs.push(`${chan}:${r.ts}`); else console.error(`qa card to ${key} failed (non-fatal): ${r.error}`);
  }
  if (refs.length && t.pageId) {
    try { sh(`node scripts/notion.mjs set-props ${t.pageId} --slack-ts "${refs.join(",")}"`); }
    catch { console.error(`could not store slack ts for ${t.pageId} (non-fatal)`); }
  }
  console.log(`posted qa card to ${refs.length} channel(s)`);
}

async function cmdPostFailCard(jsonPath) {
  const t = readJson(jsonPath);
  for (const key of channelsFor(t.category, cfg)) {
    const chan = agentChannelId(key);
    if (!chan) continue;
    const r = await apiTry("chat.postMessage", { channel: chan, text: failCardText(t) }, true);
    console.log(r.ok ? `posted fail card to ${key}` : `fail card to ${key} failed (non-fatal): ${r.error}`);
  }
}

async function cmdPostRunSummary(jsonPath) {
  const r0 = readJson(jsonPath);
  const chan = cfg.slack?.generalChannel;
  if (!chan) { console.error("no generalChannel in config"); process.exit(1); }
  const r = await apiTry("chat.postMessage", { channel: chan, text: runSummaryText(r0) }, true);
  console.log(r.ok ? `posted run summary ts=${r.ts}` : `run summary failed (non-fatal): ${r.error}`);
}

const FIX_RX = /^(x|heavy_multiplication_x|repeat|arrows_counterclockwise|no_entry|hammer)$/;
const OK_RX = /^(white_check_mark|heavy_check_mark|\+1|ok_hand)$/;

// Reads reactions on every QA card still awaiting feedback (SlackTs = "<chan>:<ts>[,...]").
// Only the configured owner's reactions count. Clearing SlackTs is the dedup marker.
async function cmdPollReactions() {
  const me = cfg.slack?.slackUserId;
  const items = [];
  let awaiting = [];
  try { awaiting = JSON.parse(sh(`node scripts/notion.mjs list-awaiting-feedback`)); }
  catch { console.error("could not list awaiting-feedback cards (non-fatal)"); console.log("[]"); return; }
  for (const card of awaiting) {
    let fix = false, ok = false, notes = [];
    for (const ref of card.slackTs.split(",")) {
      const [chan, ts] = ref.split(":");
      if (!chan || !ts) continue;
      const rr = await apiTry("reactions.get", { channel: chan, timestamp: ts, full: "true" });
      if (!rr.ok) continue;
      for (const rx of rr.message?.reactions || []) {
        if (me && !(rx.users || []).includes(me)) continue;
        if (FIX_RX.test(rx.name)) fix = true;
        if (OK_RX.test(rx.name)) ok = true;
      }
      if (fix) {
        const rep = await apiTry("conversations.replies", { channel: chan, ts });
        if (rep.ok) notes.push(...(rep.messages || []).filter((m) => m.user === me && m.ts !== ts).map((m) => m.text));
      }
    }
    if (!fix && !ok) continue;
    items.push(fix
      ? { action: "followup", pageId: card.id, title: card.title, category: card.category, note: notes.join(" | ") || "reviewer flagged 🔄 with no note — re-examine" }
      : { action: "ack", pageId: card.id, title: card.title, category: card.category, note: "" });
    try { sh(`node scripts/notion.mjs clear-slack-ts ${card.id}`); }
    catch { console.error(`could not clear slack ts for ${card.id} (non-fatal)`); }
  }
  console.log(JSON.stringify(items, null, 2));
}

// Commits on a branch inside [start, end) whose body carries "Notion:" (= shipped tasks).
function shippedCommits(branch, startISO, endISO) {
  sh(`git fetch origin ${branch} --quiet`);
  const raw = sh(`git log origin/${branch} --since="${startISO}" --until="${endISO}" --format=%H%x1f%s%x1f%b%x1e`);
  return raw.split("\x1e").map((rec) => rec.trim()).filter(Boolean).map((rec) => {
    const [sha, subject, body] = rec.split("\x1f");
    return { sha, title: subject, body: body || "" };
  }).filter((c) => /^Notion: /m.test(c.body)).map((c) => ({
    ...c, category: (c.body.match(/^Category: (.+)$/m) || [, "backend"])[1].trim(),
  }));
}

async function cmdDigestWindow(startISO, endISO, label) {
  const chan = cfg.slack?.generalChannel;
  const end = Date.parse(endISO);
  const shipped = shippedCommits("dev", startISO, endISO);
  const doneCount = shippedCommits("main", startISO, endISO).length;
  let qaWaiting = 0;
  try { qaWaiting = JSON.parse(sh(`node scripts/notion.mjs list-qa`)).length; } catch { console.error("list-qa failed (non-fatal)"); }
  const { head, text } = sessionReportText({ label, start: startISO.slice(11, 16), end: endISO.slice(11, 16), shipped, qaWaiting, doneCount });
  // Duplicate guard: two schedulers fire this for the same window; Slack stores 📋 as :clipboard:,
  // so match on the emoji-free head. Fails OPEN on API error (a missing report is worse than a double).
  const matchKey = head.replace("📋 ", "");
  if (chan) {
    const hist = await apiTry("conversations.history", { channel: chan, oldest: String(end / 1000), latest: String(end / 1000 + 23 * 3600), inclusive: "true", limit: "100" });
    if (hist.ok && (hist.messages || []).some((m) => m.bot_id && (m.text || "").includes(matchKey))) { console.log("already posted, skipping"); return; }
    if (!hist.ok) console.error(`duplicate-guard check failed (posting anyway): ${hist.error}`);
    const r = await apiTry("chat.postMessage", { channel: chan, text }, true);
    console.log(r.ok ? `posted session line (${shipped.length} shipped)` : `session line failed (non-fatal): ${r.error}`);
  }
  // Per-engine detail from the commit bodies' Agent notes, only when there is work.
  const nameMap = { "frontend-engine": "frontend", "backend-engine": "backend" };
  const buckets = { frontend: [], backend: [] };
  for (const c of shipped) for (const n of parseAgentNotes(c.body)) {
    const key = nameMap[n.agent]; if (key) buckets[key].push(`• ${c.title} (${c.sha.slice(0, 7)}): ${n.did}\n  assumed: ${n.assumed}`);
  }
  for (const [key, lines] of Object.entries(buckets)) {
    const ac = agentChannelId(key);
    if (!ac || !lines.length) continue;
    const r = await apiTry("chat.postMessage", { channel: ac, text: `📆 ${key} · ${label} · ${lines.length} shipped\n${lines.join("\n")}` }, true);
    console.log(r.ok ? `posted ${key} detail` : `${key} detail failed (non-fatal): ${r.error}`);
  }
}

const [cmd, ...args] = process.argv.slice(2);
const run = {
  "ping": () => cmdPing(args[0], ...args.slice(1)),
  "resolve-channels": cmdResolveChannels,
  "post-qa-card": () => cmdPostQaCard(args[0]),
  "post-fail-card": () => cmdPostFailCard(args[0]),
  "post-run-summary": () => cmdPostRunSummary(args[0]),
  "poll-reactions": cmdPollReactions,
  "digest-window": () => cmdDigestWindow(args[0], args[1], args.slice(2).join(" ")),
}[cmd];
if (!run) { console.error(`Unknown command: ${cmd}`); process.exit(2); }
await run();
