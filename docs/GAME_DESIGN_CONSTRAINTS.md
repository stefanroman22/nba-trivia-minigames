# Game Design Constraints (the Series Winner standard)

**Every game — current and new — must follow these.** They exist so every game shares one
consistent structure: shell, idle screen, loading, in-game chrome, feedback, and end-state.

**Reference implementations** (read these before building anything):

| Concern | Reference |
|---|---|
| Shell, idle, loading, round chrome, progress, feedback, standard end | `Game Renderers/PlayOffSeries.tsx` ("Guess the Series Winner") |
| The answers-shown exception (in-place end, progressive reveal) | `Game Renderers/FanFavorites.tsx` |

Everything below is measured from the live app. Numbers are exact — match them, don't approximate.

---

## RULE 0 — Your root is `<GameFrame>`. This rule outranks every other rule here.

Earlier versions of this document *described* the layout and let each game re-implement it. That
produced **8 different root gaps** (20 / 16.2 / 14.4 / 14 / 13.5 / 12.6 / 12 / 11.7px) and **7
different widths** (430–720px, plus one game with none) across 18 games — all of which passed every
static check while looking nothing alike. Prose does not enforce layout. A component does.

```tsx
<GameFrame>                                   {/* owns width, max-width, 20px gap */}
  <GameFrame.Status
    left={<GameFrame.Label>ROUND 1/5</GameFrame.Label>}
    right={<GameFrame.Score value={score} />}
  />
  <ProgressBar value={…} max={…} />           {/* optional — omit if no linear progression */}
  <GameFrame.Prompt eyebrow="First Round · 1978-79" title="Who won the series?" />
  <GameFrame.Board>{/* the ONLY free-form region */}</GameFrame.Board>
  <GameFrame.Action>{/* input row, EndSequence, buttons */}</GameFrame.Action>
</GameFrame>
```

**Non-negotiable:**
- A game **never** declares its own root class, `max-width`, `gap`, `margin` or `padding` at the top
  level. `GameFrame` owns all of it. If you find yourself writing `.xx-wrap`, stop.
- A game **never** hand-rolls a status row. Pass content into `Status`.
- `Board` is the only place bespoke markup belongs — a hex grid, a 4×4 tile grid and a survey board
  genuinely differ; everything *around* them must not.
- `fill` is only for boards that **actually scroll** (`overflow-y:auto`). A fixed-size board with
  `flex:1` gets stranded in dead space — that was Heatmap's bug.

**Verification is not optional and is not `grep`.** Run the harness; it renders every game, measures
it, and writes a screenshot per game:

```bash
npm run dev        # in another terminal
npm run ui:audit   # renders all 18 at 3 viewports, asserts, exits 1 on any failure
```

Never claim a game is compliant without a rendered screenshot. Static checks pass on broken layouts.

**One viewport is not verification.** `ui:audit` runs desktop (1100×900), laptop (854×694) and
mobile (390×844) because the failures differ by size. Every game passed at 1100×900 while **11 of
18 were broken at 854×694** — four of them rendering *outside* the shell border — purely because
`--stage-max` shrinks with viewport height and content that fits at one size overflows at another.
A single-viewport pass is how that shipped.

Note also that the expected top/bottom offset is **not a constant**: it is the stage padding,
`clamp(14px, 2.6vw, 30px)` — 30px on a wide screen, 22.2px at 854px, 14px on mobile. Assertions read
the computed padding; never hardcode a pixel value.

---

## 0. Design tokens (`src/styles/theme.css`)

Never hardcode a hex that has a token. Never introduce a second accent colour.

| Token | Value | Use |
|---|---|---|
| `--bg` / `--bg2` | `#101010` / `#161616` | page background |
| `--surface` | `#1c1c1e` | cards, stage shell |
| `--surface2` | `#232327` | choice buttons, inputs |
| `--surface3` | `#2b2b30` | progress track, inert fills |
| `--line` / `--line2` | `rgba(255,255,255,.09)` / `rgba(255,255,255,.17)` | hairlines / stronger borders |
| `--text` / `--muted` | `#f5f3ef` / `#9c9a95` | body / secondary text |
| `--brand` | `#ff6a1a` | the **only** accent |
| `--brand2` / `--brand-deep` | `#ff8a3d` / `#c2510a` | gradient partners |
| `--brand-soft` | `rgba(255,106,26,.14)` | tinted brand fills |
| `--good` / `--good-soft` | `#2fc762` / `rgba(47,199,98,.16)` | correct |
| `--bad` / `--bad-soft` | `#ff4d4d` / `rgba(255,77,77,.16)` | wrong |
| `--shadow` | `0 22px 60px -18px rgba(0,0,0,.65)` | elevated surfaces |
| `--radius` | `14px` | default corner |
| `--ease-out` | `cubic-bezier(.22,1,.36,1)` | the house easing |

