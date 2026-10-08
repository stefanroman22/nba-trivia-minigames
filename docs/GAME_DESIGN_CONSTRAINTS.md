# Game Design Constraints

Every game renderer (`src/Game Renderers/*.tsx`) fits into one shared shell: idle screen, loading,
playing frame, feedback, end of game. The shell and the shared components own the layout; a game
owns only its board. Reference renderers: `PlayOffSeries.tsx` (Guess the Series Winner — standard
path) and `FanFavorites.tsx` (in-place end with a progressive reveal).

Verify layout with the harness, not by reading code: `npm run dev`, then `npm run ui:audit` (every
visible game, at 1100×900, 854×694 and 390×844, one screenshot each). Never call a game compliant
without a rendered screenshot. History and rationale for these rules live in `docs/team/DECISIONS.md`.

## Rules at a glance

| ID | Rule | Enforced by |
|---|---|---|
| 0 | Your root MUST be `<GameFrame>`; a game MUST NOT set its own root width, gap, margin or padding | `ui:audit` (`usesGameFrame`, root gap 20 px) |
| 0.1 | Colours MUST come from `theme.css` tokens, with one accent; every number MUST carry `.tnum` | review |
| 1.0 | Children MUST size against `--stage-avail`, never `--stage-max` | review (`grep stage-max src/styles`) |
| 1.1 | The play area MUST fit 390×844 with no in-game scroll | `ui:audit` mobile (`playAreaFitsViewport`, reported) + QA |
| 1.2 | A game that cannot fit MUST let the shell grow (content game, page scrolls) — never clip, never squash — and MUST have a deviations entry | `ui:audit` (`shellContainsGame`) + review |
| 2.1 | The idle screen is shell-owned; a game MUST NOT build its own | review |
| 3.1 | Loading is shell-owned (`CourtLoader`, 2000 ms hold); a game MUST NOT add a full-stage loader | review |
| 4.1 | Every game MUST be classified: a board that scrolls internally → `<GameFrame fill>`; anything else → `<GameFrame>` | `ui:audit` (`gameToExit` per family) |
| 4.2 | The three shell distances MUST be identical in every game | `ui:audit` (`shellTop`, `gameToExit`, `exitToBottom`) |
| 4.2a | An empty slot MUST be omitted, never rendered | `ui:audit` (lone-slot alignment) |
| 4.2b | A content game MUST NOT be given a height floor | `ui:audit` (`shellTop`) |
| 4.3 | Column counts MUST be explicit per breakpoint; media MUST keep its aspect ratio | review |
| 4.4 | Labels above repeated cells MUST reserve their maximum line count | manual DevTools check |
| 4.5 | Space above the first and below the last component MUST equal `--stage-pad` in every state | `ui:audit` (playing) + manual (idle, loading, ended) |
| 4.6 | One leave control per screen, labelled `Close game`; a game MUST NOT render its own | review |
| 5.0 | A progress bar MUST be the shared `<ProgressBar>` in the frame's second slot, or omitted | review |
| 5.1 | Between rounds only the content that changed MUST animate | motion-reviewer |
| 6.0 | Feedback copy MUST be `Correct! +N`, a statement of the truth, or neutral, in the fixed colours | review |
| 6.1 | Per-guess feedback MUST be `<SubmitGuessPopup>` in the shell's `.feedback-slot` | manual DevTools check |
| 6.2 | Transient content MUST NOT resize the container | manual ResizeObserver check / QA |
| 6.3 | Running out of lives MUST NOT be announced anywhere | review (`grep` the banned strings) |
| 7.0 | The score line MUST sit above Play again / Close game | review |
| 7.1 | The result MUST NOT restate a count the board already shows | review |
| 7.2 | A reveal MUST NOT re-animate what the player already earned | review |
| 7.3 | A game that reveals something at the end MUST end in place (`{ inPlace: true }`, `EndSequence`, `ScorePanel`) | `scripts/check-game-results.mjs` (`npm run lint`) |
| 7.4 | A full-screen result MUST appear at once — no "Calculating" beat, no loader, no timeout | review |
| 8.1 | Shared components MUST be reused, never re-implemented | review + `docs/team/CODE_MAP.md` |
| 9.1 | `pointsPerCorrect × rounds` MUST equal `maxPoints`; time MUST NOT add points | review |

