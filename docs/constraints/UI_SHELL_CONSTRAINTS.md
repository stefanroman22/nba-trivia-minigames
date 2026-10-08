# UI Shell Constraints (non-game chrome)

**Scope:** everything a player sees that is *not* a game renderer — the App Router shell, routing,
navigation, pages/views, modals/overlays, the shared `components/ui/` and `components/motion/`
toolkits, and their styling conventions. Game renderers (`src/Game Renderers/*.tsx`) and the in-game
stage/idle/loading/feedback/end-of-game system are `docs/GAME_DESIGN_CONSTRAINTS.md` territory — this
doc does not repeat any of those rules (`Stage`, `GameFrame`, `CourtLoader`, `TeamCrest`,
`SubmitGuessPopup`, `.stage-*`, `.playing-wrap`, `.feedback-slot`, etc. are covered there).

The frontend is Next.js 16 (App Router) + React + TypeScript, migrated from Vite/React Router in
Sept 2026. Route files live in `src/app/`; page components live in `src/views/` (not `src/pages/`).

**Reference implementations** (read these before touching shell code):

| Concern | Reference |
|---|---|
| Root layout + global CSS + providers | `src/app/layout.tsx`, `src/app/providers.tsx` |
| Page shell (`app-shell` + `Navigation` + `main.page`) | `src/views/Landpage.tsx`, `src/views/Trivia/MiniGame.tsx`, `src/views/Admin.tsx` |
| Routing / route-level transition | `src/app/[game]/page.tsx` (one dynamic route for every game), `src/app/template.tsx` + `src/context/PageTransitionContext.tsx` + `src/hooks/useNavigate.ts` |
| Single overlay host | `src/components/ModalHost.tsx`, `src/context/ModalContext.tsx`, `src/components/ui/Modal.tsx` |
| Shared design-system primitives | `src/components/ui/index.ts` |
| Sliding tab/pill switcher | `src/components/motion/SegmentedTabs.tsx` + `src/styles/SegmentedTabs.css` + `springs.thumb` in `src/motion/tokens.ts` |
| Animated label swap ("Copy"→"Copied!") | `src/components/motion/SwapText.tsx` (see `src/components/modals/FeedbackModal.tsx`) |
| One-shot system messages (not modals) | `src/utils/Alerts.tsx` |
| Game visibility | `visibleGames` in `src/utils/GameUtils.tsx` |

Everything below is measured from the live codebase. Where the code is inconsistent, the DOMINANT
pattern is documented and the exception is called out explicitly — nothing here is an aspirational
convention the code doesn't actually show.

---

## Rule UI-1: A page owns its own shell — `.app-shell` → `<Navigation>` → `<main class="page …">`

There is no shared `<Layout>` wrapper. `src/app/layout.tsx` + `src/app/providers.tsx` only set up
global CSS, providers and the `#root` container; each top-level page (`src/views/Landpage.tsx`,
`src/views/Trivia/MiniGame.tsx`, `src/views/Admin.tsx`) renders the shell markup itself. The
`.app-shell` / `.page` rules live in `src/styles/LandPage.css`.

```tsx
❌ WRONG — the root layout wrapping every page in a shared shell
// src/app/layout.tsx
<Providers><AppShellLayout>{children}</AppShellLayout></Providers>

✅ RIGHT — every page renders its own shell (Landpage.tsx)
<div className="app-shell">
  <Navigation type="full" />
  <main className="page">
    {/* page content */}
  </main>
</div>
```

`src/views/NoPageFound.tsx` (rendered by `src/app/not-found.tsx` and `src/app/coming-soon/page.tsx`)
is the one page that skips the shell (no `Navigation`, no `.app-shell`/`.page`) — it renders a
full-bleed centered message. That is a deliberate exception for the not-found state, not something
to copy for a real page.

## Rule UI-2: A new game is a catalogue entry that the single `[game]` route serves, never a new page

`src/app/[game]/page.tsx` is the one route for every game path: `generateStaticParams` is built from
`visibleGames` in `src/utils/GameUtils.tsx` (minus `coming-soon`, which has its own
`src/app/coming-soon/page.tsx`), `dynamicParams = false` makes every other slug a 404, and it always
renders the same `<MiniGame />`. `MiniGame` resolves the game from the URL
(`games.find(g => g.urlPath === pathname)?.id` in `src/views/Trivia/MiniGame.tsx`).

```tsx
❌ WRONG — a bespoke page per game
// src/app/new-game/page.tsx
export default function NewGamePage() { return <NewGameScreen />; }

✅ RIGHT — nothing to route by hand: add the entry to games[] and the [game] route serves it
{ id: "new-game", name: "New Game", urlPath: "/new-game", /* … */ }
```

Adding a game is a `Game` entry in `src/utils/GameUtils.tsx` — the touchpoints are in
`GAME_DESIGN_CONSTRAINTS.md` → "Adding a game"; never a new file under `src/views/` or `src/app/`.

## Rule UI-3: `Navigation`'s `type` prop decides scroll-in-place vs navigate-then-scroll

