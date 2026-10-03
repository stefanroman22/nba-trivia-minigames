#!/usr/bin/env node
// Gate 2 (design §7): deterministic browser QA scoped to what the diff touched.
//   docs-only diff → pass (skipped) · games touched → ui-audit --only <ids> at 3 viewports
//   routes touched → smoke at 390×844 and 1100×900 (loads, no console/page errors, screenshot)
//   brief `## QA assertions` → {route, selector, expect} checks
// Evidence and verdict go to <main checkout>/.team/qa/<slug>/ whatever --repo is. Exits 0/1; a
// missing browser is "skipped", not a failure. Kills what it started, also on SIGTERM.
// Usage: node scripts/team/qa.mjs <slug> --base <sha> [--lane 1|2] [--repo <dir>]
import { spawn, spawnSync } from "node:child_process";
import { existsSync, readFileSync, renameSync, rmSync, mkdirSync } from "node:fs";
import { createServer } from "node:net";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { ROOT, loadConfig } from "../lib/team-config.mjs";
import { classifyTouched, touchedFiles } from "./lib/touched.mjs";
import { loadQaMap, resolveQa } from "./lib/qa-map.mjs";
import { runDir, readState, writeState } from "./lib/state.mjs";

process.chdir(ROOT); // qa-browser.mjs resolves .team/qa against cwd — pin it to the main checkout
if (process.env.TEAM_CLOUD === "1" && !process.env.PLAYWRIGHT_BROWSERS_PATH) process.env.PLAYWRIGHT_BROWSERS_PATH = "/opt/pw-browsers"; // where infra/routine/setup.sh installed Chromium

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
const qaDir = resolve(ROOT, ".team/qa", slug);

const harness = await import(pathToFileURL(resolve(repo, "scripts/qa-browser.mjs")).href);
const { launchBrowser, waitForServer, openApp, shot, writeVerdict } = harness;

const t0 = Date.now();
const log = (m) => console.error(`[qa +${Math.round((Date.now() - t0) / 1000)}s] ${m}`);
const touched = touchedFiles(repo, base);
const cls = classifyTouched(touched);

async function finish(pass, failures, notesArr, extra = {}) {
  const prev = readState(slug);
  const firstError = failures[0] || null;
  const sameFirstError = Boolean(firstError) && prev.lastFirstError?.qa === firstError;
  const verdict = await writeVerdict(slug, pass, failures, notesArr.join(" · "));
  writeState(slug, { stage: pass ? "review" : "build", lastFirstError: { ...(prev.lastFirstError || {}), qa: firstError } });
  console.log(JSON.stringify({ pass, failures, notes: notesArr, sameFirstError, seconds: Math.round((Date.now() - t0) / 1000), verdict: `.team/qa/${slug}/verdict.json`, ...extra }, null, 2));
  process.exit(pass ? 0 : 1);
}

if (cls.docsOnly || (!cls.frontend && !cls.backend)) {
  await finish(true, [], [`skipped: ${cls.docsOnly ? "docs-only" : "no frontend/backend files"} diff`], { skipped: cls.docsOnly ? "docs-only" : "no-ui", touched });
}
const plan = resolveQa(touched, loadQaMap());
const assertions = readAssertions(resolve(dir, "brief.md"));
for (const a of assertions) if (a.route && !a.flow && !plan.routes.includes(a.route)) plan.routes.push(a.route);
const failures = [];
const notes = [];
const children = [];

