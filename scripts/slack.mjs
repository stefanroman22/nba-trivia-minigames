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

async function cmdPing(channel, ...text) {
  const r = await api("chat.postMessage", { channel, text: text.join(" ") || "ping from nba-team-pipeline" }, true);
  console.log(`posted ts=${r.ts} channel=${r.channel}`);
}

async function cmdResolveChannels() {
  // Map the channel names to ids and write them into config. Only the pipeline
  // channel + the implementation-agent channels (frontend, backend) are used.
  const want = { "pipeline": ["slack", "generalChannel"], "agent-frontend": ["slack", "agentChannels", "frontend"],
    "agent-backend": ["slack", "agentChannels", "backend"] };
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
  for (const t of batch.shipped) {
    const body =
      `${t.n}.  *_${t.title}_*   ·   *${(t.areas || []).join("+")}*\n\n` +
      `*Check:*  ${t.look || "verify the change"}\n\n` +
      `✅ approve      ·      🔄 needs work — reply to say what\n​`;
    // Top-level (no thread_ts) so a human reply threads under THIS task, making
    // notes unambiguously per-task even when a batch has several tasks.
    const card = await api("chat.postMessage", { channel: chan, text: body }, true);
    if (t.pageId) {
      try { sh(`node scripts/notion.mjs set-props ${t.pageId} --slack-ts ${card.ts}`); }
      catch { console.error(`could not store slack ts for ${t.pageId} (non-fatal)`); }
    }
  }
  console.log(`posted batch: parent ts=${parent.ts}, ${batch.shipped.length} cards`);
}

