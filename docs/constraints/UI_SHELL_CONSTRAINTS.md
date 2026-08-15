# UI Shell Constraints (non-game chrome)

**Scope:** everything a player sees that is *not* a game renderer — the app shell, routing,
navigation, pages, modals/overlays, the shared `components/ui/` toolkit, and their styling
conventions. Game renderers (`src/Game Renderers/*.tsx`) and the in-game stage/idle/loading/
feedback/end-of-game system are `docs/GAME_DESIGN_CONSTRAINTS.md` territory — this doc does not
repeat any of those rules (design tokens, `Stage`, `GameFrame`, `CourtLoader`, `TeamCrest`,
`SubmitGuessPopup`, `.stage-*`, `.playing-wrap`, `.feedback-slot`, etc. are all covered there).

**Reference implementations** (read these before touching shell code):

| Concern | Reference |
|---|---|
| Page shell (`app-shell` + `Navigation` + `main.page`) | `src/pages/Landpage.tsx`, `src/pages/Trivia/MiniGame.tsx` |
| Routing / route-level transition | `src/App.tsx` |
| Single overlay host | `src/components/ModalHost.tsx`, `src/context/ModalContext.tsx`, `src/components/ui/Modal.tsx` |
| Shared design-system primitives | `src/components/ui/index.ts` |
| One-shot system messages (not modals) | `src/utils/Alerts.tsx` |

Everything below is measured from the live codebase. Where the code is inconsistent, the
DOMINANT pattern is documented and the exception is called out explicitly — nothing here is an
aspirational convention the code doesn't actually show.

---

## Rule UI-1: A page owns its own shell — `.app-shell` → `<Navigation>` → `<main class="page …">`

There is no shared `<Layout>` wrapper. `App.tsx` only sets up routing; each top-level page
(`src/pages/Landpage.tsx`, `src/pages/Trivia/MiniGame.tsx`) renders the shell markup itself.

```tsx
❌ WRONG — App.tsx wrapping routes in a shared layout
<Routes>
  <Route path="/" element={<AppShellLayout><Landpage /></AppShellLayout>} />
</Routes>

✅ RIGHT — every page renders its own shell (Landpage.tsx)
<div className="app-shell">
  <Navigation type="full" />
  <main className="page">
    {/* page content */}
  </main>
</div>
```

`src/pages/NoPageFound.tsx` is the one page that skips this shell entirely (no `Navigation`, no
`.app-shell`/`.page`) — it renders a full-bleed centered message instead. That is a deliberate
exception for the not-found state, not something to copy for a real page.

## Rule UI-2: A new game is a route to the single `MiniGame` page, never a new page component

`src/App.tsx` defines one route per game path, but every single one renders the same
`<MiniGame />` element — 17 routes, one component. `MiniGame` resolves which game to show from
router state or the URL path (`src/pages/Trivia/MiniGame.tsx`, `gameId = location.state?.id ?? games.find(...)`).

```tsx
❌ WRONG — a bespoke page per game
<Route path="/new-game" element={<PageTransition><NewGamePage /></PageTransition>} />

✅ RIGHT — App.tsx, matching every other game route
<Route
  path="/new-game"
  element={
    <PageTransition>
      <MiniGame />
    </PageTransition>
  }
/>
```

