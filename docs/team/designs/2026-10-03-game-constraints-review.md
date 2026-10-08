# Findings — GAME_DESIGN_CONSTRAINTS.md fresh-eyes review

Card `3ee2cfb1` · slug `clean-up-game-design` · design `2026-10-08-clean-up-game-design.md` · 2026-10-08.
Old document: `origin/dev:docs/GAME_DESIGN_CONSTRAINTS.md` at `9f874aa` (958 lines). New: 504 lines (53 %).
Line numbers below are old-document lines.

## Fresh read — what confused a newcomer
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
- (implementation read) §7b's ScorePanel CSS block shows a wrapping row (`flex-wrap:wrap`), and RULE 7.0 sixteen lines later says it is a column.

## Findings
| # | Finding | Type | Location (old line) | Proposed action | Done |
|---|---|---|---|---|---|
| F1 | Stage padding stated as `clamp(...)` everywhere, `30px` in RULE 4.2, and `28.6` as a literal in the 4.2 test and 4.2b | contradiction | 63, 130, 352, 420, 501–503 | state the truth once (RULE 4.2): `--stage-pad` = 30 px at ≥ 820 px, `clamp(14px, 2.6vw, 30px)` below; tests read the computed padding, no literal | yes — RULE 4.2 table + snippet reads `paddingTop` |
| F2 | §5 instructs an inline-styled root (`maxWidth:560`, `gap:20`) while RULE 0 forbids a game root | contradiction | 521–530 vs 38 | delete §5's root/status-row specs; `GameFrame` owns them | yes — §5 root removed |
| F3 | RULE 4.1 and "Adding a game" require `CONTENT_STAGE_GAMES`; removed from code | stale | 316–343, 955 | rewrite the test as `<GameFrame fill>` vs `<GameFrame>`; drop the "current set" list | yes — RULE 4.1, Adding a game |
| F4 | `.exit-link.is-ended` "box kept" (§4) vs "collapsed" (4.2.1) | contradiction | 512–514 vs 365–367 | RULE 4.5 states the collapse (code: `MiniGame.css:214`) | yes — RULE 4.5 |
| F5 | 7b opening sentence == RULE 7.3 statement | duplicate | 771–772 vs 870–874 | 7b merges into RULE 7.3 | yes |
| F6 | 7.0–7.3 are `####`; `extractRules` ignores them, so briefs never quote them | missing (from briefs) | 816–870 | promote to `###` | yes — `extractRules` returns all 28 ids |
| F7 | `RULE 4.2.1` id is unparseable by the brief generator | stale (tooling) | 361 | rename to 4.5; mapping row | yes |
| F8 | Exit control has no id; code-reviewer must cite "§4 Exit button" | missing | 507–515 | RULE 4.6 | yes |
| F9 | "17 games" / "18 games" counts and "only Series Winner and Starting Five are verified" | stale | 51, 57, 664, 940 | remove counts; `ui:audit` covers every visible game | yes |
| F10 | Known open item "other 17 games not re-measured" | stale | 940–941 | drop | yes |
| F11 | `CorrectAnswer.tsx` orphan note | history-in-the-rulebook | 939 | drop from rulebook; follow-up note in findings (file still exists) | yes — see Spot audit follow-ups |
| F12 | §9 "always-visible `SessionTimer`" — no single-player game renders it (only `OnlineMatch`) | unverifiable | 905, 938 | drop the rule; keep "time never adds points" in RULE 9.1; DECISIONS entry | yes |
| F13 | §0 `useReducedMotion()` vs UI-20 `useReducedMotionSafe` | contradiction (cross-doc) | 92 | delete the line; RULE 0.1 links UI-20 (one doc owns reduced motion) | yes |
| F14 | "Adding a game" step 1 duplicates UI-2 | duplicate (cross-doc) | 947 vs UI-2 | game doc keeps the 4 touchpoints; UI-2 links to it instead of restating | yes — game doc step 1 cites UI-2; UI-2 now links to "Adding a game" instead of restating |
| F15 | Idle screen pixel table, CourtLoader keyframes, GameResult table, ScorePanel/EndSequence/Spinner CSS, choice-card spec | history-in-the-rulebook (implementation detail of shell-owned components) | 238–257, 269–280, 759–768, 784–805, 592–614 | replace with "shell-owned, do not rebuild/restyle" + owning file; constants table keeps 2000 ms, 1.5 s, 1800 ms, 260/300 ms, 22 px | yes — "Shared constants" table in §5 |
| F16 | Idle chips "5 rounds / ~1 min hardcoded" | stale | 252–254 | code reads `game.roundsLabel`; RULE 2.1 says "data-driven from the `Game` entry" | yes (the `~1 min` chip no longer renders at all) |
| F17 | RULE 1.2's example `.stage-inner:has(.s5-wrap) { max-height: none }` and the Starting Five "opts out at ≤ 620px" deviation | stale | 205–214, 921 | every content game is uncapped by `ui.css:188`; 1.2 becomes "become a content game; never clip/squash"; deviation row removed | yes — Starting Five row restated as a Rule 1.1 overflow, no opt-out selector |
| F18 | Deviation "Wordle: `GameResult` without `onPlayAgain`" — Wordle now ends in place | stale | 931 | reword: Wordle's `ScorePanel` has no Play again (daily lock) | yes (`grep onPlayAgain Wordle.tsx` is empty) |
| F19 | Deviation "Imposter lost `[data-low]`" is a changelog line | history-in-the-rulebook | 930 | remove; DECISIONS | yes |
| F20 | Deviation "narrower roots 430–520px" for 5 games — only `.gf:has(.s5-cards)` overrides width today | unverifiable | 922 | keep only rows with a selector | yes — `grep '\.gf:has(' src/styles` finds only StartingFive (width) and Contexto (`.endseq`); the 5-game row is removed, a Contexto row is added |
| F21 | Career Path deviation hides a rule ("no button waits more than 400 ms") | ambiguous | 935 | keep as deviation reason; RULE 7.4 carries "no artificial wait" | yes — kept in the Career Path reason; 7.4 states "no artificial timeout" |
| F22 | RULE 6.3 is three paragraphs plus history | duplicate (self) | 714–740 | one statement + banned-string list + the "warning before the last life is fine" clause | yes |
| F23 | RULE 6.1 says "the §7b panels are not covered" while 6.2 lists the slot as technique 1 | ambiguous | 665, 696 | 6.1 scopes itself to per-guess feedback in the statement | yes |
| F24 | Feedback copy format and 6.3's "never a distinct Out of lives" overlap | duplicate | 620–626 vs 714 | RULE 6.0 holds copy; it links 6.3 for the loss case | yes |
| F25 | Progress bar rule lacks an id and partly repeats RULE 0's `<ProgressBar>` comment | missing | 542–560 | RULE 5.0 | yes |
| F26 | Accepted deviations lack a date column and a rule column | missing | 918 | add both; dates from `git log -S` / DECISIONS, else `≤ 2026-10` | yes — rows from the October batch dated `2026-10`, older rows `≤ 2026-10` |
| F27 | Reference-implementations table calls Fan Favorites "the answers-shown exception" — it is now the rule (7.3) | stale | 11 | "in-place end reference" | yes — intro |
| F28 | Terminology: exit / leave / close; "overview"; "in-place" vs "stays in place" | ambiguous | throughout | `## Terms` block; one term each; "Close game" | yes |
| F29 | 7a/7b, `§7b` cited in 8 renderers/CSS and in `code-reviewer.md:37` | stale (after this card) | repo | update to `Rule 7.3` / `Rule 7.4`; checker rejects retired forms | yes — renderer/CSS comments, `code-reviewer.md`, MiniGame.tsx note updated; `check-constraint-ids` rejects retired forms |
| F30 | `design-round` skill does not cite any GAME_DESIGN section (card expects a pointer to fix) | — | `.claude/skills/design-round/SKILL.md` | nothing to change; note in findings | yes — noted, no change |
| F31 | §7b ScorePanel CSS shows `flex-wrap:wrap` row; RULE 7.0 and `ui.css:217` say column | contradiction | 799–805 vs 818–828 | drop the CSS block; RULE 7.0 is the only statement | yes |
| F32 | §7b says ScorePanel buttons use "the same treatment as 7a" (`btn-md`, 46 px); `ScorePanel.tsx` renders `size="sm"` | stale | 811–813 | component is the spec; no button size in the rulebook | yes |
| F33 | `ui:audit` measures `playAreaFitsViewport` but never fails on it, so Rule 1.1 was presented as automated | unverifiable | 147–163 | glance table says "reported" + QA, not a failing assertion | yes — enforcement column; follow-up below |
| F34 | Design §2.2 says "29 numbered rules" but its own table lists 28 ids (19 old − `4.2.1` + `4.5` + 9 new) | ambiguous (design) | design §1, §2.2, §5 | keep the 28 ids of the table; no rule invented to reach 29 | yes — QA assertions 1 and 4 should read 28 |
| F35 | Old "Adding a game" lists the renderer props as `{ gameInfo, onGameEnd, onPlayAgain }`; in-place games also need `onClose` | stale | 951–952 | add `onClose` | yes |