`src/components/Navigation.tsx` takes `type?: "full" | "back"`. On `"full"` (the landing page) a nav
link scrolls the current page; on `"back"` (game pages, and `Admin.tsx`) the same click navigates to
`/#<section>`. Next scrolls to the hash while `src/app/template.tsx`'s enter transform
(`scale: 0.98`) is still active, so its rect-based scroll lands short. `Landpage.tsx` therefore
re-runs a layout-based scroll one frame after mount, and `scrollToSection`
(`src/utils/ScrolllToSection.tsx`) sums `offsetTop` up the `offsetParent` chain minus the target's
`scrollMarginTop` instead of using `scrollIntoView()`.

```tsx
❌ WRONG — game page using type="full", so "Games" tries to scroll a section that
   doesn't exist on /series-winner
<Navigation type="full" />

✅ RIGHT — Navigation.tsx's own go() helper, wired by the `type` prop
const go = (section: string) => {
  setDrawer(false);
  if (type === "full") {
    scrollToSection(section);
  } else {
    navigate(`/#${section}`);
  }
};
```

```tsx
✅ RIGHT — src/views/Landpage.tsx re-scrolls once on mount, overriding Next's transform-skewed hash scroll
useEffect(() => {
  const id = window.location.hash.slice(1);
  if (!id || !document.getElementById(id)) return;
  const raf = window.requestAnimationFrame(() => scrollToSection(id));
  return () => window.cancelAnimationFrame(raf);
}, []);
```

Any new top-level page must pick `type` explicitly. Exception: the hero's "Browse all games" button
in `Landpage.tsx` calls `getElementById("games-grid")?.scrollIntoView(...)` directly; it runs long
after mount so the transform is not an issue, but new code should use `scrollToSection`.

## Rule UI-4: One CSS file per page/feature, imported by its owner; the shared layers are imported once, in `layout.tsx`

Feature/page stylesheets live in `src/styles/<Name>.css` and are imported by the component that owns
them (`Navigation.tsx` → `Navigation.css`, `ui/Modal.tsx` → `Modal.css`, `views/Landpage.tsx` →
`LandPage.css`, `views/Trivia/MiniGame.tsx` → `MiniGame.css`, `motion/SegmentedTabs.tsx` →
`SegmentedTabs.css`). All CSS is global under Next (no CSS Modules), and the shared layers are
imported once in `src/app/layout.tsx`: `theme.css`, `ui.css`, `src/index.css` (Tailwind import),
`src/App.css` (`#root`), and `LandPage.css` + `GlobalStyles.css` — the last two globally on purpose,
because `LandPage.css` owns `.app-shell`/`.page` that game and admin pages rely on, and Next would
otherwise scope them to `/`.

```tsx
❌ WRONG — a shell component re-importing the shared layers
import "../styles/theme.css";   // already global via app/layout.tsx
import "../styles/ui.css";

✅ RIGHT — src/components/Navigation.tsx: only the feature's own CSS file
import "../styles/Navigation.css";
```

Note: `src/views/Admin.tsx` and `Landpage.tsx` also re-import `LandPage.css`/`GlobalStyles.css`
(harmless duplication; don't add more).

## Rule UI-5: Shell/page markup styles with hand-written CSS classes, not Tailwind utilities

Tailwind is live (`@import "tailwindcss";` in `src/index.css`, loaded by `layout.tsx`;
`postcss.config.js` uses `@tailwindcss/postcss`; `tailwind.config.js` scans `./src/**/*.{js,jsx,ts,tsx}`),
but no shell page (`Navigation.tsx`, `src/views/**`, `src/components/modals/**`,
`src/components/ui/**`) styles itself with utilities. They use classes from their own page CSS plus
the shared `ui.css` classes (`.btn`, `.chip`, `.field`, `.surface`, …) and inline `style` for
one-offs.

```tsx
❌ WRONG — new nav item styled with Tailwind utilities
<button className="flex items-center gap-2 px-3 py-2 text-sm text-white/70 hover:text-white">Games</button>

✅ RIGHT — src/components/Navigation.tsx, styled via Navigation.css
<button type="button" onClick={() => go("games-grid")} className="nav-link">Games</button>
```

**Exceptions:** `src/app/template.tsx` uses `className="w-full h-full"` (the only live Tailwind
utility in the shell); `src/components/Footer.tsx` is written entirely in Tailwind but is not imported
by anything (dead code, not a second convention). Don't use either as a template. (`tailwind.config.js`
also lists a nonexistent `./index.html`, a Vite leftover — harmless.)

## Rule UI-6: New component-scoped classes take a short, unique prefix — all CSS is global

Every class is global. Shell components avoid collisions with a per-feature prefix: `.nav3-*`
(`Navigation.css`), `.gtile-*` (`ui.css`), `.lbf-*` / `.fb-*` / `.instr-*` / `.auth-*` /
`.modal-*` (`Modal.css`), `.rail-*` / `.aside-*` (`MiniGame.css`), `.admin-*` (`Admin.css`),
`.seg-*` (`SegmentedTabs.css`).

