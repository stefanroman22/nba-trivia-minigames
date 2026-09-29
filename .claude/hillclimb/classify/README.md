# classify eval

Routing-accuracy eval for the team pipeline's `classify` step (model tier + design-round call) under the
2026-09-29 model policy. 36 cases: 19 real Notion cards + 17 owner-written; answer key owner-verified.

Lives on the `eval/classify` branch on purpose: never merge it into `dev`. The pipeline's classify greps the
repo and would otherwise read this answer key while classifying real cards. (Locally the folder is also listed
in `.git/info/exclude`, so commits here need `git add -f`.)

Run from the repo root of a checkout that has this folder:

    node .claude/hillclimb/classify/run-eval.mjs --flow .claude/hillclimb/classify --approve-harness   # owner only, after reviewing changes
    node .claude/hillclimb/classify/run-eval.mjs --flow .claude/hillclimb/classify --variant baseline --model claude-fable-5-1 --reps 2

Baseline (2026-09-29, Fable 5.1, 36 cases x 2): routing 88% (95% CI +-8), design 94%, model tier 93%,
risk 94%, difficulty 78%, valid JSON 100%. Cost ~$52 at API prices per full pass (median $0.72/run, ~70 s).
Report: `node <claude-api skill>/shared/evals/report/build-report-lite.mjs .claude/hillclimb/classify/`