**Type** — `Russo One` via `.font-display` / `.disp` (letter-spacing `.4px`) for every heading,
game name, team name, and VS label. `Chakra Petch` is the body font (`.font-accent` to force it).
**`.tnum` is mandatory** on every number, score, timer, count, and rank.
Respect `prefers-reduced-motion` (use framer-motion's `useReducedMotion()`).

---

## 1. The shell — never rebuild it

Fixed DOM chain, owned by `MiniGame.tsx` + `Stage.tsx`. A game renderer supplies **only** the
node marked *your root*:

```
section.stage-col            (flex column, gap 16px)
├── div.stage-title          (flex, align center, gap 11px)
│     h1.font-display        font-size clamp(19px, 2.6vw, 26px)  ← game name
│     button.info-btn        30×30 circle, border 1px var(--line2), radius 50%
│     Chip variant=brand dot margin-left:auto                    ← game tag (PREDICT, HEX…)
└── div.stage-shell
      ├── div.stage-dots     (aria-hidden decorative grid)
      └── div.stage-inner
            └── motion.div   (Stage phase cross-fade — width 100%, flex, centered)
                  └── .idle | CourtLoader | .playing-wrap | GameResult   ← your root
```

**`.stage-shell`** — `border 1px var(--line)`, `radius 16px`, `box-shadow var(--shadow)`,
`overflow: visible` (so autocomplete dropdowns can escape), background
`radial-gradient(130% 120% at 50% -10%, var(--brand-soft), transparent 50%), var(--surface)`.

**`.stage-dots`** — `inset 0`, `opacity .4`,
`radial-gradient(circle at 1px 1px, var(--line) 1px, transparent 0)` at `24px 24px`,
masked with `radial-gradient(120% 90% at 50% 0%, #000, transparent 75%)`.

**`.stage-inner`** — the single source of the game's outer padding:

```css
.stage-inner {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: clamp(14px, 2.6vw, 30px);
  min-height: clamp(280px, 44dvh, 430px);
  --stage-max: calc(100dvh - 188px);
  max-height: var(--stage-max);
}
@media (max-width: 819px) { .stage-inner { --stage-max: calc(100dvh - 216px); } }
.stage-inner > * { max-height: 100%; min-height: 0; }
```

- **Never add your own outer padding** — the clamp is what makes every game's top spacing match.
- `--stage-max` is the height budget your root may consume. Size with `clamp()` / `dvh` so
  content shrinks on short screens.

**Phase transition** (`Stage.tsx`, `AnimatePresence mode="wait"`) — identical for every game:
`initial {opacity:0, y:12}` → `animate {opacity:1, y:0}` → `exit {opacity:0, y:-12}`,
`duration 0.25`, `ease [0.22, 1, 0.36, 1]`.

### RULE 1.1 — The play area must fit one 390×844 viewport

The **Exit button's bottom edge ≤ viewport height**, with no mid-game scrolling of the game itself.
The multiplayer aside sits *below* the stage on mobile and **is** allowed to scroll — it is not the
play area, so page-level overflow caused by the aside alone is fine.

**Acceptance test** — resize to 390×844, start the game, and run:

```js
const r = el => el.getBoundingClientRect();
const exit  = document.querySelector('.exit-link');
const aside = document.querySelector('.game-aside');
({
  playAreaFits: r(exit).bottom <= window.innerHeight,        // MUST be true
  overflowIsAsideOnly: r(aside).bottom > window.innerHeight  // fine if true
});
```

### RULE 1.0 — Size children against `--stage-avail`, never `--stage-max`

`.stage-inner` exposes two custom properties and they are not interchangeable:

| Property | Meaning |
|---|---|
| `--stage-max` | the stage's own **border-box** cap — `calc(100dvh - 188px)` |
| `--stage-avail` | what a **child** may occupy — `--stage-max` minus the stage's own padding |

Sizing a child against `--stage-max` makes it consume the padding it is supposed to sit inside, so
it renders flush against the shell border. That is why NBA Grid's status label sat at offset `0`
with no top margin at all.

```css
❌ WRONG — eats the stage's padding, game sits on the border
.playing-wrap { height: min(var(--stage-max, 620px), 600px); }

✅ RIGHT
.playing-wrap { height: min(var(--stage-avail, 620px), 600px); }
```

Related: `.stage-inner` uses `align-items: safe center`, not `center`. Plain `center` overflows a
too-tall child equally in **both** directions, pushing content out past the **top** border where it
can't even be scrolled to. `safe` falls back to flex-start instead.

And a content game never gets a height cap at all — it hugs, so if it is taller than the budget the
shell grows and the page scrolls (Rule 1.2) rather than spilling out:

```css
.stage-inner:has(.gf:not(.gf--fill)) { min-height: 0; max-height: none; }
```

### RULE 1.2 — If it genuinely cannot fit, grow the stage; never clip and never squash

Some games can't honour Rule 1.1 without violating something more important (Rule 4.3's
aspect-ratio guarantee). When that happens the game **explicitly opts out of the stage height cap**
so the shell grows and the *page* scrolls. It must never be left in the default state, where
`.stage-inner`'s `max-height` silently clips the content and the game renders **outside** the
shell's rounded border:

```css
❌ WRONG — cards spill past the shell border (exit at 946px, shell ends at 824px)
/* no opt-out: .stage-inner stays capped at --stage-max */

✅ RIGHT — the shell grows to contain the game; the page scrolls
@media (max-width: 620px) { .stage-inner:has(.s5-wrap) { max-height: none; } }
```

Opting out is a **last resort** and must be recorded in Accepted deviations with the reason.
Verify with `r(exit).bottom <= r(shell).bottom` — the shell must always contain its game.

---

## 2. Idle screen — identical for every game

Driven entirely by the `Game` entry in `src/utils/GameUtils.tsx`. Do not build a custom idle.

```html
<div class="idle">
  <div class="idle-thumb" style="background-image: url(…)"></div>
  <div class="idle-head">
    <h2 class="font-display" style="font-size:23px">{game.name}</h2>
    <p style="font-size:14px; color:var(--muted); line-height:1.5">{game.description}</p>
  </div>
  <div class="idle-chips">
    <span class="chip">5 rounds</span>
    <span class="chip">~1 min</span>
    <span class="chip">up to <span class="tnum">{game.maxPoints}</span> pts</span>
  </div>
  <button class="btn btn-primary btn-lg"><svg …/> Play</button>
</div>
```

