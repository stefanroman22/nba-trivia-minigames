---
name: seo
description: SEO hub for nba-minigames: which area skill to load (indexing now), the ledger and export rules, the read budget. Use for "/seo", "SEO check", "indexing", "is page X indexed", "Search Console".
---

# SEO (hub)

Scripts measure, the `seo` agent (or this session) judges. Background: `docs/seo/README.md`; design
`docs/superpowers/specs/2026-10-25-seo-agent-design.md`; the owner's study `docs/seo/indexing-guide.md`; catalogue
`scripts/seo/CHECKS.md`; config `scripts/seo/config.json`.

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
| indexing (can every page be indexed, is it, what to do next) | `seo-indexing` | live |
| search queries (Search Analytics by page and query) | `seo-queries` | reserved, phase 2 |
| performance (Core Web Vitals) | `seo-performance` | reserved |

Load the area skill the task names; "/seo", "SEO check", "indexing", "is page X indexed" all mean `seo-indexing`.
Model rule: the judgement runs on `fable` (the agent's frontmatter); nothing the agent does needs a cheaper tier,
because the scripts do the bulk work.

## 2. Read budget and token rules (binding, agent and session alike)
- Read only: `<runDir>/digest.md` (header, `## FAIL IX-nn`, `## Regressions`, `## Coverage gaps`),
  `<runDir>/gsc-summary.md`, `<runDir>/ledger-summary.md`, `scripts/seo/CHECKS.md`, `<runDir>/findings.json` when the
  run already wrote one, and the `seo-indexing` references a step needs.
- Never open `results.json`, `gsc.json`, `gsc-analytics.json`, `ledger.json`, `ledger-previous.json`, an export, a CSV.
  The one exception is the per-URL slice command in `seo-indexing` ("Inputs"), which prints coverage fields only.
- Never print or write a click, impression, CTR, position or query: the weekly run's stdout is a public log, and the
  repo, its branches and the run artifacts are world-readable. Search Analytics lives only in the Drive export.
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
- Validate: `node scripts/seo/notion-push.mjs --run <runId> --dry-run` (exit 0). Cards for real only when the owner asks:
  the same command without `--dry-run`.
- To delegate instead: `--agents on` (`--agent-model fable`, watchdog `--agent-timeout-sec 1800`), or dispatch
  `subagent_type: "seo"` with the run's prompt: `Load the seo skill, then the seo-indexing skill. Run dir: <runDir>.
  Site: <site>. Write <runDir>/findings.json and docs/seo/owner-actions.md per the skill. Return ≤ 10 lines.`
- A dev build: `node scripts/seo/audit.mjs --site http://localhost:5173` (a preview blocks crawling by design; the
  audit then checks the HTML signals only). One check: `--only IX-04`; one page: `--url <u>`.

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
Give the owner: the absolute path of `<runDir>/REPORT.md` and its `## Summary`, the notion-push dry-run's result lines,
what `docs/seo/owner-actions.md` now asks them to do, and that it stays uncommitted on a local run (the weekly run
commits it).
