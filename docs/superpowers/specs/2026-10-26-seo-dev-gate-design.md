# SEO rules before dev — design

Date: 2026-10-26. Owner request: when work that the SEO agent would check reaches `dev` (a new page, new metadata, a new
game), it must already follow the SEO principles; keep the post-deploy SEO check for further iteration.
Extends `docs/superpowers/specs/2026-10-25-seo-agent-design.md` (phase 1) and the phase-2 on-page work.

## 1. Intent

Today the 12 IX checks run only after a deploy to `main`, so a page that breaks an indexing rule is caught in production.
Move the same rules earlier: state them where builders read them, check the code before it lands, and check the built
page before it ships. The post-deploy audit and the Monday run stay unchanged as the safety net and the improvement loop.

**Goals**
- Builders (the team pipeline's engines and humans) see the SEO rules that apply to the files they change.
- A change that adds or alters a page cannot reach `dev` through the pipeline while it breaks an indexing rule.
- The same checks run in `dev-ci` for PRs and pushes to `dev`, so human work is checked too.
- Phase-2 (on-page) issues are reported as warnings, never blocking, until the owner decides otherwise.

**Non-goals**: new SEO checks (the IX and OP catalogues stay as they are); content writing; changing the post-deploy or
weekly workflows; branch protection settings (the owner's call).

**Anti-goals**: blocking a change for a problem it did not cause; blocking on network flakiness; slowing every pipeline
card (the built-page check runs only when SEO-relevant files changed); a rule document that drifts from the checks.

## 2. Shape: three layers

| Layer | What | Where it runs | Blocks |
|---|---|---|---|
| 1. Rules | `docs/constraints/SEO_CONSTRAINTS.md`, rules `SEO-1 … SEO-n`, each naming the IX/OP check that proves it | quoted in briefs by the team pipeline; read by humans | — |
| 2. Static check | `scripts/check-seo.mjs` (`npm run check:seo`, part of `npm run lint`): reads the source, no build | pipeline gate 1 (verify, already runs `npm run lint` for frontend changes); `dev-ci` lint job (push + PR to dev) | yes |
| 3. Built-page check | the existing `scripts/seo/audit.mjs` (IX) and `scripts/seo/onpage.mjs` (OP) against the locally served build, judged as if it were swishquest.com | pipeline gate 2 (QA, already serves the build); a new `dev-ci` job | IX yes; OP warnings only |

The pipeline fast-forwards to `dev` without a PR, so its gates (1 and 2) are where pipeline work is blocked; `dev-ci` on
a push then reports, and on a PR it blocks review in the usual way.

## 3. Layer 1: the rules document

`docs/constraints/SEO_CONSTRAINTS.md` in the format of the other constraint docs (`## Rule SEO-n: <title>` headings,
body with Why / Do / Don't / Check), registered in `scripts/check-constraint-ids.mjs` (`SEO` prefix) so ids stay unique
and references resolve. Rules (each says which check enforces it):

| id | rule | enforced by |
|---|---|---|
| SEO-1 | Every public page is in the sitemap (a game: a visible catalogue entry; any other page: its path in `src/app/sitemap.ts`) or is explicitly `noindex` and listed in `scripts/seo/config.json` `expectedNoindex`. No third state. | check:seo; IX-03, IX-10 |
| SEO-2 | Every indexable page sets its own `title`, `description` and `alternates.canonical`; the root layout never sets a canonical. | check:seo; IX-04, IX-05, IX-06 |
| SEO-3 | Private or thin pages (admin, profile, account, credits, coming-soon, thank-you, internal search) carry `robots: { index: false }` and stay out of the sitemap; never use robots.txt to hide a page that others link to. | check:seo; IX-01, IX-03 |
| SEO-4 | A game's `seoDescription` is 50–160 characters (aim 110–160), unique, specific, written for people. | check:seo; IX-06, OP-03 |
| SEO-5 | URLs are lowercase, hyphen-separated, no underscores or query strings; existing URLs are never renamed (a rename needs a 301 and loses signals). | check:seo; OP-07 |
| SEO-6 | Page content and links are in the server HTML (static or server rendering), links are real `<a href>`, one `<h1>`. | IX-07, IX-08, IX-11 |
| SEO-7 | Structured data: JSON-LD that matches the visible page, `url` = canonical, no invented ratings or reviews. | IX-09 |
| SEO-8 | Share preview: `og:title`, `og:description`, `og:image` present and the image loads. | IX-12 |
| SEO-9 (should) | Phase-2 on-page quality for new games: a primary search in `scripts/seo/keyword-map.json`, title/H1 built on it, a visible how-to-play section, related-game links, artwork as `<img>` with alt, BreadcrumbList. | OP-01 … OP-09 (warnings) |

Rules state the principle and the concrete Swish Quest file where it is set; they point to `docs/seo/indexing-guide.md`
and `docs/seo/onpage-guide.md` for background instead of repeating them.

**Getting the rules into briefs**: `scripts/team/brief.mjs` adds `docs/constraints/SEO_CONSTRAINTS.md` to the brief's
docs deterministically when a plan file matches the SEO paths (below), in addition to whatever classify chose; and the
`classify` skill lists the doc for cards that add a page or a game, change metadata, or whose Source starts with
`seo-check` (the SEO agent's own cards). Rule selection by keyword works unchanged; the SEO paths add the keywords
`seo`, `sitemap`, `metadata`.

**SEO paths** (one list in `scripts/seo/lib/seo-paths.mjs`, used by brief, QA and CI): `src/app/**/page.tsx`,
`src/app/**/layout.tsx`, `src/app/sitemap.ts`, `src/app/robots.ts`, `src/app/manifest.ts`,
`src/app/**/opengraph-image.tsx`, `src/app/**/twitter-image.tsx`, `src/configurations/site.ts`,
`src/utils/GameUtils.tsx`, `src/components/JsonLd.tsx`, `src/views/Trivia/MiniGame.tsx`, `src/app/page.tsx`,
`scripts/seo/config.json`, `scripts/seo/keyword-map.json`.

## 4. Layer 2: `npm run check:seo`

`scripts/check-seo.mjs` (no dependencies, reads source files, prints `SEO-n <file>: <what>` per violation, exit 1 on
any): it enumerates the routes under `src/app` (`page.tsx` files; route handlers such as `llms.txt/route.ts` are not
pages) and checks:

1. SEO-1/SEO-3: each static route is either noindex (`robots: { index: false` in its metadata) and listed in
   `expectedNoindex`, or indexable and its path appears in `src/app/sitemap.ts`; `expectedNoindex` lists no path that is
   not a noindex route; the `[game]` route is indexable and the sitemap is built from the visible games.
2. SEO-2: each indexable route exports `metadata` or `generateMetadata` with `title`, `description` and
   `alternates.canonical`; `src/app/layout.tsx` has no `alternates`/`canonical`.
3. SEO-4/SEO-5: each catalogue entry in `src/utils/GameUtils.tsx` that is visible (not hidden, not `coming-soon`) has a
   `urlPath` matching `^/[a-z0-9]+(-[a-z0-9]+)*$` and a `seoDescription` of 50–160 characters, unique among entries;
   a new route directory name follows the same URL rule.
4. Self-test with fixtures; and it passes on today's `dev` (if it does not, the gap is a finding to report, not to
   paper over).

It is appended to the `lint` script, so pipeline gate 1 (frontend changes) and the `dev-ci` lint job run it. Gate 1
(`scripts/team/verify.mjs`) also runs `npm run check:seo` on its own when the diff touches an SEO path but no frontend
file (for example only `scripts/seo/config.json`), without a build: config-only changes are checked statically, and
no card pays for a `next build` it did not need. Source
parsing is heuristic (string and regex scanning, no TypeScript compiler); the builder chooses the patterns, with tests
on the real files and on fixtures for each failure.

## 5. Layer 3: the built-page check

**Origin alias.** A local build names `https://swishquest.com` in canonicals, sitemap and `og:image` (`SITE_URL` is
hard-coded unless `NEXT_PUBLIC_SITE_URL` is set at build time). `audit.mjs` and `onpage.mjs` get `--as <origin>`: fetch
from `--site` (for example `http://localhost:5274`), but read every URL found in the sitemap, canonicals, `og:image` and
links that starts with `<origin>` as the same path on `--site`, and compare canonicals and sitemap URLs modulo the
origin. Without `--as` behaviour is unchanged. On a non-production host the existing rules already skip IX-01 (robots
disallows all off production) and the IX-02 `http`/`www` variants. In `--as` mode IX-03 also does not judge the
`X-Robots-Tag` response header: `next.config.ts` sends `X-Robots-Tag: noindex` to every host that is not
`swishquest.com` (previews stay out of Google), so a local build always carries it. The header is noted under Coverage
gaps; the per-page `<meta name="robots">` is still judged. The header rule itself is covered by the post-deploy audit.

**Measured 2026-10-26** (a production build of `dev` 12eb0de served on localhost, `NEXT_PUBLIC_SITE_URL` pointed at it,
`audit.mjs`): 18 URLs, every IX check passes except IX-03 on all 14 indexable pages, and that failure is exactly the
`X-Robots-Tag` host header above. With the rule above the gate passes on today's `dev`.

**Pipeline gate 2** (`scripts/team/qa.mjs`): when the diff touches an SEO path and the production build is served, run
`audit.mjs --site <baseUrl> --as https://swishquest.com --run-dir <qa dir>/seo` after the route smoke. Exit 1 → QA
failures, one line per failing IX id with its first evidence lines (capped). Exit 2 (infra) → a QA note, not a
failure. Then `onpage.mjs` with the same flags → its `## FAIL OP-nn` headers go into the QA notes as warnings. Docs-only
or non-SEO diffs: nothing runs. The QA verdict and the card's Slack QA message mention the SEO result in one line.

**`dev-ci`**: a job `seo-pages` (push and PR to dev): checkout with history, compute the changed files against the
base (`github.event.pull_request.base.sha` or `github.event.before`), skip unless an SEO path changed; `npm ci`,
`npm run build`, `next start` on a free port, wait for it, then the same two commands as gate 2. IX failures fail the
job; OP results go to the job summary. Upload the two digests as an artifact (no Search Console data is involved).

**What blocks**: only IX failures. A pre-existing IX failure on an untouched page would block unrelated work, which is
acceptable today because production passes all 12 checks; if that ever stops being true, the post-deploy audit files a
P0 card first.

## 6. Decisions

- **Reuse the existing audits** (`audit.mjs`, `onpage.mjs`) rather than a second implementation: one definition of each
  rule, so the gate and the post-deploy check can never disagree.
- **Static check in `lint`**: the cheapest and earliest point, already run by both the pipeline and CI.
- **Built-page check in QA, not verify**: QA already serves the production build; verify builds but does not serve.
- **OP checks warn, not block**: the on-page content does not exist yet; blocking would stall every page change.
- **Deterministic SEO doc selection in brief.mjs**: classify is an agent and may forget; the file-path rule cannot.

- **The `X-Robots-Tag` host header is not judged locally** (§5): it is environment, not page code; judging it would
  fail every page of every local build.
- **Settled by the builder check:** a transient (status 0) audit result is a QA note, not a failure; the SEO audit runs
  before the browser launch in QA (HTTP only, so it runs even when no browser is available); the `SEO-n` reference
  check in `check-constraint-ids.mjs` ignores SEO agent finding ids (`SEO-<8 digits>-…`); SEO-9 is a normal rule
  heading (the "should" lives in its body); `dev-ci` falls back to the base branch when `github.event.before` is the
  all-zero sha; `seo-pages` is not added to the promotion job's `needs`.

## 7. Left to the builder

The exact source-scanning patterns of `check-seo.mjs`; the QA line wording; the `dev-ci` job's port and wait loop
(copy the pattern of the existing CI or `scripts/team/qa.mjs`); the rule bodies' wording (concise, in the house style).

## 8. Verification

- `npm run check:seo` passes on today's `dev`, and fails with the right `SEO-n` line on fixtures for: a page in neither
  the sitemap nor noindex, a noindex page missing from `expectedNoindex`, a page without canonical, a layout canonical,
  a game with a 40-character `seoDescription`, a `urlPath` with an underscore.
- `audit.mjs --site http://localhost:<port> --as https://swishquest.com` against a local production build (built
  without `NEXT_PUBLIC_SITE_URL`) passes all IX checks it runs (IX-01, the IX-02 variants and the IX-03 header reported
  in Coverage gaps). Note: a worktree whose `node_modules` is a junction cannot run `next build` (Turbopack); use a real
  `npm ci` there or the main checkout.
- A throwaway change that removes a page's `description` makes both `check:seo` (SEO-2) and the local audit (IX-06) fail.
- `npm run lint`, `npm run test:seo`, `node --test scripts/team/*.test.mjs` (the files the brief/QA changes touch),
  `npm run build` and `tsc --noEmit` pass; the `dev-ci` YAML loads.