"Review" means the code reviewer checks it by reading; "manual" means a DevTools snippet given in the
rule. Neither is automated — treat them as the rules most likely to regress.

## Terms

| Term | Meaning |
|---|---|
| **shell** | Everything `MiniGame.tsx` + `Stage.tsx` render around your root: title row, `.stage-shell`, `.stage-inner`, `.playing-wrap`, `.feedback-slot`, the `Close game` link. |
| **content game** | `<GameFrame>` without `fill`. It hugs its content; the shell sizes to it. |
| **fill game** | `<GameFrame fill>`. Its board takes the remaining height and scrolls internally. |
| **slot** | One of `GameFrame`'s fixed children: `Status`, `ProgressBar`, `Prompt`, `Board`, `Action`. |
| **transient content** | Anything that appears and then goes away: feedback, reveal label, hint, badge, spinner, error. |
| **standard path** | The game calls `onGameEnd(score)`; the shell swaps in the full-screen `GameResult`. |
| **in place** | The game calls `onGameEnd(score, { inPlace: true })`; the game UI stays and `EndSequence` → `ScorePanel` shows the points under it. |
| **Close game** | The one control that leaves a game. Never "Exit", "Leave" or "Quit" in UI copy. |

---

## 0. Root and tokens

### RULE 0 — Your root is `<GameFrame>`. This rule outranks every other rule here.
Your renderer's root is `<GameFrame>` (`src/components/ui/GameFrame.tsx`) in every state the game
renders, including its own empty/error states. Never declare a root class, `max-width`, `gap`,
`margin` or `padding` at the top level, and never hand-roll a status row. `Board` is the only
free-form region. `GameFrame.Action` returns `null` when empty.

```tsx
<GameFrame>                                   {/* owns width, max-width, 20px gap */}
  <GameFrame.Status left={<GameFrame.Label>ROUND 1/5</GameFrame.Label>} right={<GameFrame.Score value={score} />} />
  <ProgressBar value={…} max={…} />           {/* optional — Rule 5.0 */}
  <GameFrame.Prompt eyebrow="First Round · 1978-79" title="Who won the series?" />
  <GameFrame.Board>{/* the ONLY free-form region */}</GameFrame.Board>
  <GameFrame.Action>{/* input row, EndSequence, buttons */}</GameFrame.Action>
  <SubmitGuessPopup … />                      {/* Rule 6.1 */}
</GameFrame>
```

**Why:** prose layout specs let each game re-implement the root, and they drifted. A component cannot.
**Check:** `npm run ui:audit` fails on a root that is not `.gf` or whose gap is not 20 px. If you are
writing `.xx-wrap`, stop. A width override needs a selector on `.gf:has(…)` and a deviations row.

### RULE 0.1 — Colours come from tokens; one accent; `.tnum` on every number
Use the `src/styles/theme.css` tokens below; never hardcode a hex that has one, and never add a second
accent colour. `Russo One` (`.font-display` / `.disp`) is for headings, game, team and player names and
the VS label; `Chakra Petch` is the body font (`.font-accent` forces it). Every number, score, timer,
count and rank carries `.tnum`. Reduced motion is owned by UI-20 in `UI_SHELL_CONSTRAINTS.md`.

| Token | Value | Use |
|---|---|---|
| `--bg` / `--bg2` | `#101010` / `#161616` | page background |
| `--surface` / `--surface2` / `--surface3` | `#1c1c1e` / `#232327` / `#2b2b30` | cards and stage / choice buttons, inputs / progress track, inert fills |
| `--line` / `--line2` | `rgba(255,255,255,.09)` / `rgba(255,255,255,.17)` | hairlines / stronger borders |
| `--text` / `--muted` | `#f5f3ef` / `#9c9a95` | body / secondary text |
| `--brand` | `#ff6a1a` | the **only** accent |
| `--brand2` / `--brand-deep` / `--brand-soft` | `#ff8a3d` / `#c2510a` / `rgba(255,106,26,.14)` | gradient partners / tinted fills |
| `--good` / `--good-soft` | `#2fc762` / `rgba(47,199,98,.16)` | correct |
| `--bad` / `--bad-soft` | `#ff4d4d` / `rgba(255,77,77,.16)` | wrong |
| `--shadow` / `--radius` / `--ease-out` | `0 22px 60px -18px rgba(0,0,0,.65)` / `14px` / `cubic-bezier(.22,1,.36,1)` | elevation / corner / house easing |

