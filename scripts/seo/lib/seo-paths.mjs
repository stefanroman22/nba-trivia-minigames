// The files whose changes can alter what search engines see (design 2026-10-26-seo-dev-gate §3). One list, used by
// the team brief (quote docs/constraints/SEO_CONSTRAINTS.md), QA and CI (run the built-page SEO check).
// Globs are repo-relative, posix: `**` spans directories (zero or more), `*` stays inside one segment.
export const SEO_PATHS = [
  "src/app/**/page.tsx",
  "src/app/**/layout.tsx",
  "src/app/sitemap.ts",
  "src/app/robots.ts",
  "src/app/manifest.ts",
  "src/app/**/opengraph-image.tsx",
  "src/app/**/twitter-image.tsx",
  "src/configurations/site.ts",
  "src/utils/GameUtils.tsx",
  "src/components/JsonLd.tsx",
  "src/views/Trivia/MiniGame.tsx",
  "src/app/page.tsx",
  "scripts/seo/config.json",
  "scripts/seo/keyword-map.json",
];

function globToRegExp(glob) {
  let re = "";
  for (let i = 0; i < glob.length; i += 1) {
    const c = glob[i];
    if (c === "*" && glob[i + 1] === "*") {
      if (glob[i + 2] === "/") { re += "(?:.*/)?"; i += 2; } else { re += ".*"; i += 1; }
    } else if (c === "*") re += "[^/]*";
    else re += c.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`^${re}$`);
}

const SEO_RES = SEO_PATHS.map(globToRegExp);

const normalise = (file) => String(file || "").replace(/\\/g, "/").replace(/^(?:\.\/)+/, "");

/** @param {string} file repo-relative; backslashes and a leading ./ are accepted */
export function isSeoPath(file) {
  const f = normalise(file);
  return SEO_RES.some((re) => re.test(f));
}

/** @param {string[]} files */
export function touchesSeo(files) {
  return (files || []).some(isSeoPath);
}
