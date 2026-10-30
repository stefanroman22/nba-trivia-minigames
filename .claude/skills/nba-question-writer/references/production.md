# Reading production, and putting questions live

The questions live in the production database (`Question` rows, `QuestionLabel`, `DataCorrection`). You
read it with `question_writer export` and change it only with `question_writer apply`, both run on the
production database by the **Ops command** workflow (`.github/workflows/ops-manage.yml`). Players see a
change only after **Publish game data** runs. Your local database has no questions.

Git rules: you never push to `dev` or `main` unless Stefan asks. A throwaway `ops/run-question_writer-*`
branch is how a command reaches production; push it only for an export, or for an apply Stefan said
"go" to in this session, and delete it when done.

## Files you write

Proposals (local, for `check`), in your scratchpad:

```json
{"game": "tictactoe",
 "questions": [{"definition": {...the game's definition...},
                "difficulty": "medium",
                "typed_forms": {"Shaquille O'Neal": ["Shaq", "Diesel"]}}]}
```

Payload (for `apply`), committed on the ops branch as `backend/ops/payloads/<yyyy-mm-dd>-<game>-<what>.json`:

```json
{"game": "who-are-ya",
 "aliases": [{"person_id": 1626157, "add": ["Karl Anthony Towns", "KAT"], "reason": "spellings fans type"}],
 "add": [{"definition": {"person_id": 1503}, "difficulty": "easy", "reason": "guide: Easy rule 2 (STAR, active)"}],
 "labels": [{"qid": "way-000123", "difficulty": "hard", "reason": "guide: Hard rule 1 (DEEP, pre-1990)"}]}
```

`apply` handles aliases first (so the new spellings count), then new questions (active at once, the
label if given, `created_by "writer"`; duplicates and definitions that do not hold are skipped and
reported, never forced), then labels (an owner label is never changed).

## Export (read production)

Once `question_writer` is on `main`:

```bash
gh workflow run ops-manage.yml -R stefanroman22/nba-trivia-minigames -f command=question_writer -f args="export --game <slug>"
# find the run, wait for it, download the file
gh run list -R stefanroman22/nba-trivia-minigames --workflow ops-manage.yml --limit 1
gh run watch <id> -R stefanroman22/nba-trivia-minigames --exit-status
gh run download <id> -R stefanroman22/nba-trivia-minigames -n ops-out -D <scratchpad>/export-<slug>
```

Before it is on `main`: branch `ops/run-question_writer-export-<slug>` from the branch that has it, write
`backend/ops/args/question_writer.txt` with `export --game <slug>`, commit, push; the push runs it. Then
download the artifact as above and delete the branch.

Use a fresh export for every `check` and `capacity` run of a session (it carries the active data
corrections, so the local check sees production's dataset).

## Apply (only after Stefan's go)

1. `git fetch origin && git switch -c ops/run-question_writer-<game>-<what> origin/main`
2. Add the payload under `backend/ops/payloads/`, and `backend/ops/args/question_writer.txt` with
   `apply --file ops/payloads/<file>.json --dry-run`. Commit, push. Read the run log: every item should be
   `added` / `labeled` as planned. A `skipped` item goes back to the write flow (duplicate: step 5).
3. Change the args line to drop `--dry-run`, commit, push. Read the log and the `ops-out` report.
4. Publish (below), check the live site, then delete the ops branch (`git push origin --delete ...`,
   `git branch -D ...`).

## Publish

Publish game data is switched off (Stefan paused it). Turn it on only for the one run:

```bash
R=stefanroman22/nba-trivia-minigames
gh workflow enable "Publish game data" -R $R
gh workflow run "Publish game data" -R $R --ref main -f games=<slug> -f target=vercel -f dry_run=false
# wait until the run's jobs have started (a run queued while the workflow is disabled never starts)
gh run view <id> -R $R --json jobs --jq '[.jobs[]|select(.status!="queued")]|length'
gh workflow disable "Publish game data" -R $R
```

A publish runs maintenance: it re-checks every live question against today's data and retires any that
no longer hold. It never generates questions (no `--top-up`).

## Check it is live

`https://nba-minigames-data.vercel.app/manifest.json` has the new `version`; the game's index lists the
new qids (Tic-Tac-Toe items are `[qid, level]`); each new file `<game>/<qid>.<sha12>.json` answers 200.
The publish's own "Verify live data" step can fail on a stale cache right after publishing: check by hand a
few minutes later before publishing again.