```css
❌ WRONG — generic names that will collide with something else's .card/.row
.card { border: 1px solid var(--line); }
.row { display: flex; align-items: center; }

✅ RIGHT — src/styles/Modal.css, prefixed per feature
.lbf-row { display: flex; align-items: center; gap: 11px; }
.fb-star { background: none; border: none; cursor: pointer; }
```

## Rule UI-7: Non-game chrome colors come from `theme.css` tokens, and the app is dark-only at runtime

Shell CSS reads the custom properties in `src/styles/theme.css` (`var(--surface)`, `var(--text)`,
`var(--muted)`, `var(--brand)`, `var(--line)`, `var(--shadow)`, …). Never hardcode a hex that has a
token. (Known exceptions: `src/utils/Alerts.tsx` passes `background: "#1c1c1e"` to SweetAlert2 and
the popup CSS overrides it with tokens; `.btn-primary` deliberately uses `#201005` for contrast.)

```css
❌ WRONG — a hardcoded hex where a token already exists
.new-banner { background: #1c1c1e; color: #9c9a95; border: 1px solid rgba(255,255,255,.09); }

✅ RIGHT — the same values, via theme.css tokens
.new-banner { background: var(--surface); color: var(--muted); border: 1px solid var(--line); }
```

`theme.css` also defines a `.light` palette, but `src/app/providers.tsx` strips it on every mount:

```tsx
// src/app/providers.tsx (AppEffects)
document.documentElement.classList.remove("light");
try { localStorage.setItem("nba3via-theme", "dark"); } catch { /* ignore */ }
```

Build and review shell UI as dark-only. `src/hooks/useTheme.ts` (a toggle hook) exists but nothing in
the shell mounts a theme toggle; don't wire one in.

## Rule UI-8: Every overlay goes through the single `ModalHost` + `Modal` shell

`src/components/ModalHost.tsx` is mounted once in `src/app/providers.tsx` and owns the only
`.modal-backdrop`/`.modal-panel`. `src/context/ModalContext.tsx` exposes `open(kind, payload)` /
`close()`; `src/components/ui/Modal.tsx` owns backdrop, panel, title bar, close button,
Escape-to-close, focus trap, focus restore and body-scroll lock, and `ModalHost` wraps it in
`<AnimatePresence>` keyed by `kind`. A new overlay is a new `ModalKind` plus a branch in
`ModalHost.tsx` and a presentational component in `src/components/modals/` that only receives
`onClose` (never its own backdrop). Current kinds: `login`, `feedback`, `leaderboard`,
`instructions`, `multiplayerInfo`.

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
export type ModalKind = "login" | "feedback" | "leaderboard" | "instructions" | "multiplayerInfo";

// src/components/ModalHost.tsx
} else if (kind === "multiplayerInfo") {
  title = "Multiplayer";
  content = <MultiplayerInfoModal onClose={close} />;
}
```

Use `wide` (via the `wide` flag set in `ModalHost`, as `leaderboard` does) rather than a custom
panel width. Open from UI with `useModal().open(kind)`; `Navigation.tsx` closes the mobile drawer
first when it opens a modal.

## Rule UI-9: One-shot system messages use SweetAlert2 via `src/utils/Alerts.tsx`, not a bespoke toast

Errors and one-shot confirmations go through `showErrorAlert` in
`src/utils/Alerts.tsx`, which lazy-imports `sweetalert2` (kept out of the startup bundle) and style it
with `swal2-custom-popup` / `swal2-custom-button`. `MiniGame.tsx` uses it for "Finish your current
game first." Reserve `ModalHost` for in-app content (forms, lists, instructions). There is no toast
library; the in-game "Correct! +10" line is the shell-owned feedback slot
(`GAME_DESIGN_CONSTRAINTS.md` Rule 6.1), not a toast.

Forms inside a modal report their own outcome inline instead: the auth modal (`LogInSignUp.tsx`)
and `FeedbackModal.tsx` show errors in an inline `role="alert"` slot and success as an in-modal
pane (`SuccessBadge`), never a SweetAlert.

```tsx
❌ WRONG — a one-off error routed through the modal system
open("error", { message: "Finish your current game first." });

✅ RIGHT — src/views/Trivia/MiniGame.tsx
showErrorAlert("Finish your current game first.", "Game in progress", "Continue playing");
```

The `.swal2-*` overrides live in `src/styles/LandPage.css` (global via `layout.tsx`) even though the
alerts fire from non-landing code — edit that file to change the look. Any new `Swal.fire` outside
`Alerts.tsx` (as `src/components/GameCard.tsx` and `src/utils/GameUtils.tsx` do today) must use the
same `customClass` names.

## Rule UI-10: `<Button>` is for CTA-weight actions; small inline controls are hand-rolled `<button>`s

`src/components/ui/Button.tsx` (`.btn .btn-<variant> .btn-<size>` with framer-motion hover/tap, both
disabled under reduced motion) is for primary/secondary calls to action: "Play", "Log in", "Play
today's game", "Back to games". Small inline controls — nav links, drawer links, icon buttons, rail
chips — are plain `<button className="…">` styled by the owning page CSS.

```tsx
❌ WRONG — wrapping every small control in the CTA Button component
<Button size="sm" variant="ghost" onClick={() => go("games-grid")}>Games</Button>

