# Security agent

One agent, two modes, one workflow: `.github/workflows/security.yml` → `scripts/security/run.mjs`.

| | Weekly (mode A) | PR to `main` (mode B) |
|---|---|---|
| When | Fridays 12:00 Europe/Amsterdam (crons 09:30/10:30/11:30 UTC + `lib/slot.mjs` gate, DST-safe), or "Run workflow" | every PR to `main`; the promote job (`dev-ci.yml`, via `workflow_call`); the pipeline's `security-gate/<slug>` push before a `Target = main` ship |
| Scope | whole repo; gitleaks over the **full git history** of every branch | the diff against `main` only (gitleaks: the lines the PR adds; osv: what the PR's lockfile changes introduce) |
| Output | ONE parent Notion card (To Do) for the team pipeline, only when something is new | commit status `security/pr-scan` (required on `main`), one PR comment edited in place — never Notion |
| High/critical, confidence ≥ 8 | in the ticket | status fails → the team pipeline's direct mode fixes the branch → re-scan; max 2 auto-fix rounds, then a human |
| Medium/low, confidence ≥ 8 | in the ticket | PR comment + recorded in the state; the next weekly ticket carries them |

## Detectors
- **gitleaks** v8.21.2 (`.gitleaks.toml`, shared with `dev-ci.yml`'s tree scan) — secrets.
- **osv-scanner** v2.6.0 — dependency CVEs, one finding per locked package version (all its advisories), grouped per lockfile.
- **Claude security review** — headless `claude -p` on the `CLAUDE_CODE_OAUTH_TOKEN` subscription token (no API
  key, no per-token cost), read-only tools, prompt + `.security/scan-instructions.md`. Model: `fable` weekly, `opus`
  on PRs. The `anthropics/claude-code-security-review` action was not used because it needs a paid Anthropic API key.

Every finding is normalised (`scripts/security/lib/finding.mjs`): fingerprint, tool, rule, category, severity,
confidence 1-10, file/line, exploit path (source → sink), fix steps, acceptance, how to verify, root cause.
**Fingerprint** = `sha256(rule + file + sha256(normalised code context))`, 16 hex — no line number, so it survives code
moving. Context: the sink line (Claude; located in the file from the snippet the model copies), `package@version`
(osv), the secret's hash (gitleaks; the value itself is never stored). Only confidence ≥ 8 counts anywhere.

## Where state lives
Branch **`security-state`** (orphan, never merge it), file `findings.json`: one entry per fingerprint with
`status` open/resolved, first/last seen, `source` weekly/pr, the Notion `ticket`, and `details` (the full finding)
**AES-256-GCM encrypted with the repo secret `SECURITY_STATE_KEY`** — the repo is public, so nothing readable about a
vulnerability sits in a branch. Written through check-core's store (`scripts/check-core/lib/state-store.mjs`:
fetch → apply → fast-forward push, never force), so the weekly run and PR runs never clobber each other.
- new = not in the state (or resolved before) → ticketed; open with a ticket → not re-ticketed (unless that card is
  **Done** and the finding is still there: re-ticketed as reopened); open but not re-reported this week → stays open while
  its sink line is still in the file (the model is not deterministic); gone → resolved.
- Lose the key → details become unreadable; set a new `SECURITY_STATE_KEY` and delete the branch: the next run re-tickets
  what is open once.
- Test runs use `security-state-test` (a push to `ci-test/security-weekly*`, PRs to `ci-test/security-main`).
- Logs show counts only; raw output stays in `$RUNNER_TEMP` (no artifacts). PR comments omit exploit paths.

## The ticket and the fix
The weekly card (`[security] Weekly scan <date>: …`, Source `security-check fp:… run:…`, Target `dev`, Priority P0 when
anything is high+, `findings.json` attached) has one section per root-cause group, most severe first: affected files,
why it is exploitable, numbered fix steps that name files (the pipeline's brief takes them as the plan), acceptance
criteria and the test to add. Leaked secrets come with **owner actions first**: revoke/rotate at the provider, then purge
from history (a force-push the pipeline never does) — deleting the literal from the code is not a fix.

On a PR the fix runs through the pipeline's **direct mode** (no Notion): `scripts/team/direct.mjs` writes the card/
classify/brief files the pipeline always uses, and the `team-direct` skill runs build (opus engine) → `verify.mjs` →
fable code review on the PR branch. The workflow commits `security: auto-fix round N` and pushes it with `GITHUB_TOKEN`
(the agents never see a token), then re-scans and sets the status on the new commit. Only for same-repo PRs by
OWNER/MEMBER/COLLABORATOR; a fork PR gets no secrets (deterministic scan only, no status) and needs the owner.

## Required on `main`
A repository ruleset requires the status `security/pr-scan` on every commit that reaches `main`; repository admins can
bypass it only through a pull request (to merge one that needs a human). The two direct pushes to `main` go through it:
the promote job opens a dev → main PR, runs this gate and pushes exactly the scanned commit; the ship skill's
`Target = main` path pushes `security-gate/<slug>` and waits (`scripts/security/wait-status.mjs`) before pushing `main`.

## Tuning false positives
1. **One finding** → add its fingerprint (in the ticket, PR comment and `findings.json`) to `.security/ignore.json`
   with a `reason` (required) and optionally `until` (ISO date; it reports again after).
2. **A class of LLM findings** → edit `.security/scan-instructions.md` (the exclusions / severity / confidence rules).
3. **A gitleaks rule or path** → `.gitleaks.toml` allowlist, with a comment saying why. Never for a real secret.
4. The bar itself is `MIN_CONFIDENCE` in `scripts/security/lib/finding.mjs` (8).

## Running it by hand
- Weekly: Actions → Security → Run workflow (`notion`: live / backlog / dry, `state_branch`, `llm`, `force`).
- Locally (needs `gitleaks`, `osv-scanner`, `claude` on PATH, or `GITLEAKS_BIN` / `OSV_SCANNER_BIN`):
  `node scripts/security/run.mjs weekly --notion dry --llm off` (nothing written) ·
  `node scripts/security/run.mjs pr --base origin/main --branch <b> --status off --fix off`.
- Tests: `node --test "scripts/security/*.test.mjs"`.