Adding a game is a routing change plus a `Game` entry in `src/utils/GameUtils.tsx` (see
`GAME_DESIGN_CONSTRAINTS.md`'s "Adding a game" section) — never a new file under `src/pages/`.

## Rule UI-3: `Navigation`'s `type` prop decides scroll-in-place vs navigate-then-scroll

`src/components/Navigation.tsx` takes `type?: "full" | "back"`. On `"full"` (the landing page),
clicking a nav link scrolls the current page. On `"back"` (every game page), the same click
navigates home first, then scrolls after a fixed 350ms delay so the target section exists.

```tsx
❌ WRONG — game page using type="full", so "Games"/"Leaderboard" try to scroll a section that
   doesn't exist on /series-winner
<Navigation type="full" />

✅ RIGHT — Navigation.tsx's own go() helper, wired by the `type` prop
const go = (section: string) => {
  setDrawer(false);
  if (type === "full") {
    scrollToSection(section);
  } else {
    navigate("/");
    setTimeout(() => scrollToSection(section), 350);
  }
};
```

`Landpage.tsx` passes `type="full"`; `MiniGame.tsx` passes `type="back"`. Any new top-level page
must pick one explicitly — there is no default that works for both.

## Rule UI-4: One CSS file per page/feature, imported by that component; the design system is imported once, globally

Every page-scoped or feature-scoped stylesheet lives in `src/styles/<Name>.css` and is imported
directly by the one component that owns it: `src/components/Navigation.tsx` imports
`../styles/Navigation.css`, `src/components/ui/Modal.tsx` imports `../../styles/Modal.css`,
`src/pages/Landpage.tsx` imports `../styles/LandPage.css`, `src/pages/Trivia/MiniGame.tsx` imports
`../../styles/MiniGame.css`. The shared design system (`theme.css` tokens + `ui.css` component
classes) is the one exception: it is imported exactly once, globally, in `src/main.tsx`, not
re-imported per component.

```tsx
❌ WRONG — a new shell component re-declaring shared tokens/classes in its own file
import "../styles/theme.css";   // already global via main.tsx — don't re-import per component
import "../styles/ui.css";

✅ RIGHT — src/components/Navigation.tsx: only the feature's own CSS file
import "../styles/Navigation.css";
```

```tsx
// src/main.tsx — the one place theme.css / ui.css are imported
import './styles/theme.css'
import './styles/ui.css'
```

## Rule UI-5: Shell/page markup styles with hand-written CSS classes, not Tailwind utility classes

`tailwind.config.js` scans `./src/**/*.{js,jsx,ts,tsx}` and Tailwind is imported via
`@import "tailwindcss";` in `src/index.css`, but no wired shell page (`App.tsx`, `Navigation.tsx`,
`src/pages/**`, `src/components/modals/**`, `src/components/ui/**`) styles itself with Tailwind
utility classes — they use classes from their own page CSS file plus the shared `ui.css` classes
(`.btn`, `.chip`, `.field`, `.surface`, …).

```tsx
❌ WRONG — new nav item styled with Tailwind utilities
<button className="flex items-center gap-2 px-3 py-2 text-sm text-white/70 hover:text-white">
  Games
</button>

✅ RIGHT — src/components/Navigation.tsx, styled via Navigation.css
<button type="button" onClick={() => go("play")} className="nav-link">Games</button>
```

**Exception:** `src/components/Footer.tsx` is written entirely in Tailwind utility classes
(`className="bg-[#292929] text-white py-10 px-6 flex flex-col …"`) — but it is not imported or
rendered anywhere in the app (not in `App.tsx`, not in any page). It is dead code, not a second
convention; don't use it as a template for new shell UI.

## Rule UI-6: New component-scoped classes take a short, unique prefix — all CSS is global

There are no CSS Modules and no `styled-components`; every class is global. Existing shell
components avoid collisions with a short prefix per component: `.nav3-*` (`Navigation.css`),
`.gtile-*` (`ui.css`, the landing-page game card), `.lbf-*` (the full leaderboard modal,
`Modal.css`), `.fb-*` (feedback modal, `Modal.css`), `.instr-*` (instructions modal, `Modal.css`),
`.auth-*` (login/signup, `Modal.css`), `.rail-*` / `.aside-*` (`MiniGame.css`).

```css
❌ WRONG — generic names that will collide with something else's .card/.row
.card { border: 1px solid var(--line); }
.row { display: flex; align-items: center; }

✅ RIGHT — src/styles/Modal.css, prefixed per feature
.lbf-row { display: flex; align-items: center; gap: 11px; }
.fb-star { background: none; border: none; cursor: pointer; }
```

## Rule UI-7: Non-game chrome colors/spacing come from `theme.css` tokens, and the app is dark-only at runtime

Shell CSS reads the same custom properties as game CSS (`var(--surface)`, `var(--text)`,
`var(--muted)`, `var(--brand)`, `var(--line)`, `var(--shadow)`, …) defined in
`src/styles/theme.css`. Never hardcode a hex value that has a token.

```css
❌ WRONG — a hardcoded hex where a token already exists
.new-banner { background: #1c1c1e; color: #9c9a95; border: 1px solid rgba(255,255,255,.09); }

✅ RIGHT — the same values, via theme.css tokens
.new-banner { background: var(--surface); color: var(--muted); border: 1px solid var(--line); }
```

`theme.css` also defines a full `.light` palette (lines 53–70), but `src/App.tsx` actively
strips it on every mount:

```tsx
// src/App.tsx
useEffect(() => {
  document.documentElement.classList.remove("light");
  try { localStorage.setItem("nba3via-theme", "dark"); } catch { /* ignore */ }
}, []);
```

So the light tokens exist in CSS but are unreachable in the running app — build and review shell
UI as dark-only; don't rely on `.light` ever being applied, and don't spend effort tuning it.

## Rule UI-8: Every overlay goes through the single `ModalHost` + `Modal` shell

`src/components/ModalHost.tsx` is mounted once in `App.tsx` and owns the only `.modal-backdrop`/
`.modal-panel` in the app. `src/context/ModalContext.tsx` exposes `open(kind, payload)` /
`close()`; `src/components/ui/Modal.tsx` owns the backdrop, panel, title bar, close button,
Escape-to-close, focus trap, and body-scroll lock. A new overlay is a new `ModalKind` plus a
`content` branch in `ModalHost.tsx` and a small presentational component (see
`src/components/modals/FeedbackModal.tsx`, `LeaderboardModal.tsx`, `InstructionsModal.tsx`) that
only receives `onClose` — it never renders its own backdrop.

```tsx
❌ WRONG — a component rendering its own overlay outside ModalHost
function ShareDialog({ onClose }: { onClose: () => void }) {
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-panel">…</div>
    </div>
  );
}

✅ RIGHT — add a ModalKind, let ModalHost render the shared Modal shell
// src/context/ModalContext.tsx
export type ModalKind = "login" | "feedback" | "leaderboard" | "instructions" | "share";

// src/components/ModalHost.tsx
} else if (kind === "share") {
  title = "Share this game";
  content = <ShareModal onClose={close} />;
}
```

## Rule UI-9: One-shot system messages use SweetAlert2 via `src/utils/Alerts.tsx`, not a bespoke toast

Errors and one-shot confirmations (not in-app content) go through `showErrorAlert` /
`showNewUserAlert` in `src/utils/Alerts.tsx`, which call `Swal.fire(...)` with the
`swal2-custom-popup` / `swal2-custom-button` classes. `src/pages/Trivia/MiniGame.tsx` uses this
for "Finish your current game first." when a player tries to switch games mid-round. This is a
different mechanism from `ModalHost` — reserve `ModalHost` for actual in-app content (forms,
lists, instructions), and `Alerts.tsx` for a single blocking message.

```tsx
❌ WRONG — a one-off error routed through the modal system
open("error", { message: "Finish your current game first." });

✅ RIGHT — src/pages/Trivia/MiniGame.tsx
showErrorAlert("Finish your current game first.", "Game in progress", "Continue playing");
```

The SweetAlert style overrides (`.swal2-custom-popup`, `.swal2-custom-button`) live in
`src/styles/LandPage.css` (lines ~335–367) even though the alerts themselves fire from
`MiniGame.tsx` and other non-landing-page code — that's the file to edit if the SweetAlert look
needs to change, despite the misleading location.

## Rule UI-10: `<Button>` is for CTA-weight actions; small inline controls are hand-rolled `<button>`s

`src/components/ui/Button.tsx` (the `.btn-primary`/`.btn-secondary`/etc. wrapper with
framer-motion hover/tap) is used for primary and secondary calls to action: "Play" on the idle
screen, "Log in", "Play today's game" / "Browse all games", "Back to games". Small inline
controls — nav links, the mobile drawer links, the info/exit/close icon buttons, rail chips —
are plain `<button className="…">` elements styled by the owning page's CSS file, not `<Button>`.

```tsx
❌ WRONG — wrapping every small control in the CTA Button component
<Button size="sm" variant="ghost" onClick={() => go("play")}>Games</Button>

✅ RIGHT — src/components/Navigation.tsx, a hand-rolled control for a small nav link
<button type="button" onClick={() => go("play")} className="nav-link">Games</button>

✅ RIGHT — src/pages/Landpage.tsx, a CTA using the shared Button
<Button size="lg" onClick={() => openGame(games[0].id, games[0].urlPath)}>
  Play today's game
</Button>
```

## Rule UI-11: Icons in shell chrome are hand-written inline SVG, not an icon library

Every icon actually rendered in the shell (`Navigation.tsx`'s hamburger/close, `Modal.tsx`'s
close button, `Landpage.tsx`'s play/search icons) is an inline `<svg>` with
`viewBox="0 0 24 24"`, `stroke="currentColor"`, `strokeWidth` in the 2–2.4 range, and
`strokeLinecap="round"`. `@fortawesome/react-fontawesome` only appears in
`src/components/Footer.tsx`, which (per Rule UI-5) is not mounted anywhere — it is not a second
icon convention to follow.

```tsx
❌ WRONG — pulling in an icon library for a new shell button
import { faBell } from "@fortawesome/free-solid-svg-icons";
<FontAwesomeIcon icon={faBell} />

✅ RIGHT — src/components/ui/Modal.tsx, matching the rest of the shell
<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
  <path d="M18 6L6 18M6 6l12 12" />
</svg>
```

## Rule UI-12: Fixed/sticky shell chrome uses a fixed z-index scale — don't pick an arbitrary number

Observed literal values, low to high: `.feedback-fab` (`src/styles/LandPage.css`) `z-index: 35` <
`.nav3` sticky nav (`src/styles/Navigation.css`) `z-index: 40` < `.modal-backdrop`
(`src/styles/Modal.css`) `z-index: 60` < `.drawer-panel` mobile menu (`src/styles/Navigation.css`)
`z-index: 70`. A new page-level fixed/sticky element should slot into this scale rather than
inventing a value (elements scoped inside a card, like the `.games-search` icon's local
`z-index: 1`, are a separate local stacking context and don't need to fit this scale).

```css
❌ WRONG — an arbitrary high value for a new floating element
.new-banner { position: fixed; z-index: 999; }

✅ RIGHT — src/styles/LandPage.css, sits below the sticky nav
.feedback-fab { position: fixed; right: 18px; bottom: 18px; z-index: 35; }
```

## Rule UI-13: Reuse the existing breakpoint set — don't invent new pixel values

The shell reuses a fixed handful of breakpoints rather than a per-component ad hoc value:
`480px` / `640px` / `900px` (`src/styles/ui.css`'s `.hide-xs`/`.hide-sm`/`.hide-md`, and
`src/styles/LandPage.css`'s mobile reflow at 640px / engage-strip stack at 900px), `560px`
(`src/styles/Modal.css`'s mobile bottom-sheet dock), and `819px`/`820px` +
`1199px`/`1200px` (`src/styles/MiniGame.css`'s rail-strip↔rail and aside-column breakpoints).

```css
❌ WRONG — a new breakpoint that doesn't match anything else in the shell
@media (max-width: 768px) { .new-widget { display: none; } }

✅ RIGHT — src/styles/ui.css, one of the existing breakpoints
@media (max-width: 900px) { .hide-md { display: none !important; } }
```

## Rule UI-14: Route-level transitions are owned by `PageTransition` — pages don't add their own

`src/App.tsx`'s `AnimatedRoutes` wraps every route element in one `PageTransition` component
(`opacity`/`scale` fade, `0.4s` in / `0.3s` out). A page must not add a second top-level
enter/exit animation around its own root — scroll-triggered motion *inside* the page (e.g.
`src/components/motion/Reveal.tsx`, used in `Landpage.tsx`) is fine, a competing whole-page
transition is not.

```tsx
❌ WRONG — a page re-animating its own root on top of PageTransition
const Landpage = () => (
  <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
    <div className="app-shell">…</div>
  </motion.div>
);

✅ RIGHT — src/App.tsx owns the one route-level transition
function PageTransition({ children }: { children: ReactNode }) {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.98 }}
      animate={{ opacity: 1, scale: 1, transition: { duration: 0.4, ease: "easeOut" } }}
      exit={{ opacity: 0, scale: 0.98, transition: { duration: 0.3, ease: "easeIn" } }}
      className="w-full h-full"
    >
      {children}
    </motion.div>
  );
}
```

## Rule UI-15: Use the shared `.hide-xs`/`.hide-sm`/`.hide-md` utilities for simple breakpoint show/hide

`src/styles/ui.css` defines `.hide-xs` (≤480px), `.hide-sm` (≤640px), `.hide-md` (≤900px) as the
standard way to hide an element at a breakpoint — `Navigation.tsx` uses `hide-md` on the desktop
nav links/right side and `hide-sm` on the username block.

```tsx
❌ WRONG — a bespoke media query duplicating a breakpoint ui.css already covers
// SomeWidget.css
@media (max-width: 900px) { .some-widget-extra { display: none; } }

✅ RIGHT — src/components/Navigation.tsx, the shared utility class
<div className="nav3-links hide-md">{navLinks}</div>
<div className="nav3-right hide-md"> … </div>
```

**Exception:** `src/styles/Navigation.css` also defines its own local `.show-md` (display none by
default, `inline-flex` at ≤900px) for the mobile hamburger button instead of inverting the shared
`.hide-md` utility — both the shared hide-* set and this one bespoke show-* class exist side by
side for nav-specific show/hide; don't be surprised the two conventions coexist, but default to
`.hide-xs`/`.hide-sm`/`.hide-md` for anything new.

---

## Acceptance checks

Concrete DevTools/console checks a QA agent can run.

**1. Every route renders the shell (Rule UI-1).** Navigate to `/`, `/series-winner`, and
`/coming-soon`, and on each run:
```js
({
  hasShell: !!document.querySelector('.app-shell'),
  hasMain: !!document.querySelector('main.page'),
});
```
`/` and `/series-winner` → both `true`. `/coming-soon` (`NoPageFound`) is the documented
exception and may be `false`.

**2. Single overlay host (Rule UI-8).** Open any overlay (Log in, Feedback, Leaderboard, or a
game's info button) and run:
```js
document.querySelectorAll('.modal-backdrop').length;   // MUST be 1
!!document.querySelector('.modal-backdrop .modal-panel'); // MUST be true
```

**3. Z-index scale (Rule UI-12).** With a modal open, run:
```js
const z = sel => { const el = document.querySelector(sel); return el && +getComputedStyle(el).zIndex; };
({ fab: z('.feedback-fab'), nav: z('.nav3'), modalBackdrop: z('.modal-backdrop') });
// expect 35, 40, 60 respectively (fab only present on the landing page)
```
Open the mobile drawer (viewport ≤900px, tap the hamburger) and check
`z('.drawer-panel')` → `70`.

**4. Breakpoint reuse (Rule UI-13).** Resize to 899px then 901px and diff
`getComputedStyle(document.querySelector('.nav3-links')).display` (`flex` → `none` crossing
900px). Resize to 819px then 821px on a game page and diff
`getComputedStyle(document.querySelector('.rail')).display` / `.rail-strip` visibility.

**5. No icon library in wired shell code (Rule UI-11).** From the repo root:
```bash
grep -rl "@fortawesome\|react-icons\|lucide-react" src/App.tsx src/components/Navigation.tsx src/pages src/components/modals src/components/ui
```
Expect no output (the only hit repo-wide is the unused `src/components/Footer.tsx`).

**6. No Tailwind utilities in wired shell code (Rule UI-5).**
```bash
grep -rnE 'className="[^"]*\b(flex|grid|px-[0-9]|py-[0-9]|text-(sm|lg|white)|bg-\[)' src/App.tsx src/components/Navigation.tsx src/pages src/components/modals
```
Expect no output outside `src/pages/Landpage.tsx`'s single incidental `games-grid3` class name
(which is not a Tailwind utility — it's a page-CSS class that happens to contain a digit).
