# Credential Registry — what expires, when, and what breaks

Every token/credential the app and pipeline depend on. **Values never appear here** — only
where each lives, when it dies, what stops working, and how to replace it. Update the date
column every time a credential is created or rotated.

## ⏰ Next hard expiry

| Date | Credential | Action before then |
|---|---|---|
| **2026-11-28** | GitHub PAT for report dispatch | Create a new fine-grained PAT and re-upload the Worker secret (see #1) |

Everything else either doesn't expire or has no date set — see the table.

## The registry

| # | Credential | Lives in | Used by | Expires | If it expires |
|---|---|---|---|---|---|
| 1 | **GitHub fine-grained PAT** (repo `nba-trivia-minigames`, Actions R/W) | Cloudflare Worker secret `GITHUB_TOKEN` on `nba-report-cron` | The punctual-report cron (`infra/report-cron/`) dispatching `team-reports.yml` | **2026-11-28** (90-day token, created 2026-08-30) | Punctual reports stop (Worker gets 401, visible in the CF dashboard). **Nothing crashes** — GitHub's own late cron still posts every report, just hours late again. |
| 2 | **Cloudflare API token** (`cfat_…`, account-owned) | `.env.team` → `CLOUDFLARE_API_TOKEN` | Manual/agent Cloudflare management from this machine | Set at creation — **check in dash.cloudflare.com → Manage Account → API Tokens and fill in here: `____-__-__`** | Local CF management fails. The deployed Worker keeps running — it doesn't use this token. |
| 3 | **R2 S3-style key pair** | `.env.team` → `ACCESS_KEY` / `SECRET_ACCESS_KEY` | `publish_game_data` (optional R2 publish path — expects them as `R2_ACCESS_KEY_ID`/`R2_SECRET_ACCESS_KEY`) | Same token as #2 (an R2 token is a CF token; the Access Key ID is its token id) | R2 publishing fails. Not in the serving path — game data ships with the frontend build. |
| 4 | **Slack bot token** (`hoops-24-team` app) | `.env.team` and GitHub secret `SLACK_BOT_TOKEN` | Batch cards, reaction polling, session reports, digests | **No expiry** (dies only if the app is uninstalled from the workspace or the token is revoked) | All Slack posting/polling fails; pipeline itself keeps shipping (Slack failures are non-fatal by design). |
| 5 | **Notion integration token** | `.env.team` and GitHub secret `NOTION_TOKEN` | Task board: claim, status, comments | **No expiry** (internal integration; dies if the integration is removed from the board) | Pipeline can't pick up or update tasks — the autonomous loop halts quietly. |
| 6 | **Claude Code OAuth token** | GitHub secret `CLAUDE_CODE_OAUTH_TOKEN` | `claude.yml` (PR review/mention workflows) | Long-lived, no published date — treat as "until it 401s" | `claude.yml` runs fail on auth. Rotate: run `claude setup-token` locally, paste the new value into the repo secret. |
| 7 | **Supabase DB password** (inside `DATABASE_URL`) | Vercel env (backend project), `backend/.env` locally when needed | Django in production | **No expiry** (until reset in Supabase) | Backend 500s on all DB endpoints AND deploys fail (build runs `migrate`). Reset + rebuild procedure: `docs/DEPLOYMENT.md` → Supabase connection. |
| 8 | **Google OAuth client secret** | Vercel env `CLIENT_SECRET` (+ public `CLIENT_ID`) | "Sign in with Google" | **No expiry** (until rotated in Google Cloud Console) | Google sign-in fails; email/password login unaffected. |
| 9 | **`gh` CLI + `wrangler` OAuth** | This machine's keyring / wrangler config | Local dev and agent sessions | Self-refreshing / long-lived | Re-auth interactively (`gh auth login`, `wrangler login`). Account gotcha: `gh` must be on `stefanroman22`, not `jimmedeknatel8`. |

## Rotation procedures

**#1 — the one with a deadline (do this before 2026-11-28):**
1. github.com → Settings → Developer settings → Fine-grained tokens → new token:
   resource owner `stefanroman22`, ONLY repo `nba-trivia-minigames`, permission
   **Actions: Read and write**, nothing else.
2. From the repo root: `wrangler secret put GITHUB_TOKEN -c infra/report-cron/wrangler.toml`
   (paste when prompted — the value goes to Cloudflare's secret store, never to disk).
3. Verify: next 05:30/15:30 UTC, `gh run list --workflow=team-reports.yml --limit 1` shows a
   punctual `workflow_dispatch` success. Then update the date at the top of this file.
4. Delete the old PAT on GitHub.

**#2/#3 —** create the replacement in dash.cloudflare.com → API Tokens, update the values in
`.env.team`, revoke the old one. Keep `.env.team` ASCII `KEY=value` lines only (no quotes —
and note the file is CRLF; scripts strip `\r`, ad-hoc shell `source` does not).

**#4/#5/#6 —** paste the new value into BOTH homes where the table lists two (`.env.team`
AND the GitHub repo secret: `gh secret set <NAME>`); drift between them is the classic
silent failure.

## Habits that keep this working

- **When any credential is created or rotated, update this file in the same commit.**
- The only credential that *can* take the system down on a timer is #1 — and its failure
  mode is "reports go back to being late", not an outage. Everything user-facing (the app,
  the API, sign-in) runs on non-expiring credentials.
