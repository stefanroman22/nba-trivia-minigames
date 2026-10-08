# Design — Clean up GAME_DESIGN_CONSTRAINTS.md (fresh-eyes review, stable ids, shorter)

Card `3ee2cfb1` · slug `clean-up-game-design` · docs-only · 2026-10-08 · planner: fable

## 1. Decision summary

- Rewrite `docs/GAME_DESIGN_CONSTRAINTS.md` (958 lines) into a rulebook of **29 numbered rules**, opened
  by a "Rules at a glance" table, target **≤ 575 lines** (60 %). Every existing rule id is kept
  (`0, 1.0–1.2, 4.1–4.4, 4.2a, 4.2b, 5.1, 6.1–6.3, 7.0–7.3`). Two ids change because the brief
  generator (`scripts/team/lib/rules.mjs`) cannot parse them and nothing outside the doc cites them:
  `4.2.1 → 4.5`; the unnumbered sections `7a`/`7b` retire into `RULE 7.4` (standard path) and
  `RULE 7.3` (in place). Unnumbered rules get ids so the reviewer can cite them (`0.1, 2.1, 3.1, 4.6,
  5.0, 6.0, 8.1, 9.1`).
- **The component is the spec.** Pixel/CSS specs of shell-owned components (idle screen, CourtLoader,
  status row, GameResult, ScorePanel, EndSequence, Spinner, the Series Winner choice card) leave the
  rulebook; the rule becomes "shell-owned — never rebuild, never restyle" plus the file that owns it.
  Numbers a game author must choose stay in one "Shared constants" table.
- History and incidents (8 root gaps, 11-of-18 laptop failures, Guess MVP 82 px, Starting Five 427 px /
  480 ms, the 6.3 sweep) move to one `docs/team/DECISIONS.md` entry; the rulebook keeps one "why" line
  per rule.
- Stale rules are rewritten to the code (`CONTENT_STAGE_GAMES` no longer exists — `<GameFrame fill>`
  and `:has()` decide; `28.6` is not a constant; `.is-ended` collapses, it does not keep its box).
- `scripts/check-constraint-ids.mjs` (plain Node, reuses `extractRules`) fails CI on duplicate ids or
  dangling `Rule x.y` / `UI-n` / `BE-n` / `MP-n` / `AUTH-n` references; wired into `npm run lint`.
- The implementation produces the card's findings document
  `docs/team/designs/2026-10-03-game-constraints-review.md` from the tables in §7–§9 below.
- Engine: **mixed** — `[opus]` for the rewrite, the mapping and the spot audit; `[sonnet]` for the
  checker, wiring and reference updates.

## 2. Interfaces

### 2.1 Rule heading contract (what the pipeline parses)
`scripts/team/lib/rules.mjs` `RULE_RE` accepts `## RULE <id> — <title>` / `### RULE <id> — <title>` where
`<id>` is `\d+(\.\d+)?[a-z]?` or `[A-Z]+-\d+`. Therefore in the new doc:
- every rule is a `##` or `###` heading (never `####` — today 7.0–7.3 are `####` and briefs never quote them);
- ids have at most one dot (`4.2.1` is unparseable → `4.5`);
- acceptance tests live inside the rule's body under a bold lead-in (`**Check:**`), never as a separate
  `### RULE x.y acceptance test` heading.

