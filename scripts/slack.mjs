#!/usr/bin/env node
// Deterministic Slack I/O for the team pipeline. Zero deps (Node 18+ fetch).
// Env: SLACK_BOT_TOKEN (from .env.team or process env). Config: .claude/team/config.json
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

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
    const card = await api("chat.postMessage", { channel: chan, thread_ts: parent.ts, text: body }, true);
    state.cards.push({ ts: card.ts, parentTs: parent.ts, channel: chan, pageId: t.pageId || null, pr: t.pr, prNum: t.prNum, title: t.title, resolved: false });
  }
  writeState(state);
  console.log(`posted batch: parent ts=${parent.ts}, ${batch.shipped.length} cards`);
}

async function cmdPollReactions() {
  const me = cfg.slack?.slackUserId;
  const state = readState();
  const items = [];
  // Slack threads are one level deep: a human reply to any card lands in the PARENT
  // thread, not under the specific card. So reactions are read PER CARD (reliable,
  // per-message), but the note text is read ONCE per parent thread and shared as
  // context across the flagged cards in that batch. Cache replies by parentTs.
  const noteCache = {};
  async function noteFor(parentTs, channel) {
    if (parentTs in noteCache) return noteCache[parentTs];
    let note = "";
    try {
      const rep = await api("conversations.replies", { channel, ts: parentTs });
      // The bot authored the parent + all cards; only the human's replies have user === me.
      const mineReplies = (rep.messages || []).filter(m => m.user === me);
      if (mineReplies.length) note = mineReplies.map(m => m.text).join(" | ");
    } catch { /* non-fatal */ }
    noteCache[parentTs] = note;
    return note;
  }
  for (const card of state.cards) {
    if (card.resolved) continue;
    // Reactions on this specific card (per-message, reliable).
    let reacted = { fix: false, ok: false };
    try {
      const r = await api("reactions.get", { channel: card.channel, timestamp: card.ts, full: "true" });
      const reactions = r.message?.reactions || [];
      for (const rx of reactions) {
        const mine = !me || (rx.users || []).includes(me);
        if (!mine) continue;
        if (/x|repeat|arrows_counterclockwise|no_entry|hammer/.test(rx.name)) reacted.fix = true;
        if (/white_check_mark|heavy_check_mark|\+1|ok_hand/.test(rx.name)) reacted.ok = true;
      }
    } catch { /* non-fatal per card */ }
    // TRIGGER is the per-card 🔄 reaction (unambiguous). A thread note is DETAIL
    // attached to the flagged card — a note alone never spawns follow-ups (else one
    // note would re-open every task in the batch). ✅ (without 🔄) acknowledges.
    if (reacted.fix) {
      const note = await noteFor(card.parentTs || card.ts, card.channel);
      items.push({ action: "followup", pageId: card.pageId, pr: card.pr, prNum: card.prNum, title: card.title,
        note: note || "reviewer flagged 🔄 with no note — re-examine" });
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

const [cmd, ...args] = process.argv.slice(2);
const run = {
  "ping": () => cmdPing(args[0], ...args.slice(1)),
  "resolve-channels": cmdResolveChannels,
  "post-batch": () => cmdPostBatch(args[0]),
  "poll-reactions": cmdPollReactions,
}[cmd];
if (!run) { console.error(`Unknown command: ${cmd}`); process.exit(2); }
await run();