✅ RIGHT — src/components/Navigation.tsx, a hand-rolled control for a small nav link
<button type="button" onClick={() => go("games-grid")} className="nav-link">Games</button>

✅ RIGHT — src/views/Landpage.tsx, a CTA using the shared Button
<Button size="lg" onClick={() => openGame(games[0].id, games[0].urlPath)}>Play today's game</Button>
```

Exception: modal forms use `.modal-primary-btn` (`Modal.css`) rather than `<Button>`. Follow that
inside modals.

## Rule UI-11: Icons in shell chrome are hand-written inline SVG, not an icon library

Every icon in `Navigation.tsx`, `ui/Modal.tsx`, `Landpage.tsx`, `ui/GameTile.tsx` is an inline
`<svg viewBox="0 0 24 24">` with `stroke="currentColor"`, `strokeWidth` 2–2.6 and
`strokeLinecap="round"`.

```tsx
❌ WRONG — pulling in an icon library for a new shell button
import { faBell } from "@fortawesome/free-solid-svg-icons";
<FontAwesomeIcon icon={faBell} />

✅ RIGHT — src/components/ui/Modal.tsx, matching the rest of the shell
<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
  <path d="M18 6L6 18M6 6l12 12" />
</svg>
```

**Exceptions:** `src/components/Footer.tsx` imports FontAwesome but is unmounted. `src/components/LogInSignUp.tsx`
is live (rendered by `ModalHost` for `login`) and imports `FontAwesomeIcon` (`faEye`/`faEyeSlash`,
`faGoogle`). Don't extend FontAwesome into new chrome and don't drive-by rewrite that file.

## Rule UI-12: Fixed/sticky chrome uses the existing z-index scale — don't pick an arbitrary number

Observed shell scale, low to high: `.feedback-fab` (`LandPage.css`) `35` < `.nav3` (`Navigation.css`)
`40` < `.modal-backdrop` (`Modal.css`) `60` < `.drawer-panel` (`Navigation.css`) `70`. A new
page-level fixed/sticky element slots into this scale. Local stacking inside a card (`.gtile-*` 0–2,
`.seg-label` 1, `.feedback-slot` 5 in `MiniGame.css`, `.games-search svg` 1) is a separate concern.
Existing outliers, not to be copied: `EnvBadge.tsx` `9999` (dev-only badge), the confetti layer in
`GameResult.tsx` `9998`, `AutoCompleteInput.tsx` dropdown `1000`.

```css
❌ WRONG — an arbitrary high value for a new floating element
.new-banner { position: fixed; z-index: 999; }

✅ RIGHT — src/styles/LandPage.css, sits below the sticky nav
.feedback-fab { position: fixed; right: 18px; bottom: 18px; z-index: 35; }
```

## Rule UI-13: Reuse the existing breakpoint set — don't invent new pixel values

Shell breakpoints: `480px` / `640px` / `900px` (`ui.css` `.hide-xs`/`.hide-sm`/`.hide-md`;
`LandPage.css` reflows at `640px` and `900px`), `560px` (`Modal.css` bottom-sheet dock), and
`819px`/`820px` + `1199px`/`1200px` (`MiniGame.css` rail/aside layout; `ui.css` `--stage-max` at
`819px`). Per-game CSS files add their own (`400`, `480`, `620`, `760`) — that is game territory,
not a shell precedent.

```css
❌ WRONG — a new breakpoint that doesn't match anything else in the shell
@media (max-width: 768px) { .new-widget { display: none; } }

✅ RIGHT — src/styles/ui.css, one of the existing breakpoints
@media (max-width: 900px) { .hide-md { display: none !important; } }
```

Breakpoints are max-width for the shared utilities and `Navigation.css`; `MiniGame.css` mixes
`min-width: 820px/1200px` with `max-width: 819px/1199px` (keep the 1px pairing exact).

## Rule UI-14: Route-level transitions are owned by `template.tsx` + `PageTransitionContext` — pages don't add their own

`src/app/template.tsx` remounts on every route change and wraps each page in one fade/scale
(`0.4s easeOut` in, `0.3s easeIn` out). The exit can't be animated by the App Router, so
`navigate()` in `src/context/PageTransitionContext.tsx` sets `leaving`, waits `EXIT_MS = 300` (must
match the exit duration in `template.tsx`), then `router.push`. The first paint (`hasNavigated`
false) does not animate because it is the LCP. A page must not add a second whole-page
enter/exit; scroll-triggered motion inside the page (`src/components/motion/Reveal.tsx`) is fine.

```tsx
❌ WRONG — a page re-animating its own root on top of the template
const Landpage = () => (
  <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
    <div className="app-shell">…</div>
  </motion.div>
);