**Why:** one palette and tabular digits are what make every game read as one app.
**Check:** `grep -nE '#[0-9a-fA-F]{3,6}\b' src/styles/<Game>.css` — every hit is either a token-less
value with a deviations row (white on brand fills) or a bug.

---

## 1. The shell

`MiniGame.tsx` + `Stage.tsx` own this chain; a renderer supplies only the node marked *your root*.
Styles live in `src/styles/ui.css` (`.stage-*`) and `src/styles/MiniGame.css` (`.playing-wrap`,
`.exit-link`, `.feedback-slot`). Never add your own outer padding; `.stage-inner`'s `--stage-pad` is
the only one.

```
section.stage-col
├── div.stage-title          h1 game name · info button · tag chip
└── div.stage-shell          border, radius 16px, overflow visible (dropdowns escape)
      ├── div.stage-dots     decorative
      └── div.stage-inner    padding: var(--stage-pad); align-items: safe center
            └── motion.div   Stage phase cross-fade (0.25 s)
                  └── .idle | CourtLoader | .playing-wrap › your root + .feedback-slot + .exit-link | GameResult
```

### RULE 1.0 — Size children against `--stage-avail`, never `--stage-max`
`.stage-inner` exposes `--stage-max` (its own border-box cap, `calc(100dvh - 188px)`, `216px` below
820 px) and `--stage-avail` (`--stage-max` minus twice `--stage-pad` — what a child may occupy).

```css
❌ .playing-wrap { height: min(var(--stage-max, 620px), 600px); }   /* eats the padding, sits on the border */
✅ .playing-wrap { height: min(var(--stage-avail, 620px), 600px); }
```

**Why:** a child sized to `--stage-max` consumes the padding it should sit inside.
**Check:** `grep -n 'stage-max' src/styles/*.css` — only `ui.css` may set it (a mention in a comment is fine).

### RULE 1.1 — The play area must fit one 390×844 viewport
At 390×844, the `Close game` link's bottom edge is at or above the viewport bottom, with no scrolling
inside the game. The multiplayer aside below the stage may scroll the page; it is not the play area.

**Why:** a player must never scroll to reach the board's controls mid-round.
**Check:** at 390×844, mid-game: `document.querySelector('.exit-link').getBoundingClientRect().bottom <= innerHeight`
(also reported by `ui:audit` mobile as `playAreaFitsViewport`).

### RULE 1.2 — If it genuinely cannot fit, grow the stage; never clip and never squash
When Rule 1.1 cannot hold without breaking Rule 4.3 (squashed media), the game is a content game: the
stage has no height cap for content games (`ui.css`: `.stage-inner:has(.gf:not(.gf--fill))`), so the
shell grows and the page scrolls. Never leave content clipped by `max-height` or rendered outside the
shell border, and never shrink media to fit. Record the overflow in Accepted deviations.

**Why:** a page scroll is a small cost; content outside the shell border or a squashed photo is broken.
**Check:** `exit.bottom <= shell.bottom` (`ui:audit` `shellContainsGame`) at every viewport.

---

## 2. Idle

### RULE 2.1 — The idle screen is shell-owned
`MiniGame.tsx` renders the idle screen from the `Game` entry in `src/utils/GameUtils.tsx`: thumbnail
(`backgroundImage`), `name`, `description`, a rounds chip (`roundsLabel`, default `5 rounds`), an
`up to {maxPoints} pts` chip, and the Play button. In a friend room the Play button is replaced by the
room note. A game whose format differs changes its `Game` entry (e.g. `roundsLabel: "10 matchups"`),
never the idle markup.

**Why:** the idle screen is the same promise for every game; a fork drifts.
**Check:** the renderer has no idle state of its own; `git diff src/views/Trivia/MiniGame.tsx` is empty
for a new game.

## 3. Loading