| Element | Spec |
|---|---|
| `.idle` | `flex column`, `align-items:center`, **`gap:18px`**, `text-align:center` |
| `.idle-thumb` | `width: min(340px, 82vw)`, `aspect-ratio:16/9`, `radius:18px`, `background-size:cover`, `background-position:center`, `border:1px solid var(--line2)`, `box-shadow:var(--shadow)`, `overflow:hidden` |
| `.idle-thumb::after` | vignette — `linear-gradient(180deg, transparent 55%, rgba(8,7,6,.45))` + `inset 0 0 32px rgba(0,0,0,.3)`, `pointer-events:none` |
| `.idle-head` | `flex column`, `gap:7px`, `max-width:420px` |
| title | `.font-display`, `font-size:23px` |
| description | `font-size:14px`, `color:var(--muted)`, `line-height:1.5` |
| `.idle-chips` | `flex`, `gap:10px`, `flex-wrap:wrap`, `justify-content:center` |
| `.chip` | `padding:5px 12px`, `radius:30px`, `font-size:11px`, `weight:700`, `letter-spacing:.5px`, `border:1px solid var(--line)`, `color:var(--muted)` |
| points chip inner | `.tnum`, `color:var(--brand)`, `weight:700`, `margin-left:4px` |
| Play button | `<Button size="lg">` → `.btn.btn-primary.btn-lg`: `height:52px`, `padding:0 30px`, `font-size:16px`, `letter-spacing:.5px`, `radius:10px`, `gap:10px`, `background:var(--brand)`, `color:#fff`, `box-shadow:0 12px 30px -12px var(--brand)`. Hover `y:-2`, tap `scale:.95` (spring `stiffness 520`, `damping 30`). |
| Play icon | inline `svg` 18×18, `viewBox="0 0 24 24"`, `fill="currentColor"`, `path d="M8 5v14l11-7z"`, before the word "Play" |

> The "5 rounds" and "~1 min" chips are currently **hardcoded** in `MiniGame.tsx`; only
> `maxPoints` is per-game. A game whose format differs must make those chips data-driven off the
> `Game` entry rather than fork the idle markup.

**Lobby variant:** when a friend room is open, the Play button is replaced by
`<p class="idle-room-note">` (`font-size:13px`, `muted`, `max-width:320px`, `line-height:1.5`).

---

## 3. Loading — one animation, one duration, every game

Pressing Play always produces the **same** screen (image 1). No per-game loader.

- `handleStart()` holds the loading phase for a fixed **2000 ms** before data resolves
  (`MiniGame.tsx`), so the animation never flashes.
- Render is exactly `<CourtLoader label="Warming up the court…" />` — **`scale: 1`** (default).

`CourtLoader` internals (scale 1): wrapper `flex column`, `align-items:center`, `gap:14px`;
stage box `90×118`; backboard/rim SVG `80×70`; ball `26×26` running
`shoot 1.45s cubic-bezier(.4,.05,.55,.95) infinite`; net running `netSway 1.45s ease-in-out infinite`;
label `font-size:14px`, `color:var(--muted)`, `letter-spacing:.3px`, `loaderPulse 1.25s ease-in-out infinite`.

Use `Spinner` (not `CourtLoader`) for small inline spots — see §7.

---

## 4. Playing shell — `.playing-wrap`

```html
<div class="playing-wrap is-content">
  <!-- your game root -->
  <div class="feedback-slot" aria-hidden="true"></div>
  <button class="exit-link">Exit game</button>
</div>
```

```css
.playing-wrap {
  position: relative; width: 100%;
  height: min(var(--stage-max, 620px), 600px);
  max-height: 100%; min-height: 0;
  display: flex; flex-direction: column;
  align-items: center; justify-content: center;
  gap: 12px;
}
.playing-wrap.is-content { height: auto; gap: 28px; }
.playing-wrap > :first-child { max-height: 100%; min-height: 0; width: 100%; }
```

### RULE 4.1 — Every game MUST be classified, and the classification is mechanical

Layout mode is **not** a style preference. Getting it wrong produces dead space or overflow, so run
this test — it has exactly one right answer per game:

> **Does the game root set `height:100%` AND contain a child with `flex:1` that scrolls internally
> (`overflow-y:auto`)?**
> - **Yes → fill game.** Keep it OUT of `CONTENT_STAGE_GAMES`. Game→Exit gap = **12px**.
> - **No → content game.** It hugs its content. It **MUST** be added to `CONTENT_STAGE_GAMES` in
>   `MiniGame.tsx`. Game→Exit gap = **28px**.

There is no third option. "It looks fine" is not a classification.

**Why this is load-bearing:** `.exit-link` has `margin-top:auto`. Inside a fill `.playing-wrap`
(`height: min(--stage-max, 600px)`), that auto margin absorbs **all** free space. So a
content-shaped game left out of `CONTENT_STAGE_GAMES` gets its UI pinned to the top of a 600px box
and Exit slammed to the bottom — an enormous dead gap, and a top offset that doesn't match any
other game. This is exactly what happened to Starting Five and Wordle.

```
❌ WRONG — content-shaped game omitted from the set
   .s5-wrap { display:flex; flex-direction:column; gap:…; }   /* no height:100%, no flex:1 scroller */
   CONTENT_STAGE_GAMES = { …, /* starting-five missing */ }
   → game pinned to top of a 600px box, ~170px of dead space above Exit

✅ RIGHT
   CONTENT_STAGE_GAMES = { …, "starting-five" }
   → .playing-wrap.is-content { height:auto; gap:28px } → Exit sits 28px under the game
```

