# The AI layer

Everything in this repo that is run by a model lives here or is started from here: the **agents** (who does the
work), the **skills** (how a job is done), and the **automations** that dispatch them (GitHub workflows, a cloud
routine, and plain commands). Scripts do everything mechanical and every write; agents judge, plan, build and review.

```
.claude/
  agents/        one file per role: its model, effort and instructions
  skills/        one folder per procedure: the steps an agent or a session follows
  models.json    which model does what (checked by `npm run check:ai`)
  profiles.json  named model/effort profiles for interactive sessions (`npm run engine`)
  settings.json  the committed Claude Code settings every surface reads
  team/          team-pipeline config: board ids, QA ports, the file -> QA-scope map
  routines/      prompts for the scheduled cloud routines
```

`npm run check:ai` keeps this honest: it fails when an agent's model differs from `models.json`, when an agent,
skill or workflow is missing from this page, or when a file here points at a path that no longer exists.

## Agents (`.claude/agents/`)

| Agent | Model | What it does | Dispatched by |
|---|---|---|---|
| `planner-architect` | sonnet (fable for design rounds) | Classifies a card, writes the step plan and acceptance criteria, runs the design round for hard cards. Never writes product code. | `team-run` |
| `frontend-engine` | sonnet (haiku trivial, opus judgment/motion) | Implements in `src/`: React 19, TypeScript, Tailwind, Next.js. | `team-run`, `team-direct`, `ui-fix` |
| `backend-engine` | sonnet (same escalation) | Implements in `backend/` (Django, DRF) and `multiplayer_server/` (Socket.IO). | `team-run`, `team-direct`, `ui-fix` |
| `browser-qa` | sonnet | Drives headless Playwright for the multi-step flows a script cannot express. | `team-run` (gate 2) |
| `code-reviewer` | sonnet (fable for P0, high risk, protected paths) | Read-only review of the diff; returns a verdict per acceptance criterion. | `team-run`, `team-direct`, `ui-fix` |
| `motion-reviewer` | opus | Read-only review of animation changes against the shared motion system. | `team-run`, `ui-fix` |
| `ticket-writer` | opus | Splits one long text into tickets with acceptance criteria. Read-only, returns JSON. | `ticket-intake` |
| `feedback-triage` | sonnet | Gives each player feedback message a verdict and writes tickets for what is actionable. Read-only, returns JSON. | `feedback-triage` |
| `ui-check-guest`, `ui-check-account`, `ui-check-games`, `ui-check-multiplayer` | sonnet | Judges of the UI check: turn one suite's digest and screenshots into probe-confirmed findings. | `ui-check` |
| `logic-check-triage` | sonnet | Turns failing API, socket and page-status checks into confirmed findings. | `logic-check` |
| `seo` | fable | Judges the weekly SEO audit and Search Console data; decides card, owner action or wait. | `seo` |
| `question-author` | opus | Proposes new question boards as rules over the dataset. | Editorial author workflow (dormant) |
| `question-checker` | sonnet | Decides whether every fact in a pending question is true. Validity only. | Question checker workflow (dormant) |
| `question-doctor` | opus | Researches quarantined questions and proposes sourced data corrections. | Doctor research workflow (dormant) |
| `question-reviewer` | opus | Reviews two weeks of question-factory signals and files follow-ups. | Factory review workflow (dormant) |

The model column is the agent file's default. The team pipeline passes a model on every spawn, following the policy
in [`docs/team/PIPELINE.md`](../docs/team/PIPELINE.md) §14.

## Skills (`.claude/skills/`)

| Skill | What it is for |
|---|---|
| `team-run` | One queue-drain run of the team pipeline: intake, classify, brief, plan, build, verify, QA, review, ship. |
| `team-direct` | The same build, verify and review loop on the current branch with no board (used by the security gate). |
| `classify` | Difficulty, areas, risk and model tier of a card. |
| `design-round` | The one-pass written design for a hard card. |
| `qa-protocol` | The browser-QA harness: bring-up, flow scripts, verdict. |
| `ship` | Commit, rebase, push to `dev` (or the hotfix flow for check cards), update the board. |
| `ticket-intake` | A long text becomes board cards with acceptance criteria. |
| `feedback-triage` | Player feedback becomes verdicts and Backlog cards. |
| `ui-check` | The full automated UI audit: four suites on seven viewports, judged into findings. |
| `ui-fix` | Fixes open UI-check findings cluster by cluster, with review and a regression run. |
| `logic-check` | API, socket-protocol and page-status checks, triaged into findings and cards. |
| `seo`, `seo-indexing`, `seo-onpage` | The SEO agent's hub and its two playbooks. |
| `nba-question-writer` | Writing questions with the owner in the session: clarify, build, dedupe, go live on their word. |
| `promote-to-prod` | The runbook for promoting `dev` to production. Only on the owner's explicit ask. |
| `bootstrap-audit` | Regenerates the constraint docs and `docs/team/CODE_MAP.md` from the code. |

