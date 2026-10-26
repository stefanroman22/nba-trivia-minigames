import { test } from "node:test";
import assert from "node:assert/strict";
import { SEO_PATHS, isSeoPath, touchesSeo } from "./lib/seo-paths.mjs";

const SPEC_PATHS = [
  "src/app/page.tsx",
  "src/app/[game]/page.tsx",
  "src/app/privacy/page.tsx",
  "src/app/layout.tsx",
  "src/app/admin/layout.tsx",
  "src/app/sitemap.ts",
  "src/app/robots.ts",
  "src/app/manifest.ts",
  "src/app/opengraph-image.tsx",
  "src/app/[game]/opengraph-image.tsx",
  "src/app/twitter-image.tsx",
  "src/app/[game]/twitter-image.tsx",
  "src/configurations/site.ts",
  "src/utils/GameUtils.tsx",
  "src/components/JsonLd.tsx",
  "src/views/Trivia/MiniGame.tsx",
  "scripts/seo/config.json",
  "scripts/seo/keyword-map.json",
];

test("SEO_PATHS is the spec §3 glob list", () => {
  assert.ok(Array.isArray(SEO_PATHS));
  assert.ok(SEO_PATHS.includes("src/app/**/page.tsx"));
  assert.ok(SEO_PATHS.includes("scripts/seo/keyword-map.json"));
});

test("every spec §3 path matches", () => {
  for (const p of SPEC_PATHS) assert.equal(isSeoPath(p), true, p);
});

test("non-SEO files do not match", () => {
  for (const p of ["src/views/Admin.tsx", "scripts/seo/audit.mjs", "src/app/providers.tsx", "src/app/template.tsx",
    "src/app/llms.txt/route.ts", "src/app/page.tsx.bak", "xsrc/app/sitemap.ts", "src/utils/GameUtils.tsx.orig"]) {
    assert.equal(isSeoPath(p), false, p);
  }
});

test("Windows backslash and ./ paths normalise", () => {
  assert.equal(isSeoPath("src\\app\\[game]\\page.tsx"), true);
  assert.equal(isSeoPath("scripts\\seo\\config.json"), true);
  assert.equal(isSeoPath("./src/app/sitemap.ts"), true);
  assert.equal(isSeoPath("src\\views\\Admin.tsx"), false);
});

test("touchesSeo is true when any file is an SEO path", () => {
  assert.equal(touchesSeo(["src/views/Admin.tsx", "src/app/sitemap.ts"]), true);
  assert.equal(touchesSeo(["src/views/Admin.tsx"]), false);
  assert.equal(touchesSeo([]), false);
  assert.equal(touchesSeo(undefined), false);
});
