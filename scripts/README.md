# scripts/

The mechanical half of the project. Agents (`.claude/agents/`) judge, plan, build and review; everything here is
deterministic code they call or that calls them. Zero-dependency Node (ESM) unless noted. The index of what
triggers what is [`.claude/README.md`](../.claude/README.md).

## Automations

| Folder / file | What it is | Docs |
|---|---|---|
| `team/` | The team pipeline's nodes: `intake`, `brief`, `verify`, `qa`, `review-package`, `direct` (no-board mode), `tickets` (ticket intake), `relay-deploy`. Pure helpers with tests in `team/lib/`. | `docs/team/PIPELINE.md` |
| `team-run.ps1`, `register-team-cron.ps1`, `unregister-team-cron.ps1` | Start a pipeline run locally (`npm run team`) and manage its Windows scheduled task. | `docs/team/PIPELINE.md` §3 |
| `feedback/` | Feedback triage: validate the agent's verdicts against the exported batch and file Backlog cards. | `.claude/skills/feedback-triage` |
| `ui-check/` | The UI audit: Playwright suites for guest, account, games and multiplayer on seven viewports, the check catalog, verify and report. | `docs/ui-check/README.md` |
| `logic-check/` | API, socket-protocol and page-status checks, plus the live production probes. | `docs/logic-check/README.md` |
| `check-core/` | Shared by both checkers: run ids, the check stack, findings, clustering, the cards ledger, the state branch, pushing cards. | `scripts/check-core/README.md` |
| `check-run.mjs`, `check-run.ps1`, `register-check-cron.ps1`, `unregister-check-cron.ps1` | The weekly run: Logic Check, then the UI check, on `main`. | `docs/logic-check/README.md` |
| `seo/` | The SEO audit, Search Console pull, on-page checks, the findings ledger and card push. | `docs/seo/README.md` |
| `security/` | The security agent's runner: gitleaks, osv-scanner, the model review, state and the PR gate. | `docs/security/README.md` |

## Shared libraries (`lib/`)

| File | What it is |
|---|---|
| `team-config.mjs` | Board statuses, categories, config and `.env.team` loading. |
| `notion-cli.mjs` | The one client scripts use to reach the board: it shells out to `notion.mjs`. |
| `claude-agent.mjs` | Runs one agent file headless, read-only and without credentials, and returns its JSON answer. |
| `notion-blocks.mjs`, `notion-spec.mjs` | Markdown to Notion blocks; a card's body, attachments and comments to one spec text. |
| `slack-format.mjs` | Slack message builders. |
| `game-shell.mjs` | Measures the game shell contract (used by the UI audit and the UI check). |

`notion.mjs` is the only code that calls the Notion API (card CRUD, claim, ship, comments). `slack.mjs` is the only
code that posts to Slack.

## Repo checks (`npm run lint` runs all of them)

`check-ai-layer.mjs` (agents, skills, workflows and the model registry agree), `check-constraint-ids.mjs`,
`check-game-results.mjs`, `check-legal-config.mjs`, `check-seen.mjs`, `check-review-rounds.mjs`,
`check-award-seasons.mjs`, `check-daily-flow.mjs`, `check-seo.mjs`, `check-photo-map.mjs`, `check-no-nba-logos.mjs`.

## Tests

- `npm run test:automation`: every `*.test.mjs` under `lib/`, `team/`, `feedback/`, `check-core/`, `seo/` and
  `security/`, plus the AI-layer check's own tests (`node:test`, Node 22).
- `test-*.mjs` (`npm run test:<name>`): unit tests of frontend logic (scoring, ranks, answer matching, daily games).
- `npm run ui:selftest`, `npm run logic:selftest`: the checkers checking themselves.

## Development and content tools

| File / folder | What it is |
|---|---|
| `dev.mjs`, `dev-env.mjs`, `copy-data.mjs` | `npm run dev`: probe the local backend and relay, fall back to the deployed ones, copy game data. |
| `qa-browser.mjs`, `ui-audit.mjs` | The Playwright harness for browser QA and the deterministic layout audit. |
| `chrome-debug.ps1` | A Chrome with remote debugging for live UI work. |
| `game-cards/` | Generates the images behind the game tiles. |
| `player-photos/` | Builds the player photo map (official headshots, Wikimedia Commons where there is none) and its credits. |
| `scramble-logos/` | Produces the scrambled team logos Name the Logo shows before the guess. |
| `contexto-golden.mjs` | Generated the Contexto similarity fixture used by a backend test. |