⚠️ **Never make a fill game `is-content`** — content-sizing unbounds its `flex:1` scroll area and it
overflows the viewport (verified).

Current set: `CONTENT_STAGE_GAMES = { "series-winner", "name-logo", "guess-mvps", "fan-favorites",
"starting-five", "wordle" }`.

### RULE 4.2 — The three shell distances are identical in every game

These are shell-owned and **must not vary by game**, whether or not the game has a progress bar,
a status row, or any header at all:

| Distance | Value | Owned by |
|---|---|---|
| Stage top → top of the game UI | `28.6px` (the `.stage-inner` clamp at ≥1100px) | `.stage-inner` padding |
| Game bottom → Exit button | `28px` (content) / `12px` (fill) | `.playing-wrap` gap |
| Exit button → stage bottom | `28.6px` | `.stage-inner` padding |

A game with no progress bar starts its first element at the **same** offset as a game with one —
the bar is *inside* the game column, so its presence changes nothing about the shell spacing.
If your game's top offset differs from Series Winner's, you have a layout-mode bug (Rule 4.1),
**not** a padding problem. Never "fix" it by adding margin/padding to the game root.

### RULE 4.2a — Never render an empty slot; omit it

An empty slot is not free. It still occupies a flex position and still triggers the row's `gap`, so
alignment maths lands half a gap off and `:only-child` / `:empty` rules that should fire never do.

`GameFrame.Status` therefore omits a slot it was given nothing for, which lets the row align itself:

```css
/* Both slots → space-between. One slot → align by which one it is. */
.gf-status > .gf-status-left:only-child  { margin-inline: auto; }        /* lone label centres */
.gf-status > .gf-status-right:only-child { margin-inline-start: auto; }  /* lone score stays right */
```

A lone **label** centres — with nothing opposite it, pinning it to the left edge reads as a broken
bar rather than a heading. A lone **score** stays right, so it never jumps sides when a game gains
or loses its left label mid-run. Affected: Fan Favorites, Wordle, Who Would Win, Imposter's rules
card.

This is the same principle as `GameFrame.Action` returning `null` when empty (Rule 0): **a slot with
no content must contribute no node**. Do not "fix" alignment by passing `""`, `<span />` or `&nbsp;`
into a slot — that reintroduces the phantom element the rule exists to remove.

The harness asserts it: a lone left slot must sit within 1.5px of the row's centre, a lone right
slot must be flush right.

### RULE 4.2b — A content game must never be given a height floor

A content game hugs its content. If anything above it imposes a **minimum height**, the leftover
gets split by `align-items: center` and the game floats — a bigger top *and* bottom offset than
every other game, for no reason other than "this game has less content".

That is exactly what made Guess the MVP sit at **82px** top/bottom while Name the Club sat at
**28.6px**: identical structure, identical slot usage, both content games. The only difference was
that Name the Club has a big logo image so its content exceeded `.stage-inner`'s
`min-height: clamp(280px, 44dvh, 430px)` (~396px) and filled it, while Guess the MVP — same layout,
no image — fell ~107px short and had that slack split evenly around it.

```css
❌ WRONG — the floor applies to content games too, so short ones float
.stage-inner { min-height: clamp(280px, 44dvh, 430px); }

✅ RIGHT — the floor still protects idle/loading and fill games, but never a content game
.stage-inner { min-height: clamp(280px, 44dvh, 430px); }
.stage-inner:has(.gf:not(.gf--fill)) { min-height: 0; }
```

**Generalised:** a content game's shell height is *output*, not input. Two content games with
different amounts of content SHOULD produce different shell heights — what must be identical is the
padding around them. Never reach for a min-height to make two games' shells the same size.

The harness asserts this: `shellTop` and `exitToBottom` must both be 28.6 for every game, so a
reintroduced floor fails `npm run ui:audit` instead of waiting to be spotted by eye.

### RULE 4.3 — Column counts are chosen per breakpoint, never left to `auto-fit`

`auto-fit`/`minmax()` reflows silently and unpredictably on phones — and with a square
(`aspect-ratio: 1/1`) cell, each extra row multiplies height. That is how Starting Five ended up
427px past the viewport. Decide the count explicitly at each breakpoint instead:

```css
❌ WRONG — reflows to an unplanned 2x3 at 390px, blowing the viewport budget
.s5-cards { grid-template-columns: repeat(auto-fit, minmax(120px, 1fr)); }

✅ RIGHT — an explicit count per breakpoint
.s5-cards { grid-template-columns: repeat(5, minmax(0, 1fr)); }
@media (max-width: 620px) { .s5-cards { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
```

**Legibility beats keeping the set on one line.** Squeezing five cards across a 390px screen leaves
~59px each — too narrow for a full player name. Two per row (~157px) is correct even though it
costs a row.

**But media keeps its aspect ratio — always.** A card's photo/artwork is the point of the card, so
its ratio is never squashed to reclaim height. Buy height back from everything *except* the media:
lay the control row out horizontally (input beside its button), trim oversized headers, tighten
labels. A cell may end up **larger** on mobile than desktop (Starting Five: ~157px vs ~133px) —
that is fine. Smaller or letterboxed is not.

```css
❌ WRONG — letterboxes the photo to save height
@media (max-width: 620px) { .s5-card-stage { aspect-ratio: auto; height: clamp(58px, 8dvh, 116px); } }

✅ RIGHT — ratio preserved at every width; height comes from elsewhere
@media (max-width: 620px) { .s5-card-input { flex-direction: row; } }
```

