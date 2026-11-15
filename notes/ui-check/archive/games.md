# games.md — archived notes (retain.mjs)

## archived 2026-11-15

- (20261014-1153) False positive: `tap-target` on `button.chip.cp-toggle` (Career Path, phone-390, 114x22 px): `.cp-toggle::after` already extends the hit area to 44 px (CareerPath.css:42); the detector measures the visible box only.
- (20261014-1153) Unproven: HTTP 500 on `log-session` (series-winner) and `log-guesses` (fan-favorites), both desktop-1366 only, other games fine; may be a transient prod blip.
- (20261014-1153) Environment artefact: the log-session / log-guesses HTTP 500 did not reproduce on re-validation; most likely a local sqlite lock under 4 parallel workers. Dropped. Series Winner name wrap: deterministic probe = minSize 0x56 on `.playing-wrap .gf-board button span.font-display` (fails now: 18.8 px with short names; would pass spuriously if a 3-line name is drawn).
- (20261016-1855) Environment artefact: prod run (ref main) with adapters from dev. Adapters expect the rebalanced points (dev commit bfd0034, not on main), so feedback-copy / end-score / points-not-logged (448 violations, every game) are tooling-vs-prod drift, not findings. Judge layout rules (snap, stage-resized, feedback-over-end, off-centre, loaf) separately; skips are all by-design adapter reasons.
- (20261016-2125) Environment artefact: 78 wordle `daily-play` and 61 `log-session` HTTP 500 are all `database is locked` in django-8200.log (local sqlite under parallel workers); every Wordle timeout/no-playing, points-not-logged and console 5xx line is this, not a finding. Single-frame `loaf` (111-127 ms, 1 over) on name-logo/career-path/who-are-ya/starting-five is flake (same as the Contexto note).
