"use client";
/**
 * Page-transition state + the app's navigate() function.
 *
 * Under react-router, <AnimatePresence mode="wait"> faded the old page out
 * (0.3s) before the new one faded in (0.4s). The App Router unmounts the old
 * page the moment the new one is ready, so exits can't be animated there;
 * instead navigate() flags the current page as `leaving`, src/app/template.tsx
 * plays the exit fade, and the route change is pushed once that fade is done.
 * The template mounts fresh for the new route and plays the enter fade itself.
 */
import {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode,
} from "react";
import { usePathname, useRouter } from "next/navigation";

/** Matches the exit transition duration in src/app/template.tsx. */
const EXIT_MS = 300;

export type NavigateFn = (to: string, opts?: { state?: unknown }) => void;

interface PageTransitionValue {
  /** True while the current page is fading out ahead of a route change. */
  leaving: boolean;
  /** False until the first client-side navigation — the first paint must not animate in. */
  hasNavigated: boolean;
  navigate: NavigateFn;
}

const Ctx = createContext<PageTransitionValue | null>(null);

export function PageTransitionProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const pathRef = useRef(pathname);
  const [leaving, setLeaving] = useState(false);
  const [hasNavigated, setHasNavigated] = useState(false);

  // A route change (ours or browser back/forward) ends any pending exit.
  useEffect(() => {
    pathRef.current = pathname;
    setLeaving(false);
  }, [pathname]);

  // Same call shape as react-router's navigate(). The `state` option is
  // accepted for source compatibility but ignored: every game page resolves
  // its game from the URL path.
  const navigate = useCallback<NavigateFn>((to) => {
    if (to === pathRef.current) {
      router.push(to);
      return;
    }
    setHasNavigated(true);
    setLeaving(true);
    router.prefetch(to); // load the next route while the fade runs
    setTimeout(() => router.push(to), EXIT_MS);
  }, [router]);

  const value = useMemo(() => ({ leaving, hasNavigated, navigate }), [leaving, hasNavigated, navigate]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components
export function usePageTransition(): PageTransitionValue {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("usePageTransition must be used within PageTransitionProvider");
  return ctx;
}