## Old → new id mapping
| Old reference | New | Action |
|---|---|---|
| `RULE 4.2.1` | `RULE 4.5` | rename (unparseable 3-part id; zero references outside the doc) |
| `7a`, `§7a`, `Rule 7a` | `Rule 7.4` | section retired into a rule |
| `7b`, `§7b`, `Rule 7b` | `Rule 7.3` | section retired into a rule |
| `### RULE 4.2 acceptance test` | body of `RULE 4.2` | heading removed (it was never a rule) |
| `### RULE 6.1/6.2 acceptance test` | bodies of `6.1` / `6.2` | same |
| every other id | unchanged | — |

New ids for rules the old document stated without one: `0.1` (§0 tokens), `2.1` (§2 idle), `3.1` (§3 loading),
`4.6` (§4 Exit button), `5.0` (§5 progress bar), `6.0` (§6 copy format), `7.4` (§7a), `8.1` (§8), `9.1` (§9).

## Section mapping
One row per `##`/`###`/`####` heading of the old document (39).

| Old heading (line) | Fate | Why |
|---|---|---|
| RULE 0 (17) | kept as RULE 0 | gap/width history and "11 of 18" moved to DECISIONS; verification paragraph and the three viewports moved to the intro; the `fill` caveat moved to RULE 4.1 |
| 0. Design tokens (68) | kept as RULE 0.1 + token table | table compressed by pairing related tokens; reduced-motion line removed (F13, UI-20 owns it) |
| 1. The shell (96) | kept, compressed | DOM chain kept (8 lines); `.stage-shell`/`.stage-dots`/`.stage-inner` CSS removed — `ui.css` owns it; phase-transition values removed (shell-owned, `Stage.tsx`); "never add padding" kept |
| RULE 1.1 (147) | kept as RULE 1.1 | snippet reduced to the one assertion that matters; aside clause kept |
| RULE 1.0 (165) | kept as RULE 1.0 | NBA Grid offset-0 incident → DECISIONS; `safe center` note folded into the shell chain; content-game uncap moved to RULE 1.2 / 4.2b |
| RULE 1.2 (197) | kept, rewritten | the `.s5-wrap` opt-out example is stale (F17): every content game is already uncapped |
| 2. Idle screen (218) | merged into RULE 2.1 | pixel table removed (shell-owned, F15); hardcoded-chips note replaced by `roundsLabel` (F16); lobby note kept |
| 3. Loading (261) | merged into RULE 3.1 | CourtLoader keyframe internals removed (shell-owned, F15); 2000 ms hold kept (also in constants table) |
| 4. Playing shell (286) | removed | the `.playing-wrap` CSS block is `MiniGame.css`'s; the 12/28 px gaps survive in RULE 4.1/4.2 |
| RULE 4.1 (309) | kept, rewritten | `CONTENT_STAGE_GAMES` is gone (F3); the test is now `fill` vs no `fill`; Starting Five/Wordle incident → DECISIONS |
| RULE 4.2 (345) | kept | padding stated once (F1); acceptance test folded in |
| RULE 4.2.1 (361) | renamed RULE 4.5 | unparseable id (F7); collapse of `.is-ended` stated per code (F4) |
| RULE 4.2a (371) | kept | CSS and "affected games" list removed (shell-owned; rule is now general) |
| RULE 4.2b (395) | kept | Guess MVP 82 px vs 28.6 incident → DECISIONS; `28.6` literal removed (F1) |
| RULE 4.3 (423) | kept | Starting Five 427 px incident → DECISIONS; two ❌/✅ pairs compressed into one block; odd-cell and auto-fit-exception clauses kept |
| RULE 4.4 (470) | kept | example shortened; acceptance test kept as the Check line with a generic selector |
| RULE 4.2 acceptance test (491) | merged into RULE 4.2 | it was never a rule heading; `28.6` literals replaced by `--stage-pad` |
| Exit button (507) | merged into RULE 4.6 | styling removed (shell-owned); `.is-ended` "box kept" contradiction resolved by RULE 4.5 (F4) |
| 5. Game root layout (519) | removed | contradicted RULE 0 (F2); `GameFrame` owns root and status row |
| Progress bar — position is fixed (542) | merged into RULE 5.0 | `.progress` CSS removed (component-owned); "second slot or omitted" kept |
| RULE 5.1 (562) | kept | element table kept; reveal-states sentence dropped (it changed nothing) |
| Round body spec (581) | removed | Series Winner's own markup, not a rule other games follow (F15); 1800 ms dwell → constants table |
| 6. Feedback (618) | merged into RULE 6.0 | copy list kept; popup styling removed (component-owned) |
| RULE 6.1 (631) | kept | Series Winner's original in-flow row → DECISIONS; "all 17 games" removed (F9); scope narrowed to per-guess feedback (F23) |
| RULE 6.1 acceptance test (667) | merged into RULE 6.1 | Check line |
| RULE 6.2 (675) | kept | techniques list and ❌/✅ kept |
| RULE 6.2 acceptance test (704) | merged into RULE 6.2 | Check snippet |
| RULE 6.3 (714) | kept, compressed | three paragraphs into one (F22); 2026-10-07 sweep history → DECISIONS |
| 7. End of game (744) | kept as section header | one sentence: a game ends once through `onGameEnd`, Rule 7.3 picks the path |
| 7a. Standard path (746) | merged into RULE 7.4 | "no Calculating beat / background award" kept; GameResult table and confetti removed (shell-owned, F15) |
| 7b. The exception (770) | merged into RULE 7.3 | duplicate of 7.3's statement (F5); EndSequence phases kept as one sentence; Spinner/EndSequence/ScorePanel CSS removed (F15, F31, F32) |
| RULE 7.0 (816) | kept, promoted to `###` | F6 |
| RULE 7.1 (832) | kept, promoted to `###` | F6; CSS example dropped (the colour rule is in the statement) |
| RULE 7.2 (852) | kept, promoted to `###` | F6; Starting Five 480 ms incident → DECISIONS |
| RULE 7.3 (870) | kept, promoted to `###` | F6; absorbs 7b and the allowlist / online-duel exemption |
| 8. Reusable components (894) | merged into RULE 8.1 | list kept, `GameFrame` and `SwapText` added (they were the most-cited omissions) |
| 9. Scoring (903) | merged into RULE 9.1 | SessionTimer rule dropped (F12, DECISIONS); points arithmetic and "time never adds points" kept |
| Accepted deviations (913) | kept, pruned and dated | F17–F20, F26; Rule column added |
| Adding a game (945) | kept | step 5 rewritten (F3); step 1 cites UI-2 (F14); `onClose` added (F35); "Known open items" (937–941, not a heading) removed (F10–F12) |