✅ RIGHT — src/app/template.tsx owns the one route-level transition
<motion.div
  initial={hasNavigated ? { opacity: 0, scale: 0.98 } : false}
  animate={leaving
    ? { opacity: 0, scale: 0.98, transition: { duration: 0.3, ease: "easeIn" } }
    : { opacity: 1, scale: 1, transition: { duration: 0.4, ease: "easeOut" } }}
  className="w-full h-full"
>
  {children}
</motion.div>
```

Server-rendered hero content follows the same LCP logic: `Landpage.tsx` entrances are slide-only
(`initial={{ y: 14 }}`, no opacity 0) so the static page isn't invisible before hydration. Don't
start SSR'd above-the-fold elements at `opacity: 0`.

## Rule UI-15: Use the shared `.hide-xs`/`.hide-sm`/`.hide-md` utilities for simple breakpoint show/hide

`src/styles/ui.css` defines `.hide-xs` (≤480px), `.hide-sm` (≤640px), `.hide-md` (≤900px).
`Navigation.tsx` uses `hide-md` on the desktop links, the right-side block and the username/#id
meta of the user chip (avatar-only on mobile).

```tsx
❌ WRONG — a bespoke media query duplicating a breakpoint ui.css already covers
// SomeWidget.css
@media (max-width: 900px) { .some-widget-extra { display: none; } }

✅ RIGHT — src/components/Navigation.tsx, the shared utility class
<div className="nav3-links hide-md">{navLinks}</div>
<div className="nav3-right hide-md"> … </div>
```

**Exception:** `Navigation.css` defines its own `.show-md` (hidden by default, `inline-flex` at
≤900px) for the hamburger group. Both conventions coexist; default to the shared `hide-*` set for
new work.

## Rule UI-16: Every single-track tab/pill switcher uses `SegmentedTabs`

`src/components/motion/SegmentedTabs.tsx` is the one place tab/pill switchers get their sliding
active-option thumb (a framer-motion `layoutId` span, spring `springs.thumb` from
`src/motion/tokens.ts`, `{ duration: 0 }` under reduced motion). The caller keeps its own track and
button classes for size/shape (`className`, `itemClassName`, `thumbRadius` matching the button's
border-radius); the fill and label layering come from `src/styles/SegmentedTabs.css`, so the
caller's `.is-active` rule must set only the label colour, not a background. Current users:
`LeaderboardModal.tsx` and `Leaderboard.tsx` (`lb-scope`), `FriendsPanel.tsx` (`fr-tabs`),
`LogInSignUp.tsx` (`auth-tabs`), `UserProfile.tsx`. Override the thumb colour with `--seg-thumb-bg`
(default `var(--brand)`).

```tsx
❌ WRONG — a hand-rolled switcher that just toggles a background class
<div className="lb-scope">
  {LEADERBOARD_SCOPES.map((s) => (
    <button key={s.key} className={`lb-scope-btn${scope === s.key ? " is-active" : ""}`} onClick={() => setScope(s.key)}>
      {s.label}
    </button>
  ))}
</div>

✅ RIGHT — src/components/modals/LeaderboardModal.tsx
<SegmentedTabs className="lb-scope" itemClassName="lb-scope-btn" options={LEADERBOARD_SCOPES} value={scope} onChange={setScope} />
```

**Known not-yet-migrated exceptions:** `src/views/Admin.tsx` (`.admin-tabs`, separate gapped bordered
chips with a `tablist` role) and the `.fb-pill` filter groups in `src/components/admin/FeedbackTab.tsx`
(period/granularity toggles). Treat them as legacy; a new or reworked single-select switcher must use
`SegmentedTabs`. Multi-select toggles and free-standing chips (`rail-chip`) are not switchers.

## Rule UI-17: Navigate only through `useNavigate` — never `next/link`, `useRouter`, or `react-router`

`src/hooks/useNavigate.ts` is a drop-in for React Router's `navigate(path, { state })` that plays the
exit fade and then pushes the route (`PageTransitionContext`). The `state` option is accepted for
source compatibility but ignored — every game resolves from the URL path. `useRouter` from
`next/navigation` appears only inside `PageTransitionContext.tsx`; elsewhere only read-only
`usePathname` is used (`MiniGame.tsx`, `MultiplayerContext.tsx`). There is no `next/link` and no
`react-router` in the app.

```tsx
❌ WRONG — bypasses the exit transition and the leaving flag
import { useRouter } from "next/navigation";
const router = useRouter();
router.push(g.urlPath);