### RULE 3.1 — Loading is shell-owned
Pressing Play shows `<CourtLoader label="Warming up the court…" />` (scale 1) and holds it for
**2000 ms** (`handleStart()` in `MiniGame.tsx`) so it never flashes. A game never adds its own
full-stage loader. For a small inline wait (pending vote, end-of-game score) use `Spinner`.

**Why:** one loading moment for every game.
**Check:** no `CourtLoader` import in `src/Game Renderers/`; a renderer's waiting state is a
`<GameFrame>` with an inline `Spinner`, not a bare `<div>` root (Rule 0).

---

## 4. Playing shell

### RULE 4.1 — Every game MUST be classified, and the classification is mechanical
Ask: **does the board contain a `flex:1` region that scrolls internally (`overflow-y:auto`)?**
- **Yes → fill game:** `<GameFrame fill>`. Game → `Close game` gap is **12 px**.
- **No → content game:** `<GameFrame>`. It hugs its content. Game → `Close game` gap is **28 px**.

There is no third option and no id list: `MiniGame.css` reads the prop through
`.playing-wrap:has(> .gf:not(.gf--fill))`. Never use `fill` on a fixed-size board — `flex:1` strands
it in dead space with `Close game` pushed to the bottom.

**Why:** the wrong mode produces either dead space above `Close game` or a board that overflows.
**Check:** `ui:audit` fails when `gameToExit` does not match the declared family.

### RULE 4.2 — The three shell distances are identical in every game
| Distance | Value | Owned by |
|---|---|---|
| Stage top → first component | `--stage-pad` | `.stage-inner` padding |
| Game bottom → `Close game` | 28 px (content) / 12 px (fill) | `.playing-wrap` gap (`--pw-gap`) |
| `Close game` (or last component) → stage bottom | `--stage-pad` | `.stage-inner` padding |

`--stage-pad` is **30 px** at ≥ 820 px wide and `clamp(14px, 2.6vw, 30px)` below (`ui.css`). It is
the same in every game whether or not it has a progress bar or a status row. A different top offset
is a classification bug (Rule 4.1), never a reason to add margin or padding.

**Why:** these three numbers are what make games look like one product.
**Check:** `ui:audit`, or in DevTools while playing (each value against `--stage-pad`, never a literal):

```js
const r = el => el.getBoundingClientRect(), inner = document.querySelector('.stage-inner');
const game = document.querySelector('.playing-wrap').firstElementChild, exit = document.querySelector('.exit-link');
({ pad: getComputedStyle(inner).paddingTop, top: r(game).top - r(inner).top,
   toExit: r(exit).top - r(game).bottom, bottom: r(inner).bottom - r(exit).bottom });
```

### RULE 4.2a — Never render an empty slot; omit it
A slot with no content contributes no node. `GameFrame.Status` omits an empty side: a lone label
centres, a lone score stays flush right. Never pass `""`, `<span />` or `&nbsp;` to fix alignment.

**Why:** an empty node still takes a flex position and a gap, so alignment lands half a gap off.
**Check:** `ui:audit` fails a lone left slot more than 1.5 px off centre or a lone right slot not flush.

### RULE 4.2b — A content game must never be given a height floor
Nothing above a content game may impose a `min-height`; `ui.css` removes the stage floor for content
games (`.stage-inner:has(.gf:not(.gf--fill)) { min-height: 0 }`). The floor stays for idle, loading
and fill games. A content game's shell height is output, not input — two content games of different
size SHOULD have different shell heights; only the padding around them must match.

**Why:** a floor makes short games float, with a bigger top and bottom offset than every other game.
**Check:** `ui:audit` (`shellTop` and `exitToBottom` equal `--stage-pad`).

### RULE 4.3 — Column counts are chosen per breakpoint, never left to `auto-fit`
Set the column count explicitly at each breakpoint; `auto-fit`/`minmax()` reflows unpredictably on
phones. Prefer legible cells to one row (two per row at 390 px beats five unreadable ones). Centre an
odd cell left alone on the last row. Media (photo, artwork) **always keeps its aspect ratio** — buy
height back from controls, headers and labels; if it still cannot fit, apply Rule 1.2. `auto-fit` is
allowed only for genuinely open-ended lists (a results feed, a guess list).

