---
name: seo
description: SEO hub for nba-minigames: which area skill to load (indexing; on-page, opt-in phase 2), the ledger and export rules, the read budget, the privacy of query data. Use for "/seo", "SEO check", "indexing", "is page X indexed", "Search Console", "on-page", "titles", "keywords".
---

# SEO (hub)

Scripts measure, the `seo` agent (or this session) judges. Background: `docs/seo/README.md`; design
`docs/superpowers/specs/2026-10-25-seo-agent-design.md`; the owner's study `docs/seo/indexing-guide.md` (phase 1) and
`docs/seo/onpage-guide.md` (phase 2); catalogue `scripts/seo/CHECKS.md`; config `scripts/seo/config.json`; keyword map
`scripts/seo/keyword-map.json`.

## Config
| key | value | used by |
|---|---|---|
| site | `https://swishquest.com` (`config.json` `site`) | every command |
| property | `sc-domain:swishquest.com` | Search Console |
| site live since | **2026-10-09** (the move to swishquest.com, `docs/SEO-OWNER-TODO.md`) | the site's age in the decision rules: young = run date before 2026-12-08 (60 days) |
| expected noindex | `/admin`, `/profile`, `/credits`, `/coming-soon` (`config.json` `expectedNoindex`) | "sitemap URL" = every audited URL not on this list |

## 1. Areas
| area | skill | status |
|---|---|---|
| indexing (can every page be indexed, is it, what to do next) | `seo-indexing` | live, phase 1 (every run) |
| on-page (keyword map, title, description, headings, content, links, URL, images, structured data, page experience, Search Console query data) | `seo-onpage` | live, phase 2, opt-in: `--areas indexing,onpage`; always after `seo-indexing` |

Load the area skill the task names; "/seo", "SEO check", "indexing", "is page X indexed" all mean `seo-indexing`;
"on-page", "titles", "keywords", "content", "why does page X not get clicks" mean `seo-indexing` then `seo-onpage`
(the query data and page experience of earlier plans are its areas 10 and 11).
Model rule: the judgement runs on `fable` (the agent's frontmatter); nothing the agent does needs a cheaper tier,
because the scripts do the bulk work.

## 2. Read budget and token rules (binding, agent and session alike)
- Read only: `<runDir>/digest.md` (header, `## FAIL IX-nn`, `## Regressions`, `## Coverage gaps`),
  `<runDir>/gsc-summary.md`, `<runDir>/ledger-summary.md`, `scripts/seo/CHECKS.md`, `<runDir>/findings.json` when the
  run already wrote one, the `seo-indexing` references a step needs, and `docs/seo/indexing-guide.md`: the guide's
  §4 section for the step in hand, only that section.
- Phase 2 adds: `<runDir>/onpage-summary.md`, `<runDir>/queries-summary.md` (PRIVATE, see below),
  `scripts/seo/keyword-map.json`, the `seo-onpage` references a check needs, and `docs/seo/onpage-guide.md`: the §6
  area in hand, only that area.
- Never open `results.json`, `gsc.json`, `gsc-analytics.json`, `gsc-analytics-pq.json`, `onpage.json`, `ledger.json`,
  `ledger-previous.json`, an export, a CSV. The exceptions are the per-URL slice commands in `seo-indexing` and
  `seo-onpage` ("Inputs"), which print coverage fields and page signals only.
- Never print or write a click, impression, CTR, position or query: the weekly run's stdout is a public log, and the
  repo, its branches and the run artifacts are world-readable. Search Analytics lives only in the Drive export and,
  with phase 2, in the run dir's `gsc-analytics-pq.json` and `queries-summary.md` (never uploaded).
- Query data (phase 2): `queries-summary.md` is read with the Read tool, never through Bash. Its query strings and
  numbers may be written only into the `current`/`howToFix` of a `card` finding in `findings.json` (they reach the
  Notion card body); never into `REPORT.md`, `docs/seo/owner-actions.md`, another finding, a log, Slack or a return.
  `notion-push.mjs --dry-run` prints card bodies: on a phase-2 run, use it only in a local session, never paste it.
- Never a secret: `run.mjs` strips them from the agent's env; do not go looking for them.
- Source code: Grep, then Read about 30 lines around the hit. Never a whole file you do not need.

## 3. Run it locally
The weekly run (GitHub Actions `seo-weekly.yml`, Mondays 06:00 Europe/Paris) calls the agent through `claude -p`. By
hand, the same steps with the judgement in this session:
```
node scripts/seo/run.mjs --notion dry --slack off --agents off
```
- Add `--dry-run` to keep everything on this machine (no store push, no ping, no upload, no owner-actions commit),
  `--gsc off` for the audit alone (no Google credentials needed), `--no-state` to use this home's ledger only (no git).
- The second line is `seo-run: run <runId> · site <site> · <runDir>`. Then load `seo-indexing` and do its "Producing the
  run's output" on that `<runDir>`, as the agent would. The run wrote a placeholder `REPORT.md` (overwrite it) and,
  without Google credentials, a `findings.json` with the "Set up Search Console access" finding (merge into it).
- Phase 2 on top: add `--areas indexing,onpage` (the on-page step, and with Google credentials Search Analytics page ×
  query; `PSI_API_KEY` in the env adds PageSpeed data). After `seo-indexing`, load `seo-onpage` and do its "Producing
  the run's output" on the same `<runDir>`. The on-page step alone: `node scripts/seo/onpage.mjs --site <site>`.
- Validate: `node scripts/seo/notion-push.mjs --run <runId> --validate-only` (exit 0, no Notion call). A preview of the
  cards: `--dry-run` instead (reads Notion, needs `NOTION_TOKEN`); cards for real only when the owner asks: neither flag.
- To delegate instead: `--agents on` (`--agent-model fable`, watchdog `--agent-timeout-sec 1800`), or dispatch
  `subagent_type: "seo"` with the run's prompt: `Load the seo skill, then the seo-indexing skill. Run dir: <runDir>.
  Site: <site>. Write <runDir>/findings.json and docs/seo/owner-actions.md per the skill. Return ≤ 10 lines.` (phase 2:
  `Load the seo skill, then the seo-indexing skill, then the seo-onpage skill. Run dir: … Site: … Write
  <runDir>/findings.json and docs/seo/owner-actions.md per the skills. Return ≤ 10 lines.`)
- A dev build: `node scripts/seo/audit.mjs --site http://localhost:5173` (a preview blocks crawling by design; the
  audit then checks the HTML signals only). One check: `--only IX-04`; one page: `--url <u>`.
