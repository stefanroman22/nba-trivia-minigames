# Slack Reporting & Feedback Layer — Design Spec

**Date:** 2026-08-22
**Status:** Approved design, pending implementation plan
**Repo:** nba-minigames
**Owner:** Stefan
**Builds on:** `docs/superpowers/specs/2026-08-15-autonomous-team-design.md` (the autonomous pipeline)

## 1. Goal

Add a Slack layer to the existing autonomous pipeline that (a) posts a **very concise,
targeted batch overview** to a general channel after each batch, (b) posts a **richer daily
digest per agent** to per-agent channels, and (c) lets Stefan **react** (✅ / 🔄 / reply) so
that 🔄/replies become follow-up tasks — a post-merge feedback loop, not a pre-merge gate.

## 2. Hard constraints

- **Autonomy preserved.** Reactions are *post-merge*. A batch still classifies → builds →
  tests → reviews → CTO-merges to `dev` fully autonomously. Slack never gates a merge.
- **No new always-on server.** Reactions are consumed by *polling* at the start of each
  pipeline run (rides the existing ~2h cadence). Nothing listens in real time.
- **Subscription auth for Claude usage is untouched.** Slack uses its own bot token; it does
  not affect how Claude is billed.
- **Deterministic Slack I/O.** All Slack calls go through a `scripts/slack.mjs` CLI (mirrors
  `scripts/notion.mjs`), never an interactive MCP connector (absent in headless/cron/cloud runs).
- **Slack failure is non-fatal.** If Slack is unreachable, the pipeline logs and continues;
  Notion remains the source of truth.
- **Secrets never committed.** `SLACK_BOT_TOKEN` lives in `.env.team` (local) and as a GitHub
  repo secret (if the cloud side ever posts). Gitignored, same handling as `NOTION_TOKEN`.

## 3. Slack app & auth

One Slack app ("nba-team-pipeline") installed to Stefan's workspace, providing a **bot token**
(`xoxb-…`). Required bot scopes:

- `chat:write` — post messages (batch overview, per-agent digests, threaded task cards)
- `reactions:read` — read ✅/🔄 reactions on the pipeline's own messages
- `channels:history` (public) / `groups:history` (private) — read threaded replies
- `channels:read` / `groups:read` — resolve channel ids from names

The bot must be **invited to every channel** it posts to / reads from. Channel ids (not names)
are stored in config after a one-time resolve.

## 4. Channels

| Channel | Cadence | Content |
|---|---|---|
| `#pipeline` (general) | per **batch** (only when ≥1 task shipped) | concise overview: parent one-liner + one threaded card per task |
| `#agent-frontend` | daily digest | frontend-engine's day: what shipped, assumptions, flags |
| `#agent-backend` | daily digest | backend-engine's day (incl. multiplayer/data) |
| `#agent-qa` | daily digest | test-qa-engine + browser-qa results for the day |
| `#agent-review` | daily digest | code-reviewer + CTO verdicts for the day |

Start with these **4 agent channels** (planner/browser-qa fold into qa/review). The channel
set is config-driven and trivially extendable.

## 5. Message formats

### 5.1 `#pipeline` — batch (parent message, one line in channel view)

```
🟢 Batch complete — 3 shipped to dev · 14:12
```

Then **one threaded reply per task** (keeps the channel clean; detail lives in the thread):

```
1 · Fix leaderboard sort bug · frontend · PR #34 ✅CTO
   check: <devSiteUrl>/leaderboard — top-10 orders by wins desc
   react: ✅ good · 🔄 needs work (reply what) · 💬 note
```

Each threaded task card carries: index, title, area/agent(s), PR link + CTO status, the
**check link** (§8), a one-line **what to look for**, and the react legend. Reactions are read
**per task card** (per threaded message), so 🔄 on task 2 targets task 2 specifically.

### 5.2 Per-agent daily digest (e.g. `#agent-frontend`)

```
📆 frontend-engine · Aug 22 · 3 shipped · 0 parked
• Leaderboard sort (PR#34): reversed comparator in useLeaderboard; reused SortDir util.
  assumed: "top" = wins desc, ties by recency.
• Career-high stat (PR#35): new ProfileStatRow → /api/users/me.
  assumed: backend returns career_high (coordinated w/ backend-engine).
flags: none · reuse: 2 CODE_MAP hits · read: UI_SHELL, GAME_DESIGN
```

Built from that agent's tasks for the day: PR summary + the agent-notes block (§9) +
counts. Empty day → the digest is skipped (no post).

## 6. React → feedback loop

At the **start of each pipeline run**, before draining the queue, `team-run` runs
`slack.mjs poll-reactions`:

0. Only **Stefan's** reactions/replies count. `poll-reactions` filters to the configured
   `slackUserId` (§10) and ignores the bot's own reactions and anyone else's, so a stray emoji
   never spawns work.
1. For each tracked, not-yet-resolved task card (from Slack state, §7), read its reactions and
   thread replies since last poll.
