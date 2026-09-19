#!/usr/bin/env node
// Keeps exactly one open PR dev → main, listing the cards waiting in QA. Never merges.
import { writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { execSync } from "node:child_process";
import { ROOT } from "./lib/team-config.mjs";

const sh = (c) => execSync(c, { encoding: "utf8" }).trim();
const out = (o) => { console.log(JSON.stringify(o)); process.exit(0); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function devCiState(sha) {
  // Wait briefly for the dev-ci run on this sha to exist and finish (push → run is seconds).
  for (let i = 0; i < 10; i++) {
    const runs = JSON.parse(sh(`gh run list --workflow dev-ci.yml --branch dev --json headSha,status,conclusion --limit 20`));
    const run = runs.find((r) => r.headSha === sha);
    if (run && run.status === "completed") return run.conclusion;
    await sleep(30_000);
  }
  return "pending";
}

async function ensurePr() {
  sh("git fetch origin main dev --quiet");
  if (sh("git rev-list --count origin/main..origin/dev") === "0") out({ skipped: "dev not ahead of main" });
  const head = sh("git rev-parse origin/dev");
  const ci = await devCiState(head);
  if (ci === "pending") out({ skipped: `dev-ci still running on ${head.slice(0, 7)}` });
  if (ci !== "success") out({ skipped: `dev-ci ${ci} on ${head.slice(0, 7)}` });
  const qa = JSON.parse(sh("node scripts/notion.mjs list-qa"));
  const body = [
    "## Tasks in this promotion",
    ...qa.map((c) => `- ${c.title} · ${c.category} · ${c.commit.slice(0, 7)}`),
    "", `Notion-Tasks: ${qa.map((c) => c.id).join(",")}`,
    "", "Merge this PR on GitHub after checking the dev site. `main-sync` will move the cards to Done.",
  ].join("\n");
  const dir = resolve(ROOT, ".team"); mkdirSync(dir, { recursive: true });
  const bodyFile = resolve(dir, "promote-pr-body.md"); writeFileSync(bodyFile, body);
  const title = `Promote dev → main (${qa.length} task${qa.length === 1 ? "" : "s"})`;
  const open = JSON.parse(sh(`gh pr list --base main --head dev --state open --json number`));
  let number;
  if (open.length) { number = open[0].number; sh(`gh pr edit ${number} --title "${title}" --body-file "${bodyFile}"`); }
  else {
    const url = sh(`gh pr create --base main --head dev --title "${title}" --body-file "${bodyFile}" --label promote`);
    number = Number(url.match(/\/pull\/(\d+)/)?.[1]);
  }
  out({ number, count: qa.length });
}

const cmd = process.argv[2];
if (cmd !== "ensure-pr") { console.error("usage: promote.mjs ensure-pr"); process.exit(2); }
await ensurePr();