- Run order, exit codes, how to read a run, the two workflows and troubleshooting: `docs/seo/README.md`.

## 4. State rules (spec §6)
- The ledger is `seo/ledger.json` on the `checks-state` branch, written only through `scripts/seo/lib/store.mjs`
  (`state-store.mjs`, merged by URL), so the weekly run, a PC run and a session never clobber each other. Mirror:
  `<home>/seo/ledger.json`. Read it through `node scripts/seo/ledger.mjs summary`, never whole.
- It holds coverage only: audit pass/fail, the Search Console inspection fields, `requests[]`, the IndexNow ping, the
  run's decision per URL, and `history` (the last 52 runs). Never a Search Analytics field.
- `requests[]` is appended only by the owner's click report (below), so no unchanged page is requested twice.
- The decisions reach the ledger only through `run.mjs` (step 6). A session's decisions on an `--agents off` run stay
  in its `REPORT.md` and `findings.json`; the next weekly run decides again.
- Exports (Drive `SEO/Indexing/exports/`): `ledger-<date>.csv`, `gsc-analytics-<date>.csv`, `REPORT-<date>.md`; the
  full picture, the only place Search Analytics numbers exist.
- `docs/seo/owner-actions.md` is rewritten by every run from its `owner` decisions; the run commits it to dev
  (`seo: owner actions <runId>`) only when it changed and only from a checkout at `origin/dev`.

## 5. The owner reports a click
After the owner pressed "Request indexing" for a URL in Search Console:
```
node scripts/seo/ledger.mjs requested <url>
```
(default note "URL Inspection → Request indexing"; `--note "…"` for another action). It pulls, appends and pushes the
store. When the owner says in a session that they clicked, run it for them, once per URL. The next run then waits 14
days before it asks for that URL again.

## 6. Hand over (a session run)
Give the owner: the absolute path of `<runDir>/REPORT.md` and its `## Summary`, the validator's line (and the dry-run's result lines when you ran one),
what `docs/seo/owner-actions.md` now asks them to do, and that it stays uncommitted on a local run (the weekly run
commits it).
