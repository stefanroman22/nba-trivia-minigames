#!/usr/bin/env node
// Gate 2 (design §7): deterministic browser QA scoped to what the diff touched.
//   docs-only diff → pass (skipped) · games touched → ui-audit --only <ids> at 3 viewports
//   routes touched → smoke at 390×844 and 1100×900 (loads, no console/page errors, screenshot)
//   brief `## QA assertions` → {route, selector, expect} checks
// Writes .team/qa/<slug>/verdict.json via the shared harness and exits 0/1. Kills what it started.
// Usage: node scripts/team/qa.mjs <slug> --base <sha> [--lane 1|2] [--repo <dir>]
import { spawn, spawnSync } from "node:child_process";
import { existsSync, readFileSync, renameSync, rmSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { ROOT, loadConfig } from "../lib/team-config.mjs";
import { classifyTouched, touchedFiles } from "./lib/touched.mjs";
import { loadQaMap, resolveQa } from "./lib/qa-map.mjs";
import { runDir, writeState } from "./lib/state.mjs";

const argv = process.argv.slice(2);
const slug = argv[0];
const arg = (k, d = null) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
if (!slug || slug.startsWith("--")) { console.error("usage: qa.mjs <slug> --base <sha> [--lane 1|2] [--repo <dir>]"); process.exit(2); }
const repo = resolve(arg("--repo", ROOT));
const base = arg("--base", "origin/dev");
const lane = Number(arg("--lane", "1"));
const cfg = loadConfig();
const ports = (cfg.qaPorts?.lanes || [cfg.qaPorts])[lane - 1] || { django: 8100, vite: 5273, socket: 4100 };
const dir = runDir(slug);
const win = process.platform === "win32";

// qa-browser.mjs lives in the repo under test (same file in every worktree); import it from there.
const harness = await import(pathToFileURL(resolve(repo, "scripts/qa-browser.mjs")).href);
const { launchBrowser, waitForServer, openApp, shot, writeVerdict } = harness;

const touched = touchedFiles(repo, base);
const cls = classifyTouched(touched);
if (cls.docsOnly || (!cls.frontend && !cls.backend)) {
  await writeVerdict(slug, true, [], `skipped: ${cls.docsOnly ? "docs-only" : "no frontend/backend files"} diff`);
  writeState(slug, { stage: "review" });
  console.log(JSON.stringify({ pass: true, skipped: cls.docsOnly ? "docs-only" : "no-ui", touched }));
  process.exit(0);
}
const plan = resolveQa(touched, loadQaMap());
const failures = [];
const notes = [];
const children = [];

function start(label, cmd, args, opts = {}) {
  const child = spawn(cmd, args, { cwd: opts.cwd || repo, env: { ...process.env, ...(opts.env || {}) }, shell: win && !/python/.test(cmd), stdio: ["ignore", "pipe", "pipe"], detached: !win });
  child.stdout.on("data", () => {}); child.stderr.on("data", () => {});
  children.push({ label, child });
  return child;
}
function stopAll() {
  for (const { child } of children) {
    try { if (win) spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore" }); else process.kill(-child.pid, "SIGTERM"); } catch { /* already gone */ }
  }
}
process.on("exit", stopAll);
process.on("SIGINT", () => { stopAll(); process.exit(130); });

const t0 = Date.now();
const log = (m) => console.error(`[qa +${Math.round((Date.now() - t0) / 1000)}s] ${m}`);
log(`touched ${touched.length} files → routes ${plan.routes.join(",") || "-"} games ${plan.games === "*" ? "all" : plan.games.join(",") || "-"} backend ${plan.backend}`);
try {
  // --- servers
  if (plan.backend) {
    const py = win ? ["backend/.venv/Scripts/python.exe", "backend/venv/Scripts/python.exe"] : ["backend/.venv/bin/python", "backend/venv/bin/python"];
    const python = py.map((p) => resolve(repo, p)).find((p) => existsSync(p)) || (win ? "python" : "python3");
    start("django", python, ["manage.py", "runserver", String(ports.django), "--noreload"], { cwd: resolve(repo, "backend"), env: { DATABASE_URL: "", NBA_DEV_ENV_SKIP: "1" } });
  }
  const feEnv = { NBA_DEV_ENV_SKIP: "1", PORT: String(ports.vite) };
  if (plan.backend) feEnv.VITE_BACKEND_URL = `http://localhost:${ports.django}/api`;
  // Gate 1 already produced a production build; serving it is ~10x faster per page than dev
  // mode compiling every route on first visit (18 games × 3 viewports took >12 min in dev).
  const prodBuild = existsSync(resolve(repo, ".next/BUILD_ID"));
  if (prodBuild) start("next", "npx", ["next", "start", "-p", String(ports.vite)], { env: feEnv });
  else start("next", "npm", ["run", "dev", "--", "--port", String(ports.vite)], { env: feEnv });
  const baseUrl = `http://localhost:${ports.vite}`;
  log(`waiting for ${baseUrl} (${prodBuild ? "next start, production build from gate 1" : "next dev — no .next/BUILD_ID"})`);
  await waitForServer(baseUrl, 120000);
  log("server up");
  if (!prodBuild) notes.push("served by next dev (no production build found)");
  if (plan.backend) await waitForServer(`http://localhost:${ports.django}/api/health/`, 90000).catch(() => notes.push("django health did not answer in 90s"));

  // --- ui-audit for touched games
  // A shared-component change maps to "*"; auditing all 18 games takes minutes per viewport, so
  // sample one pool game, one in-place game and one bespoke game plus every renderer the diff touched.
  const SAMPLE = ["series-winner", "career-path", "contexto"];
  const games = plan.games === "*" ? [...new Set([...SAMPLE, ...cls.games])] : plan.games;
  if (games.length) {
    if (plan.games === "*") notes.push(`shared UI touched → audited sample ${games.join(",")}`);
    const viewports = [["desktop", 1100, 900], ["laptop", 854, 694], ["mobile", 390, 844]];
    for (const [label, w, h] of viewports) {
      const auditLabel = `qa-${slug}-${label}`;
      const args = [resolve(repo, "scripts/ui-audit.mjs"), "--url", baseUrl, "--label", auditLabel, "--width", String(w), "--height", String(h), "--only", games.join(",")];
      log(`ui-audit ${label} ${games.join(",")}`);
      const r = spawnSync(process.execPath, args, { cwd: repo, encoding: "utf8", maxBuffer: 32 * 1024 * 1024, timeout: 240000 });
      log(`ui-audit ${label} exit ${r.status}`);
      if (r.status !== 0) {
        const lines = ((r.stdout || "") + (r.stderr || "")).split(/\r?\n/).filter((l) => /✖|×|FAIL|assert|Error/i.test(l)).slice(0, 40);
        failures.push(`ui-audit ${label} (${games.join(",")}) exit ${r.status === null ? "timeout" : r.status}: ${lines.join(" | ") || "see output"}`);
      }
      // ui-audit writes under docs/ui-audit/<label> (tracked folder) — move the evidence into the
      // card's QA dir so the worktree stays clean for ship's "only intended files" pre-flight.
      const from = resolve(repo, "docs/ui-audit", auditLabel);
      const to = resolve(repo, ".team/qa", slug, `audit-${label}`);
      try { rmSync(to, { recursive: true, force: true }); mkdirSync(resolve(repo, ".team/qa", slug), { recursive: true }); if (existsSync(from)) renameSync(from, to); } catch (e) { notes.push(`could not move ${auditLabel}: ${e.message}`); }
    }
  }

  // --- route smoke + assertions
  log("route smoke");
  const browser = await launchBrowser();
  const assertions = readAssertions(resolve(dir, "brief.md"));
  try {
    for (const route of plan.routes.length ? plan.routes : ["/"]) {
      for (const [w, h] of [[390, 844], [1100, 900]]) {
        const page = await browser.newPage({ viewport: { width: w, height: h } });
        const errors = [];
        page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
        page.on("pageerror", (e) => errors.push(String(e.message || e)));
        try {
          await openApp(page, baseUrl, route);
          await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});
          const hasMain = (await page.locator("main, .page, .app-shell").count()) > 0;
          if (!hasMain) failures.push(`${route} @${w}: no <main>/.page/.app-shell rendered`);
          // Noise that is not the card's fault: dev-tools hints, the multiplayer relay (not deployed in
          // production → socket.io 404/refused on every page), and — when no local backend is under
          // test — cross-origin fetches to the deployed API that the browser blocks with CORS from a
          // localhost QA port. JS exceptions (pageerror) and same-origin errors always count.
          const NOISE = /favicon|hydrat|ResizeObserver|Download the React DevTools|WebSocket|socket\.io|ERR_CONNECTION_REFUSED/i;
          const REMOTE = /CORS policy|net::ERR_FAILED|ERR_NAME_NOT_RESOLVED|Failed to load (resource|leaderboard|friends|users|profile)/i;
          const real = errors.filter((e) => !NOISE.test(e) && !(!plan.backend && REMOTE.test(e)));
          const ignored = errors.length - real.length;
          if (ignored && !notes.some((n) => n.startsWith("ignored"))) notes.push(`ignored ${ignored}+ relay/cross-origin console errors (no local backend under test)`);
          if (real.length) failures.push(`${route} @${w}: ${real.length} console/page error(s): ${real.slice(0, 3).join(" | ").slice(0, 400)}`);
          await shot(page, slug, `${route.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "") || "home"}-${w}`);
          for (const a of assertions.filter((x) => x.route === route && !x.flow)) {
            const loc = page.locator(a.selector);
            const count = await loc.count();
            const exp = String(a.expect || "visible");
            if (exp === "visible") { if (!count || !(await loc.first().isVisible())) failures.push(`${route} @${w}: expected ${a.selector} visible`); }
            else if (exp.startsWith("count>=")) { const n = Number(exp.slice(7)); if (count < n) failures.push(`${route} @${w}: expected ${a.selector} count>=${n}, got ${count}`); }
            else if (exp.startsWith("text:")) { const want = exp.slice(5); const txt = count ? await loc.first().innerText() : ""; if (!txt.includes(want)) failures.push(`${route} @${w}: expected ${a.selector} to contain "${want}", got "${txt.slice(0, 80)}"`); }
          }
        } catch (e) {
          failures.push(`${route} @${w}: ${String(e.message || e).split("\n")[0].slice(0, 300)}`);
        } finally { await page.close(); }
      }
    }
  } finally { await browser.close(); }
  const flows = assertions.filter((a) => a.flow);
  if (flows.length) notes.push(`${flows.length} flow assertion(s) need the browser-qa agent: ${flows.map((f) => f.flow).join(" | ").slice(0, 300)}`);
} catch (e) {
  failures.push(`qa harness: ${String(e.message || e).split("\n")[0].slice(0, 300)}`);
} finally {
  log("stopping servers");
  stopAll();
}

const pass = failures.length === 0;
const verdict = await writeVerdict(slug, pass, failures, [`lane ${lane}`, `routes ${plan.routes.join(",") || "-"}`, `games ${plan.games === "*" ? "all" : plan.games.join(",") || "-"}`, `${Math.round((Date.now() - t0) / 1000)}s`, ...notes].join(" · "));
writeState(slug, { stage: pass ? "review" : "build", lastFirstError: failures[0] || null });
console.log(JSON.stringify({ pass, failures, plan, notes, flows: readAssertions(resolve(dir, "brief.md")).filter((a) => a.flow), seconds: Math.round((Date.now() - t0) / 1000), verdict: `.team/qa/${slug}/verdict.json` }, null, 2));
process.exit(pass ? 0 : 1);

function readAssertions(briefPath) {
  if (!existsSync(briefPath)) return [];
  const md = readFileSync(briefPath, "utf8");
  const m = md.match(/## QA assertions[\s\S]*?```json\s*([\s\S]*?)```/);
  if (!m) return [];
  try { const arr = JSON.parse(m[1]); return Array.isArray(arr) ? arr : []; } catch { return []; }
}
