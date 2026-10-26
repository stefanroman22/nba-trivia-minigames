// brief.mjs quotes docs/constraints/SEO_CONSTRAINTS.md whenever the plan names an SEO path (or classify's areas
// name "seo"), whatever classify chose. Runs the real script on throwaway run dirs under .team/run/.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { ROOT } from "../lib/team-config.mjs";
import { RUN_ROOT } from "./lib/state.mjs";

const SEO_DOC = "docs/constraints/SEO_CONSTRAINTS.md";
const made = [];
after(() => { for (const d of made) rmSync(d, { recursive: true, force: true }); });

function brief(name, spec, classify = {}) {
  const slug = `zz-brief-seo-test-${process.pid}-${name}`;
  const dir = resolve(RUN_ROOT, slug);
  made.push(dir);
  mkdirSync(dir, { recursive: true });
  writeFileSync(resolve(dir, "card.json"), JSON.stringify({ id: `test-${name}`, title: "Test card for the brief", priority: "P2", spec }));
  writeFileSync(resolve(dir, "classify.json"), JSON.stringify({ difficulty: "standard", docs: [], ...classify }));
  execFileSync(process.execPath, [resolve(ROOT, "scripts/team/brief.mjs"), slug], { encoding: "utf8" });
  const text = readFileSync(resolve(dir, "brief.md"), "utf8");
  const from = text.indexOf("## Rules that apply"), to = text.indexOf("## Reuse");
  assert.ok(from >= 0 && to > from, "brief.md has the Rules and Reuse sections");
  return text.slice(from, to);
}

test("a plan naming src/app/sitemap.ts quotes the SEO doc", () => {
  const rules = brief("sitemap", "1. Add `/about` to `src/app/sitemap.ts`.\n2. Create `src/app/about/page.tsx`.");
  assert.match(rules, new RegExp(`### ${SEO_DOC}`));
  assert.match(rules, /RULE SEO-1 —/);
  assert.match(rules, /#### RULE SEO-\d+ —/); // at least one rule body is quoted, not only the index
});

test("a plan naming only src/views/Admin.tsx does not", () => {
  const rules = brief("admin", "1. Change the table header in `src/views/Admin.tsx`.");
  assert.doesNotMatch(rules, /SEO_CONSTRAINTS/);
});

test("classify areas naming seo add the doc without an SEO path", () => {
  const rules = brief("area", "Rewrite the share text.", { areas: ["frontend", "seo"] });
  assert.match(rules, new RegExp(`### ${SEO_DOC}`));
});

test("the SEO doc is not listed twice when classify already chose it", () => {
  const rules = brief("dup", "1. Edit `src/app/sitemap.ts`.", { docs: [SEO_DOC] });
  assert.equal(rules.split(`### ${SEO_DOC}`).length - 1, 1);
});
