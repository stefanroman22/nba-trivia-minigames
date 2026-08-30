# Punctual Session Reports (Cloudflare Cron → workflow_dispatch) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Session reports post to Slack at exactly 07:30 and 17:30 local, instead of whenever GitHub's scheduler gets around to it (observed 3–6 hours late).

**Architecture:** A ~30-line Cloudflare Worker with two cron triggers calls GitHub's `workflow_dispatch` API at the exact minute. The existing GitHub cron stays as a late-firing backup, and a duplicate guard in `scripts/slack.mjs` makes double-posting impossible: before posting, it checks whether this window's report already exists in the Slack channel. Content logic is untouched — only the trigger changes.

**Tech Stack:** Cloudflare Workers (free tier, cron triggers), wrangler 4.x (installed, OAuth-authenticated), GitHub Actions `workflow_dispatch`, Slack Web API `conversations.history`.

**Spec:** Approved in-chat design (option A of the 2026-08-30 brainstorm — bounded change, no spec file). Decision record: CF Worker chosen over pipeline-self-reporting (doesn't hit exact times), cron-job.org (third party holds the PAT), and more GitHub crons (still GitHub's scheduler).

## Global Constraints

- **Do not change what reports say or how windows are computed.** `cmdDigestWindow`'s window math, message text and per-engine details are correct and stay byte-identical; only an early-exit guard is added before any posting.
- Exact cron expressions, both systems, both UTC: `30 5 * * *` (night report) and `30 15 * * *` (day report). CF and GitHub run the SAME expressions — GitHub is the guarded fallback, not a different schedule.
- Repo: `stefanroman22/nba-trivia-minigames`; workflow file `team-reports.yml`; dispatch `ref` is `main`.
- Cloudflare account: **Stefan@gmbapi.com's Account**, account_id `8d0328eded45f6ea471f9dd240cacf2d` (assumption recorded: the personal of the two available accounts; free tier, movable later).
- Worker name: `nba-report-cron`, living in-repo at `infra/report-cron/`.
- The GitHub PAT is a secret: never generated, guessed, or pasted into any command that lands in permission rules or files. The owner creates it and enters it interactively (Task 4).
- Slack scope assumption: the bot token already calls `conversations.replies` (scope `channels:history`), which is the same scope `conversations.history` needs. If the guard call returns `missing_scope`, the guard must fail OPEN (post anyway, log a warning) — a duplicate report is annoying; a silently missing report is a defect.
- DST note (accepted, out of scope): both schedulers fire at fixed UTC, so in winter (UTC+1) reports arrive 06:30/16:30 local. This matches existing behaviour — the workflow hardcodes `+02:00` offsets today.
- Commit style: conventional prefixes; stage explicit paths, never `git add -A`. Uncommitted admin-panel work exists in this tree — sweeping it in is a serious error.

---

## Task 1: Duplicate guard in `cmdDigestWindow`

**Files:**
- Modify: `scripts/slack.mjs` (function `cmdDigestWindow`, ~line 187)

**Interfaces:**
- Consumes: existing `api`/`apiTry` helpers and `cfg.slack.generalChannel` in the same file.
- Produces: `digest-window` exits 0 with `already posted, skipping` when the window's report exists. Task 2's workflow relies on this to make the GitHub-cron fallback safe.

- [ ] **Step 1: Add the guard at the top of `cmdDigestWindow`**

Insert immediately after `const start = Date.parse(startISO), end = Date.parse(endISO);` and the `chan` lookup:

```javascript
  // Duplicate guard: two schedulers fire this command for the same window (the
  // punctual Cloudflare cron, and GitHub's own cron as a late-firing backup).
  // A legitimate report can only post at-or-after the window's end, so if the
  // channel already holds a message with this window's head line since `end`,
  // this run is the duplicate — skip everything, including per-engine details.
  // Fails OPEN on any API error (e.g. missing_scope): a duplicate report is
  // annoying, a silently missing report is a defect.
  const head = `📋 *${label}* — merges ${startISO.slice(11, 16)}–${endISO.slice(11, 16)}`;
  if (chan) {
    const hist = await apiTry("conversations.history", {
      channel: chan, oldest: String(end / 1000), inclusive: "true", limit: "100",
    });
    if (hist.ok && (hist.messages || []).some((m) => (m.text || "").includes(head))) {
      console.log("already posted, skipping (found this window's report in channel history)");
      return;
    }
    if (!hist.ok) console.error(`duplicate-guard check failed (posting anyway): ${hist.error}`);
  }
```

Then change the existing head-building line further down from
`const head = \`📋 *${label}* — merges ${startISO.slice(11,16)}–${endISO.slice(11,16)}\`;`
to `// head built above (also used by the duplicate guard)` and use the existing `head` variable — the string must stay byte-identical, since the guard matches on it.

- [ ] **Step 2: Verify against last night's REAL reports — zero Slack noise**