```css
❌ .s5-cards { grid-template-columns: repeat(auto-fit, minmax(120px, 1fr)); }
✅ .s5-cards { grid-template-columns: repeat(5, minmax(0, 1fr)); }
   @media (max-width: 620px) { .s5-cards { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
❌ @media (max-width: 620px) { .s5-card-stage { aspect-ratio: auto; height: clamp(58px, 8dvh, 116px); } }
```

**Why:** silent reflow multiplies square rows and blows the viewport budget.
**Check:** `grep -n 'auto-fit' src/styles/<Game>.css`; resize through 390 / 620 / 1100 px.

### RULE 4.4 — Reserve label height across repeated cells
A label above a row of repeated cells reserves its maximum line count (`min-height: 2.4em` for two
lines), so one short label does not shift its column.

**Why:** "Center" (one line) next to "Point Guard" (two) knocks that column 11 px out of line.
**Check:** `new Set([...document.querySelectorAll('<cell body>')].map(c => c.getBoundingClientRect().top.toFixed(1))).size === 1`

### RULE 4.5 — Top space equals bottom space equals `--stage-pad`, in every state
Idle, loading, playing and ended (in place or full-screen result): the space above the first
component and below the last is the stage padding. Never compensate with margin or padding on a
root, and never leave an invisible element holding space under the last component. When a game ends
in place the shell adds `.is-ended` to `.exit-link`, which hides **and collapses** it (height and its
flex gap, `MiniGame.css`), because the `ScorePanel` buttons are then the last component.

**Why:** the padding must not change when the phase changes.
**Check:** measure first-child top and last-child bottom against `.stage-inner` in each state.

### RULE 4.6 — One leave control per screen, labelled `Close game`
While playing, the only leave control is the shell's `.exit-link` (`Close game`). On a result it is
the end panel's `Close game` button (`GameResult` or `ScorePanel`); the shell link is then hidden
(Rule 4.5). A game never renders its own leave control and never labels one anything else.
Exception: the multiplayer `OnlineMatch` leave-match control.

**Why:** two leave controls, or three names for one, make the player hesitate.
**Check:** `grep -nE 'Exit|Leave|Quit' "src/Game Renderers/<Game>.tsx"` finds no button copy.

---

## 5. Rounds

### RULE 5.0 — Progress bar: the shared component, in the second slot, or nothing
If a game has linear progression, it renders the shared `<ProgressBar value max />` as the second
child of `<GameFrame>`, right under `Status`. Never move it, restyle its track or fill, or substitute a
custom bar. A game with no linear progression (open boards, daily puzzles, lives-as-progress) omits
it and gets a deviations row.

**Why:** the bar's position is the same distance from the top in every game.
**Check:** `grep -n 'ProgressBar' "src/Game Renderers/<Game>.tsx"` — one import from `components/ui`.

### RULE 5.1 — Between rounds, only the content that changed animates. **HARD RULE.**
The round body mounts once and is never re-keyed per round — no `<AnimatePresence key={round}>` or
`key={currentIndex}` around a group.

| Element | When the round changes |
|---|---|
| Constant (question, `VS`, labels, the cards and buttons themselves, the input row) | Nothing. Stays mounted. |
| Changing text (eyebrow, names, `ROUND 4/5`) | `<SwapText>` (UI-21); it animates only when the text differs. |
| Changing media (crest, logo, headshot) | Swap only the media inside its fixed box: `<SwapText swapKey={id}>` with opacity-only variants. |

Key the swap by content identity (team, player id), never by round index; key repeated cells by
position (`key={i}`). Reference: `PlayOffSeries.tsx`.

**Why:** a whole-card fade every round reads as a reload and hides what actually changed.
**Check:** play two rounds that share an eyebrow; only names and crests may change, nothing blinks.

### Shared constants
| Constant | Value | Where it comes from |
|---|---|---|
| Loading hold | 2000 ms | `MiniGame.tsx` (Rule 3.1) |
| Reveal dwell (lock → next round) | 1800 ms | game timer; `PlayOffSeries.tsx` |
| In-place loader beat | 1.5 s | game timer (Rule 7.3) |
| End-of-game stagger | 260 ms per item, ~300 ms lead-in | game timer (Rule 7.2) |
| Feedback slot | `bottom: 22px`, absolute, `pointer-events: none` | `MiniGame.css` (Rule 6.1) |

---

## 6. Feedback

