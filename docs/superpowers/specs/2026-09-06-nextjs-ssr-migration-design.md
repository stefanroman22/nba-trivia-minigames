# Next.js SSR migration — design

**Date:** 2026-09-06
**Status:** approved for implementation (autonomous session; decisions recorded here)
**Plan:** [../plans/2026-09-06-nextjs-ssr-migration.md](../plans/2026-09-06-nextjs-ssr-migration.md)

## 1. Goal

Move the frontend from a Vite client-side SPA (with a build-time prerender of `/` only) to
Next.js so that **every route ships as server-rendered HTML** — full markup for crawlers and
for the first paint — while the UI, behaviour and the rest of the delivery setup stay exactly
as they are.

Non-goals: redesigning anything, moving data fetching to the server, changing the backend,
the multiplayer server, the data pipeline or the hosting topology.

## 2. Starting point

- React 19 + TypeScript + Vite 7 + Tailwind 4, Redux Toolkit, framer-motion, socket.io-client,
  react-router-dom 7. 163 files under `src/`.
- 20 routes, all declared in `src/App.tsx`: `/` (Landpage), 17 game paths (all rendering
  `MiniGame`, which picks the game from the URL), `/coming-soon` (NoPageFound), `/admin`.
- `scripts/ssg.mjs` + `src/entry-server.tsx` prerender `/` at build time; `main.tsx` hydrates
  on `/` and client-renders everywhere else. Vercel serves `dist/` with an SPA rewrite.
- Env: `VITE_BACKEND_URL`, `VITE_SOCKET_URL`, `VITE_DATA_BASE` read via `import.meta.env`;
  `.env.production` is committed, `scripts/dev-env.mjs` writes `.env.local` before `npm run dev`.

SSR audit of `src/` (done before this design): the only hard breaks are the four
`import.meta.env` sites and image imports being used as URL strings; browser globals are
otherwise only touched in effects/handlers. Three SSR-reachable components derive markup from
`useReducedMotion()`, which returns `null` on the server and the real value during hydration
(a mismatch for reduced-motion users). `src/constants/teamLogos.ts` has a `.tsx` twin that
Vite never resolved but Next's resolver (`.tsx` before `.ts`) would.

## 3. Decisions

| Topic | Decision | Why |
|---|---|---|
| Framework | Next.js 16.3 (latest), App Router, `src/app/` | Current default; static prerender at build + SSR fallback on Vercel with zero extra infra |
| Rendering | Every existing page/component becomes (or is imported from) a `'use client'` tree; pages are **statically prerendered** at build (no `force-dynamic`) | Client components are still rendered to HTML by Next; no page reads request data, so static HTML is the fastest correct output |
| Routing | `page.tsx` for `/`, `/coming-soon`, `/admin`; one dynamic segment `[game]` with `generateStaticParams` from the game catalogue and `dynamicParams = false`; `not-found.tsx` renders `NoPageFound` | Mirrors the 20 routes without 17 near-identical folders; unknown paths get a real 404 instead of today's blank page |
| Navigation API | `src/hooks/useNavigate.ts` — same call shape as react-router's (`navigate(path, { state })`), state ignored | Every navigation is programmatic (no `<Link>` anywhere); call sites change only their import. `MiniGame` already falls back to the pathname |
| Page transition | `src/app/template.tsx` plays the enter fade (0.4 s, from opacity 0.98 scale) on client navigations only; the navigate hook plays the 0.3 s exit fade **before** `router.push` | App Router unmounts the old page immediately, so `AnimatePresence mode="wait"` can't run exits; sequencing it in the hook keeps the current feel without touching Next internals |
| Env vars | Keep the `VITE_*` names; `next.config.ts` `env` inlines the three the browser reads | `.env.production`, `dev-env.mjs`, the QA protocol, the docs and the Vercel project env all stay valid; renaming would touch all of them for no user-visible gain |
| Dev/preview ports | `next dev -p 5173`, `next start -p 4173` | CLAUDE.md, README, chrome-debug, ui-audit, Lighthouse scripts and the backend CORS defaults all assume these |
| Images | Keep `<img>` and CSS `url()`, append `.src` to static imports | `next/image` would change markup/behaviour; `.src` is the hashed URL Vite used to return |
| Reduced motion | `src/hooks/useReducedMotionSafe.ts` — `null` until hydrated, then framer's value; used by `Reveal`, `GameTile`, `CourtLoader` | Server and client first render agree; reduced-motion users get a short fade instead of an instant reveal (transforms are already disabled by `MotionConfig reducedMotion="user"`) |
| `teamLogos.tsx` | Delete | Dead under Vite, but would silently replace the real module under Next's resolver order |
| Redux store | Keep the module singleton | Nothing dispatches during render; the per-request store pattern is not needed for correctness |
| Lint/typecheck | `eslint .` stays the CI check; `next build` type-checks; `npx next typegen && npx tsc --noEmit` for a standalone typecheck | `next-env.d.ts` is generated and git-ignored (Next 16 recommendation) |
| Vercel | `vercel.json`: `framework: "nextjs"`, drop `outputDirectory` + SPA rewrite, keep `/data/` cache headers | Framework preset drives the build; headers are edge config and work unchanged |
| Metadata | Layout: `title` default `HOOPS24` (+ `%s | HOOPS24` template), the existing description, favicon from the asset import, the two font preloads. Games: `generateMetadata` → game name + description. Admin: `robots: noindex` | Direct SEO payoff of per-route HTML; `/admin` is already disallowed in robots.txt |
| StrictMode | `reactStrictMode: false` | The Vite entry never used StrictMode; keeps dev-only double effects (socket identify, `/me/` check) from appearing |

