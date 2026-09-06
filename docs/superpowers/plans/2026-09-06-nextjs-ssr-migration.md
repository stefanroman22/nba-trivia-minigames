# Next.js SSR Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Vite SPA build with Next.js so every route is served as server-rendered HTML, with the UI and the surrounding tooling unchanged.

**Architecture:** Next.js App Router under `src/app/`; the existing page components are imported as client components from thin `page.tsx` files and statically prerendered at build. A small navigation hook + `template.tsx` replace react-router and the `AnimatePresence` page transition. `VITE_*` env names are kept and inlined through `next.config.ts`.

**Tech Stack:** Next.js 16.3.4 (Turbopack), React 19, TypeScript 5.8 strict, Tailwind 4 via `@tailwindcss/postcss`, framer-motion 12, Redux Toolkit.

**Spec:** `docs/superpowers/specs/2026-09-06-nextjs-ssr-migration-design.md`

## Global Constraints

- Node `>=20` (`package.json` engines); Next 16 needs `>=20.9`; Vercel project runs Node 24.x.
- Dev server on `:5173`, preview server on `:4173` (scripts, docs and backend CORS assume them).
- Env names stay `VITE_BACKEND_URL`, `VITE_SOCKET_URL`, `VITE_DATA_BASE`.
- Surgical changes only: no refactors, no deleting dead code beyond what the migration needs.
- Every edited source file must pass `npm run lint` and `npm run build`.
- Commits go on `feat/nextjs-ssr-migration`; never push `dev` (it auto-promotes to production).

---

### Task 1: Toolchain — package scripts, tsconfig, eslint, next.config, vercel.json, gitignore

**Files:**
- Modify: `package.json` (scripts), `tsconfig.json` (rewrite), `eslint.config.js`, `.gitignore`, `vercel.json`, `.vercelignore` (comment)
- Create: `next.config.ts`
- Delete: `tsconfig.app.json`, `tsconfig.node.json`, `vite.config.ts`, `index.html`, `src/vite-env.d.ts`, `scripts/ssg.mjs`

**Interfaces:**
- Produces: `process.env.VITE_BACKEND_URL | VITE_SOCKET_URL | VITE_DATA_BASE` available in browser bundles (Task 2 relies on it).

- [ ] **Step 1: package.json scripts**

```json
"dev": "npm run copy:data && next dev -p 5173",
"build": "npm run copy:data && next build",
"preview": "next start -p 4173",
```
Remove `"postbuild"`. (Deps already changed: `next@16.3.4` added; `vite`, `@vitejs/plugin-react`, `@tailwindcss/vite`, `react-router-dom` removed.)

- [ ] **Step 2: next.config.ts**

```ts
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  env: {
    VITE_BACKEND_URL: process.env.VITE_BACKEND_URL,
    VITE_SOCKET_URL: process.env.VITE_SOCKET_URL,
    VITE_DATA_BASE: process.env.VITE_DATA_BASE,
  },
  reactStrictMode: false,
};

export default nextConfig;
```

- [ ] **Step 3: tsconfig.json** — single project: `jsx: preserve`, `moduleResolution: bundler`, `plugins: [{ name: "next" }]`, the strict/unused flags from the old `tsconfig.app.json`, `include: ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"]`, `exclude: ["node_modules", "backend", "multiplayer_server", "dist", "dist-server"]`.

- [ ] **Step 4: eslint.config.js** — ignore `.next` and `next-env.d.ts`; replace `reactRefresh.configs.vite` with `reactRefresh.configs.recommended` and set `react-refresh/only-export-components` to `['warn', { allowConstantExport: true, allowExportNames: ['metadata','generateMetadata','generateStaticParams','dynamicParams','dynamic','revalidate','viewport','generateViewport'] }]`.

- [ ] **Step 5: vercel.json** — `"framework": "nextjs"`, keep `buildCommand`, drop `outputDirectory` and `rewrites`, keep `headers`. `.gitignore`: add `.next/` and `next-env.d.ts`. `.vercelignore`: "Vite frontend" → "Next.js frontend".

- [ ] **Step 6: delete the Vite files** listed above.