2. **🔄 reaction, or any human reply in the thread** → create a **new Ready Notion card**:
   `Follow-up: <original task title>` with body = the reply text (or "reviewer flagged 🔄 with
   no note — re-examine <task>"), Area copied from the original, `Difficulty` unset (re-classified).
   Link back to the original PR. The next drain picks it up like any task.
3. **✅ reaction (and no 🔄/reply)** → mark that task **acknowledged**: archive its Notion card.
4. **Nothing** → no-op.
5. Mark the card resolved in Slack state so it's never re-processed (dedup).

A reply *and* a ✅ on the same card → the reply wins (treated as 🔄): a note means work remains.

## 7. Components

- **`scripts/slack.mjs`** (deterministic, zero-dep, Node 18 fetch; loads `.env.team`):
  - `resolve-channels` — one-time: map channel names → ids, write to config
  - `post-batch <batchJsonPath>` — post parent + per-task threaded cards; append each card's
    `{ts, channel, pageId, pr}` to Slack state
  - `post-agent-digest <agent> <digestJsonPath>` — post one agent's daily digest
  - `poll-reactions` — emit a JSON list of actionable feedback items (🔄/reply/✅) for
    unresolved cards; mark processed
- **`team-run` skill** gains two steps:
  - **run start:** `poll-reactions` → for each item, create the follow-up Ready card or archive
    (via `notion.mjs`) *before* listing Ready tasks, so follow-ups drain in the same run
  - **run end:** compose the batch JSON (from the run's shipped tasks) → `post-batch`
- **Daily digest trigger:** a second Windows scheduled task (~23:30 daily) runs a small
  `slack.mjs`-driven digest: gather the day's merged `team/*` PRs (via `gh`) + their agent-notes,
  group by agent, `post-agent-digest` per channel.
- **Batch composition happens in the local run** (it holds every task's artifacts in one place),
  not split across the cloud CTO. The CTO stays as-is.

## 8. Check-link surface

- Config gains **`devSiteUrl`** — the Vercel preview URL of the `dev` branch (the stable
  dev-site deployment). Default check link = `devSiteUrl` + an optional per-task path hint the
  planner emits during classify (e.g. `/leaderboard`).
- Every task card also links its **PR** (diff + CTO review + evidence).
- Note (from I1 of the pipeline spec): the CTO bot-merge lands on `dev`, not prod, so the
  correct surface to eyeball is the **dev** deployment; prod follows on the next manual promote.
- *Optional later:* isolated per-PR preview URLs (fetched from the PR's deployment statuses).
  Not in v1 — `devSiteUrl` covers the need with far less integration surface.

## 9. Data captured for reports

Engines already produce a PR body summary. To feed the digests' "what / assumed" lines, the
**ship** skill's PR body gains a machine-readable block **per contributing engine** (a
multi-area task that used frontend+backend emits two blocks, so it appears in both agents'
digests):

```
## Agent notes
- agent: frontend-engine
  did: <≤20 words on what changed>
  assumed: <≤20 words on any assumption made>
- agent: backend-engine
  did: <…>
  assumed: <…>
```

The digest parser groups by each block's `agent`. If the block is absent (e.g. docs-only
tasks), the digest falls back to the PR title + summary, attributed to whichever engine the
classify step assigned.

## 10. Config & secrets

- `.claude/team/config.json` gains:
  ```json
  "slack": {
    "generalChannel": "",           // channel id for #pipeline
    "agentChannels": {              // channel ids
      "frontend": "", "backend": "", "qa": "", "review": ""
    },
    "slackUserId": ""               // Stefan's Slack user id; only his reactions act
  },
  "devSiteUrl": ""
  ```
- `.env.team` / GitHub secret: `SLACK_BOT_TOKEN`.
- `.claude/team/slack-state.json` — gitignored runtime state (posted card ts → task mapping,
  resolved flags, last-poll marker).

## 11. Failure handling

- Any Slack call failing → log to the run log, continue. The batch still merged; Notion still
  reflects truth. A missed post is recoverable (re-run digest; batch overview is not re-posted
  to avoid dupes — a `posted` marker in slack-state guards it).
- `poll-reactions` failing → skip feedback ingestion this run; unresolved cards remain
  unresolved and are retried next run (idempotent via the resolved-flag dedup).

## 12. Build order

| Stage | Deliverable | Exit criterion |
|---|---|---|
| S0 | Slack app + bot token + channels created (user) + `resolve-channels` | `slack.mjs post-batch` posts a test card to `#pipeline` |
| S1 | `post-batch` wired into `team-run` run-end; batch JSON composer | a real batch posts a concise overview with correct check links |
| S2 | `poll-reactions` + run-start ingestion (🔄/reply→card, ✅→archive) | a 🔄 + reply produces a follow-up card that drains next run |
| S3 | Per-agent daily digest task + agent-notes block in `ship` | end-of-day digests land in the 4 agent channels |

## 13. Out of scope

Pre-merge approval gating; full two-way Slack control (merge/re-run/reprioritize from Slack);
real-time Slack events (Socket Mode / event subscriptions); per-PR isolated preview URLs;
Slack posting from the cloud CTO job (local run composes all Slack output in v1).
