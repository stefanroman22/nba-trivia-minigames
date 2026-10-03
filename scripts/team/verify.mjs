#!/usr/bin/env node
// Gate 1 (design §4): run only the checks the touched files need, keep failures only, write
// .team/run/<slug>/verify.json and exit 0/1.
// Usage: node scripts/team/verify.mjs <slug> --base <sha> [--repo <dir>] [--touched a,b,c]
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { ROOT } from "../lib/team-config.mjs";
import { classifyTouched, touchedFiles } from "./lib/touched.mjs";
import { failuresOnly } from "./lib/output.mjs";
import { runDir, writeJson, writeState } from "./lib/state.mjs";

const argv = process.argv.slice(2);
const slug = argv[0];
const arg = (k, d = null) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
if (!slug || slug.startsWith("--")) { console.error("usage: verify.mjs <slug> --base <sha> [--repo <dir>] [--touched a,b]"); process.exit(2); }
const repo = resolve(arg("--repo", ROOT));
const base = arg("--base", "origin/dev");
const touched = arg("--touched") ? arg("--touched").split(",").map((s) => s.trim()).filter(Boolean) : touchedFiles(repo, base);
const cls = classifyTouched(touched);

export function venvPython(repoDir) {
  const win = process.platform === "win32";
  const candidates = win
    ? ["backend/.venv/Scripts/python.exe", "backend/venv/Scripts/python.exe"]
    : ["backend/.venv/bin/python", "backend/venv/bin/python"];
  for (const c of candidates) if (existsSync(resolve(repoDir, c))) return resolve(repoDir, c);
  return win ? "python" : "python3";
}

function run(label, cmd, args, opts = {}) {
  const t0 = Date.now();
  const r = spawnSync(cmd, args, { cwd: opts.cwd || repo, encoding: "utf8", shell: process.platform === "win32" && !/python/.test(cmd), env: { ...process.env, ...(opts.env || {}) }, maxBuffer: 64 * 1024 * 1024 });
  const out = (r.stdout || "") + (r.stderr || "");
  const exit = r.status ?? 1;
  return { label, cmd: [cmd, ...args].join(" "), ms: Date.now() - t0, exit, out };
}

const ran = [];
if (cls.frontend) {
  ran.push(run("lint", "npm", ["run", "lint", "--silent"]));
  if (ran.at(-1).exit === 0) ran.push(run("typecheck", "npx", ["next", "typegen"]), run("tsc", "npx", ["tsc", "--noEmit"]));
  if (ran.every((r) => r.exit === 0)) ran.push(run("build", "npm", ["run", "build", "--silent"]));
}
if (cls.backend) {
  const py = venvPython(repo);
  const env = { DATABASE_URL: "" };
  ran.push(run("django check", py, ["manage.py", "check"], { cwd: resolve(repo, "backend"), env }));
  if (ran.at(-1).exit === 0) ran.push(run("django tests", py, ["manage.py", "test", "users", "trivia", "--noinput"], { cwd: resolve(repo, "backend"), env }));
}
if (cls.multiplayer) ran.push(run("relay syntax", process.execPath, ["--check", "multiplayer_server/src/index.js"]));

const failed = ran.filter((r) => r.exit !== 0);
const failures = failed.map((r) => `### ${r.label} (exit ${r.exit})\n${failuresOnly(r.out, 100, { fallbackTail: true })}`).join("\n\n");
const testCount = (() => { const m = ran.find((r) => r.label === "django tests")?.out.match(/Ran (\d+) tests?/); return m ? Number(m[1]) : null; })();
const result = {
  pass: failed.length === 0,
  ran: ran.map(({ label, cmd, ms, exit }) => ({ label, cmd, ms, exit })),
  failures,
  testCount,
  touched,
  classes: cls,
  skipped: ran.length ? [] : [cls.docsOnly ? "docs-only" : "nothing to check"],
  at: new Date().toISOString(),
};
writeJson(resolve(runDir(slug), "verify.json"), result);
writeState(slug, { stage: result.pass ? "qa" : "build", lastFirstError: failures.split("\n").find((l) => l && !l.startsWith("###")) || null });
console.log(JSON.stringify({ pass: result.pass, ran: result.ran, testCount, skipped: result.skipped, failures: failures.slice(0, 4000) }, null, 2));
process.exit(result.pass ? 0 : 1);