**If the layout still cannot fit, the game opts out of the stage cap — it does not shrink.** See
Rule 1.2.

Use `auto-fit` **only** where the count is genuinely open-ended (a results feed, a guess list).
When cells shrink, scale their contents with them rather than letting text ellipse into nonsense —
and remember a control's accessible name can come from `aria-label`, so the *visible* label may
shrink freely.

An odd cell left alone on the final row must be centred, not left dangling in column 1:

```css
.s5-card:last-child:nth-child(odd) { grid-column: 1 / -1; justify-self: center; width: calc(50% - 5px); }
```

### RULE 4.4 — Reserve label height across repeated cells

Any label that sits above a row of repeated cells must reserve its **maximum** line count, or the
one short label knocks its whole column out of alignment. "Center" is one line while "Point Guard"
wraps to two — an 11px offset on that entire column.

```css
❌ WRONG — "Center" rides 11px higher than the other four
.s5-card-pos { line-height: 1.2; }

✅ RIGHT — two lines always reserved, all five columns align
.s5-card-pos { line-height: 1.2; min-height: 2.4em; }
```

**Acceptance test** — every repeated cell's body must start at the same Y:

```js
new Set([...document.querySelectorAll('.s5-card-stage')]
  .map(c => c.getBoundingClientRect().top.toFixed(1))).size === 1  // MUST be true
```

### RULE 4.2 acceptance test

Paste into DevTools while any game is in play. All three numbers must match Series Winner's:

```js
const r = el => el.getBoundingClientRect();
const inner = document.querySelector('.stage-inner');
const game  = document.querySelector('.playing-wrap').firstElementChild;
const exit  = document.querySelector('.exit-link');
({
  top:    +(r(game).top - r(inner).top).toFixed(1),      // 28.6
  toExit: +(r(exit).top - r(game).bottom).toFixed(1),    // 28 content / 12 fill
  bottom: +(r(inner).bottom - r(exit).bottom).toFixed(1) // 28.6
});
```

### Exit button
One shell element only — `.exit-link` with `margin-top:auto`, so the distance beneath it is the
`.stage-inner` clamp padding for **every** game. `font-size:12px`, `color:var(--muted)`,
`text-decoration:underline`, `text-underline-offset:3px`; hover → `var(--text)`.
**Never render your own exit.**

---

## 5. Game root layout (the Series Winner column)

Your root is a single column. Copy these values:

```jsx
<div style={{ position:"relative", width:"100%", maxWidth:560,
              display:"flex", flexDirection:"column", gap:20 }}>
```

| Slot | Spec |
|---|---|
| **root** | `max-width:560px`, `flex column`, **`gap:20px`** |
| **1. status row** | `flex`, `align-items:center`, `justify-content:space-between`, `gap:14px` |
| ↳ round label | `font-size:11px`, `letter-spacing:1px`, `color:var(--muted)`, `weight:600` — `ROUND {n}/{total}` (uppercase) |
| ↳ score group | `flex`, `align-items:center`, `gap:8px`, `font-size:13px`, `weight:700` |
| ↳ "SCORE" | `color:var(--muted)`, `weight:500`, `font-size:11px`, `letter-spacing:.5px` |
| ↳ score value | `.tnum`, `color:var(--brand)`, `font-size:16px` |
| **2. progress bar** | `<ProgressBar value max />` — see below |
| **3. round body** | keyed `AnimatePresence mode="wait"` block, `flex column`, **`gap:18px`** |

There is no feedback row: feedback is an overlay that lives in the shell's `.feedback-slot`, outside
the game column entirely — see §6 RULE 6.1.

### Progress bar — position is fixed
The bar is **always the second child of the root**, directly under the status row, separated by the
root's `gap:20px`. That distance from the top of the game container is identical in every game.

```css
.progress { height: 5px; border-radius: 5px; background: var(--surface3); overflow: hidden; }
.progress > span {
  display: block; height: 100%; border-radius: 5px;
  background: linear-gradient(90deg, var(--brand), var(--brand2));
  transition: width 0.4s var(--ease-out);
}
```

- Use the shared `<ProgressBar value={…} max={…} />` (renders `role="progressbar"` +
  `aria-valuenow` / `aria-valuemax`). Series Winner advances it on reveal:
  `value={currentIndex + (revealing ? 1 : 0)}`.
- **A game may omit the bar** if it has no linear progression (open boards, daily puzzles) — but if
  it has one, it goes in that exact slot with that exact styling. Never move it, never restyle the
  track/fill, never substitute a custom bar.

### Round body (inside the keyed block)
Transition: `initial {opacity:0, y:10}` → `animate {opacity:1, y:0}` → `exit {opacity:0, y:-10}`,
`duration 0.25`. Skip `initial`/`exit` when `useReducedMotion()` is true.

| Element | Spec |
|---|---|
| header | `flex column`, `gap:6px`, `align-items:center`, `text-align:center` |
| ↳ context line | `font-size:11px`, `letter-spacing:1.5px`, **`color:var(--brand)`**, `weight:600` (e.g. `First Round · 1978-79`) |
| ↳ question | `.font-display`, `font-size:19px` (e.g. "Who won the series?") |
| choice grid | `display:grid`, `grid-template-columns:"1fr auto 1fr"`, `gap:10px`, `align-items:stretch` |
| VS divider | `.font-display`, `font-size:13px`, `color:var(--muted)`, `align-self:center` |