## 4. Resulting layout

```
next.config.ts                 env inlining, strict mode off
src/app/layout.tsx             <html lang="en">, font preloads, global CSS (theme → ui → index → App), <div id="root">, metadata
src/app/providers.tsx          'use client': Redux Provider → MotionConfig → PageTransitionProvider → MultiplayerProvider → ModalProvider → [AppEffects, children, ModalHost, EnvBadge]
src/app/template.tsx           'use client': the PageTransition motion wrapper (w-full h-full)
src/app/page.tsx               Landpage
src/app/[game]/page.tsx        MiniGame + generateStaticParams/generateMetadata, dynamicParams=false
src/app/coming-soon/page.tsx   NoPageFound
src/app/admin/page.tsx         Admin (noindex)
src/app/not-found.tsx          NoPageFound
src/context/PageTransitionContext.tsx   leaving/hasNavigated state + navigate()
src/hooks/useNavigate.ts       re-export of the context's navigate
src/hooks/useReducedMotionSafe.ts
```

Removed: `index.html`, `vite.config.ts`, `tsconfig.app.json`, `tsconfig.node.json`,
`src/main.tsx`, `src/App.tsx`, `src/entry-server.tsx`, `src/vite-env.d.ts`, `scripts/ssg.mjs`,
`src/constants/teamLogos.tsx`; packages `vite`, `@vitejs/plugin-react`, `@tailwindcss/vite`,
`react-router-dom`.

`AppEffects` carries the two effects that lived in `App.tsx` (dark-only theme reset and the
`/me/` session check).

## 5. Error handling

- Unknown `[game]` slug or any other path → Next 404 status + `NoPageFound` markup.
- Missing `VITE_*` env → same failure mode as before (requests hit a wrong origin); the
  `PROD DATA` badge still warns in dev when the backend is not local.
- Hydration: no server/client divergence on SSR-reachable paths after the reduced-motion hook;
  the dev console is checked for hydration warnings on `/`, a game page, `/admin`, and a 404.

## 6. Verification

1. `npm run lint`, `npm run build` (type-check + 20 prerendered routes), `npx tsc --noEmit`.
2. `npm run preview` (`:4173`): `curl` each route class and confirm the HTML contains the page
   content (hero copy on `/`, game name + rail on `/wordle`, "Admins only" placeholder on
   `/admin`, "Nothing here yet" on `/nope`) — i.e. SSR is real, not a shell.
3. Real browser: landing, a game (idle → play → exit), rail navigation between games, the
   feedback/leaderboard/login modals, `/admin` as guest, a 404, browser back/forward; console
   free of hydration/runtime errors; screenshots compared with production at desktop and
   390×844.
4. `node scripts/ui-audit.mjs` (desktop/laptop/mobile) against the Next dev server — the shell
   contract measurements must still pass for all 17 games.
5. Push the branch → Vercel preview build with the Next.js preset; read the build log and
   fetch the preview HTML for the same route classes.

## 7. Out of scope / follow-ups

- Server-side data fetching (leaderboard etc.) for richer crawlable HTML.
- `app/sitemap.ts`.
- Dead files the audit found (`components/Footer.tsx`, `Loader.tsx`, `GameCard.tsx`,
  `RevealText.tsx`, `motion/MotionButton.tsx`, `hooks/useTheme.ts`, `utils/LeaveMultiplayer.tsx`)
  are left in place (only edited where the migration needs them to compile).