## Automations

Status as of 2026-11-24. "Dormant" means the code is complete and tested but nothing fires it: the workflow is
manual-dispatch only, or the owner keeps it disabled in GitHub and enables it when wanted.

### Building and shipping

| Automation | Entry point | Trigger | Model use |
|---|---|---|---|
| **Team pipeline**: board cards become commits on `dev` | `team-run` skill (`scripts/team/*`) | `npm run team`, or a cloud routine running `/team-run` (the owner currently starts runs on demand) | planner, engines, QA, reviewers (table above) |
| **Ticket intake**: a long text becomes cards with acceptance criteria | `scripts/team/tickets.mjs`, `ticket-intake.yml` | manual | `ticket-writer` |
| **Classify tier comparison**: which model should classify, measured on the owner-verified eval | `scripts/team/eval-classify.mjs` (`npm run team:eval-classify`) | manual; a full pass costs real quota | `planner-architect`, once per model compared |
| **Cost ledger**: every shipped card's commit carries what it cost; a report and an HTML dashboard read them back | `scripts/team/costs.mjs` (`npm run team:costs`) | each ship; the report on demand | none |
| **Feedback triage**: player feedback becomes verdicts and Backlog cards | `scripts/feedback/run.mjs`, `feedback-triage.yml` | manual (dormant) | `feedback-triage` |
| **@claude responder** on issues and PRs | `claude.yml` | a comment that mentions `@claude` | the session model in `settings.json` |
| CI and promotion | `dev-ci.yml`, `main-sync.yml`, `relay-deploy.yml` | push / PR to `dev`, manual promote, push to `main` | none |
| Session reports to Slack | `team-reports.yml` | twice a day | none |

### Checking production

| Automation | Entry point | Trigger | Model use |
|---|---|---|---|
| **Weekly checks**: Logic Check, then the UI check, on `main`; findings become cards | `checks-weekly.yml` (`scripts/check-run.mjs`) | Sundays | `logic-check-triage`, the four `ui-check-*` judges |
| Live probes of the production API | `logic-live.yml` | every 6 hours | none |
| **Security**: weekly full scan and a gate on every PR to `main`, with auto-fix | `security.yml` (`scripts/security/run.mjs`) | Fridays, and PRs to `main` | fable (weekly review), opus (PR review), `team-direct` (fix) |
| **SEO**: weekly indexing audit judged by an agent | `seo-weekly.yml` (`scripts/seo/run.mjs`) | Mondays | `seo` |
| SEO post-deploy audit | `seo-audit.yml` | push to `main` | none |

### Game data and questions

| Automation | Entry point | Trigger | Model use |
|---|---|---|---|
| Question checker (capped) | `question-checker.yml` | manual (dormant) | `question-checker` |
| Editorial author | `editorial-author.yml` | dormant | `question-author` |
| Doctor research | `doctor-research.yml` | dormant | `question-doctor` |
| Factory review | `factory-review.yml` | dormant | `question-reviewer` |
| Factory nightly (roll-ups, cleanup, doctor scan) and maintenance | `factory-nightly.yml`, `maintain-questions.yml` | dormant | none |
| NBA data refresh and publishing | `data-refresh.yml`, `publish-game-data.yml` | dormant; the owner enables a single run | none |
| Data freshness and usage reports, the daily Wordle word | `game-data-freshness.yml`, `game-data-usage.yml`, `wordle-daily.yml` | daily / weekly | none |

### Operations

`ops-manage.yml` (run an allow-listed management command on production), `db-migrate.yml`,
`deploy-moderation-service.yml`, `prune-personal-data.yml` (weekly retention), `rename-email-derived-names.yml`.
None of them uses a model.

### In the product

