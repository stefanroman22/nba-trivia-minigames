# SEO agent

The SEO agent keeps swishquest.com indexed. Scripts measure: a deterministic audit of the live site (the IX checks,
GET/HEAD only), the Search Console pull and the per-URL ledger. The agent judges: it reads only their digests and
summaries and decides, for every failure or verdict that is not `PASS`, on a card, an owner action, a resubmit the run
does itself, or a reasoned wait. Cards carry code changes: the agent never edits `src/`, it files Notion cards that the
team pipeline builds, and clicks only the owner can do go to `docs/seo/owner-actions.md`.

Design: `docs/superpowers/specs/2026-10-25-seo-agent-design.md`. Catalogue: `scripts/seo/CHECKS.md`. The owner's study
the playbook follows: `docs/seo/indexing-guide.md`. Config: `scripts/seo/config.json`.

## Where things are

| Part | Where | Role |
|---|---|---|
| `seo` agent | `.claude/agents/seo.md` (model `fable`, effort high) | judges the audit digest and the Search Console data, decides, plans, writes cards and the owner list. Never edits `src/`. |
| `seo` skill | `.claude/skills/seo/SKILL.md` | hub: the areas (indexing now; queries, performance later), the state rules, token rules, which area skill to load. |
| `seo-indexing` skill | `.claude/skills/seo-indexing/SKILL.md` + `references/` | the 11-step playbook (one section per step: what, how, verify, Google likes / dislikes), the IX check catalogue, the card template, the owner-actions template. References are read per step, not whole. |
| scripts | `scripts/seo/` | measure and move data: audit, Search Console pull, ledger, Drive export, IndexNow, Notion push, the run orchestrator, the one-time auth. Node 22, `node --test`, no new npm dependencies (fetch + OAuth token refresh by hand). |
| knowledge base | `docs/seo/` | `indexing-guide.md` (the owner's study, markdown), `owner-actions.md` (what only the owner can click, kept current by the run), `README.md` (how the system runs, like `docs/logic-check/README.md`). |
| state | branch `checks-state`, `seo/ledger.json` | the per-URL ledger, written through `check-core/lib/state-store.mjs`. |
| workflows | `.github/workflows/seo-audit.yml`, `seo-weekly.yml` | post-deploy audit on every push to `main`; the weekly run. |

## How it runs

| trigger | what | why |
|---|---|---|
| push to `main` (`seo-audit.yml`) | wait until the two Vercel commit statuses (`Vercel – nba-minigames`, `Vercel – backend`) are `success` (poll `gh api …/commits/<sha>/statuses`, 15 min, as the `ship` skill); `audit.mjs --baseline <store's last results>`; on exit 3 (regression) one Slack line to `#agent-frontend` that starts `seo: production regression` and names the IX ids and URLs, and a **P0 card, Target `dev`** through `notion-push.mjs --priority P0` (the pipeline lets only check cards ship to `main`; an indexing regression is never a minutes-matter emergency because Google re-crawls over days, so the owner promotes dev as usual); the new results become the baseline on the store. No agent, ~2 min, no tokens. | the only thing worth checking after every deploy is "did we break something that was fine"; Search Console moves on a scale of days. |
| Monday 06:00 Europe/Paris (`seo-weekly.yml`, crons `0 4 * * 1` and `0 5 * * 1`, the second skipped when the store says this week ran) | `scripts/seo/run.mjs`: full audit, Search Console pull, ledger, agent, cards, IndexNow, Drive export, Slack. ubuntu-latest, ~10 min, `claude` through `CLAUDE_CODE_OAUTH_TOKEN` as `checks-weekly.yml` (preflight; without it, no judgement and the line says so). | Google's Search Console data is final with a 2–3 day lag; Monday morning gives the owner the week's list. |
| on demand | `/seo` (hub) or `/seo indexing` locally: the same `run.mjs` steps with `--notion dry` unless asked, the agent in this session instead of `claude -p`; `node scripts/seo/audit.mjs --site http://localhost:5173` for a dev build. | look now. |

Both workflows are `workflow_dispatch`-able with the same knobs as the checks (`notion`, `slack`, `agents`, `gsc`,
`dry_run`). GitHub runs schedules only from `main`: the weekly file is inert until dev is promoted (as
`checks-weekly.yml`).

## Owner setup

Once; it blocks the Search Console and Drive parts, the audit works without it.

1. Google Cloud: a project, enable **Search Console API** and **Google Drive API**, an OAuth client of type
   **Desktop app**, consent screen **published to Production** (a Testing app's refresh token dies after 7 days) with
   the owner as the only user.
2. `node scripts/seo/auth.mjs` locally, sign in as the Search Console owner account.
3. `gh secret set` the three Google secrets from the file it wrote, and keep `NOTION_TOKEN`, `SLACK_BOT_TOKEN`,
   `CLAUDE_CODE_OAUTH_TOKEN` as they are (the IndexNow key is committed config).
4. Create the Drive folder `SEO/Indexing/exports` and put its id in `scripts/seo/config.json` (the token is the
   owner's, so My Drive works; a service account could not write there since April 2025, which is why the design uses
   the owner's OAuth token).
5. Later, optional: Bing Webmaster Tools API key (`BING_WEBMASTER_KEY`) for URL submission beyond IndexNow.

The run degrades on purpose: no Google secrets → `--gsc off` behaviour and an owner action "set up Search Console
access"; key file not live → IndexNow skipped and a card to deploy it (once).