**Choice button** (`.btn` is *not* used — these are bespoke cards):
```
flex column, align-items:center, gap:10px
padding: 18px 14px
border-radius: 14px
border: 1px solid var(--line2)
background: var(--surface2)
height: 100%; justify-content: flex-start
transition: background .35s ease, border-color .35s ease, opacity .35s ease
hover: y -2   |   tap: scale .96   (both disabled once revealed)
```
Reveal states — correct: `border var(--good)` + `background var(--good-soft)`;
the player's wrong pick: `border var(--bad)` + `background var(--bad-soft)`;
every other option: `opacity .55`.

Inside each button: crest tile `54×54`, `radius:14px`, centered, `background:` the team's primary
colour (fallback `var(--surface3)`), `box-shadow:0 6px 16px -6px rgba(0,0,0,.5)`, `overflow:hidden`,
containing `<TeamCrest size={40} />`; then the label `.font-display`, `font-size:15px`,
`text-align:center`, `line-height:1.25`; then (after reveal only) a `.tnum` stat line with
`margin-top:auto`, `padding-top:6px`, `font-size:12px`, `weight:700`, coloured `var(--good)` for the
winner else `var(--muted)`.

**Reveal dwell: 1800 ms** between locking an answer and advancing to the next round.

---

## 6. Feedback ("Correct! +10")

**Copy format is fixed:**
- Correct → `` `Correct! +${pointsPerCorrect}` `` in `var(--good)`.
- Wrong → a short statement of the truth, in `var(--bad)` — e.g. `It was the ${winner}`,
  `Not on the board`. Never a bare "Wrong".
- Neutral/no-op → `var(--muted)` (e.g. `Already tried`).

**Styling is fixed:** `.font-accent`, `font-size:14px`, `weight:700`, animated
`initial {opacity:0, y:6}` → `animate {opacity:1, y:0}` (and `exit {opacity:0, y:6}`).

### RULE 6.1 — Feedback is an overlay in the shell slot. There is exactly one placement.

Render `<SubmitGuessPopup show={…} text={…} color={…} />` as a direct child of `<GameFrame>`,
after `<GameFrame.Action>`. It **portals into `.feedback-slot`** — `position:absolute`,
`left/right:0`, **`bottom:22px`**, `pointer-events:none`, `z-index:5` — a fixed spot in the gap
between the game's bottom border and the Exit button.

Being absolutely positioned with `pointer-events:none`, it has **zero layout footprint**: it never
shifts any element regardless of message length, and it never covers game content, because it
occupies gap that is otherwise empty. **Do not build a per-game popup, and never reserve an in-flow
row for the message.**

❌ A reserved in-flow row as the last child of the round body:
```tsx
<div style={{ height: 20, display: "flex", alignItems: "center", justifyContent: "center" }}>
  {feedback && <motion.span …>{feedback.text}</motion.span>}
</div>
```
This was Series Winner's original placement. It grows the card by the row height **plus** the
column `gap`, it travels with the board instead of sitting in the shell's fixed spot, and it puts
the message somewhere different in every game.

✅ The shared overlay:
```tsx
<GameFrame.Action>{…}</GameFrame.Action>

<SubmitGuessPopup
  show={!!feedback}
  text={feedback?.text ?? ""}
  color={feedback?.color ?? "var(--good)"}
/>
```

**All 17 games use this placement.** A game that renders per-guess feedback any other way is wrong.
(The end-of-game reveal panels of §7b are a different thing and are not covered by this rule.)

### RULE 6.1 acceptance test
1. DevTools → select the game root; record `getBoundingClientRect().height` before answering.
2. Trigger a correct answer, then a wrong one (wrong copy is longer — it names the answer).
3. The height must be **identical** in all three states, and the message must sit between the
   game's bottom border and Exit, overlapping neither.
4. While a message shows, `document.querySelector(".feedback-slot").children.length` must be `1`.
   If it is `0`, the game built its own popup instead of portalling into the shared slot.

### RULE 6.2 — Transient content must never resize the container. **HARD RULE.**

The game container may change size **only** when a permanent structural component mounts or
unmounts — a real phase change (board → result). Anything that appears temporarily and then goes
away — a feedback message, a reveal label, a hint, a badge, a spinner, an error — must **reserve its
space up front** and cost the container **zero pixels**.

A transient element that resizes the container is a bug even when the animation looks smooth: the
board jumps under the player's cursor mid-interaction.

❌ Conditional render of an in-flow node — the card grows on reveal:
```tsx
{showWinner && <span>{t.wins} wins</span>}   // 24px label + 10px flex gap = 34px jump
```

✅ Always mounted, space reserved, content swapped:
```tsx
<span aria-hidden={!showWinner}>{showWinner ? `${t.wins} wins` : " "}</span>
```

Allowed techniques, in order of preference:
1. **Portal into `.feedback-slot`** — zero footprint. Correct for all per-guess feedback (6.1).
2. **Keep the node mounted and swap its content**, reserving the line box with ` `.
3. **`min-height` / `min-width`** sized to the longest state.
4. **`position:absolute`** inside a parent that already reserves the space.

Never: conditional mount of an in-flow node, `display:none` ↔ `block` toggles, or copy that changes
line count between states.

### RULE 6.2 acceptance test
Zero variance in the game root height across a full round, including a wrong answer:
```js
const gf = document.querySelector('.gf');
const seen = new Set([gf.getBoundingClientRect().height.toFixed(2)]);
new ResizeObserver(() => seen.add(gf.getBoundingClientRect().height.toFixed(2))).observe(gf);
// …play a round with one correct and one wrong answer…
seen.size === 1   // MUST be true
```