### 2.2 Final rule ids (the "Rules at a glance" rows)
| ID | Rule (MUST / MUST NOT) | Enforced by | Was |
|---|---|---|---|
| 0 | Your root MUST be `<GameFrame>`; a game never sets its own root width, gap, margin or padding | `npm run ui:audit` (`usesGameFrame`, `rootMaxWidth`) | RULE 0 |
| 0.1 | Colours MUST come from `theme.css` tokens; one accent; `.tnum` on every number | review | §0 prose |
| 1.0 | Children MUST size against `--stage-avail`, never `--stage-max` | review (`grep stage-max src/styles`) | RULE 1.0 |
| 1.1 | The play area MUST fit 390×844 with no in-game scroll | `ui:audit` mobile (`playAreaFitsViewport`) | RULE 1.1 |
| 1.2 | A game that cannot fit MUST let the shell grow (content game, page scrolls) — never clip, never squash — with a deviations entry | `ui:audit` (`shellContainsGame`) + review | RULE 1.2 |
| 2.1 | The idle screen is shell-owned; a game MUST NOT build its own | review | §2 |
| 3.1 | Loading is shell-owned (`CourtLoader`, 2000 ms hold); a game MUST NOT add a loader | review | §3 |
| 4.1 | Every game MUST be classified: a board that scrolls internally → `<GameFrame fill>`; anything else → `<GameFrame>` | `ui:audit` (`isContent`, `gameToExit`) | RULE 4.1 |
| 4.2 | The three shell distances MUST be identical in every game | `ui:audit` (`shellTop`, `gameToExit`, `exitToBottom`) | RULE 4.2 |
| 4.2a | An empty slot MUST be omitted, never rendered | `ui:audit` (lone-slot alignment) | RULE 4.2a |
| 4.2b | A content game MUST NOT be given a height floor | `ui:audit` (`shellTop`) | RULE 4.2b |
| 4.3 | Column counts MUST be explicit per breakpoint; media keeps its aspect ratio | review | RULE 4.3 |
| 4.4 | Labels above repeated cells MUST reserve their maximum line count | manual DevTools check | RULE 4.4 |
| 4.5 | Space above the first and below the last component MUST equal `--stage-pad` in every state | `ui:audit` (playing) + manual (idle, loading, ended) | RULE 4.2.1 |
| 4.6 | One leave control per screen, labelled `Close game`; a game MUST NOT render its own | review | §4 "Exit button" |
| 5.0 | A progress bar is the shared `<ProgressBar>` in the frame's second slot, or omitted | review | §5 "Progress bar" |
| 5.1 | Between rounds only the content that changed MUST animate | motion-reviewer | RULE 5.1 |
| 6.0 | Feedback copy MUST be `Correct! +N` / a statement of the truth / neutral, in the fixed colours | review | §6 "Copy format" |
| 6.1 | Per-guess feedback MUST be `<SubmitGuessPopup>` in the shell's `.feedback-slot` | manual DevTools check | RULE 6.1 |
| 6.2 | Transient content MUST NOT resize the container | manual ResizeObserver check / QA | RULE 6.2 |
| 6.3 | Running out of lives MUST NOT be announced anywhere | review (`grep` banned strings) | RULE 6.3 |
| 7.0 | The score line MUST sit above Play again / Close game | review | RULE 7.0 |
| 7.1 | The result MUST NOT restate a count the board already shows | review | RULE 7.1 |
| 7.2 | A reveal MUST NOT re-animate what the player already earned | review | RULE 7.2 |
| 7.3 | A game that reveals something at the end MUST end in place (`{ inPlace: true }`, `EndSequence`, `ScorePanel`) | `scripts/check-game-results.mjs` | RULE 7.3 + §7b |
| 7.4 | A full-screen result MUST appear at once — no "Calculating" beat, no loader, no timeout; points award in the background | review | §7a |
| 8.1 | Shared components MUST be reused, never re-implemented | review + `docs/team/CODE_MAP.md` | §8 |
| 9.1 | `pointsPerCorrect × rounds` MUST equal `maxPoints`; time never adds points | review | §9 |

### 2.3 Old → new id mapping (goes verbatim into the findings doc)
| Old reference | New | Action |
|---|---|---|
| `RULE 4.2.1` | `RULE 4.5` | rename (unparseable 3-part id; zero references outside the doc) |
| `7a`, `§7a`, `Rule 7a` | `Rule 7.4` | section retired into a rule |
| `7b`, `§7b`, `Rule 7b` | `Rule 7.3` | section retired into a rule |
| `### RULE 4.2 acceptance test` | body of `RULE 4.2` | heading removed (it was never a rule) |
| `### RULE 6.1/6.2 acceptance test` | bodies of `6.1` / `6.2` | same |
| every other id | unchanged | — |

