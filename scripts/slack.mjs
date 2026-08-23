#!/usr/bin/env node
// Deterministic Slack I/O for the team pipeline. Zero deps (Node 18+ fetch).
// Env: SLACK_BOT_TOKEN (from .env.team or process env). Config: .claude/team/config.json
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CONFIG_PATH = resolve(ROOT, ".claude/team/config.json");
const ENV_PATH = resolve(ROOT, ".env.team");
const STATE_PATH = resolve(ROOT, ".claude/team/slack-state.json");

function loadEnvTeam() {
  if (!process.env.SLACK_BOT_TOKEN && existsSync(ENV_PATH)) {
    for (const line of readFileSync(ENV_PATH, "utf8").split(/\r?\n/)) {
      const m = line.match(/^([A-Z_]+)=(.*)$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
    }
  }
}
loadEnvTeam();
const TOKEN = process.env.SLACK_BOT_TOKEN;
if (!TOKEN) { console.error("SLACK_BOT_TOKEN missing (set in .env.team or env)"); process.exit(2); }
const cfg = existsSync(CONFIG_PATH) ? JSON.parse(readFileSync(CONFIG_PATH, "utf8")) : {};

// Slack Web API. GET-style methods pass params as query; write methods POST JSON.
async function api(method, params = {}, post = false) {
  const url = `https://slack.com/api/${method}`;
  let res;
  if (post) {
    res = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify(params),
    });
  } else {
    const qs = new URLSearchParams(params).toString();
    res = await fetch(`${url}?${qs}`, { headers: { Authorization: `Bearer ${TOKEN}` } });
  }
  const json = await res.json();
  if (!json.ok) { console.error(`Slack ${method} error: ${json.error}`); process.exit(1); }
  return json;
}