✅ RIGHT — src/views/Trivia/MiniGame.tsx
import { useNavigate } from '../../hooks/useNavigate';
const navigate = useNavigate();
navigate(g.urlPath, { state: { id: g.id } });
```

Pass hash targets as a plain string (`navigate("/#games-grid")`, as `Navigation.tsx` does). Navigating
to the current path skips the transition and calls `router.push` directly.

## Rule UI-18: `src/app/` files are thin server-side wrappers; page logic lives in `src/views/` behind `"use client"`

Route files (`page.tsx`, `not-found.tsx`, `coming-soon/page.tsx`, `admin/page.tsx`) only render a
view and export `metadata`/`generateMetadata` (title template `%s | HOOPS24` from `layout.tsx`;
`/admin` also sets `robots: { index: false, follow: false }`). Views and providers that use hooks,
Redux or framer-motion start with `"use client"` (`Landpage.tsx`, `Admin.tsx`, `NoPageFound.tsx`,
`MiniGame.tsx`, `providers.tsx`, `template.tsx`, `PageTransitionContext.tsx`). Client-only
components (`Navigation`, `ModalHost`, modals) carry no directive of their own and are only imported
from client trees. Keep `layout.tsx` a server component: providers go in `providers.tsx`, not inline.

Route files also own SEO: `metadataBase`, canonical, Open Graph and Twitter tags come from `layout.tsx`
plus each route's `generateMetadata`; every absolute URL derives from `src/configurations/site.ts`
(`SITE_URL`); JSON-LD is rendered with `<JsonLd>` in the route's `page.tsx`; `src/app/sitemap.ts` is built
from `visibleGames`. `robots.txt` stays in `public/` — adding `src/app/robots.ts` would fail the build.

```tsx
❌ WRONG — UI logic in a route file
// src/app/admin/page.tsx
"use client";
export default function AdminPage() { const user = useSelector(...); /* … */ }

✅ RIGHT — src/app/admin/page.tsx delegates to the view
export const metadata: Metadata = { title: "Admin", robots: { index: false, follow: false } };
export default function AdminPage() { return <Admin />; }
```

## Rule UI-19: Every user-facing game listing uses `visibleGames`, never raw `games`

`src/utils/GameUtils.tsx` flags unfinished games `hidden: true` (typed at `hidden?: boolean` in
`src/types/types.tsx`) and exports `visibleGames = games.filter((g) => !g.hidden)`. The landing grid
(`Landpage.tsx`), the game rail and mobile strip (`MiniGame.tsx`), the multiplayer pickers
(`MultiPlayer/FriendPlay.tsx`, `OnlineMatch.tsx`) and `[game]/page.tsx`'s `generateStaticParams`
all use it, so a hidden game has no tile, no rail entry and a 404 route. Raw `games` is only for
lookups by id/path where the game is already known (`MiniGame.tsx` resolving the URL, the
`gameCatalog` id checks in `FeedbackModal.tsx`, `FeedbackTab.tsx`, `Admin.tsx`).

```tsx
❌ WRONG — a new picker listing every catalogue entry, hidden ones included
import { games } from "../utils/GameUtils";
{games.map((g) => <GameTile key={g.id} name={g.name} … />)}

✅ RIGHT — src/views/Landpage.tsx
import { visibleGames as games } from "../utils/GameUtils";
{filtered.map((game, index) => <GameTile key={game.id} name={game.name} … />)}
```

## Rule UI-20: Motion must honour reduced motion — `MotionConfig`, `useReducedMotionSafe`, and the tokens

`src/app/providers.tsx` wraps the tree in `<MotionConfig reducedMotion="user">`, and `theme.css`
shrinks all CSS animation to `0.01ms` under `prefers-reduced-motion: reduce`. Components that
gate their own hover/tap/loops read the preference: components that render in server HTML and derive
markup from it (`Reveal.tsx`, `GameTile.tsx`, `CourtLoader.tsx`) use `useReducedMotionSafe`
(`src/hooks/useReducedMotionSafe.ts`, which returns `null` until hydrated so the first client render
matches the server); purely client-side interactive ones (`Button.tsx`, `SegmentedTabs.tsx`,
`SwapText.tsx`, `AnimatedNumber.tsx`, `Spinner.tsx`) use framer-motion's `useReducedMotion`. Reuse
`durations`/`easing`/`springs` from `src/motion/tokens.ts` and the variants in `src/motion/variants.ts`
rather than inventing curves (some older shell code hardcodes `[0.22, 1, 0.36, 1]` — that is
`easing.out`).

```tsx
❌ WRONG — an infinite/decorative animation with no reduced-motion branch, and an SSR-unsafe hook
const reduce = useReducedMotion();          // in a component rendered into server HTML
<motion.span animate={{ rotate: 360 }} transition={{ repeat: Infinity }} />

