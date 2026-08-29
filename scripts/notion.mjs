#!/usr/bin/env node
// Deterministic Notion I/O for the team pipeline. Zero deps (Node 18+ fetch).
// Env: NOTION_TOKEN (from .env.team or process env). Config: .claude/team/config.json
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CONFIG_PATH = resolve(ROOT, ".claude/team/config.json");
const ENV_PATH = resolve(ROOT, ".env.team");

function loadEnvTeam() {
  if (!process.env.NOTION_TOKEN && existsSync(ENV_PATH)) {
    for (const line of readFileSync(ENV_PATH, "utf8").split(/\r?\n/)) {
      const m = line.match(/^([A-Z_]+)=(.*)$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
    }
  }
}
loadEnvTeam();
const TOKEN = process.env.NOTION_TOKEN;
if (!TOKEN) { console.error("NOTION_TOKEN missing (set in .env.team or env)"); process.exit(2); }
const cfg = existsSync(CONFIG_PATH) ? JSON.parse(readFileSync(CONFIG_PATH, "utf8")) : {};
const DB = process.env.NOTION_DB_ID || cfg.notionDbId;
const USER = process.env.NOTION_USER_ID || cfg.notionUserId;

async function api(path, method = "GET", body) {
  const res = await fetch(`https://api.notion.com/v1/${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      "Notion-Version": "2022-06-28",
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json();
  if (!res.ok) { console.error(`Notion ${res.status}: ${json.message}`); process.exit(1); }
  return json;
}

const SCHEMA = {
  Name: { title: {} },
  Status: { select: { options: [
    { name: "Backlog", color: "gray" }, { name: "Ready", color: "blue" },
    { name: "In Progress", color: "yellow" }, { name: "In Review", color: "orange" },
    { name: "Blocked", color: "red" }, { name: "Blocked-approval", color: "pink" },
    { name: "Done", color: "green" },
  ] } },
  Priority: { select: { options: [
    { name: "P0", color: "red" }, { name: "P1", color: "yellow" }, { name: "P2", color: "gray" },
  ] } },
  Area: { multi_select: { options: ["games","ui","backend","multiplayer","auth","data"].map(n => ({ name: n })) } },
  Difficulty: { select: { options: [
    { name: "trivial", color: "gray" }, { name: "standard", color: "blue" }, { name: "hard", color: "red" },
  ] } },
  Branch: { rich_text: {} },
  PR: { url: {} },
  SlackTs: { rich_text: {} },
  Paused: { checkbox: {} },
};

const text = (s) => [{ type: "text", text: { content: String(s).slice(0, 1900) } }];

async function cmdSetup(parentPageId) {
  const db = await api("databases", "POST", {
    parent: { type: "page_id", page_id: parentPageId },
    title: text("NBA Team Board"),
    properties: SCHEMA,
  });
  console.log(`DB created: ${db.id}`);
  await api("pages", "POST", {
    parent: { database_id: db.id },
    properties: { Name: { title: text("CONTROL — do not delete") }, Paused: { checkbox: false } },
  });
  console.log("CONTROL row created");
}

async function cmdWhoamiUser(email) {
  let cursor, found;
  do {
    const r = await api(`users?page_size=100${cursor ? `&start_cursor=${cursor}` : ""}`);
    found = r.results.find(u => u.person?.email === email);
    cursor = r.has_more ? r.next_cursor : null;
  } while (!found && cursor);
  if (!found) { console.error(`No user with email ${email}`); process.exit(1); }
  console.log(found.id);
}

const isControl = (p) =>
  (p.properties?.Name?.title?.[0]?.plain_text || "").startsWith("CONTROL");

async function cmdCheckPause() {
  const r = await api(`databases/${DB}/query`, "POST", {
    filter: { property: "Paused", checkbox: { equals: true } },
  });
  if (r.results.some(isControl)) { console.log("PAUSED"); process.exit(3); }
  console.log("RUNNING");
}

async function cmdListReady() {
  const r = await api(`databases/${DB}/query`, "POST", {
    filter: { property: "Status", select: { equals: "Ready" } },
    page_size: 50,
  });
  const rank = { P0: 0, P1: 1, P2: 2 };
  const rows = r.results.filter(p => !isControl(p)).map(p => ({
    id: p.id,
    title: p.properties.Name.title.map(t => t.plain_text).join(""),
    priority: p.properties.Priority?.select?.name || "P2",
    area: (p.properties.Area?.multi_select || []).map(a => a.name),
    difficulty: p.properties.Difficulty?.select?.name || null,
    url: p.url,
  })).sort((a, b) => rank[a.priority] - rank[b.priority]);
  console.log(JSON.stringify(rows, null, 2));
}

async function cmdGetSpec(pageId) {
  let cursor, out = [];
  do {
    const r = await api(`blocks/${pageId}/children?page_size=100${cursor ? `&start_cursor=${cursor}` : ""}`);
    for (const b of r.results) {
      const rt = b[b.type]?.rich_text;
      if (rt) out.push((b.type.startsWith("heading") ? "## " : b.type === "bulleted_list_item" ? "- " : "") + rt.map(t => t.plain_text).join(""));
    }
    cursor = r.has_more ? r.next_cursor : null;
  } while (cursor);
  console.log(out.join("\n"));
}

async function setStatus(pageId, status) {
  await api(`pages/${pageId}`, "PATCH", { properties: { Status: { select: { name: status } } } });
}

async function cmdComment(pageId, body, mention) {
  const rich = [];
  if (mention && USER) rich.push({ type: "mention", mention: { user: { id: USER } } }, { type: "text", text: { content: " " } });
  rich.push({ type: "text", text: { content: String(body).slice(0, 1900) } });
  await api("comments", "POST", { parent: { page_id: pageId }, rich_text: rich });
  console.log("commented");
}

async function cmdSetProps(pageId, args) {
  const props = {};
  const bi = args.indexOf("--branch"); if (bi > -1) props.Branch = { rich_text: text(args[bi + 1]) };
  const pi = args.indexOf("--pr"); if (pi > -1) props.PR = { url: args[pi + 1] };
  const si = args.indexOf("--slack-ts"); if (si > -1) props.SlackTs = { rich_text: text(args[si + 1]) };
  await api(`pages/${pageId}`, "PATCH", { properties: props });
  console.log("props set");
}

async function cmdCreateCard(title, args) {
  const props = {
    Name: { title: text(title) },
    Status: { select: { name: "Ready" } },
    Priority: { select: { name: "P1" } },
  };
  const ai = args.indexOf("--area");
  if (ai > -1 && args[ai + 1]) props.Area = { multi_select: args[ai + 1].split(",").map(n => ({ name: n.trim() })) };
  const page = { parent: { database_id: DB }, properties: props };
  const bi = args.indexOf("--body");
  if (bi > -1 && args[bi + 1]) {
    page.children = [{ object: "block", type: "paragraph", paragraph: { rich_text: text(args[bi + 1]) } }];
  }
  const r = await api("pages", "POST", page);
  console.log(r.id);
}

async function cmdArchiveCard(pageId) {
  await api(`pages/${pageId}`, "PATCH", { archived: true });
  console.log("archived");
}

async function cmdListAwaitingFeedback() {
  const r = await api(`databases/${DB}/query`, "POST", {
    filter: { property: "SlackTs", rich_text: { is_not_empty: true } },
    page_size: 100,
  });
  const rows = r.results.filter(p => !isControl(p)).map(p => ({
    id: p.id,
    title: p.properties.Name.title.map(t => t.plain_text).join(""),
    slackTs: (p.properties.SlackTs?.rich_text || []).map(t => t.plain_text).join(""),
    pr: p.properties.PR?.url || "",
    areas: (p.properties.Area?.multi_select || []).map(a => a.name),
  })).filter(x => x.slackTs);
  console.log(JSON.stringify(rows, null, 2));
}

async function cmdClearSlackTs(pageId) {
  await api(`pages/${pageId}`, "PATCH", { properties: { SlackTs: { rich_text: [] } } });
  console.log("slack-ts cleared");
}

const [cmd, ...args] = process.argv.slice(2);
const run = {
  "setup": () => cmdSetup(args[0]),
  "whoami-user": () => cmdWhoamiUser(args[0]),
  "check-pause": cmdCheckPause,
  "list-ready": cmdListReady,
  "get-spec": () => cmdGetSpec(args[0]),
  "claim": async () => { await setStatus(args[0], "In Progress"); await cmdComment(args[0], "🤖 started", false); },
  "set-status": () => setStatus(args[0], args[1]),
  "set-props": () => cmdSetProps(args[0], args.slice(1)),
  "comment": () => cmdComment(args[0], args.filter(a => a !== "--mention").slice(1).join(" "), args.includes("--mention")),
  "create-card": () => cmdCreateCard(args[0], args.slice(1)),
  "archive-card": () => cmdArchiveCard(args[0]),
  "list-awaiting-feedback": cmdListAwaitingFeedback,
  "clear-slack-ts": () => cmdClearSlackTs(args[0]),
}[cmd];
if (!run) { console.error(`Unknown command: ${cmd}`); process.exit(2); }
await run();