### 2.4 `scripts/check-constraint-ids.mjs`
```
node scripts/check-constraint-ids.mjs            # exit 0, prints "<n> ids in 4 docs, <m> references resolved"
                                                 # exit 1, one line per problem: "<file>:<line>: <id> does not resolve" /
                                                 #   "<doc>: duplicate id <id>"
```
- **Id sources** (one `extractRules` call each): `docs/GAME_DESIGN_CONSTRAINTS.md`,
  `docs/constraints/UI_SHELL_CONSTRAINTS.md`, `BACKEND_CONSTRAINTS.md`, `MULTIPLAYER_CONSTRAINTS.md`,
  `AUTH_CONSTRAINTS.md`. Duplicate id within a doc → fail.
- **Reference patterns** (per line): `/\b(?:RULE|Rule)s?\s+(\d+(?:\.\d+)?[a-z]?)\b/g` (resolves against the
  game doc), `/\b(UI|BE|MP|AUTH)-(\d+)\b/g` (resolves against the prefixed docs), and the retired forms
  `/(?:Rule|RULE|§)\s*7[ab]\b/` and `/\bRULE\s+4\.2\.1\b/` → always fail (the mapping replaced them).
- **Scanned**: `CLAUDE.md`, `README.md`, `docs/**/*.md`, `.claude/**/*.md`, `src/**/*.{ts,tsx,css}`,
  `scripts/**/*.{mjs,js,json}` — walked with `fs`, no globbing dependency.
- **Excluded** (dated records that describe the doc as it was): `docs/team/designs/`, `docs/team/DECISIONS.md`,
  `docs/team/RETRO.md`, `docs/superpowers/`, `node_modules/`, `.next/`, `.team/`. The exclusion list is a
  constant at the top of the script with this reason as a comment.
- Known limit, documented in the header: `Rules 1.1 / 4.2` resolves only the first id of a slash list.

### 2.5 `package.json`
```
"check:ids": "node scripts/check-constraint-ids.mjs",
"lint": "eslint . && npm run check:games && npm run check:ids"
```
`.github/workflows/dev-ci.yml` already runs `npm run lint`, so CI needs no change.

### 2.6 Findings document `docs/team/designs/2026-10-03-game-constraints-review.md`
Sections and table columns, in this order:
1. `## Fresh read — what confused a newcomer` (bullets, §7 below)
2. `## Findings` — columns: `#` · `Finding` · `Type` (contradiction / duplicate / stale / ambiguous /
   unverifiable / missing / history-in-the-rulebook) · `Location (old line)` · `Proposed action` · `Done`
3. `## Old → new id mapping` (§2.3)
4. `## Section mapping` — one row per `##`/`###`/`####` heading of the old doc: `Old heading` · `Fate`
   (kept / merged into `<id>` / removed) · `Why` (the implementation fills every row; §9 seeds it)
