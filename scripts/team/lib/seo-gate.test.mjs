import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { seoGate, seoArgs, auditFailureLines, onpageWarnings, SEO_ORIGIN } from "./seo-gate.mjs";

const RUN_DIR = "/qa/card/seo";
const REPO = "/wt";
const BASE = "http://localhost:5273";
const AUDIT_HEAD = "seo-audit: run 20261026-1200-seo · site http://localhost:5273 · 18 urls · 0 failing checks";
const ONPAGE_HEAD = "seo-onpage: run 20261026-1200-seo · site http://localhost:5273 · 18 urls · 0 failing checks";

/** A fake runner: answers by script name, records every call. */
function fakeRun(answers) {
  const calls = [];
  const run = async (args) => {
    calls.push(args);
    const key = /audit\.mjs$/.test(args[0]) ? "audit" : "onpage";
    return answers[key] ?? { status: 0, stdout: key === "audit" ? AUDIT_HEAD : ONPAGE_HEAD, stderr: "" };
  };
  return { run, calls };
}
const files = (map) => (p) => {
  const k = Object.keys(map).find((name) => p.replace(/\\/g, "/").endsWith(`/${name}`));
  if (!k) throw new Error(`ENOENT ${p}`);
  return map[k];
};
const result = ({ urls = {}, siteFailures = [] } = {}) => JSON.stringify({ urls, siteFailures });
const gate = (over) => seoGate({ touched: ["src/app/sitemap.ts"], prodBuild: true, baseUrl: BASE, runDir: RUN_DIR, repo: REPO, reset: () => {}, ...over });

test("a non-SEO diff runs nothing and adds nothing", async () => {
  const { run, calls } = fakeRun({});
  let reset = 0;
  const r = await gate({ touched: ["src/views/Admin.tsx", "backend/users/views.py"], run, reset: () => { reset += 1; } });
  assert.deepEqual(r, { ran: false, failures: [], notes: [] });
  assert.equal(calls.length, 0);
  assert.equal(reset, 0);
});

test("an SEO diff served by next dev is skipped with one note", async () => {
  const { run, calls } = fakeRun({});
  const r = await gate({ prodBuild: false, run });
  assert.equal(r.ran, false);
  assert.deepEqual(r.failures, []);
  assert.equal(r.notes.length, 1);
  assert.match(r.notes[0], /^seo: built-page check skipped .*next dev/);
  assert.equal(calls.length, 0);
});

test("the audit and on-page commands: --site, --as swishquest.com, --run-dir, the worktree's scripts", async () => {
  assert.equal(SEO_ORIGIN, "https://swishquest.com");
  assert.deepEqual(seoArgs({ repo: REPO, script: "audit", baseUrl: BASE, runDir: RUN_DIR }),
    [join(REPO, "scripts/seo/audit.mjs"), "--site", BASE, "--as", "https://swishquest.com", "--run-dir", RUN_DIR]);
  const { run, calls } = fakeRun({});
  let resetDir = null;
  await gate({ run, reset: (d) => { resetDir = d; } });
  assert.equal(resetDir, RUN_DIR, "a previous round's results are removed first");
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[0], seoArgs({ repo: REPO, script: "audit", baseUrl: BASE, runDir: RUN_DIR }));
  assert.deepEqual(calls[1], seoArgs({ repo: REPO, script: "onpage", baseUrl: BASE, runDir: RUN_DIR }));
});

test("a passing run: no failures, one summary note", async () => {
  const { run } = fakeRun({});
  const r = await gate({ run, readFile: files({}) });
  assert.equal(r.ran, true);
  assert.deepEqual(r.failures, []);
  assert.deepEqual(r.notes, ["seo: IX pass (18 urls) · on-page 0 warning(s)"]);
});

test("exit 1: one failure per IX id, first evidence lines (max 3), transient lines left out", async () => {
  const urls = {
    "http://localhost:5273/": { status: 200, failures: [] },
    "http://localhost:5273/a": { status: 200, failures: [
      { id: "IX-06", url: "http://localhost:5273/a", evidence: "no meta description" },
      { id: "IX-12", url: "http://localhost:5273/a", evidence: "request failed (timeout): og:image x, want 200", transient: true },
    ] },
    "http://localhost:5273/b": { status: 200, failures: [{ id: "IX-06", url: "http://localhost:5273/b", evidence: "no meta description" }] },
    "http://localhost:5273/c": { status: 200, failures: [{ id: "IX-06", url: "http://localhost:5273/c", evidence: "no meta description" }] },
    "http://localhost:5273/d": { status: 200, failures: [{ id: "IX-06", url: "http://localhost:5273/d", evidence: "no meta description" }] },
  };
  const siteFailures = [{ id: "IX-10", url: "http://localhost:5273/", evidence: "http://localhost:5273/sitemap.xml: lists no URL" }];
  const { run } = fakeRun({ audit: { status: 1, stdout: "seo-audit: run x · site y · 18 urls · 3 failing checks", stderr: "" } });
  const r = await gate({ run, readFile: files({ "results.json": result({ urls, siteFailures }) }) });
  assert.deepEqual(r.failures, [
    "seo IX-06: http://localhost:5273/a: no meta description | http://localhost:5273/b: no meta description | http://localhost:5273/c: no meta description (+1 more)",
    "seo IX-10: http://localhost:5273/: http://localhost:5273/sitemap.xml: lists no URL",
  ]);
  assert.equal(r.notes[0], "seo: IX FAIL IX-06, IX-10 (18 urls; transient left out: 1) · on-page 0 warning(s)");
});