function start(label, cmd, args, opts = {}) {
  const useShell = win && /^(npm|npx)$/.test(cmd);
  const child = useShell
    ? spawn([cmd, ...args].join(" "), { cwd: opts.cwd || repo, env: { ...process.env, ...(opts.env || {}) }, shell: true, stdio: ["ignore", "pipe", "pipe"] })
    : spawn(cmd, args, { cwd: opts.cwd || repo, env: { ...process.env, ...(opts.env || {}) }, stdio: ["ignore", "pipe", "pipe"], detached: !win });
  let tail = "";
  child.stdout.on("data", (d) => { tail = (tail + d).slice(-2000); });
  child.stderr.on("data", (d) => { tail = (tail + d).slice(-2000); });
  child.on("exit", (code) => { if (code && !stopping) notes.push(`${label} exited early (code ${code}): ${tail.split("\n").filter(Boolean).slice(-3).join(" | ").slice(0, 300)}`); });
  children.push({ label, child });
  return child;
}
let stopping = false;
function stopAll() {
  stopping = true;
  for (const { child } of children) {
    try { if (win) spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore" }); else process.kill(-child.pid, "SIGTERM"); } catch { /* already gone */ }
  }
}
process.on("exit", stopAll);
for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"]) process.on(sig, () => { stopAll(); process.exit(130); });

function portFree(port) {
  return new Promise((res) => {
    const srv = createServer();
    srv.once("error", () => res(false));
    srv.listen(port, () => srv.close(() => res(true)));
  });
}
function venvPython() {
  const rel = win ? ["backend/.venv/Scripts/python.exe", "backend/venv/Scripts/python.exe"] : ["backend/.venv/bin/python", "backend/venv/bin/python"];
  for (const root of [repo, ROOT]) for (const c of rel) if (existsSync(resolve(root, c))) return resolve(root, c);
  return win ? "python" : "python3";
}

log(`touched ${touched.length} files → routes ${plan.routes.join(",") || "-"} games ${plan.games === "*" ? "all" : plan.games.join(",") || "-"} backend ${plan.backend}`);
try {
  for (const p of [ports.vite, ports.django]) if (!(await portFree(p))) throw new Error(`port ${p} is busy (another QA lane or an orphaned server) — free it or use the other lane`);

  // --- servers. Gate 1 built the frontend against the lane's Django port, so a lane backend always
  // runs when the frontend is under test (otherwise the UI would call the owner's :8000 or CORS-fail
  // against production). The worktree has no sqlite (ignored file): migrate first, seconds on sqlite.
  const py = venvPython();
  const dj = { cwd: resolve(repo, "backend"), env: { DATABASE_URL: "", NBA_DEV_ENV_SKIP: "1" } };
  const mig = spawnSync(py, ["manage.py", "migrate", "--noinput", "-v", "0"], { ...dj, env: { ...process.env, ...dj.env }, encoding: "utf8" });
  if (mig.status !== 0) notes.push(`migrate failed: ${((mig.stderr || "") + (mig.stdout || "")).split("\n").filter(Boolean).slice(-2).join(" | ").slice(0, 300)}`);
  start("django", py, ["manage.py", "runserver", String(ports.django), "--noreload"], dj);

  const feEnv = { NBA_DEV_ENV_SKIP: "1", PORT: String(ports.vite), VITE_BACKEND_URL: `http://localhost:${ports.django}/api` };
  const prodBuild = existsSync(resolve(repo, ".next/BUILD_ID"));
  // Call Next's bin through node directly: no shell, no npx (whose string form fails on this Windows setup).
  const nextBin = resolve(repo, "node_modules/next/dist/bin/next");
  if (prodBuild) start("next", process.execPath, [nextBin, "start", "-p", String(ports.vite)], { env: feEnv });
  else {
    spawnSync(process.execPath, [resolve(repo, "scripts/copy-data.mjs")], { cwd: repo, stdio: "ignore" }); // what `npm run dev` does first
    start("next", process.execPath, [nextBin, "dev", "-p", String(ports.vite)], { env: feEnv });
    notes.push("served by next dev (no production build found)");
  }
  const baseUrl = `http://localhost:${ports.vite}`;
  log(`waiting for ${baseUrl} (${prodBuild ? "next start, production build from gate 1" : "next dev"}) and django :${ports.django}`);
  await waitForServer(baseUrl, 120000);
  await waitForServer(`http://localhost:${ports.django}/api/health/`, 90000).catch(() => notes.push("django health did not answer in 90s"));
  log("servers up");

  // --- browser (missing → skipped, never a failure)
  let browser;
  try { browser = await launchBrowser(); }
  catch (e) {
    log(`no browser: ${String(e.message).split("\n")[0]}`);
    await finish(true, [], [`skipped: no browser available (${String(e.message).split("\n")[0].slice(0, 120)})`, ...notes], { skipped: "no-browser" });
  }

  // --- ui-audit for touched games. A shared-component change maps to "*"; auditing all 18 games
  // takes minutes per viewport, so sample one pool, one in-place and one bespoke game plus every
  // renderer the diff touched.
  const SAMPLE = ["series-winner", "career-path", "contexto"];
  const games = plan.games === "*" ? [...new Set([...SAMPLE, ...cls.games])] : plan.games;
  if (games.length) {
    if (plan.games === "*") notes.push(`shared UI touched → audited sample ${games.join(",")}`);
    for (const [label, w, h] of [["desktop", 1100, 900], ["laptop", 854, 694], ["mobile", 390, 844]]) {
      const auditLabel = `qa-${slug}-${label}`;
      const args = [resolve(repo, "scripts/ui-audit.mjs"), "--url", baseUrl, "--label", auditLabel, "--width", String(w), "--height", String(h), "--only", games.join(",")];
      log(`ui-audit ${label} ${games.join(",")}`);
      const r = spawnSync(process.execPath, args, { cwd: repo, encoding: "utf8", maxBuffer: 32 * 1024 * 1024, timeout: 240000, killSignal: "SIGKILL" });
      log(`ui-audit ${label} exit ${r.status}`);
      if (r.status !== 0) {
        const lines = ((r.stdout || "") + (r.stderr || "")).split(/\r?\n/).filter((l) => /✖|×|FAIL|assert|Error/i.test(l)).slice(0, 40);
        failures.push(`ui-audit ${label} (${games.join(",")}) ${r.status === null ? "timed out after 240s" : `exit ${r.status}`}: ${lines.join(" | ").slice(0, 1500) || "see output"}`);
      }
      // ui-audit writes under <repo>/docs/ui-audit/<label> (a tracked folder) — move the evidence to the
      // card's QA dir so the worktree stays clean for ship's "only intended files" pre-flight.
      const from = resolve(repo, "docs/ui-audit", auditLabel);
      const to = resolve(qaDir, `audit-${label}`);
      try { rmSync(to, { recursive: true, force: true }); mkdirSync(qaDir, { recursive: true }); if (existsSync(from)) renameSync(from, to); } catch (e) { notes.push(`could not move ${auditLabel}: ${e.message}`); }
    }
  }

  // --- route smoke + assertions
  log("route smoke");
  try {
    for (const route of plan.routes.length ? plan.routes : ["/"]) {
      for (const [w, h] of [[390, 844], [1100, 900]]) {
        const page = await browser.newPage({ viewport: { width: w, height: h } });
        const errors = [];
        page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
        page.on("pageerror", (e) => errors.push(`pageerror: ${String(e.message || e)}`));
        try {
          await openApp(page, baseUrl, route);
          await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});
          const hasMain = (await page.locator("main, .page, .app-shell").count()) > 0;
          if (!hasMain) failures.push(`${route} @${w}: no <main>/.page/.app-shell rendered`);
          // Noise that is not the card's fault: dev-tools hints, the multiplayer relay (not deployed in
          // production → socket.io 404/refused on every page), and requests to NON-localhost hosts (a build
          // pointed at the deployed API fails CORS from a localhost QA port — that is the build's origin,
          // not the UI). JS exceptions and same-origin errors always count.
          const NOISE = /favicon|hydrat|ResizeObserver|Download the React DevTools|WebSocket|socket\.io|ERR_CONNECTION_REFUSED.*(4000|4100|4101|socket)/i;
          const REMOTE_HOST = /https?:\/\/(?!localhost)[\w.-]+/i;
          const remoteSeen = errors.some((e) => REMOTE_HOST.test(e) && /CORS|ERR_FAILED|Failed to fetch|blocked/i.test(e));
          const real = errors.filter((e) => !NOISE.test(e) && !(REMOTE_HOST.test(e) && /CORS|ERR_FAILED|Failed to fetch|blocked/i.test(e)) && !(remoteSeen && /Failed to fetch|net::ERR_FAILED|Failed to load (resource|leaderboard|friends|users|profile)/i.test(e)));
          const ignored = errors.length - real.length;
          if (ignored && !notes.some((n) => n.startsWith("ignored"))) notes.push(`ignored ${ignored}+ relay/remote-host console errors${remoteSeen ? " (the build calls a non-localhost API)" : ""}`);
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
  if (flows.length) notes.push(`${flows.length} flow assertion(s) need the browser-qa agent`);
} catch (e) {
  failures.push(`qa harness: ${String(e.message || e).split("\n")[0].slice(0, 300)}`);
} finally {
  log("stopping servers");
  stopAll();
}

await finish(failures.length === 0, failures.slice(0, 30), [`lane ${lane}`, `routes ${plan.routes.join(",") || "-"}`, `games ${plan.games === "*" ? "all(sampled)" : plan.games.join(",") || "-"}`, ...notes], { plan, flows: assertions.filter((a) => a.flow) });

function readAssertions(briefPath) {
  if (!existsSync(briefPath)) return [];
  const md = readFileSync(briefPath, "utf8");
  const m = md.match(/## QA assertions[\s\S]*?```json\s*([\s\S]*?)```/);
  if (!m) return [];
  try { const arr = JSON.parse(m[1]); return Array.isArray(arr) ? arr : []; } catch { return []; }
}