5. `## Resolved contradictions` (the list the card's Done-when asks for)
6. `## Spot audit` — `Renderer` · `Rule` · `Observation` · `Follow-up card?`
7. `## Irreducible parts` (only if the 575-line target is missed)

## 3. File plan
- `docs/GAME_DESIGN_CONSTRAINTS.md` — rewritten (structure in §6).
- `docs/team/designs/2026-10-03-game-constraints-review.md` — created (findings, mapping, audit).
- `docs/team/DECISIONS.md` — one entry: history moved out of the rulebook + the SessionTimer rule dropped.
- `scripts/check-constraint-ids.mjs` — created.
- `package.json` — `check:ids` script; `lint` calls it.
- `src/Game Renderers/{Contexto,Wordle,TicTacToe,StartingFive,HeatmapGame,NbaGrid}.tsx`,
  `src/styles/{Wordle,Contexto}.css` — comment-only: `7b`/`§7b` → `Rule 7.3`.
- `.claude/agents/code-reviewer.md` — line 37 `7b / Rule 7.3` → `Rule 7.3`; point at "Rules at a glance".
- `.claude/skills/qa-protocol/SKILL.md` — step 1 cites `Rule 7.3` (unchanged id) and the new §"Checks" names.
- `docs/constraints/UI_SHELL_CONSTRAINTS.md` — lines 6/76/250 pointers verified; UI-2's "Adding a game"
  sentence links to the game doc's "Adding a game" section instead of restating it.
- `.team/run/clean-up-game-design/build-report.json` — written by the engine.
Not touched: `scripts/team/lib/rules.mjs` (its fixtures are self-contained), any renderer logic.

## 4. Risks
| Risk | Prevention |
|---|---|
| A rule disappears silently in the rewrite | §9 section mapping must have a row for every old heading; step 3's done-check diffs heading lists mechanically |
| Reviewer/skill citations break | checker runs in `lint`; step 7 greps for retired forms; `node --test scripts/team/lib/rules.test.mjs` still passes |
| Briefs stop quoting rules (regex drift) | step 2's done-check runs `extractRules` on the new doc and asserts all 29 ids |
| Rewrite invents new rules | scope rule in §6: only the 29 ids; anything else is a deviation row or DECISIONS |
| Checker false positives on prose like "Rule 1 of thumb" | case-sensitive `RULE|Rule` + a number; archival paths excluded; limit documented |
| Deviations table keeps entries nobody can verify | step 2 prunes with `grep '\.gf:has(' src/styles` and `onPlayAgain` in Wordle; each row gets a date |

## 5. Test plan
- Gate 1 (docs-only, skipped by the pipeline; the engine runs them in step 10): `npm run lint`
  (eslint + `check:games` + `check:ids`), `npm run build`, `node --test scripts/team/lib/rules.test.mjs`.
- QA assertions (script checks — no browser):
```json
[
  {"flow": "script: `node scripts/check-constraint-ids.mjs` exits 0 and reports ≥ 29 game-doc ids"},
  {"flow": "script: `node scripts/check-game-results.mjs` exits 0"},
  {"flow": "script: `node --test scripts/team/lib/rules.test.mjs` passes"},
  {"flow": "script: `wc -l docs/GAME_DESIGN_CONSTRAINTS.md` ≤ 575 and `grep -c '^#\\{2,3\\} RULE ' docs/GAME_DESIGN_CONSTRAINTS.md` = 29"},
  {"flow": "script: `grep -rnE '(Rule|RULE|§) ?7[ab]\\b|CONTENT_STAGE_GAMES|RULE 4\\.2\\.1' src .claude docs/GAME_DESIGN_CONSTRAINTS.md docs/constraints` returns nothing"}
]
```
- New tests: none beyond the checker itself (it is the test).

## 6. New document structure (the rewrite target)
```
# Game Design Constraints
intro: 4 lines (what the shell is, the two reference renderers, "run npm run ui:audit; a screenshot or it did not happen")
## Rules at a glance            (table from §2.2 without the "Was" column)
## Terms                        (fill game, content game, in place, slot, shell, transient, Close game — one term each)
## 0. Root and tokens           RULE 0 · RULE 0.1 · tokens table (kept, it is the only copy)
## 1. The shell                 DOM chain (10 lines) · RULE 1.0 · RULE 1.1 · RULE 1.2
## 2. Idle                      RULE 2.1 (data-driven from the Game entry; roundsLabel; lobby note)
## 3. Loading                   RULE 3.1 (CourtLoader scale 1; Spinner for inline spots)
## 4. Playing shell             RULE 4.1 · 4.2 · 4.2a · 4.2b · 4.3 · 4.4 · 4.5 · 4.6
## 5. Rounds                    RULE 5.0 · RULE 5.1 · "Shared constants" table (reveal dwell 1800 ms, stagger 260 ms + 300 ms lead, loader beat 1.5 s, feedback slot bottom 22 px)
## 6. Feedback                  RULE 6.0 · 6.1 · 6.2 · 6.3
## 7. End of game               RULE 7.4 (standard) · 7.3 (in place; EndSequence phases, ScorePanel, allowlist) · 7.0 · 7.1 · 7.2
## 8. Shared components         RULE 8.1 + the list
## 9. Scoring                   RULE 9.1
## Accepted deviations          table: Game · Deviation · Rule · Reason · Date
## Adding a game                4 touchpoints (CONTENT_STAGE_GAMES line replaced by "choose fill or not, Rule 4.1")
```
Each rule body: **statement** (≤ 3 lines) · **Why** (1 line) · **Check** (1 line or a ≤ 8-line snippet) ·
optional one ❌/✅ pair. Prose that explains an incident goes to DECISIONS, not the body.

## 7. Fresh read — what confused a newcomer
- Three different values for the same distance: `30px`, `clamp(14px, 2.6vw, 30px)` and `28.6` (lines 63, 352, 420, 501–503).
- RULE 0 says never set your own root; §5 then tells you to copy an inline-styled root `div` with `maxWidth:560, gap:20` (523–526).
- RULE 4.1 orders you to add the id to `CONTENT_STAGE_GAMES` in `MiniGame.tsx`; that list was deleted (`MiniGame.tsx:31`).
- "Exit", "exit button", "leave control", "Close game" and `.exit-link` all name one thing.
- §4 says `.is-ended` keeps the link's box "so the board doesn't shift"; RULE 4.2.1 says it collapses height and gap. The CSS collapses it.
- 7a/7b are sections, 7.0–7.3 are rules nested under 7b, and 7.3 restates 7b's opening sentence.
- "All 17 games" (664), "all 18" (51), "the other 17" (940): 18 visible games, none hidden.
- §9's "always-visible `SessionTimer`" is a rule the doc itself says no game follows (938).
- §0 says use framer's `useReducedMotion()`; UI-20 says `useReducedMotionSafe`.
- Long CSS/keyframe descriptions of CourtLoader, GameResult, ScorePanel, Spinner: unclear whether a game author is meant to do anything with them.

## 8. Findings (initial; the implementation copies this table and adds a Done column)
| # | Finding | Type | Location (old line) | Proposed action |
|---|---|---|---|---|
| F1 | Stage padding stated as `clamp(...)` everywhere, `30px` in RULE 4.2, and `28.6` as a literal in the 4.2 test and 4.2b | contradiction | 63, 130, 352, 420, 501–503 | state the truth once (RULE 4.2): `--stage-pad` = 30 px at ≥ 820 px, `clamp(14px, 2.6vw, 30px)` below; tests read the computed padding, no literal |
| F2 | §5 instructs an inline-styled root (`maxWidth:560`, `gap:20`) while RULE 0 forbids a game root | contradiction | 521–530 vs 38 | delete §5's root/status-row specs; `GameFrame` owns them |
| F3 | RULE 4.1 and "Adding a game" require `CONTENT_STAGE_GAMES`; removed from code | stale | 316–343, 955 | rewrite the test as `<GameFrame fill>` vs `<GameFrame>`; drop the "current set" list |
| F4 | `.exit-link.is-ended` "box kept" (§4) vs "collapsed" (4.2.1) | contradiction | 512–514 vs 365–367 | RULE 4.5 states the collapse (code: `MiniGame.css:214`) |
| F5 | 7b opening sentence == RULE 7.3 statement | duplicate | 771–772 vs 870–874 | 7b merges into RULE 7.3 |
| F6 | 7.0–7.3 are `####`; `extractRules` ignores them, so briefs never quote them | missing (from briefs) | 816–870 | promote to `###` |
| F7 | `RULE 4.2.1` id is unparseable by the brief generator | stale (tooling) | 361 | rename to 4.5; mapping row |
| F8 | Exit control has no id; code-reviewer must cite "§4 Exit button" | missing | 507–515 | RULE 4.6 |
| F9 | "17 games" / "18 games" counts and "only Series Winner and Starting Five are verified" | stale | 51, 57, 664, 940 | remove counts; `ui:audit` covers every visible game |
| F10 | Known open item "other 17 games not re-measured" | stale | 940–941 | drop |
| F11 | `CorrectAnswer.tsx` orphan note | history-in-the-rulebook | 939 | drop from rulebook; follow-up note in findings (file still exists) |
| F12 | §9 "always-visible `SessionTimer`" — no single-player game renders it (only `OnlineMatch`) | unverifiable | 905, 938 | drop the rule; keep "time never adds points" in RULE 9.1; DECISIONS entry |
| F13 | §0 `useReducedMotion()` vs UI-20 `useReducedMotionSafe` | contradiction (cross-doc) | 92 | delete the line; RULE 0.1 links UI-20 (one doc owns reduced motion) |
| F14 | "Adding a game" step 1 duplicates UI-2 | duplicate (cross-doc) | 947 vs UI-2 | game doc keeps the 4 touchpoints; UI-2 links to it instead of restating |
| F15 | Idle screen pixel table, CourtLoader keyframes, GameResult table, ScorePanel/EndSequence/Spinner CSS, choice-card spec | history-in-the-rulebook (implementation detail of shell-owned components) | 238–257, 269–280, 759–768, 784–805, 592–614 | replace with "shell-owned, do not rebuild/restyle" + owning file; constants table keeps 2000 ms, 1.5 s, 1800 ms, 260/300 ms, 22 px |
| F16 | Idle chips "5 rounds / ~1 min hardcoded" | stale | 252–254 | code reads `game.roundsLabel`; RULE 2.1 says "data-driven from the `Game` entry" |
| F17 | RULE 1.2's example `.stage-inner:has(.s5-wrap) { max-height: none }` and the Starting Five "opts out at ≤ 620px" deviation | stale | 205–214, 921 | every content game is uncapped by `ui.css:188`; 1.2 becomes "become a content game; never clip/squash"; deviation row removed |
| F18 | Deviation "Wordle: `GameResult` without `onPlayAgain`" — Wordle now ends in place | stale | 931 | reword: Wordle's `ScorePanel` has no Play again (daily lock) |
| F19 | Deviation "Imposter lost `[data-low]`" is a changelog line | history-in-the-rulebook | 930 | remove; DECISIONS |
| F20 | Deviation "narrower roots 430–520px" for 5 games — only `.gf:has(.s5-cards)` overrides width today | unverifiable | 922 | step 2 verifies with `grep '\.gf:has(' src/styles`; keep only rows with a selector |
| F21 | Career Path deviation hides a rule ("no button waits more than 400 ms") | ambiguous | 935 | keep as deviation reason; RULE 7.4 carries "no artificial wait"; the 400 ms figure is cited there as the owner's latency bound |
| F22 | RULE 6.3 is three paragraphs plus history | duplicate (self) | 714–740 | one statement + banned-string list + the "warning before the last life is fine" clause |
| F23 | RULE 6.1 says "the §7b panels are not covered" while 6.2 lists the slot as technique 1 | ambiguous | 665, 696 | 6.1 scopes itself to per-guess feedback in the statement |
| F24 | Feedback copy format and 6.3's "never a distinct Out of lives" overlap | duplicate | 620–626 vs 714 | RULE 6.0 holds copy; it links 6.3 for the loss case |
| F25 | Progress bar rule lacks an id and partly repeats RULE 0's `<ProgressBar>` comment | missing | 542–560 | RULE 5.0 |
| F26 | Accepted deviations lack a date column and a rule column | missing | 918 | add both; dates from `git log -S` / DECISIONS, else `≤ 2026-10` |
| F27 | Reference-implementations table calls Fan Favorites "the answers-shown exception" — it is now the rule (7.3) | stale | 11 | "in-place end reference" |
| F28 | Terminology: exit / leave / close; "overview"; "in-place" vs "stays in place" | ambiguous | throughout | `## Terms` block; one term each; "Close game" |
| F29 | 7a/7b, `§7b` cited in 8 renderers/CSS and in `code-reviewer.md:37` | stale (after this card) | repo | update to `Rule 7.3` / `Rule 7.4`; checker rejects retired forms |
| F30 | `design-round` skill does not cite any GAME_DESIGN section (card expects a pointer to fix) | — | `.claude/skills/design-round/SKILL.md` | nothing to change; note in findings |

## 9. Section mapping seed (every old heading; implementation completes "Why")
| Old heading | Fate |
|---|---|
| RULE 0 | kept; history (gaps/widths/11-of-18) → DECISIONS; verification paragraph → intro |
| 0. Design tokens | kept as RULE 0.1 + table; reduced-motion line removed (F13) |
| 1. The shell | kept, compressed to the DOM chain + "never add padding"; CSS block replaced by the owning file |
| RULE 1.1 / 1.0 / 1.2 | kept (1.2 rewritten per F17) |
| 2. Idle screen | merged into RULE 2.1 |
| 3. Loading | merged into RULE 3.1 |
| 4. Playing shell (CSS block) | removed — `MiniGame.css` owns it |
| RULE 4.1 | kept, rewritten per F3 |
| RULE 4.2 | kept; acceptance test folded into the body (F1) |
| RULE 4.2.1 | renamed 4.5 |
| RULE 4.2a / 4.2b / 4.3 / 4.4 | kept; incident prose → DECISIONS |
| RULE 4.2 acceptance test | merged into 4.2 |
| Exit button | merged into RULE 4.6 |
| 5. Game root layout | removed (F2) |
| Progress bar | merged into RULE 5.0 |
| RULE 5.1 | kept |
| Round body spec | removed (F15); reveal dwell → constants table |
| 6. Feedback (copy format) | merged into RULE 6.0 |
| RULE 6.1 / 6.2 / 6.3 (+ tests) | kept; tests folded into bodies |
| 7a | merged into RULE 7.4 |
| 7b | merged into RULE 7.3 |
| RULE 7.0 / 7.1 / 7.2 / 7.3 | kept, promoted to `###` |
| 8. Reusable components | merged into RULE 8.1 |
| 9. Scoring | merged into RULE 9.1 (SessionTimer dropped, F12) |
| Accepted deviations | kept; rows pruned/dated (F17–F20, F26) |
| Known open items | removed (F10–F12) |
| Adding a game | kept; step 5 rewritten (F3) |

## Implementation plan
1. `[sonnet]` Create `docs/team/designs/2026-10-03-game-constraints-review.md` with the seven sections of §2.6, copying §7, §8 (add an empty `Done` column), §2.3 and §9 from this design. Done: file exists; `grep -c '^| F' ` = 30; the old doc is also saved as `git show origin/dev:docs/GAME_DESIGN_CONSTRAINTS.md > /tmp/old-gdc.md` for steps 2–3.
2. `[opus]` Rewrite `docs/GAME_DESIGN_CONSTRAINTS.md` to §6 with the 29 rules of §2.2, applying every "Proposed action" in §8 (F1–F28). Prune the deviations table with `grep -n '\.gf:has(' src/styles/*.css` (F20) and `grep -n onPlayAgain "src/Game Renderers/Wordle.tsx"` (F18); add `Rule` and `Date` columns. Done: `wc -l` ≤ 575; `grep -cE '^#{2,3} RULE ' ` = 29 and `grep -c '^#### RULE'` = 0; `node -e "const {extractRules}=await import('./scripts/team/lib/rules.mjs');const fs=await import('node:fs');console.log(extractRules(fs.readFileSync('docs/GAME_DESIGN_CONSTRAINTS.md','utf8')).map(r=>r.id).join(' '))" --input-type=module` prints all 29 ids; `grep -nE 'CONTENT_STAGE_GAMES|28\.6|\b7[ab]\b|4\.2\.1|1[78] games|useReducedMotion\(' docs/GAME_DESIGN_CONSTRAINTS.md` is empty.
3. `[opus]` Finish the findings doc: every `##`/`###`/`####` heading of `/tmp/old-gdc.md` has a row in "Section mapping" with Fate and Why; fill "Resolved contradictions" (F1, F2, F4, F5, F13, F23 at minimum); mark each F-row `Done`. Done: `grep -cE '^#{2,4} ' /tmp/old-gdc.md` equals the mapping row count; no `Done` cell is empty.
4. `[opus]` Append to `docs/team/DECISIONS.md` the entry `## 2026-10-08 — GAME_DESIGN_CONSTRAINTS rewrite: history leaves the rulebook, SessionTimer rule dropped` holding the incident numbers removed in step 2 (RULE 0's 8 gaps / 7 widths / 11-of-18, Starting Five 427 px and 480 ms, Guess MVP 82 px vs 28.6, NBA Grid offset 0, Series Winner's original feedback row, the 6.3 sweep list, Imposter `[data-low]`) and the F12 call. Done: entry present; each number above greps in DECISIONS and not in the rulebook.
5. `[sonnet]` Write `scripts/check-constraint-ids.mjs` to §2.4: `import { extractRules } from "./team/lib/rules.mjs"`, directory walk with the exclusion constant, per-line regexes, exit codes and messages as specified, a header comment with the known limit. Done: `node scripts/check-constraint-ids.mjs` exits 0 on the rewritten tree; then plant `Rule 9.9` in `.claude/agents/code-reviewer.md`, run again → exit 1 with `.claude/agents/code-reviewer.md:<line>: Rule 9.9 does not resolve`; revert the plant and keep that output line for step 11.
6. `[sonnet]` `package.json`: add `"check:ids"` and extend `"lint"` per §2.5. Done: `grep -n 'check:ids' package.json` shows both lines; `npm run lint` runs it (visible in output).
7. `[sonnet]` Update references per §2.3: comment-only edits in `src/Game Renderers/{Contexto,Wordle,TicTacToe,StartingFive,HeatmapGame,NbaGrid}.tsx` and `src/styles/{Wordle,Contexto}.css` (`Rule 7b`/`§7b` → `Rule 7.3`); `.claude/agents/code-reviewer.md:37` → `Rule 7.3`, and its required-reading line names "Rules at a glance"; `.claude/skills/qa-protocol/SKILL.md` step 1 keeps `Rule 7.3`; `docs/constraints/UI_SHELL_CONSTRAINTS.md:76` replaces its restated touchpoint with a link to the game doc's "Adding a game" (F14) and lines 6/250 are re-read for accuracy. Done: `node scripts/check-constraint-ids.mjs` exits 0; the grep in QA assertion 5 is empty; `git diff --stat src` touches only comments (no `.tsx` line without `//` or `/*` or `{/*` changes).
8. `[sonnet]` `node --test scripts/team/lib/rules.test.mjs` passes unchanged; if a fixture string in it quotes a heading that no longer exists it is still valid (fixtures are inline) — do not edit. Done: test output `pass`, 0 fail.
9. `[opus]` Spot audit, read-only, against the new doc: `PlayOffSeries.tsx` (pool), `Contexto.tsx` (in place), `WhoWouldWin.tsx` (bespoke/fill). For each, check RULE 0, 4.1, 4.6, 6.1, 6.2, 6.3, 7.3/7.4 and the deviations rows that name it; write the "Spot audit" table in the findings doc (observation + "follow-up card?" yes/no). Do not edit renderers. Done: ≥ 7 rows per renderer, or a row stating "no discrepancy" per rule group.
10. `[sonnet]` Verify: `npm run lint` (eslint + `check:games` + `check:ids`), `npm run build`. Write `.team/run/clean-up-game-design/build-report.json` (`did`, `assumed`, `touched`, `testsAdded: ["scripts/check-constraint-ids.mjs"]`). Done: both commands exit 0.
11. `[sonnet]` Commit on `team/clean-up-game-design`: `docs(game-design): rewrite GAME_DESIGN_CONSTRAINTS with stable ids, rules-at-a-glance and an id checker`; the body quotes the planted-failure line from step 5 under "check-constraint-ids fails when a reference is broken:". Done: `git log -1 --format=%B` contains `does not resolve`.

## Self-review
- Coverage: card method 1 → §7; 2 → §8 types + step 9; 3 → §2.6 + steps 1/3; 4 → §6 + step 2; 5 → §2.3 + steps 5/7; 6 → ≤ 575 + §2.6 item 7; 7 → §2.4/2.5 + steps 5/6; 8 → steps 9/10. Done-when: findings doc (steps 1/3), at-a-glance + resolved list (2/3), checker passes and fails (5/11), agent/skill refs (7), lint/build (10).
- Ambiguities decided: archival paths are excluded from the checker (dated records must keep old ids); `4.2.1` and `7a/7b` are the only id changes; shell-owned pixel specs are deleted, not shortened; backend `.py` is not scanned (no game-rule references; AUTH refs there are a follow-up).
- Scope: no renderer logic changes; no new rules beyond ids for rules the doc already stated.