---

## 7. End of game

### 7a. Standard path — full-screen result (default)
Call `onGameEnd(finalScore)` with **no options**. The shell flips to the `result` phase:

1. **Calculating animation — 1.5 s.** `<CourtLoader label="Calculating score…" scale={0.8} />`.
   Owned by `MiniGame.tsx:149`, so every game gets it identically.
2. Then `GameResult` springs in (`stiffness 240`, `damping 22`,
   `initial {opacity:0, scale:.9, y:10}`), container `max-width:440px`, `margin:0 auto`,
   `flex column`, `align-items:center`, `gap:8px`, centered:

| Element | Spec |
|---|---|
| status icon | `64×64` circle, `background:var(--good-soft)` when scored else `var(--surface3)`, `margin-bottom:4px`; check `svg` 30×30, `stroke:var(--good)`, `stroke-width:2.6` |
| title | `.font-display`, `font-size:24px` — `Perfect game!` / `Nice run!` / `Good try!` |
| score row | `flex`, `align-items:baseline`, `gap:8px`, `margin:4px 0` |
| ↳ score | `.font-display.tnum`, **`font-size:48px`**, `color:var(--brand)`, count-up via `AnimatedNumber` |
| ↳ cap | `.font-display`, `font-size:20px`, `color:var(--muted)` — `/ {maxPoints}` |
| message | `font-size:13.5px`, `color:var(--muted)`, `max-width:300px`, `line-height:1.5` |
| buttons | `flex`, `gap:10px`, `margin-top:14px`, `width:100%` — `<Button block>Play again</Button>` + `<Button block variant="secondary">Close game</Button>` (both `btn-md`, `height:46px`) |
| confetti | only when score > 0 and motion allowed: 260 pieces, `gravity .25`, colours `#ff6a1a, #ff8a3d, #ffd166, #ffffff, #2fc762` |

### 7b. The exception — games that reveal answers (stay in place)
For games whose whole point is showing the correct answers at the end (Starting Five, Heatmap,
Fan Favorites, Career Path, Who Are Ya…): **there is no screen change.** The player stays on the
game UI while the answers fill in.

Call `onGameEnd(finalScore, { inPlace: true })` (awards points, suppresses the overview) and drive
the shared `<EndSequence phase input score />` with a
`bottomPhase: "input" | "loader" | "score"` state:

```
input  → the live submission row (input + Confirm)
loader → <Spinner label="Calculating score…" />   ← shown for 1.5 s
score  → the compact score line + buttons
```

- **The loader is small and sits at the bottom of the live game UI** — `.endseq` is
  `width:100%`, `flex`, centered, `min-height:44px` (so the swap never collapses the layout);
  `.endseq-slot` is a centered `flex column`.
  `Spinner`: `.spinner-ring` `border:3px solid var(--brand-soft)`, `border-top-color:var(--brand)`,
  `animation: spin .75s linear infinite`, default `size:30`; label `font-size:12.5px`,
  `color:var(--muted)`, `letter-spacing:.3px`; wrapper `gap:10px`.
- Phase cross-fades (`AnimatePresence mode="wait"`, `initial={false}`) — `input` exits
  `{opacity:0, y:3}` @ `0.16s`; `loader` fades @ `0.16s`; `score` enters `{opacity:0, y:6}` →
  `{opacity:1, y:0}` @ `0.16s`, ease `[.22, 1, .36, 1]`.
- **Answers reveal progressively** while the loader runs — stagger each row (Fan Favorites uses
  `260ms + i*260ms`), then settle into `score`.

**The in-place score panel is deliberately quieter than 7a** — no 64px status icon, no green
check, no 48px number, no message paragraph. Use `<ScorePanel>`:

```css
.scorepanel { display:flex; align-items:center; justify-content:center;
              gap:14px; width:100%; max-width:420px; min-height:40px; flex-wrap:wrap; }
.scorepanel-line  { display:flex; align-items:baseline; gap:9px; }
.scorepanel-label { font-size:.9rem;   font-weight:600; color:var(--muted); }  /* var(--good) when won */
.scorepanel-pts   { font-size:1.15rem; font-weight:700; color:var(--brand); letter-spacing:.3px; }
```

Optional `label` lead-in, optional `outOf` cap, `.tnum` on the number. **Below the score sit
Play again + Close game**, using the same button treatment as 7a — pass `onPlayAgain` and
`onClose` (both threaded through `RenderGame` from `MiniGame`).

#### RULE 7.0 — Score above the buttons, always

`ScorePanel` is a **column**: the score line sits above Play again / Close game, at every width and
in every game. The player reads the result, then chooses an action — never side by side, and never
reflowed by `flex-wrap` so the order shifts with the viewport.

```css
❌ WRONG — wraps to a row on wide screens, buttons beside the score
.scorepanel { display: flex; align-items: center; gap: 14px; flex-wrap: wrap; }

✅ RIGHT — score always above the actions
.scorepanel { display: flex; flex-direction: column; align-items: center; gap: 12px; }
```

Verify: `r(scoreLine).bottom <= r(buttonRow).top`.

#### RULE 7.1 — The answers carry the result; don't restate it as a count

When a game reveals per-answer outcomes, colour each revealed answer — `var(--good)` for what the
player got, `var(--bad)` for what they missed — and **omit any "Found 3/5" style tally**. The board
already shows it; a count is redundant chrome that competes with the reveal.

```css
✅ the result reads off the answers themselves
.s5-card.is-correct  .s5-card-name { color: var(--good); }
.s5-card.is-revealed .s5-card-name { color: var(--bad); }
```