- [ ] **Step 7: verify** `node -e "require('next')"` works and `npx next --version` prints 16.3.4.

---

### Task 2: Source fixes that don't depend on Next — env, images, resolver twin, reduced motion

**Files:**
- Modify: `src/configurations/backend.tsx:1`, `src/socket.ts:5`, `src/utils/pool.ts:6`, `src/components/EnvBadge.tsx:1-16`
- Modify: `src/utils/GameUtils.tsx` (18 `url('${x}')` → `url('${x.src}')`), `src/components/Navigation.tsx:29,89,132`, `src/components/UserProfile.tsx:163-164`, `src/components/MultiPlayer/FriendPlay.tsx:150,152`, `src/components/MultiPlayer/OnlineMatch.tsx:287,289,450`, `src/components/MultiPlayer/PlayerCard.tsx:42,44`, `src/components/Footer.tsx:18`
- Delete: `src/constants/teamLogos.tsx`
- Create: `src/hooks/useReducedMotionSafe.ts`
- Modify: `src/components/motion/Reveal.tsx:3,20`, `src/components/ui/GameTile.tsx:2,27`, `src/components/ui/CourtLoader.tsx:1,10`

- [ ] **Step 1: env reads**

```ts
// backend.tsx
export const BACKEND_URL = process.env.VITE_BACKEND_URL ?? "";
// socket.ts
const SOCKET_URL = process.env.VITE_SOCKET_URL || "http://localhost:4000";
// pool.ts
const DATA_BASE = process.env.VITE_DATA_BASE || "/data";
// EnvBadge.tsx
if (process.env.NODE_ENV !== "development") return null;
const url = process.env.VITE_BACKEND_URL ?? "";
```

- [ ] **Step 2: `.src` on every static image use** (Next static imports are `{ src, width, height }` objects).

- [ ] **Step 3: `useReducedMotionSafe`**

```ts
import { useReducedMotion } from "framer-motion";
import { useSyncExternalStore } from "react";

const subscribe = () => () => {};

export function useReducedMotionSafe(): boolean | null {
  const reduce = useReducedMotion();
  const hydrated = useSyncExternalStore(subscribe, () => true, () => false);
  return hydrated ? reduce : null;
}
```
Swap the import + call in the three components.

- [ ] **Step 4: delete `src/constants/teamLogos.tsx`**; confirm the three importers still resolve `../constants/teamLogos` → `.ts`.

---

### Task 3: Navigation + page transition

**Files:**
- Create: `src/context/PageTransitionContext.tsx`, `src/hooks/useNavigate.ts`
- Modify (import swap only): `src/pages/Landpage.tsx:2`, `src/pages/Admin.tsx:2`, `src/pages/NoPageFound.tsx:1`, `src/components/Navigation.tsx:2`, `src/components/GameCard.tsx:2`
- Modify: `src/pages/Trivia/MiniGame.tsx:3,35-38` (`usePathname`), `src/context/MultiplayerContext.tsx:23,370-371,459-462` (`usePathname`)

**Interfaces:**
- Produces: `useNavigate(): (to: string, opts?: { state?: unknown }) => void`; `usePageTransition(): { leaving: boolean; hasNavigated: boolean }`; `PageTransitionProvider`.

- [ ] **Step 1: context**

```tsx
"use client";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";

const EXIT_MS = 300;
interface Value { leaving: boolean; hasNavigated: boolean; navigate: (to: string, opts?: { state?: unknown }) => void }
const Ctx = createContext<Value | null>(null);

export function PageTransitionProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const pathRef = useRef(pathname);
  const [leaving, setLeaving] = useState(false);
  const [hasNavigated, setHasNavigated] = useState(false);
  useEffect(() => { pathRef.current = pathname; setLeaving(false); }, [pathname]);
  const navigate = useCallback((to: string) => {
    if (to === pathRef.current) { router.push(to); return; }
    setHasNavigated(true);
    setLeaving(true);
    router.prefetch(to);
    setTimeout(() => router.push(to), EXIT_MS);
  }, [router]);
  const value = useMemo(() => ({ leaving, hasNavigated, navigate }), [leaving, hasNavigated, navigate]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function usePageTransition() { /* throws outside provider */ }
```
`src/hooks/useNavigate.ts` returns `usePageTransition().navigate`.

