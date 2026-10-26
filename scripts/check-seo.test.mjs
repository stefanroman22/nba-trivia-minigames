// node --test scripts/check-seo.test.mjs
// Each failure fixture is an overlay on fixtures/check-seo/clean: the test copies clean, then the overlay, into a
// temp dir and expects exactly the fixture's rule id.
import { test } from "node:test";
import assert from "node:assert/strict";
import { cpSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { checkSeo } from "./check-seo.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const REPO = join(here, "..");
const FIX = join(here, "seo", "fixtures", "check-seo");
const CLI = join(here, "check-seo.mjs");

function tree(overlay) {
  const dir = mkdtempSync(join(tmpdir(), "check-seo-"));
  cpSync(join(FIX, "clean"), dir, { recursive: true });
  if (overlay) cpSync(join(FIX, overlay), dir, { recursive: true });
  return dir;
}

function withTree(overlay, fn) {
  const dir = tree(overlay);
  try {
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const rules = (violations) => [...new Set(violations.map((v) => v.rule))];

test("the clean fixture has no violations", () => {
  withTree(null, (root) => {
    const r = checkSeo({ root });
    assert.deepEqual(r.violations, []);
    assert.equal(r.routes, 5); // /, [game], admin, coming-soon, privacy (llms.txt/route.ts is not a page)
    assert.equal(r.games, 2); // series-winner, name-logo (heatmap hidden, coming-soon excluded)
  });
});

test("the real repo has no violations", () => {
  const r = checkSeo({ root: REPO });
  assert.deepEqual(r.violations, [], r.violations.map((v) => `${v.rule} ${v.file}: ${v.message}`).join("\n"));
});

const CASES = [
  ["not-in-sitemap", "SEO-1", "src/app/about/page.tsx", /neither in src\/app\/sitemap\.ts nor noindex/],
  ["noindex-unlisted", "SEO-1", "src/app/thank-you/page.tsx", /not in expectedNoindex/],
  ["noindex-ghost", "SEO-1", "scripts/seo/config.json", /"\/ghost".*not a noindex page/],
  ["game-noindex", "SEO-1", "src/app/[game]/page.tsx", /game route must be indexable/],
  ["sitemap-all-games", "SEO-1", "src/app/sitemap.ts", /visibleGames/],
  ["noindex-in-sitemap", "SEO-3", "src/app/sitemap.ts", /"\/admin".*noindex/],
  ["no-canonical", "SEO-2", "src/app/privacy/page.tsx", /alternates\.canonical/],
  ["layout-canonical", "SEO-2", "src/app/layout.tsx", /canonical/],
  ["short-description", "SEO-4", "src/utils/GameUtils.tsx", /"name-logo".*40 characters/],
  ["duplicate-description", "SEO-4", "src/utils/GameUtils.tsx", /"name-logo".*same seoDescription as "series-winner"/],
  ["missing-description", "SEO-4", "src/utils/GameUtils.tsx", /"name-logo" has no seoDescription/],
  ["underscore-urlpath", "SEO-5", "src/utils/GameUtils.tsx", /"\/name_logo"/],
  ["route-dir-case", "SEO-5", "src/app/Thank_You/page.tsx", /"Thank_You"/],
];

for (const [fixture, rule, file, message] of CASES) {
  test(`${fixture} yields exactly ${rule}`, () => {
    withTree(fixture, (root) => {
      const { violations } = checkSeo({ root });
      assert.deepEqual(rules(violations), [rule], JSON.stringify(violations, null, 2));
      assert.equal(violations.length, 1, JSON.stringify(violations, null, 2));
      assert.equal(violations[0].file, file);
      assert.match(violations[0].message, message);
    });
  });
}

test("the home page may take its title and description from the root layout, but not its canonical", () => {
  withTree(null, (root) => {
    // a layout without title/description leaves the home page without them
    writeFileSync(join(root, "src", "app", "layout.tsx"), 'export const metadata = { metadataBase: new URL("https://example.com") };\nexport default function L({ children }: { children: unknown }) { return children; }\n');
    const { violations } = checkSeo({ root });
    assert.equal(violations.length, 1, JSON.stringify(violations));
    assert.equal(violations[0].file, "src/app/page.tsx");
    assert.match(violations[0].message, /title, description/);
  });
});

test("CLI prints ok with counts on a clean tree and exits 0", () => {
  withTree(null, (root) => {
    const r = spawnSync(process.execPath, [CLI, "--root", root], { encoding: "utf8" });
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.stdout.trim(), "check:seo: ok (5 routes, 2 games)");
  });
});

test("CLI prints one SEO-n line per violation and exits 1", () => {
  withTree("noindex-ghost", (root) => {
    const r = spawnSync(process.execPath, [CLI, "--root", root], { encoding: "utf8" });
    assert.equal(r.status, 1);
    const lines = r.stderr.trim().split(/\r?\n/).filter((l) => /^SEO-\d+ /.test(l));
    assert.equal(lines.length, 1, r.stderr);
    assert.match(lines[0], /^SEO-1 scripts\/seo\/config\.json: /);
  });
});
