#!/usr/bin/env node
// Deterministic Notion I/O for the team pipeline. Zero deps (Node 18+ fetch).
// Env: NOTION_TOKEN (from .env.team or process env). Config: .claude/team/config.json
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { ROOT, STATUS, CATEGORIES, loadEnvTeam, loadConfig, text } from "./lib/team-config.mjs";
import { assembleSpec } from "./lib/notion-spec.mjs";

loadEnvTeam();
const TOKEN = process.env.NOTION_TOKEN;
if (!TOKEN) { console.error("NOTION_TOKEN missing (set in .env.team or env)"); process.exit(2); }
const cfg = loadConfig();
const DB = process.env.NOTION_DB_ID || cfg.notionDbId;
const USER = process.env.NOTION_USER_ID || cfg.notionUserId;
const MAX_ATTEMPTS = Number(cfg.maxAttempts ?? 2);
const VERSION = "2022-06-28";
// The comments endpoint only returns `attachments` on newer API versions; everything
// else stays on the version the rest of this file was written against.
const COMMENTS_VERSION = process.env.NOTION_COMMENTS_VERSION || "2025-09-03";

async function api(path, method = "GET", body, version = VERSION) {
  const res = await fetch(`https://api.notion.com/v1/${path}`, {
    method,
    headers: { Authorization: `Bearer ${TOKEN}`, "Notion-Version": version, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json();
  if (!res.ok) { console.error(`Notion ${res.status}: ${json.message}`); process.exit(1); }
  return json;
}

const sel = (names, colors = {}) => ({ select: { options: names.map((n) => ({ name: n, ...(colors[n] ? { color: colors[n] } : {}) })) } });
const STATUS_COLORS = { [STATUS.BACKLOG]: "gray", [STATUS.TODO]: "red", [STATUS.IN_PROGRESS]: "blue", [STATUS.QA]: "yellow", [STATUS.DONE]: "green" };
const SCHEMA = {
  Name: { title: {} },
  Status: sel(Object.values(STATUS), STATUS_COLORS),
  Category: sel([...CATEGORIES]),
  Priority: sel(["P0", "P1", "P2"], { P0: "red", P1: "yellow", P2: "gray" }),
  Attachments: { files: {} },
  Attempts: { number: { format: "number" } },
  "Needs human": { checkbox: {} },
  Model: { rich_text: {} },
  Difficulty: sel(["trivial", "standard", "hard"], { trivial: "gray", standard: "blue", hard: "red" }),
  Commit: { rich_text: {} },
  Branch: { rich_text: {} },
  SlackTs: { rich_text: {} },
  Paused: { checkbox: {} },
};

const arg = (args, flag) => { const i = args.indexOf(flag); return i > -1 ? args[i + 1] : undefined; };
const plain = (rich) => (rich || []).map((t) => t.plain_text).join("");
const isControl = (p) => plain(p.properties?.Name?.title).startsWith("CONTROL");
const row = (p) => ({
  id: p.id,
  title: plain(p.properties.Name?.title),
  priority: p.properties.Priority?.select?.name || "P2",
  category: p.properties.Category?.select?.name || "backend",
  difficulty: p.properties.Difficulty?.select?.name || null,
  attempts: p.properties.Attempts?.number || 0,
  commit: plain(p.properties.Commit?.rich_text),
  slackTs: plain(p.properties.SlackTs?.rich_text),
  url: p.url,
});

async function queryAll(filter) {
  let cursor, results = [];
  do {
    const r = await api(`databases/${DB}/query`, "POST", { ...(filter ? { filter } : {}), page_size: 100, ...(cursor ? { start_cursor: cursor } : {}) });
    results = results.concat(r.results);
    cursor = r.has_more ? r.next_cursor : null;
  } while (cursor);
  return results.filter((p) => !isControl(p));
}

async function setStatus(pageId, status) {
  await api(`pages/${pageId}`, "PATCH", { properties: { Status: { select: { name: status } } } });
}

async function comment(pageId, body, mention) {
  const rich = [];
  if (mention && USER) rich.push({ type: "mention", mention: { user: { id: USER } } }, { type: "text", text: { content: " " } });
  rich.push({ type: "text", text: { content: String(body).slice(0, 1900) } });
  await api("comments", "POST", { parent: { page_id: pageId }, rich_text: rich });
}

// ---------- commands ----------

async function cmdSetup(parentPageId) {
  const db = await api("databases", "POST", { parent: { type: "page_id", page_id: parentPageId }, title: text("NBA Team Board"), properties: SCHEMA });
  console.log(`DB created: ${db.id}`);
  await api("pages", "POST", { parent: { database_id: db.id }, properties: { Name: { title: text("CONTROL — do not delete") }, Paused: { checkbox: false } } });
  console.log("CONTROL row created");
}

async function cmdWhoamiUser(email) {
  let cursor, found;
  do {
    const r = await api(`users?page_size=100${cursor ? `&start_cursor=${cursor}` : ""}`);
    found = r.results.find((u) => u.person?.email === email);
    cursor = r.has_more ? r.next_cursor : null;
  } while (!found && cursor);
  if (!found) { console.error(`No user with email ${email}`); process.exit(1); }
  console.log(found.id);
}

async function cmdCheckPause() {
  const r = await api(`databases/${DB}/query`, "POST", { filter: { property: "Paused", checkbox: { equals: true } } });
  if (r.results.some(isControl)) { console.log("PAUSED"); process.exit(3); }
  console.log("RUNNING");
}

async function cmdListTodo() {
  const pages = await queryAll({ and: [
    { property: "Status", select: { equals: STATUS.TODO } },
    { property: "Needs human", checkbox: { equals: false } },
  ] });
  const rank = { P0: 0, P1: 1, P2: 2 };
  const rows = pages.map((p) => ({ ...row(p), created: p.created_time }))
    .sort((a, b) => (rank[a.priority] - rank[b.priority]) || a.created.localeCompare(b.created))
    .map(({ created, commit, slackTs, ...r }) => r);
  console.log(JSON.stringify(rows, null, 2));
}

async function cmdListQa() {
  const pages = await queryAll({ property: "Status", select: { equals: STATUS.QA } });
  console.log(JSON.stringify(pages.map((p) => { const r = row(p); return { id: r.id, title: r.title, category: r.category, commit: r.commit, url: r.url }; }), null, 2));
}

async function cmdListInProgress() {
  const pages = await queryAll({ property: "Status", select: { equals: STATUS.IN_PROGRESS } });
  console.log(JSON.stringify(pages.map((p) => ({ id: p.id, title: plain(p.properties.Name?.title) })), null, 2));
}

// Some external image hosts (e.g. Wikimedia) reject requests that carry no User-Agent.
const IMAGE_UA = "nba-minigames-team-pipeline/1.0 (+https://github.com/stefanroman22/nba-trivia-minigames)";
function downloader(pageId) {
  return async (url, index) => {
    if (!url) return null;
    let res;
    try { res = await fetch(url, { headers: { "User-Agent": IMAGE_UA } }); } catch { return null; }
    if (!res.ok) { console.error(`Attachment download failed (${res.status}): ${url}`); return null; }
    const ct = res.headers.get("content-type") || "";
    const ext = ct.includes("png") ? "png" : ct.includes("gif") ? "gif" : ct.includes("webp") ? "webp" : ct.includes("pdf") ? "pdf" : ct.includes("jpeg") ? "jpg" : "bin";
    const dir = resolve(ROOT, ".team/attachments", pageId);
    mkdirSync(dir, { recursive: true });
    const path = resolve(dir, `${index}.${ext}`);
    writeFileSync(path, Buffer.from(await res.arrayBuffer()));
    return path;
  };
}

async function cmdGetSpec(pageId) {
  let cursor, blocks = [];
  do {
    const r = await api(`blocks/${pageId}/children?page_size=100${cursor ? `&start_cursor=${cursor}` : ""}`);
    blocks = blocks.concat(r.results);
    cursor = r.has_more ? r.next_cursor : null;
  } while (cursor);
  const page = await api(`pages/${pageId}`);
  const files = page.properties?.Attachments?.files || [];
  let ccur, comments = [];
  do {
    const r = await api(`comments?block_id=${pageId}&page_size=100${ccur ? `&start_cursor=${ccur}` : ""}`, "GET", undefined, COMMENTS_VERSION);
    comments = comments.concat(r.results);
    ccur = r.has_more ? r.next_cursor : null;
  } while (ccur);
  const me = await api("users/me");
  console.log(await assembleSpec({ blocks, files, comments, botId: me.id, download: downloader(pageId) }));
}

async function cmdClaim(pageId, args) {
  const model = arg(args, "--model") || "";
  await api(`pages/${pageId}`, "PATCH", { properties: { Status: { select: { name: STATUS.IN_PROGRESS } }, Model: { rich_text: text(model) } } });
  await comment(pageId, `🤖 started · ${model}`, false);
  console.log("claimed");
}

async function cmdShipCard(pageId, args) {
  const commitSha = arg(args, "--commit"), branch = arg(args, "--branch"), model = arg(args, "--model") || "", devUrl = arg(args, "--dev-url") || cfg.devSiteUrl || "";
  if (!commitSha) { console.error("--commit required"); process.exit(2); }
  await api(`pages/${pageId}`, "PATCH", { properties: {
    Status: { select: { name: STATUS.QA } },
    Commit: { rich_text: text(commitSha) },
    ...(branch ? { Branch: { rich_text: text(branch) } } : {}),
    Model: { rich_text: text(model) },
  } });
  await comment(pageId, `✅ on dev (${commitSha.slice(0, 7)}) — check ${devUrl}`, true);
  console.log("shipped");
}

async function cmdFailCard(pageId, args) {
  const stage = arg(args, "--stage") || "unknown", reason = arg(args, "--reason") || "";
  const pmPath = arg(args, "--postmortem-file");
  const postmortem = pmPath ? readFileSync(pmPath, "utf8") : reason;
  const page = await api(`pages/${pageId}`);
  const attempts = (page.properties?.Attempts?.number || 0) + 1;
  const needsHuman = attempts >= MAX_ATTEMPTS;
  await api(`pages/${pageId}`, "PATCH", { properties: {
    Status: { select: { name: STATUS.TODO } },
    Attempts: { number: attempts },
    "Needs human": { checkbox: needsHuman },
  } });
  const head = `❌ attempt ${attempts}/${MAX_ATTEMPTS} failed at ${stage}: ${reason}` + (needsHuman ? " — Needs human is set; uncheck it to let the pipeline retry." : " — back in To Do, retries next run.");
  await comment(pageId, `${head}\n\n${postmortem}`, true);
  console.log(JSON.stringify({ attempts, needsHuman, maxAttempts: MAX_ATTEMPTS }));
}

async function cmdMarkDone(pageId) {
  await setStatus(pageId, STATUS.DONE);
  await comment(pageId, "🚀 in production", true);
  console.log("done");
}

async function cmdSetProps(pageId, args) {
  const props = {};
  const b = arg(args, "--branch"); if (b) props.Branch = { rich_text: text(b) };
  const c = arg(args, "--commit"); if (c) props.Commit = { rich_text: text(c) };
  const s = arg(args, "--slack-ts"); if (s) props.SlackTs = { rich_text: text(s) };
  const cat = arg(args, "--category"); if (cat) props.Category = { select: { name: cat } };
  await api(`pages/${pageId}`, "PATCH", { properties: props });
  console.log("props set");
}

async function cmdCreateCard(title, args) {
  const props = { Name: { title: text(title) }, Status: { select: { name: STATUS.TODO } }, Priority: { select: { name: "P1" } } };
  const cat = arg(args, "--category"); if (cat) props.Category = { select: { name: cat } };
  const page = { parent: { database_id: DB }, properties: props };
  const body = arg(args, "--body");
  if (body) page.children = [{ object: "block", type: "paragraph", paragraph: { rich_text: text(body) } }];
  const r = await api("pages", "POST", page);
  console.log(r.id);
}

async function cmdArchiveCard(pageId) { await api(`pages/${pageId}`, "PATCH", { archived: true }); console.log("archived"); }

async function cmdListAwaitingFeedback() {
  const pages = await queryAll({ property: "SlackTs", rich_text: { is_not_empty: true } });
  console.log(JSON.stringify(pages.map((p) => { const r = row(p); return { id: r.id, title: r.title, slackTs: r.slackTs, category: r.category }; }).filter((x) => x.slackTs), null, 2));
}

async function cmdClearSlackTs(pageId) { await api(`pages/${pageId}`, "PATCH", { properties: { SlackTs: { rich_text: [] } } }); console.log("slack-ts cleared"); }

// One-shot migration from the v1 board (Ready/In Progress/In Review/Blocked/…) to v2.
// --qa <id>:<sha>,...       Done cards whose commit is on dev but not main → QA with Commit set
// --category <id>=<cat>,... Category for existing cards (Area is dropped)
async function cmdMigrateV2(args) {
  const qa = Object.fromEntries((arg(args, "--qa") || "").split(",").filter(Boolean).map((s) => s.split(":")));
  const cats = Object.fromEntries((arg(args, "--category") || "").split(",").filter(Boolean).map((s) => s.split("=")));
  const OLD = ["Backlog", "Ready", "In Progress", "In Review", "Blocked", "Blocked-approval", "Done"];
  // 1. add the new options + properties while the old options still exist
  await api(`databases/${DB}`, "PATCH", { properties: {
    Status: sel([...new Set([...OLD, ...Object.values(STATUS)])], STATUS_COLORS),
    Category: SCHEMA.Category, Attachments: SCHEMA.Attachments, Attempts: SCHEMA.Attempts,
    "Needs human": SCHEMA["Needs human"], Model: SCHEMA.Model, Commit: SCHEMA.Commit,
  } });
  // 2. move every row
  const map = { Ready: STATUS.TODO, "In Progress": STATUS.IN_PROGRESS, "In Review": STATUS.QA, Blocked: STATUS.TODO, "Blocked-approval": STATUS.TODO };
  for (const p of await queryAll()) {
    const old = p.properties.Status?.select?.name;
    const props = { Attempts: { number: 0 } };
    if (qa[p.id]) { props.Status = { select: { name: STATUS.QA } }; props.Commit = { rich_text: text(qa[p.id]) }; }
    else if (map[old]) props.Status = { select: { name: map[old] } };
    if (old === "Blocked" || old === "Blocked-approval") props["Needs human"] = { checkbox: true };
    if (cats[p.id]) props.Category = { select: { name: cats[p.id] } };
    await api(`pages/${p.id}`, "PATCH", { properties: props });
    console.log(`migrated ${p.id}: ${old} → ${props.Status?.select?.name || old}`);
  }
  // 3. final option set, drop Area + PR
  await api(`databases/${DB}`, "PATCH", { properties: { Status: SCHEMA.Status, Area: null, PR: null } });
  console.log("schema finalized");
}

const [cmd, ...args] = process.argv.slice(2);
const run = {
  "setup": () => cmdSetup(args[0]),
  "whoami-user": () => cmdWhoamiUser(args[0]),
  "check-pause": cmdCheckPause,
  "list-todo": cmdListTodo,
  "list-qa": cmdListQa,
  "list-in-progress": cmdListInProgress,
  "get-spec": () => cmdGetSpec(args[0]),
  "claim": () => cmdClaim(args[0], args.slice(1)),
  "ship-card": () => cmdShipCard(args[0], args.slice(1)),
  "fail-card": () => cmdFailCard(args[0], args.slice(1)),
  "mark-done": () => cmdMarkDone(args[0]),
  "set-status": () => setStatus(args[0], args[1]).then(() => console.log("status set")),
  "set-props": () => cmdSetProps(args[0], args.slice(1)),
  "comment": () => comment(args[0], args.filter((a) => a !== "--mention").slice(1).join(" "), args.includes("--mention")).then(() => console.log("commented")),
  "create-card": () => cmdCreateCard(args[0], args.slice(1)),
  "archive-card": () => cmdArchiveCard(args[0]),
  "list-awaiting-feedback": cmdListAwaitingFeedback,
  "clear-slack-ts": () => cmdClearSlackTs(args[0]),
  "migrate-v2": () => cmdMigrateV2(args),
}[cmd];
if (!run) { console.error(`Unknown command: ${cmd}`); process.exit(2); }
await run();