- [ ] **Step 2: call sites** — swap `import { useNavigate } from "react-router-dom"` for the hook; `MiniGame` derives `gameId` from `usePathname()`; `MultiplayerContext` compares `pathname` from `usePathname()`.

---

### Task 4: App Router files

**Files:**
- Create: `src/app/layout.tsx`, `src/app/providers.tsx`, `src/app/template.tsx`, `src/app/page.tsx`, `src/app/[game]/page.tsx`, `src/app/coming-soon/page.tsx`, `src/app/admin/page.tsx`, `src/app/not-found.tsx`
- Modify: add `"use client";` to `src/pages/Landpage.tsx`, `src/pages/Trivia/MiniGame.tsx`, `src/pages/NoPageFound.tsx`, `src/pages/Admin.tsx`
- Delete: `src/main.tsx`, `src/App.tsx`, `src/entry-server.tsx`

- [ ] **Step 1: layout** — global CSS in the old order (`styles/theme.css`, `styles/ui.css`, `index.css`, `App.css`), `metadata` (title default/template, description, favicon from `assets/basketballLogo.webp`), the two font preloads in `<head>`, `<body><div id="root"><Providers>{children}</Providers></div></body>`.
- [ ] **Step 2: providers** — the tree from the spec §4; `AppEffects` holds the two `useEffect`s from `App.tsx`.
- [ ] **Step 3: template** — `motion.div` with `initial={hasNavigated ? { opacity: 0, scale: 0.98 } : false}` and `animate={leaving ? { opacity: 0, scale: 0.98, transition: { duration: 0.3, ease: "easeIn" } } : { opacity: 1, scale: 1, transition: { duration: 0.4, ease: "easeOut" } }}`, `className="w-full h-full"`.
- [ ] **Step 4: pages** — `[game]/page.tsx` with `dynamicParams = false`, `generateStaticParams` from `games` (excluding `coming-soon`), `generateMetadata` → `{ title: game.name, description: game.description }`; admin page `metadata = { title: "Admin", robots: { index: false, follow: false } }`.
- [ ] **Step 5: `npm run build`** — expect 20 static routes (`○`), no type errors, no hydration-related warnings.

---

### Task 5: Docs and scripts that describe the Vite setup

**Files:**
- Modify: `CLAUDE.md`, `README.md`, `docs/ARCHITECTURE.md:50,341`, `docs/DEPLOYMENT.md:70,81,143-148`, `.claude/agents/frontend-engine.md:3,11-12`, `.claude/README.md:35`, `docs/team/CODE_MAP.md:95`, `.claude/skills/qa-protocol/SKILL.md:29-30`, `scripts/dev-env.mjs:6-11`, `src/components/EnvBadge.tsx` header comment

- [ ] **Step 1:** replace every "Vite" description with the Next.js equivalent; keep ports and env names.
- [ ] **Step 2:** `docs/DEPLOYMENT.md`: note that `vercel.json` selects the Next.js preset and that the `VITE_*` names are inlined by `next.config.ts`.

---

### Task 6: Verification

- [ ] `npm run lint` → clean. `npm run build` → 20 prerendered routes. `npx next typegen && npx tsc --noEmit` → clean.
- [ ] `npm run preview`; `curl` `/`, `/wordle`, `/admin`, `/nope` and grep for page copy (`hero-h1`, `ALL GAMES`, `Admins only`, `Nothing here yet`) → all present in the raw HTML.
- [ ] `npm run dev`; confirm `--port 5273` override still works (`npm run dev -- --port 5273`).
- [ ] Browser (Playwright/Chrome): landing, `/wordle` idle → Play → Exit, rail navigation, modals, `/admin` guest, 404, back/forward; console free of errors and hydration warnings; screenshots vs production at 1280×900 and 390×844.
- [ ] `node scripts/ui-audit.mjs --label nextjs --width 1100 --height 900` etc. → all PASS (outputs deleted afterwards).
- [ ] Commit; push the branch; check the Vercel preview build log and fetch the preview HTML for the same routes.