Only use `ScorePanel`'s `label` for a genuine state that colour can't convey (`Board cleared!`,
`Out of guesses`) — never for a score the player can just read off the board.

#### RULE 7.2 — Never animate a reveal the player has already earned

The end-of-game stagger applies **only to answers the player never got**. Anything they solved
during play is already face-up and must cost zero reveal time, so the wait scales with how much
they missed rather than with the size of the board.

```js
❌ WRONG — re-reveals everything; a strong player waits the longest
SLOTS.forEach((s, i) => later(() => reveal(s.key), 300 + i * 260));

✅ RIGHT — only the unsolved ones are staggered
const toReveal = SLOTS.map(s => s.key).filter(k => !correctGuesses[k]);
toReveal.forEach((key, i) => later(() => reveal(key), 300 + i * 260));
```

Stagger step is **260ms** with a ~300ms lead-in (matching Fan Favorites), then settle into `score`.
Slower steps read as lag: Starting Five's 480ms step made a full miss take 4.5s; at 260ms it is 2.1s.

---

## 8. Reusable components — use these, don't re-invent

`Stage`, `Button`, `Chip`, `ProgressBar`, `AutoCompleteInput` (pass `maxResults` for large pools),
`EndSequence`, `ScorePanel`, `Spinner`, `SubmitGuessPopup`, `CourtLoader` (full-stage loading only),
`TeamCrest`, `SessionTimer`, `AnimatedNumber`, `motion/*`.
Alias-aware answer matching lives in `src/utils/answerMatch.ts`.

---

## 9. Scoring & multiplayer readiness

- Always-visible `SessionTimer`; time is the multiplayer tiebreak **only** — it never adds points.
- Roughly ~50 pts per correct answer, 100–300 per session; `pointsPerCorrect` × rounds must equal
  the `maxPoints` advertised on the idle chip.
- Build single-player first, but shape scoring/state so online + friend modes slot in with no
  redesign. In MP, show both players' running scores over the correct answers.

---

## Accepted deviations (deliberate — do not "fix" these)

The spec is modelled on a 5-round quiz game. Most games are a different shape, and §4/§5/§7 carve-outs
apply. These are reviewed and intentional:

| Game | Deviation | Why |
|---|---|---|
| Starting Five | `max-width: 720px` (not 560) | the 5-card lineup row wraps below ~720px |
| Starting Five | **opts out of the stage cap at ≤620px; the page scrolls** (Rule 1.2) | five 1:1 cards over three rows cannot fit 390×844, and Rule 4.3 forbids squashing the photo. The shell grows so the lineup stays inside its border. |
| Pack 5, Who Are Ya, NBA Grid, SuperDraft, Imposter | narrower roots (430–520px) | board shapes; 560 is a **max**, not a target |
| Heatmap, Contexto, TicTacToe, Who Are Ya, Connections, Wordle, Starting Five, Fan Favorites | **no progress bar** | no linear progression, or the board/rows/lives already *are* the progress (§5 carve-out) |
| Connections, Heatmap, Contexto, Wordle, Who Are Ya, Career Path, TicTacToe, Bingo, SuperDraft, Imposter | **no `ROUND n/total`** | these games have no rounds |
| Fan Favorites, SuperDraft, Contexto, Who Would Win | correct-feedback copy is not `Correct! +N` | no per-answer points exist, so `+N` would be a lie |
| Bingo | keeps `Dabbed!` | scoring is terminal-only; there is no per-dab constant |
| SuperDraft | keeps its bespoke `.sd-result` panel | it has a Share action with no shared equivalent; it now ends in place so there is only one end screen |
| Imposter | keeps its custom explainer screen | MP-only; that is a rules screen inside the room, not the shell idle |
| Imposter | lost the progress bar's `[data-low]` red state | swapped to the shared `ProgressBar`; `.imp-clock[data-low]` still signals low time |
| Wordle, Fan Favorites, TicTacToe, Heatmap, Who Would Win | `color: #fff` on brand/good fills | no white token exists; `ui.css:31` sets the same precedent |
| Who Would Win | stays a fill game, not `is-content` | its vertical stacked arena genuinely fills; converting it would be a redesign |

**Known open items:**
- §9's always-visible `SessionTimer` is not rendered by any game — a repo-wide product decision.
- `src/components/CorrectAnswer.tsx` is now orphaned (both its callers moved to `SubmitGuessPopup`).
- The other 17 games have **not** been re-measured against Rules 1.1 / 4.2 / 4.4 at 390×844.
  Only Series Winner and Starting Five are verified.

---

## Adding a game — the 4 touchpoints

1. Route in `App.tsx`
2. `Game` entry in `src/utils/GameUtils.tsx` — `id`, `name`, `tag`, `description`, `intro`, `rules`,
   `instruction`, `loadingMessage`, `backgroundImage`, `urlPath`, `pointsPerCorrect`, `maxPoints`,
   `fetchData`, `handleError`
3. `case` in `src/Game Renderers/RenderGame.tsx` — the renderer receives
   `{ gameInfo, onGameEnd, onPlayAgain }` and calls `onGameEnd` exactly once
4. Server endpoint in `multiplayer_server/src/gameEndpoints.js` (only once MP is wired)

**Then run Rule 4.1's classification test and add the id to `CONTENT_STAGE_GAMES` if it is a content
game.** This is a required step, not an optional one — skipping it is the single most common way a
game ends up with dead space above Exit. Finish by running Rule 4.2's acceptance test and confirming
all three distances match Series Winner.
