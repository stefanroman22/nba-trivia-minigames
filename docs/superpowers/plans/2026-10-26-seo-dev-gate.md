# SEO rules before dev — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** SEO rules are stated for builders and checked before work lands on `dev` (static check in lint, built-page check in the pipeline's QA gate and in `dev-ci`), without changing the post-deploy or weekly SEO runs.

**Architecture:** a constraint doc `SEO_CONSTRAINTS.md` quoted by briefs; `scripts/check-seo.mjs` in `npm run lint` (and in verify for SEO-only config changes); the existing `audit.mjs`/`onpage.mjs` gain `--as <origin>` and run against the locally served build in `qa.mjs` and a `dev-ci` job.

**Tech Stack:** Node 22 ESM, `node --test`, no new dependencies; Next.js 16 App Router; GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-10-26-seo-dev-gate-design.md`

## Global Constraints

- No new npm dependencies; Node 22 ESM; tests `*.test.mjs` next to the code; `npm run test:seo` covers `scripts/seo/**`; team-script tests by explicit file (`node --test scripts/team/<file>.test.mjs`); `node --test <directory>` does NOT work on this Windows setup.
- Live production traffic stays GET/HEAD only; the gate audits only a locally served build.
- Only IX failures block; OP results are warnings; transient (status 0) results are notes.
- The post-deploy (`seo-audit.yml`) and weekly (`seo-weekly.yml`) workflows and their behaviour are unchanged.
- Without `--as`, `audit.mjs` and `onpage.mjs` behave byte-for-byte as today.
- A worktree with a junctioned `node_modules` cannot run `next build`: use a real `npm ci` for build-based verification.
- Commit messages: one short plain line, no attribution trailer. No emojis.

## Review Focus

1. A PR that adds `src/app/foo/page.tsx` with metadata but forgets the sitemap → `check:seo` fails `SEO-1` naming the file.
2. A local build served on localhost passes the gate today (the `X-Robots-Tag` host header is not judged in `--as` mode; meta robots still is).
3. A diff touching only `scripts/seo/config.json` runs `check:seo` in verify without a build.
4. An SEO agent finding id `SEO-20261102-1200-seo-001` in a doc is not treated as a broken `SEO-n` rule reference by `check:ids`.
5. `qa.mjs` on a non-SEO diff behaves exactly as today (no audit, no new notes).

---

### Task 1: Rules document and brief wiring

**Files:** create `docs/constraints/SEO_CONSTRAINTS.md`, `scripts/seo/lib/seo-paths.mjs`, `scripts/seo/seo-paths.test.mjs`; modify `scripts/check-constraint-ids.mjs`, `scripts/team/brief.mjs` (+ its test file if one exists, else `scripts/team/brief-seo.test.mjs`), `.claude/skills/classify/SKILL.md`.

**Interfaces:**
- Produces: `SEO_PATHS` (array of globs from spec §3) and `isSeoPath(file: string): boolean`, `touchesSeo(files: string[]): boolean` in `scripts/seo/lib/seo-paths.mjs` (posix-normalised paths; simple glob: `**`, `*`).
- Produces: `docs/constraints/SEO_CONSTRAINTS.md` with headings `## Rule SEO-1: …` … `## Rule SEO-9: …` (spec §3 table), each body: one-line why, Do, Don't, "Checked by" (the IX/OP ids and `check:seo` where it applies), the Swish Quest file where it is set; a top section pointing to `docs/seo/indexing-guide.md` and `docs/seo/onpage-guide.md`.

- [ ] Write `seo-paths.test.mjs`: every spec §3 path matches, `src/views/Admin.tsx` and `scripts/seo/audit.mjs` do not, Windows backslash paths normalise.
- [ ] Implement `seo-paths.mjs`; tests pass.
- [ ] Write the doc (house style of `docs/constraints/UI_SHELL_CONSTRAINTS.md`; concise).
- [ ] `check-constraint-ids.mjs`: register `SEO: "docs/constraints/SEO_CONSTRAINTS.md"`; references `SEO-<n>` resolve against it; strings matching `/SEO-\d{8}-/` (agent finding ids) are ignored. `npm run check:ids` passes.
- [ ] `brief.mjs`: when `touchesSeo(planFiles)` (or classify areas name it), add the SEO doc to `docs` and the keywords `seo`, `sitemap`, `metadata`. Test: a plan naming `src/app/sitemap.ts` yields a brief whose rules section lists the SEO doc; a plan naming only `src/views/Admin.tsx` does not.
- [ ] `classify/SKILL.md`: one rule line: cards that add a page or a game, change metadata/sitemap/robots, or whose Source starts with `seo-check` list `docs/constraints/SEO_CONSTRAINTS.md` in `docs`.
- [ ] `npm run lint`, `npm run test:seo`, the brief test file pass; commit `seo: SEO constraint rules and brief wiring`.

### Task 2: `npm run check:seo`

**Files:** create `scripts/check-seo.mjs`, `scripts/check-seo.test.mjs`, fixtures under `scripts/seo/fixtures/check-seo/`; modify `package.json` (`check:seo`, appended to `lint`), `scripts/team/verify.mjs` (+ `scripts/team/lib/touched.mjs` if that is where classification lives) and its test.

**Interfaces:**
- Consumes: `isSeoPath`/`touchesSeo` (Task 1); `scripts/seo/config.json` `expectedNoindex`.
- Produces: `checkSeo({ root }): { violations: [{ rule: 'SEO-n', file, message }] }`; CLI prints one `SEO-n <file>: <message>` per violation and `check:seo: ok (<n> routes, <m> games)` on success; exit 0/1.

- [ ] Fixtures: a minimal `src/app` tree per failure in spec §8 (page in neither sitemap nor noindex; noindex page missing from `expectedNoindex`; `expectedNoindex` entry with no noindex route; page without canonical; layout canonical; game `seoDescription` of 40 chars; duplicate `seoDescription`; `urlPath` with an underscore) and one clean tree.
- [ ] Tests: each fixture yields exactly its rule id; the clean tree and the REAL repo (`root` = repo) yield no violations. If the real repo fails, stop and report (do not change site code or loosen a rule).
- [ ] Implement with string/regex scanning per spec §4 (document the patterns in the file header).
- [ ] `package.json`: `"check:seo": "node scripts/check-seo.mjs"`, appended to `lint` (` && npm run check:seo`).
- [ ] `verify.mjs`: when the touched files include an SEO path but no frontend file, run `npm run check:seo` (label `check:seo`); test with the existing verify test harness (or a focused unit test of the decision function).
- [ ] `npm run lint`, the two test files, `npm run test:seo` pass; commit `seo: check:seo static check in lint and verify`.

### Task 3: `--as <origin>` for the audits

**Files:** modify `scripts/seo/audit.mjs`, `scripts/seo/onpage.mjs`, the lib functions they use for URL comparison, their tests.

**Interfaces:**
- Produces: CLI `--as <origin>` on both scripts; `runAudit({ …, asOrigin })` / the on-page equivalent; in `--as` mode every URL from the sitemap, canonicals, `og:image` and links that starts with `asOrigin` is fetched on `--site` and compared modulo the origin; IX-03 does not judge `X-Robots-Tag` (one Coverage gaps line: `IX-03 X-Robots-Tag not judged: <host> is served as <origin> (the host rule in next.config.ts)`), meta robots still judged.

- [ ] Tests on the existing fake-site server: a site whose sitemap and canonicals name `https://example.test` passes with `--as https://example.test` and fails IX-04 without it; a page with `X-Robots-Tag: noindex` passes IX-03 in `--as` mode and the gap line is present; a page with `<meta name="robots" content="noindex">` still fails in `--as` mode; without `--as` all existing tests pass unchanged.
- [ ] Implement; `npm run test:seo` passes.
- [ ] Real check (needs a real `npm ci`, not a junction): `npm run build`, `next start -p <port>`, `node scripts/seo/audit.mjs --site http://localhost:<port> --as https://swishquest.com` → exit 0 with IX-01, IX-02 variants and the IX-03 header in Coverage gaps; record the header line in the report. `onpage.mjs` with the same flags runs (exit 0 or 1; record the FAIL headers).
- [ ] Commit `seo: --as origin alias for local audits`.

### Task 4: QA gate, dev-ci job, docs

**Files:** modify `scripts/team/qa.mjs` (+ test), `.github/workflows/dev-ci.yml`, `docs/seo/README.md`, `docs/team/PIPELINE.md`.

- [ ] `qa.mjs`: when `touchesSeo(touched)` and the production build is served: before the browser launch, run `audit.mjs --site <baseUrl> --as https://swishquest.com --run-dir <qa dir>/seo`; exit 1 → one QA failure per failing IX id (`seo IX-nn: <first evidence line>`, at most 3 evidence lines each, transient lines excluded); exit 2 → a QA note; then `onpage.mjs` same flags → each `## FAIL OP-nn` header as a QA note `seo warning OP-nn …`. Non-SEO diffs: nothing new. Test the decision and the line formatting with injected runners (no real server).
- [ ] `dev-ci.yml`: job `seo-pages` (push and pull_request to dev, ubuntu-latest, 20 min): checkout `fetch-depth: 0`; changed files vs `github.event.pull_request.base.sha` or `github.event.before` (fallback `origin/dev~1` on the all-zero sha); skip unless one matches `seo-paths.mjs` (`node -e` with the lib); `npm ci`; `npm run build`; `next start -p 5400 &`; wait until `/` answers (60 s); the audit (IX failures fail the job) and on-page (summary to `$GITHUB_STEP_SUMMARY`, never fails); upload both digests (7 days). Not added to the promotion job's `needs`. YAML loads.
- [ ] Docs: README "Before dev" section (the three layers, commands, what blocks); PIPELINE.md one paragraph (SEO rules in briefs, `check:seo` in gate 1, the audit in gate 2).
- [ ] `npm run lint`, `npm run test:seo`, the qa test file pass; commit `seo: SEO gate in QA and dev-ci`.

### Task 5: Ship

- [ ] Whole-branch review; fixes; `npm run lint`, `npm run test:seo`, team test files, `npm run build`, `tsc --noEmit` (real `npm ci`); PR to dev, merge (owner's standing git grant); report the rules and what now blocks.