Yesterday's late runs left both windows' reports in #pipeline (night posted 13:42, day posted 20:43 — both after their windows ended). Re-running those exact windows must now skip without posting anything:

```bash
node scripts/slack.mjs digest-window "2026-08-28T17:30+02:00" "2026-08-29T07:30+02:00" "Night session (01:00-07:00 work)"
node scripts/slack.mjs digest-window "2026-08-29T07:30+02:00" "2026-08-29T17:30+02:00" "Day session (10:00-17:00 work)"
```

Expected: both print `already posted, skipping (...)` and post NOTHING. Confirm no new message appears in #pipeline. If instead you see `duplicate-guard check failed ... missing_scope`, the bot lacks `channels:history` on this channel type — STOP and report; do not proceed to Task 2, the fallback design depends on this guard.

(Requires `SLACK_BOT_TOKEN` in the environment and `gh` authenticated as `stefanroman22` — `npm run team`'s environment has both; locally, source the same env the pipeline uses per `docs/team/PIPELINE.md`.)

- [ ] **Step 3: Commit**

```bash
git add scripts/slack.mjs
git commit -m "feat(team): duplicate guard so a session report can only post once per window"
```

---

## Task 2: `session` input on the workflow

**Files:**
- Modify: `.github/workflows/team-reports.yml`

**Interfaces:**
- Consumes: Task 1's guard (makes it safe for BOTH crons to keep firing).
- Produces: `workflow_dispatch` accepts `session: night|day`; Task 3's Worker sends exactly those strings.

- [ ] **Step 1: Replace the `label` input with `session`**

The current dispatch input `label` is unused by the window logic (any manual dispatch silently reports the NIGHT window — that's the bug that makes external triggering impossible today). Replace the `workflow_dispatch:` block with:

```yaml
  workflow_dispatch:
    inputs:
      session:
        description: "Which session to report"
        required: true
        type: choice
        options: [night, day]
```

- [ ] **Step 2: Teach the window selection about the input**

Change the two-branch selection to (note `SESSION` line added, condition extended):

```bash
          SCHED="${{ github.event.schedule }}"
          SESSION="${{ inputs.session }}"
          TODAY=$(date -u +%Y-%m-%d)
          YEST=$(date -u -d "yesterday" +%Y-%m-%d)
          if [ "$SCHED" = "30 15 * * *" ] || [ "$SESSION" = "day" ]; then
            START="${TODAY}T07:30+02:00"; END="${TODAY}T17:30+02:00"; LABEL="Day session (10:00-17:00 work)"
          else
            # 05:30 cron, dispatch with session=night
            START="${YEST}T17:30+02:00"; END="${TODAY}T07:30+02:00"; LABEL="Night session (01:00-07:00 work)"
          fi
          echo "schedule=[$SCHED] session=[$SESSION]  window: $START .. $END  ($LABEL)"
```

Keep the two `schedule:` cron entries exactly as they are — they are the guarded fallback.

- [ ] **Step 3: Commit and push (the workflow must be on the remote to dispatch it)**

```bash
git add .github/workflows/team-reports.yml
git commit -m "feat(team): session input so an external scheduler can dispatch either report"
git push origin dev
```

Wait for CI to promote dev→main (`git fetch origin main` until it carries the commit) — dispatch targets `main`.

- [ ] **Step 4: Verify by dispatching the NIGHT report**

```bash
gh workflow run team-reports.yml --ref main -f session=night
sleep 20
RUN=$(gh run list --workflow=team-reports.yml --limit 1 --json databaseId --jq '.[0].databaseId')
gh run watch "$RUN" --exit-status   # waits for completion; fails loudly if the run fails
gh run view "$RUN" --log | grep -E "session=|window:|skipping|posted"
```

Deliberately `night`, not `day`: today's day window hasn't ended, so a `day` dispatch would post a premature report to the real channel. The night window ended at 07:30 today, so EITHER outcome is correct and harmless: `already posted, skipping` (GitHub's own 05:30 cron beat us) or a real posted night report (it was late again — and we just delivered it). Expected in the log: `session=[night]` and the night window dates.

---

## Task 3: The Cloudflare Worker

**Files:**
- Create: `infra/report-cron/wrangler.toml`
- Create: `infra/report-cron/src/index.js`

**Interfaces:**
- Consumes: Task 2's `session` input; secret `GITHUB_TOKEN` (Task 4 supplies the value).
- Produces: a deployed Worker `nba-report-cron` firing at `30 5 * * *` and `30 15 * * *` UTC.

- [ ] **Step 1: Write `infra/report-cron/wrangler.toml`**

```toml
# Punctual trigger for the Slack session reports. GitHub's own cron fires hours
# late (observed 3-6h); Cloudflare cron fires to the minute and dispatches the
# same workflow, which computes the same window. The duplicate guard in
# scripts/slack.mjs makes the pair safe. Deployed to Stefan's personal account.
name = "nba-report-cron"
main = "src/index.js"
account_id = "8d0328eded45f6ea471f9dd240cacf2d"
compatibility_date = "2026-08-01"

[triggers]
crons = ["30 5 * * *", "30 15 * * *"]
```

- [ ] **Step 2: Write `infra/report-cron/src/index.js`**

```javascript
/**
 * Fires at 05:30 and 15:30 UTC (07:30 / 17:30 local, UTC+2) and dispatches the
 * team-reports workflow with the matching session, so the Slack report posts on
 * time instead of whenever GitHub's own scheduler wakes up.
 *
 * Secret: GITHUB_TOKEN — fine-grained PAT, repo nba-trivia-minigames, Actions:
 * read+write. Set with:  wrangler secret put GITHUB_TOKEN -c infra/report-cron/wrangler.toml
 */
const REPO = "stefanroman22/nba-trivia-minigames";
const WORKFLOW = "team-reports.yml";

export default {
  async scheduled(event, env) {
    const session = event.cron === "30 15 * * *" ? "day" : "night";
    const res = await fetch(
      `https://api.github.com/repos/${REPO}/actions/workflows/${WORKFLOW}/dispatches`,
      {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${env.GITHUB_TOKEN}`,
          "Accept": "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
          "User-Agent": "nba-report-cron", // GitHub's API rejects requests without one
        },
        body: JSON.stringify({ ref: "main", inputs: { session } }),
      },
    );
    if (res.status !== 204) {
      // Throwing marks the invocation failed in the Cloudflare dashboard, which
      // is the only place this Worker's health is visible.
      throw new Error(`dispatch ${session} failed: HTTP ${res.status} ${await res.text()}`);
    }
    console.log(`dispatched ${session} report`);
  },
};
```

- [ ] **Step 3: Deploy (without the secret — it 401s harmlessly until Task 4)**

```bash
wrangler deploy -c infra/report-cron/wrangler.toml
```

Expected: `Deployed nba-report-cron` with both cron triggers listed. A cron firing before Task 4 supplies the token fails with 401 in the CF dashboard; the guarded GitHub cron still covers that window, so nothing is lost.

- [ ] **Step 4: Commit**

```bash
git add infra/report-cron/wrangler.toml infra/report-cron/src/index.js
git commit -m "feat(team): Cloudflare cron worker to dispatch session reports on time"
git push origin dev
```

---

## Task 4: OWNER-GATED — the GitHub token

**Files:** none (a secret, entered interactively by the owner)

> **Do not attempt as an implementer.** The PAT is a real secret only the owner can mint.

- [ ] **Step 1: Hand over PAT creation**

Ask the owner to create a **fine-grained** PAT at github.com → Settings → Developer settings → Fine-grained tokens: Resource owner `stefanroman22`, ONLY the repo `nba-trivia-minigames`, permission **Actions: Read and write**, nothing else; expiry 1 year (calendar note to rotate). Then run, pasting the token when prompted (it goes to Cloudflare's secret store, never to disk or shell history):

```bash
wrangler secret put GITHUB_TOKEN -c infra/report-cron/wrangler.toml
```

- [ ] **Step 2: End-to-end verification (implementer, after the owner confirms)**

There is deliberately NO immediate test of the deployed Worker: Cloudflare has no "fire the scheduled handler now" API for deployed Workers, and every local-invocation route (`wrangler dev --test-scheduled`, `.dev.vars`) requires handling the PAT outside Cloudflare's secret store, which this plan forbids. The Task 2 dispatch already proved the GitHub half of the chain; the only unverified link is the Worker's own auth, and the next real half-hour boundary (05:30 or 15:30 UTC — at most ~10h away) proves it. After that boundary passes:

```bash
gh run list --workflow=team-reports.yml --limit 3 --json event,createdAt,conclusion \
  --jq '.[] | "\(.createdAt) \(.event) \(.conclusion)"'
```

Expected: a `workflow_dispatch` run created within ~1 minute of the half-hour, `success`; and the Slack report timestamped on time. If GitHub's own late cron fires afterwards, its log must show `already posted, skipping`.

- [ ] **Step 3: Document**

Append to `docs/team/PIPELINE.md`'s reporting section: reports are triggered by the CF Worker `nba-report-cron` (account 8d0328…, `infra/report-cron/`); GitHub's cron is the guarded fallback; the duplicate guard lives in `cmdDigestWindow`; the PAT expires yearly and is re-entered with `wrangler secret put`. Commit with the Task 3 style.

---

## Exit criteria

1. Task 1's guard skips both of yesterday's real windows without posting (verified against live channel history).
2. A `session=day` dispatch reports the DAY window (log shows it), killing the dispatch-always-means-night bug.
3. Worker deployed with both crons; after the owner's PAT, the next half-hour boundary produces a punctual `workflow_dispatch` run and an on-time Slack report, with any late GitHub-cron run skipping.