async function cmdPollReactions() {
  const me = cfg.slack?.slackUserId;
  const chan = cfg.slack?.generalChannel;
  const items = [];
  let awaiting = [];
  try { awaiting = JSON.parse(sh(`node scripts/notion.mjs list-awaiting-feedback`)); }
  catch { console.error("could not list awaiting-feedback cards (non-fatal)"); console.log("[]"); return; }
  for (const card of awaiting) {
    let reacted = { fix: false, ok: false };
    const rr = await apiTry("reactions.get", { channel: chan, timestamp: card.slackTs, full: "true" });
    if (rr.ok) {
      for (const rx of (rr.message?.reactions || [])) {
        const mine = !me || (rx.users || []).includes(me);
        if (!mine) continue;
        if (/^(x|heavy_multiplication_x|repeat|arrows_counterclockwise|no_entry|hammer)$/.test(rx.name)) reacted.fix = true;
        if (/^(white_check_mark|heavy_check_mark|\+1|ok_hand)$/.test(rx.name)) reacted.ok = true;
      }
    }
    if (!reacted.fix && !reacted.ok) continue;
    let note = "";
    if (reacted.fix) {
      const rep = await apiTry("conversations.replies", { channel: chan, ts: card.slackTs });
      if (rep.ok) {
        const mineReplies = (rep.messages || []).filter(m => m.user === me);
        if (mineReplies.length) note = mineReplies.map(m => m.text).join(" | ");
      }
    }
    items.push(reacted.fix
      ? { action: "followup", pageId: card.id, pr: card.pr, title: card.title, areas: card.areas,
          note: note || "reviewer flagged 🔄 with no note — re-examine" }
      : { action: "ack", pageId: card.id, pr: card.pr, title: card.title, areas: card.areas, note: "" });
    // Clearing SlackTs is the dedup marker — this card is never polled again.
    try { sh(`node scripts/notion.mjs clear-slack-ts ${card.id}`); }
    catch { console.error(`could not clear slack ts for ${card.id} (non-fatal)`); }
  }
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
  // Only the implementation agents that actually write Agent notes get a digest.
  const nameMap = { "frontend-engine": "frontend", "backend-engine": "backend" };
  const buckets = { frontend: [], backend: [] };
  const prs = JSON.parse(sh(`gh pr list --state merged --base dev --search "merged:${date}" --json number,title,body,url,headRefName --limit 100`));
  for (const pr of prs) {
    if (!pr.headRefName.startsWith("team/")) continue;
    for (const n of parseAgentNotes(pr.body || "")) {
      const ch = nameMap[n.agent];
      if (ch) buckets[ch].push(`• ${pr.title} (PR#${pr.number}): ${n.did}\n  assumed: ${n.assumed}`);
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

async function cmdDigestWindow(startISO, endISO, label) {
  const start = Date.parse(startISO), end = Date.parse(endISO);
  const chan = cfg.slack?.generalChannel;
  // Duplicate guard: two schedulers fire this command for the same window (the
  // punctual Cloudflare cron, and GitHub's own cron as a late-firing backup).
  // A legitimate report can only post at-or-after the window's end, so if the
  // channel already holds a message with this window's head line since `end`,
  // this run is the duplicate — skip everything, including per-engine details.
  // Fails OPEN on any API error (e.g. missing_scope): a duplicate report is
  // annoying, a silently missing report is a defect.
  const head = `📋 *${label}* — merges ${startISO.slice(11, 16)}–${endISO.slice(11, 16)}`;
  // Slack normalizes raw emoji in stored text (📋 -> :clipboard:), so match on
  // the emoji-free remainder of the head line.
  const matchKey = head.replace("📋 ", "");
  if (chan) {
    const hist = await apiTry("conversations.history", {
      channel: chan, oldest: String(end / 1000), inclusive: "true", limit: "100",
    });
    if (hist.ok && (hist.messages || []).some((m) => (m.text || "").includes(matchKey))) {
      console.log("already posted, skipping (found this window's report in channel history)");
      return;
    }
    if (!hist.ok) console.error(`duplicate-guard check failed (posting anyway): ${hist.error}`);
  }
  const nameMap = { "frontend-engine": "frontend", "backend-engine": "backend" };
  const buckets = { frontend: [], backend: [] };
  const shipped = [];
  const prs = JSON.parse(sh(`gh pr list --state merged --base dev --json number,title,url,body,headRefName,mergedAt --limit 200`));
  for (const pr of prs) {
    if (!pr.headRefName?.startsWith("team/")) continue;
    const m = Date.parse(pr.mergedAt || "");
    if (!(m >= start && m < end)) continue;
    shipped.push(`• ${pr.title} (<${pr.url}|PR#${pr.number}>)`);
    for (const n of parseAgentNotes(pr.body || "")) {
      const ch = nameMap[n.agent];
      if (ch) buckets[ch].push(`• ${pr.title} (PR#${pr.number}): ${n.did}\n  assumed: ${n.assumed}`);
    }
  }
  // Always post a session line to #pipeline (reflect reality even when empty).
  if (chan) {
    // head built above (also used by the duplicate guard)
    const text = shipped.length
      ? `${head}: ${shipped.length} task(s) shipped\n${shipped.join("\n")}`
      : `${head}: no work this session.`;
    const r = await apiTry("chat.postMessage", { channel: chan, text }, true);
    console.log(r.ok ? `posted session line (${shipped.length} shipped)` : `session line failed (non-fatal): ${r.error}`);
  }
  // Per-engine detail only when there is work.
  for (const [agent, lines] of Object.entries(buckets)) {
    const ac = cfg.slack?.agentChannels?.[agent];
    if (!ac || !lines.length) continue;
    const text = `📆 ${agent} · ${label} · ${lines.length} shipped\n${lines.join("\n")}`;
    const r = await apiTry("chat.postMessage", { channel: ac, text }, true);
    console.log(r.ok ? `posted ${agent} detail` : `${agent} detail failed (non-fatal): ${r.error}`);
  }
}

const [cmd, ...args] = process.argv.slice(2);
const run = {
  "ping": () => cmdPing(args[0], ...args.slice(1)),
  "resolve-channels": cmdResolveChannels,
  "post-batch": () => cmdPostBatch(args[0]),
  "poll-reactions": cmdPollReactions,
  "daily-digests": () => cmdDailyDigests(args[0]),
  "digest-window": () => cmdDigestWindow(args[0], args[1], args.slice(2).join(" ")),
}[cmd];
if (!run) { console.error(`Unknown command: ${cmd}`); process.exit(2); }
await run();