### RULE 6.0 — Feedback copy and colour are fixed
- Correct → `` `Correct! +${pointsPerCorrect}` `` in `var(--good)`.
- Wrong → a short statement of the truth in `var(--bad)` (`It was the ${winner}`, `Not on the board`).
  Never a bare "Wrong".
- Neutral / no-op → `var(--muted)` (`Already tried`).
- The guess that empties the last life follows Rule 6.3.

`SubmitGuessPopup` owns the type and motion; never restyle it.

**Why:** the same outcome reads the same in every game, and a wrong answer teaches the right one.
**Check:** `grep -n 'SubmitGuessPopup\|setPopUpInfo\|flashPopup' "src/Game Renderers/<Game>.tsx"` and read the strings.

### RULE 6.1 — Feedback is an overlay in the shell slot. There is exactly one placement.
Per-guess feedback is `<SubmitGuessPopup show text color />`, a direct child of `<GameFrame>` after
`<GameFrame.Action>`. It portals into the shell's `.feedback-slot` (absolute, `bottom: 22px`,
`pointer-events: none`) in the empty gap above `Close game`, so it has zero layout footprint. Never
build a per-game popup and never reserve an in-flow row for the message. End-of-game panels are
covered by Rule 7.3, not this rule.

**Why:** an in-flow message row grows the card and puts the message somewhere different in each game.
**Check:** with a message showing, `document.querySelector('.feedback-slot').children.length === 1`,
and the root's height is the same before answering, after a correct and after a wrong answer.

### RULE 6.2 — Transient content must never resize the container. **HARD RULE.**
The container changes size only when a permanent component mounts or unmounts (a real phase change).
Transient content reserves its space up front and costs zero pixels. Techniques, in order:
1. portal into `.feedback-slot` (Rule 6.1);
2. keep the node mounted and swap its content, reserving the line with a non-breaking space;
3. `min-height` / `min-width` sized to the longest state;
4. `position: absolute` inside a parent that already reserves the space.

Never conditionally mount an in-flow node, toggle `display: none`, or change line count between states.

```tsx
❌ {showWinner && <span>{t.wins} wins</span>}
✅ <span aria-hidden={!showWinner}>{showWinner ? `${t.wins} wins` : " "}</span>
```

**Why:** the board jumps under the player's cursor mid-interaction.
**Check:** zero height variance across a round with one correct and one wrong answer:

```js
const gf = document.querySelector('.gf'), seen = new Set([gf.getBoundingClientRect().height.toFixed(2)]);
new ResizeObserver(() => seen.add(gf.getBoundingClientRect().height.toFixed(2))).observe(gf);
// …play a round… then: seen.size === 1
```