| Feature | Where | Model |
|---|---|---|
| **AI game builder**: an admin describes a game, an agent builds a playable spec from the datasets, follow-up prompts refine it; an admin can then publish it to a link-only public page (`/custom/<slug>`, no points) | `backend/trivia/game_builder/`, Admin → Game Builder | `claude-opus-5-5` through the Anthropic API |
| **"Why?" on a missed answer**: a two-sentence explanation written once per question from the site's own data, checked against it, then served from the database | `backend/trivia/explanations.py`, the answer review | `claude-opus-5-5` by default (`EXPLAIN_MODEL`) |

Both are off in production: the backend installs no model SDK until `requirements-ai.txt` is enabled in
`backend/requirements.txt` and `ANTHROPIC_API_KEY` is set, and explanations also need `EXPLAIN_ENABLED=1` and the
frontend build flag `VITE_EXPLANATIONS=1`. With the flags unset the public site renders exactly as it did before
these features existed.

## How the pieces fit

- **Scripts own the mechanics, agents own the judgment.** Intake, the brief, lint, typecheck, build, tests, the
  layout audit, the review package and every Notion, Slack, git and database write are scripts. An agent is spawned
  only where a decision is needed.
- **One brief per card.** `scripts/team/brief.mjs` writes the spec, the acceptance criteria (`AC1…`), the plan, the
  rules that apply and the QA assertions into one file. Every agent on the card works from it.
- **Acceptance criteria are checked, not assumed.** The engine reports each criterion in `build-report.json`; the
  reviewer returns `met`, `not met` or `cannot tell` per criterion, and `not met` blocks the ship.
- **Every shipped card carries its cost line.** The orchestrator records the usage of each agent it spawns, and the
  ship commit gets one `Cost:` line (tier, models, spawns, tokens, fix rounds, minutes). `npm run team:costs` reads
  the commits back into a report (`docs/team/PIPELINE.md` §19).
- **Untrusted text never drives a write.** Agents that read public or pasted text (`ticket-writer`,
  `feedback-triage`, the security review) run with Read, Grep and Glob only and no credentials
  (`scripts/lib/claude-agent.mjs`); a script validates their JSON and does the writing. Cards that come from player
  feedback are filed in Backlog and wait for the owner.
- **Production is a human decision.** The pipeline stops at `dev`. Only checker findings ship to `main` on their
  own, behind the security gate.

## Models

`models.json` maps the four rolling aliases to the current models and records each agent's default:

| Alias | Model | Used for |
|---|---|---|
| `fable` | Fable 5.2 | Where a wrong call is expensive: design rounds, risky reviews, the security review, the SEO agent. |
| `opus` | Opus 5.5 | Judgment inside the work: hard implementation, motion, ticket writing, question authoring, the game builder. |
| `sonnet` | Sonnet 5.5 | The default worker: orchestration, classify, standard builds and reviews, checker judges, triage. |
| `haiku` | Haiku 5.5 | Trivial edits only. |

An alias resolves to whatever the installed Claude Code maps it to, so the CLI version CI installs is pinned in the
same file (`claudeCode`) and checked against every workflow.

### Session profiles

`npm run engine <fast|balanced|deep|max>` rewrites the `env` block of `settings.json` (subagent model and effort for
interactive sessions) and `active-profile`. Commit and push so cloud sessions, routines and the `@claude` responder
pick it up. The team pipeline does not depend on the profile: it passes a model on every spawn.

| Profile | Subagent model | Effort |
|---|---|---|
| `fast` | haiku | low |
| `balanced` (default) | sonnet | high |
| `deep` | fable | xhigh |
| `max` | fable | max |

## Adding to the layer

1. **An agent**: a file in `agents/` with `name`, `description`, `model` (an alias), `effort`; add it to
   `models.json` and to the table above. Give it the least access its job needs: a role that only returns a
   document goes through `scripts/lib/claude-agent.mjs`.
2. **A skill**: a folder in `skills/` with a `SKILL.md` whose frontmatter has `name` and `description`; list it above.
3. **An automation**: the mechanical part as a script with tests, the judgment as an agent, the trigger as a
   workflow that starts manual-only. Keep database, model and board access in separate jobs.
4. Run `npm run check:ai` and `npm run test:automation`.

## One-time account setup

1. GitHub Actions: the `CLAUDE_CODE_OAUTH_TOKEN` repo secret (`claude setup-token`, then
   `gh secret set CLAUDE_CODE_OAUTH_TOKEN`). Subscription usage, no API key.
2. The board and Slack tokens: see `docs/team/PIPELINE.md` §9 and `docs/CREDENTIALS.md`.
3. Scheduled cloud routines: `.claude/routines/README.md`.