test("exit 1 whose only failures are transient: a note, never a failure", async () => {
  const urls = { "http://localhost:5273/a": { status: 0, failures: [{ id: "IX-02", url: "http://localhost:5273/a", evidence: "request failed (ECONNRESET): want 200", transient: true }] } };
  const { run } = fakeRun({ audit: { status: 1, stdout: "seo-audit: run x · site y · 18 urls · 1 failing checks", stderr: "" } });
  const r = await gate({ run, readFile: files({ "results.json": result({ urls }) }) });
  assert.deepEqual(r.failures, []);
  assert.match(r.notes[0], /^seo: IX not judged, only transient failures \(1\): http:\/\/localhost:5273\/a: request failed/);
});

test("transient means the flag only: a mixed real + failed-request failure (flag dropped by audit.mjs) still fails", () => {
  const lines = auditFailureLines({ urls: {}, siteFailures: [
    { id: "IX-12", url: "u", evidence: "og:image a answered 404, want 200; request failed (x): og:image b, want 200" },
    { id: "IX-12", url: "v", evidence: "request failed (x): /favicon.ico, want 200" },
    { id: "IX-12", url: "w", evidence: "request failed (y): /manifest.webmanifest, want 200", transient: true },
  ] });
  assert.deepEqual(lines, {
    failures: ["seo IX-12: u: og:image a answered 404, want 200; request failed (x): og:image b, want 200 | v: request failed (x): /favicon.ico, want 200"],
    transient: ["w: request failed (y): /manifest.webmanifest, want 200"],
    ids: ["IX-12"],
  });
});

test("exit 1 with an unreadable results.json falls back to the stdout FAIL lines", async () => {
  const { run } = fakeRun({ audit: { status: 1, stdout: "seo-audit: run x · site y · 18 urls · 1 failing checks\nseo-audit: FAIL IX-04 · 2 url(s)\nseo-audit: digest d", stderr: "" } });
  const r = await gate({ run, readFile: files({}) });
  assert.equal(r.failures.length, 1);
  assert.match(r.failures[0], /^seo IX-04: 2 url\(s\) \(results\.json unreadable/);
});

test("exit 2 (infra): a note, not a failure", async () => {
  const { run } = fakeRun({ audit: { status: 2, stdout: "", stderr: "seo-audit: infra: every page request failed (ECONNREFUSED)" } });
  const r = await gate({ run, readFile: files({}) });
  assert.deepEqual(r.failures, []);
  assert.equal(r.notes[0], "seo: IX not judged (exit 2): seo-audit: infra: every page request failed (ECONNREFUSED) · on-page 0 warning(s)");
});

test("a timeout is a note, also when the kill left status 1 (Windows taskkill /F)", async () => {
  for (const audit of [{ status: 1, timedOut: true, stdout: "", stderr: "verify timed out after 5 min" }, { status: null, stdout: "", stderr: "" }]) {
    const { run } = fakeRun({ audit, onpage: { status: 1, timedOut: true, stdout: "", stderr: "" } });
    const r = await gate({ run, readFile: files({ "results.json": result({ siteFailures: [{ id: "IX-01", url: "u", evidence: "real" }] }) }) });
    assert.deepEqual(r.failures, [], JSON.stringify(audit));
    assert.deepEqual(r.notes, ["seo: IX not judged (seo audit timed out after 5 min) · on-page not judged (seo on-page timed out after 5 min)"]);
  }
});

test("the runner gets the timeout", async () => {
  const seen = [];
  await gate({ run: async (args, ms) => { seen.push(ms); return { status: 0, stdout: AUDIT_HEAD, stderr: "" }; }, timeoutMs: 120000 });
  assert.deepEqual(seen, [120000, 120000]);
});

test("on-page FAIL headers become `seo warning OP-nn …` notes, never failures", async () => {
  const summary = [
    "# seo-onpage: run x · site y · 18 urls · 2 failing checks", "",
    "## FAIL OP-01 keyword targeting", "- http://localhost:5273/a: no primary", "- http://localhost:5273/b: no primary", "",
    "## FAIL OP-08 related links", "- http://localhost:5273/a: none", "",
    "## Coverage gaps", "- none", "",
  ].join("\n");
  const { run } = fakeRun({ onpage: { status: 1, stdout: "", stderr: "" } });
  const r = await gate({ run, readFile: files({ "onpage-summary.md": summary }) });
  assert.deepEqual(r.failures, []);
  assert.deepEqual(r.notes, [
    "seo: IX pass (18 urls) · on-page 2 warning(s)",
    "seo warning OP-01 keyword targeting (2 url(s))",
    "seo warning OP-08 related links (1 url(s))",
  ]);
  assert.deepEqual(onpageWarnings(summary).map((w) => w.id), ["OP-01", "OP-08"]);
});

test("on-page infra: a note", async () => {
  const { run } = fakeRun({ onpage: { status: 2, stdout: "", stderr: "seo-onpage: infra: sitemap unreachable" } });
  const r = await gate({ run, readFile: files({}) });
  assert.deepEqual(r.failures, []);
  assert.deepEqual(r.notes, ["seo: IX pass (18 urls) · on-page not judged (exit 2): seo-onpage: infra: sitemap unreachable"]);
});