### RULE 6.3 — Lives running out is never announced, anywhere. **HARD RULE.**
No surface announces the loss: not `SubmitGuessPopup`, not the `ScorePanel`/`ScoreLine` label, not a
status banner. Banned strings: "Out of guesses", "Out of lives", "Out of hearts", "Game over",
"Run over". A loss ends with the plain points line (no label) and the reveal. On the life-ending guess,
either reuse the ordinary wrong-guess copy (Rule 6.0) or skip the popup. A warning before the last
life is spent (Pack 5's `Missed.`) is ordinary feedback and is allowed.

**Why:** the lives indicator and the reveal already say it; a third message is noise.
**Check:** `grep -rniE 'out of (guesses|lives|hearts)|game over|run over' "src/Game Renderers"` finds no user-facing string (hits inside code comments are fine).

---

## 7. End of game

A game ends exactly once, through `onGameEnd`. Which path it takes is decided by Rule 7.3.

### RULE 7.4 — A full-screen result appears at once
Standard path: `onGameEnd(finalScore)` with no options; the shell swaps in `GameResult`
(`src/components/ui/GameResult.tsx` — shell-owned, never restyle). Nothing sits between the last
round and the result except the `Stage` cross-fade: no "Calculating…" beat, no loader, no artificial
timeout. Points are logged and awarded in the background (`awardPoints` in `MiniGame.tsx`); a slow or
failed request never delays or breaks the screen.

**Why:** the score is known the instant the game ends; any wait is fake.
**Check:** no `setTimeout` between the final answer's dwell and `onGameEnd`; the result shows with the
network throttled.

### RULE 7.3 — A game that reveals something at the end MUST end in place. **HARD RULE.**
If the end reveals an answer, solution or final board, there is no screen change: call
`onGameEnd(finalScore, { inPlace: true })` and drive `<EndSequence phase input score />` through
`input` (the live action row) → `loader` (`<Spinner label="Calculating score…" />`, 1.5 s, while the
answers reveal — Rule 7.2) → `score` (`<ScorePanel>` with `onPlayAgain` and `onClose`). A game that
puts its result at the top renders `ScoreLine` in `Status` and `ScoreActions` in the score slot.
`EndSequence`, `ScorePanel` and `Spinner` are shell-owned; never restyle them.

A game whose every round already reveals its answer before advancing may keep `GameResult`, with a
written reason in `scripts/game-result-allowlist.json`. A call that ends through another flow is
exempted with `// game-results: online-duel` on its line (TicTacToe's online duel).

```tsx
❌ onGameEnd?.(finalScore);                      // the answer vanishes behind a full-screen card
✅ onGameEnd?.(finalScore, { inPlace: true });   // answer stays; EndSequence → ScorePanel, no resize (Rule 6.2)
```

**Why:** the answer is the payoff; hiding it behind a score card throws it away.
**Check:** `npm run check:games` (run by `npm run lint`, so CI) fails on a visible game without
`{ inPlace: true }` and no allowlist entry, and on a stale allowlist entry.

### RULE 7.0 — Score above the buttons, always
`ScorePanel` is a column: the score line sits above Play again / Close game at every width, never
beside them and never reordered by wrapping.

**Why:** the player reads the result, then chooses an action.
**Check:** `scoreLine.getBoundingClientRect().bottom <= buttonRow.getBoundingClientRect().top` at 390 and 1100 px.

### RULE 7.1 — The answers carry the result; don't restate it as a count
The result line shows final points only. Colour each revealed answer (`var(--good)` got,
`var(--bad)` missed) and omit any "Found 3/5" tally. Use `ScorePanel`'s `label` only for a win state
colour cannot convey (`Board cleared!`, `That's him!`) — never for a loss (Rule 6.3) and never for a
count. With nothing to say, pass no `label` at all (Rule 4.2a).

**Why:** the board already shows the count; repeating it competes with the reveal.
**Check:** read the `ScorePanel`/`ScoreLine` props and the result copy for digits or loss words.

### RULE 7.2 — Never animate a reveal the player has already earned
The end-of-game stagger applies only to answers the player never got; solved items are already face
up and cost zero reveal time. Step 260 ms with a ~300 ms lead-in.

```js
✅ const toReveal = SLOTS.map(s => s.key).filter(k => !correctGuesses[k]);
   toReveal.forEach((key, i) => later(() => reveal(key), 300 + i * 260));
```

**Why:** the wait should scale with what the player missed, not with the size of the board.
**Check:** finish with everything solved — the score appears after the loader beat only.

---

## 8. Shared components

### RULE 8.1 — Reuse the shared components; never re-implement them
`GameFrame`, `Stage`, `Button`, `Chip`, `ProgressBar`, `AutoCompleteInput` (pass `maxResults` for
large pools), `EndSequence`, `ScorePanel` / `ScoreLine` / `ScoreActions`, `Spinner`,
`SubmitGuessPopup`, `CourtLoader` (full-stage loading only), `TeamCrest`, `SessionTimer`,
`AnimatedNumber`, `SwapText`, `motion/*`. Alias-aware answer matching: `src/utils/answerMatch.ts`.

**Why:** a copy drifts from the shell the first time the original changes.
**Check:** search `docs/team/CODE_MAP.md` and `src/` before writing a component (reuse-first).

## 9. Scoring

### RULE 9.1 — Points add up, and time never adds points
`pointsPerCorrect × rounds` equals the `maxPoints` on the idle chip. Aim for about 50 points per
correct answer and 100–300 per session. Time is the multiplayer tiebreak only — it never adds points.
Build single-player first, but shape score and state so online and friend modes slot in without a
redesign (in multiplayer, show both players' running scores).

**Why:** the idle chip is a promise; the result must be able to reach it.
**Check:** compare the `Game` entry's `pointsPerCorrect`, round count and `maxPoints`.

---

## Accepted deviations

Deliberate and reviewed — do not "fix" these. A game may break a rule only with a row here.

| Game | Deviation | Rule | Reason | Date |
|---|---|---|---|---|
| Starting Five | root `max-width: 720px` (`.gf:has(.s5-cards)`) | 0 | the five-card lineup wraps below ~720 px | ≤ 2026-10 |
| Starting Five | taller than 390×844; the page scrolls | 1.1 | five 1:1 cards cannot fit without squashing the photo (Rule 4.3); as a content game the shell grows (Rule 1.2) | ≤ 2026-10 |
| Contexto | `.endseq` min-height 100 px (`.gf:has(.cx-list)`) | 6.2 | its Give up + input row is taller than the default end slot | ≤ 2026-10 |
| Heatmap, Contexto, TicTacToe, Who Are Ya, Connections, Wordle, Starting Five, Fan Favorites | no progress bar | 5.0 | no linear progression, or the board, rows or lives already are the progress | ≤ 2026-10 |
| Connections, Heatmap, Contexto, Wordle, Who Are Ya, Career Path, TicTacToe, Bingo, SuperDraft, Imposter | no `ROUND n/total` label | 0 | these games have no rounds | ≤ 2026-10 |
| Fan Favorites, SuperDraft, Contexto | correct copy is not `Correct! +N` | 6.0 | no per-answer points exist, so `+N` would be false | ≤ 2026-10 |
| Bingo | keeps `Dabbed!` | 6.0 | scoring is terminal-only; there is no per-dab constant | ≤ 2026-10 |
| Who Would Win | no per-matchup popup; points (20 with the crowd, 5 against, 0 for Skip) show in the Score slot and the split bar | 6.1 | there is no right answer to flash; the crowd split is the feedback | 2026-10 |
| Who Would Win | fill game; `.www-arena` is the scroller; tightens under 700 px of viewport height; scrolls (with a bottom fade) only at 320×568 | 4.1, 1.1 | its stacked arena genuinely fills; converting it would be a redesign | 2026-10 |
| Who Would Win | ends in place with the per-matchup list as the final board; `ScorePanel` has no label or count | 7.1 | the rows already carry the outcome | 2026-10 |
| Career Path | no `loader` beat (`input → score`); result line in `Status`, career/answer toggle in `Prompt`, actions alone in `Action` | 7.3 | the reveal is player-driven, so nothing is calculated; the owner's bound is that no button waits more than 400 ms; every slot keeps its play-time height (Rule 6.2) | 2026-10 |
| SuperDraft | bespoke `.sd-result` panel | 8.1 | it has a Share action with no shared equivalent; it ends in place, so there is one end screen | ≤ 2026-10 |
| Imposter | custom explainer screen | 2.1 | multiplayer-only rules screen inside the room, not the shell idle | ≤ 2026-10 |
| Wordle | `ScorePanel` without Play again | 7.3 | once per day: a replay POSTs `daily-play` and hits the 423 lock | 2026-10 |
| Wordle, Fan Favorites, TicTacToe, Heatmap, Who Would Win | `color: #fff` on brand/good fills | 0.1 | no white token exists; `ui.css` sets the same precedent | ≤ 2026-10 |

---

## Adding a game — the 4 touchpoints

1. Routing is automatic: `src/app/[game]/page.tsx` serves every `urlPath` in `games[]` (UI-2).
2. A `Game` entry in `src/utils/GameUtils.tsx` — `id`, `name`, `tag`, `description`, `intro`, `rules`,
   `instruction`, `loadingMessage`, `backgroundImage`, `urlPath`, `pointsPerCorrect`, `maxPoints`,
   `fetchData`, `handleError` (and `roundsLabel` if not 5 rounds).
3. A `case` in `src/Game Renderers/RenderGame.tsx` — the renderer receives
   `{ gameInfo, onGameEnd, onPlayAgain, onClose }` and calls `onGameEnd` exactly once.
4. A server endpoint in `multiplayer_server/src/gameEndpoints.js` (only once multiplayer is wired).

Then classify it (Rule 4.1: `fill` or not), choose its end path (Rule 7.3), and run `npm run ui:audit`
and `npm run lint` before calling it done.