## Resolved contradictions
1. **F1** — stage padding: one statement in RULE 4.2 (`--stage-pad`, 30 px ≥ 820 px, clamp below); no literal anywhere.
2. **F2** — RULE 0 vs §5's inline root: §5's root spec deleted; `GameFrame` is the only root.
3. **F4** — `.is-ended` "box kept" vs "collapsed": RULE 4.5 states the collapse, matching `MiniGame.css`.
4. **F5** — 7b vs RULE 7.3: one rule, 7.3.
5. **F13** — `useReducedMotion()` vs UI-20: the line is gone; RULE 0.1 defers to UI-20.
6. **F23** — RULE 6.1's "§7b not covered" vs 6.2 technique 1: 6.1 is scoped to per-guess feedback.
7. **F31** — §7b's wrapping ScorePanel row vs RULE 7.0's column: only RULE 7.0 remains.
8. **F17** — RULE 1.2's opt-out example vs the `ui.css` uncap of every content game: 1.2 now describes what the code does.
9. **F18** — Wordle deviation said `GameResult`, while RULE 7.3 and the code end Wordle in place: row reworded to `ScorePanel`.

## Spot audit
Read-only, against the new document. No renderer was edited.

| Renderer | Rule | Observation | Follow-up card? |
|---|---|---|---|
| PlayOffSeries.tsx (pool) | 0 | root is `<GameFrame>` in the playing state | no |
| PlayOffSeries.tsx | 4.1 | content game (no `fill`), fixed board — correct | no |
| PlayOffSeries.tsx | 4.2a | `GameFrame.Action` given `null`, renders no node | no |
| PlayOffSeries.tsx | 4.6 | no own leave control | no |
| PlayOffSeries.tsx | 5.0 / 5.1 | `ProgressBar` second child; cells keyed by position (`key={i}`), names via `SwapText` | no |
| PlayOffSeries.tsx | 6.1 / 6.2 | `SubmitGuessPopup` after `Action`; wins line reserved (the RULE 6.2 example comes from this file) — not measured this card | no |
| PlayOffSeries.tsx | 6.3 | no lives; no banned strings | no |
| PlayOffSeries.tsx | 7.3 / 7.4 | `onGameEnd(score)` standard path after the 1800 ms dwell, allowlisted (`series-winner`) with a reason; no extra wait | no |
| Contexto.tsx (in place) | 0 / 3.1 | while names load or the round is unplayable the root is `<div className="cx-center">` with a `Spinner`, not `<GameFrame>` | **yes** — wrap the waiting/empty state in `<GameFrame>` |
| Contexto.tsx | 4.1 | `Contexto.css` header says "This is a FILL game … the root is `<GameFrame fill>`" and `.cx-list` scrolls internally, but `Contexto.tsx:250` renders `<GameFrame>` without `fill` | **yes** — add `fill` or correct the CSS comment, then re-run `ui:audit` |
| Contexto.tsx | 4.6 | no own leave control; `Give up` is an in-game action, not a leave control | no |
| Contexto.tsx | 6.0 / 6.1 | popup via `SubmitGuessPopup`; copy `It was …` (bad), `Already guessed` (muted) | no |
| Contexto.tsx | 6.3 | no lives; no banned strings | no |
| Contexto.tsx | 7.1 | `ScorePanel label={won ? "Found it!" : "Gave up"}` — a label on a loss, which Rule 7.1 forbids | **yes** — drop the loss label (or add a deviation row if the owner wants it) |
| Contexto.tsx | 7.3 | `onGameEnd(finalScore, { inPlace: true })`, 1500 ms loader beat, `EndSequence` → `ScorePanel` | no |
| Contexto.tsx | deviations | no progress bar, no `ROUND`, copy not `Correct! +N`, `.endseq` min-height — all have rows | no |
| Contexto.tsx | UI-20 (cross-doc) | imports framer's `useReducedMotion` directly instead of `useReducedMotionSafe` | **yes** — UI-20 follow-up |
| WhoWouldWin.tsx (bespoke / fill) | 0 | `<GameFrame>` in every state, including "No matchups available" | no |
| WhoWouldWin.tsx | 4.1 | `<GameFrame fill>`, `.www-arena` scroller — covered by its deviation row | no |
| WhoWouldWin.tsx | 4.6 | no own leave control (`Skip` / `Next matchup` are game actions) | no |
| WhoWouldWin.tsx | 5.0 | `ProgressBar` second child in play and in the summary | no |
| WhoWouldWin.tsx | 6.1 | no popup — covered by its deviation row | no |
| WhoWouldWin.tsx | 6.2 | action row only toggles `disabled`; "Counting votes…" spinner swaps inside an existing span — not measured | no (QA could measure) |
| WhoWouldWin.tsx | 6.3 | no lives; no banned strings | no |
| WhoWouldWin.tsx | 7.1 / 7.3 | ends in place, `ScorePanel` with no label and no count — matches its deviation row | no |
| WhoWouldWin.tsx | 0.1 | `#fff` on `.www-summary-row.is-agreed` brand fill — covered by the white-on-fill row | no |
| WhoWouldWin.tsx | UI-20 (cross-doc) | imports framer's `useReducedMotion` directly | **yes** — same UI-20 follow-up as Contexto |

Other follow-ups found during the rewrite:
- `scripts/ui-audit.mjs` measures `playAreaFitsViewport` but never fails on it (F33) — make it a mobile-only failure, or accept that Rule 1.1 is QA-enforced.
- `src/components/CorrectAnswer.tsx` is still orphaned (F11) — delete it in a cleanup card after a CODE_MAP check.

## Irreducible parts
Not needed: the new document is 504 lines (target ≤ 575).