✅ RIGHT — src/components/motion/Reveal.tsx
const reduce = useReducedMotionSafe();
<motion.div variants={variants} initial={reduce ? "visible" : "hidden"} whileInView="visible" viewport={{ once, amount }} />
```

```tsx
✅ RIGHT — src/components/ui/Button.tsx: hover/tap disabled when the user prefers reduced motion
const interactive = !reduce && !disabled;
whileHover={interactive ? { y: -2 } : undefined}
```

Note `src/components/motion/Spinner.tsx` and `src/components/ui/Spinner.tsx` are two different
spinners (framer ring with label vs CSS `.spinner-ring`); whole-stage loading is `CourtLoader`.

---

## Rule UI-21: Any visible text that changes with state uses `SwapText`

Any visible text that changes with state uses `src/components/motion/SwapText.tsx` — the
"Copy" → "Copied!" swap (`UserProfile.tsx`): the old text fades up and out, the new one fades up and
in, `durations.swap` (0.18 s) per leg, fade-only under reduced motion. Instant feedback (typing,
timers, counters that already use `AnimatedNumber`) is exempt. Never build a second swap component.

- Give each state an explicit `swapKey` (`"loading"`, `"empty"`, `"no-match"`, `"searching"`, …)
  whenever the children aren't a plain string, or the text can change within one state
  (`Load more (12 left)` stays `"more"`).
- Keep **one** element across the states and swap only its text: a single `.fr-empty` line whose
  `SwapText` goes `loading` → `empty`, not one `<p>` per branch — the box keeps its padding and
  never jumps in height. Don't stack two loading states (a page loader, then a list's own
  "Loading…"): the list's placeholder line owns the one loading → empty transition.
- A button/inline label whose states differ in width passes `reserveWidth={[…every state]}` so the
  control never resizes mid-swap (it also holds a line at its tallest state if one wraps).
- Don't wrap static text: `<SwapText>Remove</SwapText>` animates nothing.

```tsx
❌ WRONG — src/components/FriendsPanel.tsx before: a separate <p> per state, so the text snaps
{loading ? <p className="fr-empty">Loading…</p> : <p className="fr-empty">No players found.</p>}

✅ RIGHT — src/components/FriendsPanel.tsx (EmptyLine): one line, keyed per state
<p className="fr-empty"><SwapText swapKey={state.key}>{state.text}</SwapText></p>
<SwapText swapKey={sending ? "sending" : "add"} reserveWidth={["Add", "Sending…"]}>{sending ? "Sending…" : "Add"}</SwapText>
```

---

## Rule UI-22: Every visible screen or conditional-block change enters and exits through the shared motion system; instant feedback is exempt

Anything the player sees appear, disappear or be replaced — a pane, a loader, a result banner, an
empty-state line — goes through the shared pieces in `src/motion/variants.ts` and `src/motion/tokens.ts`
(durations and easing come from there; never a literal `duration:` or cubic). Text uses `SwapText`
(UI-21); numbers that count use `AnimatedNumber`. Under reduced motion the shared pieces already
collapse to a fade (UI-20), so there is nothing extra to write.

- **Mutually exclusive screens or panes** (loader ↔ list, tab A ↔ tab B, grid ↔ empty state,
  Play button ↔ room note) sit in `<AnimatePresence mode="wait" initial={false}>` with one
  `motion.div` child using the `swap` variant (`initial="hidden" animate="visible" exit="exit"`),
  keyed per state (`key={loading ? "loading" : scope}`). Do not animate the container's height.
- **Blocks that appear or disappear** (`{cond && <X/>}`) are wrapped in an `AnimatePresence` and
  render a `motion` element with `fadeIn` (quiet blocks) or `popIn` (banners that announce a result).
  Keep the existing `role`/`aria-live` and class names on the motion element.
- **Text** that changes with state uses `SwapText` (UI-21); **counters** (scores, counts) use
  `AnimatedNumber`.
- **Exempt (instant feedback):** typing feedback, per-keystroke validation and search/filter result
  lists, timers and countdown ticks, and the click itself — animate the result of an action, never
  delay the action. No animation may hold up a player action by more than 400 ms.

```tsx
❌ WRONG — src/components/modals/LeaderboardModal.tsx before: loader and list are a bare ternary,
so the loader snaps to the list on open and again on every Global ↔ Friends toggle
{loading ? (
  <div style={{ display: "flex", justifyContent: "center", padding: "2rem 0" }}><CourtLoader … /></div>
) : (
  <>{/* head + list */}</>
)}

✅ RIGHT — src/components/modals/LeaderboardModal.tsx: one keyed swap, no height animation
<AnimatePresence mode="wait" initial={false}>
  <motion.div key={loading ? "loading" : scope} variants={swap} initial="hidden" animate="visible" exit="exit">
    {loading ? <CourtLoader … /> : <>{/* head + list */}</>}
  </motion.div>