// Non-fatal Slack call (GET-style by default, POST when post=true): returns the
// json even on ok:false, never exits — so one bad call can't abort a loop.
async function apiTry(method, params = {}, post = false) {
  try {
    const url = `https://slack.com/api/${method}`;
    const res = post
      ? await fetch(url, { method: "POST", headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json; charset=utf-8" }, body: JSON.stringify(params) })
      : await fetch(`${url}?${new URLSearchParams(params).toString()}`, { headers: { Authorization: `Bearer ${TOKEN}` } });
    return await res.json();
  } catch { return { ok: false, error: "fetch_failed" }; }
}

function readState() { return existsSync(STATE_PATH) ? JSON.parse(readFileSync(STATE_PATH, "utf8")) : { cards: [], lastPoll: null }; }
function writeState(s) { writeFileSync(STATE_PATH, JSON.stringify(s, null, 2)); }

async function cmdPing(channel, ...text) {
  const r = await api("chat.postMessage", { channel, text: text.join(" ") || "ping from nba-team-pipeline" }, true);
  console.log(`posted ts=${r.ts} channel=${r.channel}`);
}

async function cmdResolveChannels() {
  // Map the 5 channel names to ids and write them into config.
  const want = { "pipeline": ["slack", "generalChannel"], "agent-frontend": ["slack", "agentChannels", "frontend"],
    "agent-backend": ["slack", "agentChannels", "backend"], "agent-qa": ["slack", "agentChannels", "qa"],
    "agent-review": ["slack", "agentChannels", "review"] };
  const found = {};
  let cursor;
  do {
    const r = await api("conversations.list", { limit: "200", types: "public_channel,private_channel", ...(cursor ? { cursor } : {}) });
    for (const c of r.channels) if (want[c.name]) found[c.name] = c.id;
    cursor = r.response_metadata?.next_cursor || "";
  } while (cursor);
  const conf = JSON.parse(readFileSync(CONFIG_PATH, "utf8"));
  conf.slack = conf.slack || { agentChannels: {} };
  conf.slack.agentChannels = conf.slack.agentChannels || {};
  for (const [name, id] of Object.entries(found)) {
    if (name === "pipeline") conf.slack.generalChannel = id;
    else conf.slack.agentChannels[name.replace("agent-", "")] = id;
  }
  writeFileSync(CONFIG_PATH, JSON.stringify(conf, null, 2) + "\n");
  const missing = Object.keys(want).filter(n => !found[n]);
  console.log(`resolved: ${Object.keys(found).join(", ") || "none"}`);
  if (missing.length) console.error(`MISSING (invite the bot to these): ${missing.join(", ")}`);
}

async function cmdPostBatch(jsonPath) {
  const batch = JSON.parse(readFileSync(jsonPath, "utf8"));
  const chan = cfg.slack?.generalChannel;
  if (!chan) { console.error("no generalChannel in config"); process.exit(1); }
  if (!batch.shipped?.length) { console.log("empty batch, nothing to post"); return; }
  const now = new Date().toISOString().slice(11, 16);
  const devLine = cfg.devSiteUrl ? `\nDev: ${cfg.devSiteUrl}` : "";
  const parent = await api("chat.postMessage",
    { channel: chan, text: `🟢 Batch complete — ${batch.count} shipped to dev · ${now}${devLine}` }, true);
  const state = readState();
  for (const t of batch.shipped) {
    const body =
      `${t.n}.  *_${t.title}_*   ·   *${(t.areas || []).join("+")}*\n\n` +
      `*Check:*  ${t.look || "verify the change"}\n\n` +
      `✅ approve      ·      🔄 needs work — reply to say what\n​`;
    // Top-level (no thread_ts) so a human reply threads under THIS task, making
    // notes unambiguously per-task even when a batch has several tasks.
    const card = await api("chat.postMessage", { channel: chan, text: body }, true);
    state.cards.push({ ts: card.ts, channel: chan, pageId: t.pageId || null, pr: t.pr, prNum: t.prNum, title: t.title, areas: t.areas || [], resolved: false });
    writeState(state);
  }
  console.log(`posted batch: parent ts=${parent.ts}, ${batch.shipped.length} cards`);
}

async function cmdPollReactions() {
  const me = cfg.slack?.slackUserId;
  const state = readState();
  const items = [];
  // Each task is its own top-level message, so a human reply threads under THAT
  // task. Read replies on the card's OWN ts → the note is per-task, not shared.
  const noteCache = {};
  async function noteFor(cardTs, channel) {
    if (cardTs in noteCache) return noteCache[cardTs];
    let note = "";
    const rep = await apiTry("conversations.replies", { channel, ts: cardTs });
    if (rep.ok) {
      const mineReplies = (rep.messages || []).filter(m => m.user === me);
      if (mineReplies.length) note = mineReplies.map(m => m.text).join(" | ");
    }
    noteCache[cardTs] = note;
    return note;
  }
  for (const card of state.cards) {
    if (card.resolved) continue;
    // Reactions on this specific card (per-message, reliable).
    let reacted = { fix: false, ok: false };
    const rr = await apiTry("reactions.get", { channel: card.channel, timestamp: card.ts, full: "true" });
    if (rr.ok) {
      for (const rx of (rr.message?.reactions || [])) {
        const mine = !me || (rx.users || []).includes(me);
        if (!mine) continue;
        if (/^(x|heavy_multiplication_x|repeat|arrows_counterclockwise|no_entry|hammer)$/.test(rx.name)) reacted.fix = true;
        if (/^(white_check_mark|heavy_check_mark|\+1|ok_hand)$/.test(rx.name)) reacted.ok = true;
      }
    }
    // TRIGGER is the per-card 🔄 reaction (unambiguous). A thread note is DETAIL
    // attached to the flagged card — a note alone never spawns follow-ups (else one
    // note would re-open every task in the batch). ✅ (without 🔄) acknowledges.
    if (reacted.fix) {
      const note = await noteFor(card.ts, card.channel);
      items.push({ action: "followup", pageId: card.pageId, pr: card.pr, prNum: card.prNum, title: card.title,
        areas: card.areas || [], note: note || "reviewer flagged 🔄 with no note — re-examine" });
      card.resolved = true;
    } else if (reacted.ok) {
      items.push({ action: "ack", pageId: card.pageId, pr: card.pr, prNum: card.prNum, title: card.title, note: "" });
      card.resolved = true;
    }
  }
  // Prune: drop acted cards, bound growth (unreacted cards linger up to 100).
  state.cards = state.cards.filter(c => !c.resolved).slice(-100);
  writeState(state);
  console.log(JSON.stringify(items, null, 2));
}

function sh(c) { return execSync(c, { encoding: "utf8" }); }

function parseAgentNotes(body) {
  // Returns [{agent, did, assumed}] from the "## Agent notes" block, or [].
  const out = [];
  const m = body.match(/## Agent notes([\s\S]*?)(?:\n## |\n*$)/);
  if (!m) return out;
  const re = /- agent:\s*(\S+)[\s\S]*?did:\s*(.*?)\s*(?:\n\s*assumed:\s*(.*?))?(?=\n\s*- agent:|\n*$)/g;
  let x;
  while ((x = re.exec(m[1]))) out.push({ agent: x[1].trim(), did: (x[2] || "").trim(), assumed: (x[3] || "none").trim() });
  return out;
}

async function cmdDailyDigests(day) {
  const date = day || sh(`git log -1 --format=%cs`).trim(); // fallback: latest commit date (no argless Date())
  const nameMap = { "frontend-engine": "frontend", "backend-engine": "backend" };
  const buckets = { frontend: [], backend: [], qa: [], review: [] };
  const prs = JSON.parse(sh(`gh pr list --state merged --base dev --search "merged:${date}" --json number,title,body,url,headRefName --limit 100`));
  for (const pr of prs) {
    if (!pr.headRefName.startsWith("team/")) continue;
    const notes = parseAgentNotes(pr.body || "");
    if (notes.length) {
      for (const n of notes) {
        const ch = nameMap[n.agent] || "review";
        buckets[ch].push(`• ${pr.title} (PR#${pr.number}): ${n.did}\n  assumed: ${n.assumed}`);
      }
    } else {
      buckets.review.push(`• ${pr.title} (PR#${pr.number}): (no agent notes)`);
    }
  }
  for (const [agent, lines] of Object.entries(buckets)) {
    const chan = cfg.slack?.agentChannels?.[agent];
    if (!chan || !lines.length) continue;
    const text = `📆 ${agent} · ${date} · ${lines.length} shipped\n${lines.join("\n")}`;
    const r = await apiTry("chat.postMessage", { channel: chan, text }, true);
    if (r.ok) console.log(`posted digest to ${agent}`);
    else console.error(`digest post to ${agent} failed (non-fatal): ${r.error}`);
  }
}

const [cmd, ...args] = process.argv.slice(2);
const run = {
  "ping": () => cmdPing(args[0], ...args.slice(1)),
  "resolve-channels": cmdResolveChannels,
  "post-batch": () => cmdPostBatch(args[0]),
  "poll-reactions": cmdPollReactions,
  "daily-digests": () => cmdDailyDigests(args[0]),
}[cmd];
if (!run) { console.error(`Unknown command: ${cmd}`); process.exit(2); }
await run();