</AnimatePresence>
```

---

## Acceptance checks

Concrete DevTools/console/grep checks a QA agent can run.

**1. Shell present on real pages, absent only on 404s (Rule UI-1).** Visit `/`, `/series-winner`,
`/admin` (signed in as admin), then `/coming-soon` and `/definitely-not-a-route`, and run:
```js
({ shell: !!document.querySelector('.app-shell'), main: !!document.querySelector('main.page') });
```
`/`, `/series-winner`, `/admin` → both `true`. `/coming-soon` and the unknown route (`NoPageFound`)
may be `false`; the unknown route must also return HTTP 404 (Network tab).

**2. Single overlay host (Rule UI-8).** Open Log in, Feedback, Leaderboard, and a game's info
button in turn:
```js
document.querySelectorAll('.modal-backdrop').length;      // MUST be 1
!!document.querySelector('.modal-backdrop .modal-panel'); // MUST be true
```
Press Escape: the backdrop must disappear and focus return to the trigger.

**3. Z-index scale (Rule UI-12).** With a modal open on `/`:
```js
const z = s => { const e = document.querySelector(s); return e && +getComputedStyle(e).zIndex; };
({ fab: z('.feedback-fab'), nav: z('.nav3'), modal: z('.modal-backdrop') }); // 35, 40, 60
```
At ≤900px viewport tap the hamburger: `z('.drawer-panel')` → `70`.

**4. Breakpoints (Rules UI-13, UI-15).** Resize to 899px then 901px:
`getComputedStyle(document.querySelector('.nav3-links')).display` goes `none` → `flex`, and
`.nav3-mobile-right` is `inline-flex` only at 899px. On a game page at 819px vs 821px,
`.rail-strip` is `flex` vs `none` and `.rail` is `none` vs `flex`.

**5. Icon libraries limited to documented files (Rule UI-11).**
```bash
grep -rl "@fortawesome\|react-icons\|lucide-react" src --include=*.tsx
```
Expect exactly `src/components/Footer.tsx` (unmounted) and `src/components/LogInSignUp.tsx`.

**6. No new Tailwind utilities in shell code (Rule UI-5).**
```bash
grep -rnE 'className="[^"]*\b(flex|grid|px-[0-9]|py-[0-9]|w-full|h-full|text-(sm|lg|white)|bg-\[)' src/app src/components/*.tsx src/views src/components/modals src/components/ui
```
Expected hits only: `src/app/template.tsx` (`w-full h-full`), `src/components/Footer.tsx`, and
false positives whose class merely contains "grid" (`games-grid3` in `Landpage.tsx`,
`fb-detail-grid` in `FeedbackTab.tsx` if that path is included). Anything else is a violation.

**7. Navigation goes through `useNavigate` (Rule UI-17).**
```bash
grep -rnE "useRouter|next/link|react-router" src --include=*.ts --include=*.tsx
```
`useRouter` must appear only in `src/context/PageTransitionContext.tsx`; comments in
`useNavigate.ts` mentioning react-router are fine. In the browser, click a rail chip on a game page:
the page must fade out (~0.3s, `opacity` on the `template` wrapper) before the URL changes.

**8. Route transition not doubled (Rule UI-14).** Hard-load `/wordle`: the template wrapper has no
inline `opacity`/`transform` animation on first paint. Then click "Games" → a game from `/`:
```js
getComputedStyle(document.querySelector('#root > div')).opacity // returns to "1" after ~0.4s
```
and confirm no other full-page wrapper animates.

**9. SegmentedTabs in use (Rule UI-16).** Open the leaderboard modal while signed in and switch scope:
```js
document.querySelectorAll('.seg-thumb').length; // exactly 1 per mounted switcher
```
The thumb must slide (not jump) between options. Repeat in Log in ↔ Sign up (`.auth-tabs`) and the
friends panel (`.fr-tabs`). Grep for regressions:
```bash
grep -rn 'role="tab"' src --include=*.tsx   # only SegmentedTabs.tsx and the legacy Admin.tsx
```

**10. Hidden games do not leak (Rule UI-19).** Read the `hidden: true` ids from
`src/utils/GameUtils.tsx`; each must be absent from the landing grid (`.gtile` names), the game rail
(`.rail-item`), and the mobile strip (`.rail-chip`), and `/<its-slug>` must 404. Grep:
```bash
grep -rn "from \"../utils/GameUtils\"\|from '../../utils/GameUtils'" src/views src/components --include=*.tsx
```
Every listing/picker import must be `visibleGames`; raw `games`/`gameCatalog` only for lookups.

**11. Reduced motion (Rule UI-20).** In DevTools → Rendering, set "Emulate CSS prefers-reduced-motion:
reduce", hard reload `/`: `.hero-grain` has `animation-name: none`, `Button` hover doesn't lift,
`CourtLoader` (start any game) shows a static ball, and switching a `SegmentedTabs` option moves the
thumb instantly. Console must show no hydration warnings for `Reveal`/`GameTile`.

**12. Tokens, not hex (Rule UI-7).**
```bash
grep -nE "#[0-9a-fA-F]{3,6}\b" src/styles/Navigation.css src/styles/Modal.css src/styles/SegmentedTabs.css
```
Any hit that duplicates a `theme.css` token (`#101010`, `#1c1c1e`, `#9c9a95`, `#ff6a1a`, …) is a
violation. Also confirm `document.documentElement.classList.contains('light')` is `false` after load.

**13. Swal styling (Rule UI-9).** Trigger "Finish your current game first." (start a game, click
another rail item on desktop): the popup has `.swal2-custom-popup`, its background resolves to
`var(--surface)`, and no `.modal-backdrop` is added.

**14. State text swaps (Rule UI-21).** Signed in, open the Friends tab on a throttled connection:
the tabs and search box show at once, and the line under the list fades "Loading your friends…" →
"No friends yet — try the Find tab." (or the list) with no jump in the card's height; in Find, type
one letter then two and watch the hint → "Searching…" → "No players found." swap in the same line.
