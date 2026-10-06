"use client";
import { useEffect, type ReactNode } from "react";
import { Provider, useDispatch } from "react-redux";
import { MotionConfig } from "framer-motion";
import { store } from "../store";
import { accountBanned, hydrateSession, login, logout, type User } from "../store/userSlice";
import { apiFetch, clearTokens, getAccessToken, getRefreshToken, refreshSession, SessionNetworkError } from "../utils/Api";
import { clearCachedUser, isAccessTokenExpired, prewarmBackend, readCachedUser, writeCachedUser } from "../utils/session";
import { BACKEND_URL } from "../configurations/backend";
import { setBanHandler } from "../utils/ban";
import { ModalProvider } from "../context/ModalContext";
import { MultiplayerProvider } from "../context/MultiplayerContext";
import { PageTransitionProvider } from "../context/PageTransitionContext";
import ModalHost from "../components/ModalHost";
import BanNotice from "../components/BanNotice";
import EnvBadge from "../components/EnvBadge";

/** The app-wide effects that used to live in the App component. */
function AppEffects() {
  const dispatch = useDispatch();

  // Dark-only theme: drop any previously saved light preference.
  useEffect(() => {
    document.documentElement.classList.remove("light");
    try { localStorage.setItem("nba3via-theme", "dark"); } catch { /* ignore */ }
  }, []);

  // The one place a 403 `account_banned` lands (utils/ban.ts: apiFetch, refreshSession, the
  // auth form and the socket report it). The session is over: drop the tokens and the cached
  // user, then switch the slice to its banned state (BanNotice). Registered before the bootstrap
  // below so a ban answered by the very first /me/ or refresh is not missed.
  useEffect(
    () =>
      setBanHandler((info) => {
        clearTokens();
        clearCachedUser();
        dispatch(accountBanned(info));
      }),
    [dispatch],
  );

  // Keep the cached /me/ payload (utils/session.ts) in step with the slice: every signed-in
  // user change (login, points, username, photo) is written through, a settled logout clears
  // it. Nothing is written while the initial check is still pending and signed out.
  useEffect(() => {
    let prev = store.getState().user;
    return store.subscribe(() => {
      const next = store.getState().user;
      if (next === prev) return;
      prev = next;
      if (next.user) writeCachedUser(next.user);
      else if (next.authChecked) clearCachedUser();
    });
  }, []);

  useEffect(() => {
    // Return-visit bootstrap. Show the cached user first, then settle with the server in as
    // few round trips as the token state allows:
    //   access token still valid  -> GET /me/                      (one hop)
    //   access token expired/gone -> POST token/refresh/ (+ user)  (one hop; /me/ only if the
    //                                backend didn't include `user`)
    // Reconcile: a 200 replaces the cached user in place (no flash); a dead session (refresh
    // refused, or /me/ 401) clears tokens + cache and shows the guest UI; a network error or
    // 5xx changes nothing and leaves `authChecked` false for the next load to settle.
    const restoreSession = async () => {
      if (!getRefreshToken()) {
        // Guest: nothing will call /me/, so warm the backend for the first real request.
        prewarmBackend();
        // Nothing to resume. Also drops a cache left behind by a logout in another tab.
        clearCachedUser();
        dispatch(logout());
        return;
      }

      const cached = readCachedUser();
      if (cached) dispatch(hydrateSession(cached));

      try {
        const accessToken = getAccessToken();
        let user: User | null = null;
        if (!accessToken || isAccessTokenExpired(accessToken)) {
          user = (await refreshSession()).user ?? null;
        }
        if (!user) {
          const response = await apiFetch(`${BACKEND_URL}/me/`);
          if (response.status === 401) {
            // apiFetch already tried a refresh behind this 401: the session is dead.
            clearTokens();
            clearCachedUser();
            dispatch(logout());
            return;
          }
          if (!response.ok) return; // backend hiccup: keep what's shown, check again next load
          const data = await response.json();
          user = data.user;
        }
        if (user) dispatch(login(user));
      } catch (err) {
        // A genuine server rejection (refresh refused, /me/ 401) always clears the
        // tokens before throwing/returning — refreshSession and apiFetch's own catch
        // both do it. So "the refresh token is still there" is as reliable a signal as
        // SessionNetworkError itself, and covers errors this bootstrap doesn't wrap in
        // that type: apiFetch's *first* request (the still-valid-access-token path)
        // can reject with a plain TypeError when offline, and `response.json()` can
        // throw on a malformed body — neither is a verdict on the session, so tokens,
        // cache and the hydrated user all stay, and authChecked stays false for the
        // next load to settle (D4: only a dead session may flip chip -> guest).
        if (err instanceof SessionNetworkError || getRefreshToken()) {
          console.error("Session check failed:", err);
        } else if (!store.getState().user.banned) {
          // (A refused refresh that was a ban already settled the slice — keep the ban screen.)
          clearCachedUser();
          dispatch(logout());
        }
      }
    };

    restoreSession();
  }, [dispatch]);

  return null;
}

// GoogleOAuthProvider lives in LogInSignUp: it injects Google's gsi/client
// script on mount, so app-wide it cost every visitor ~73KB at startup.
export default function Providers({ children }: { children: ReactNode }) {
  return (
    <Provider store={store}>
      <MotionConfig reducedMotion="user">
        <PageTransitionProvider>
          <MultiplayerProvider>
            <ModalProvider>
              <AppEffects />
              {children}
              {/* Blocking ban screen; sits under ModalHost so Appeal's feedback modal opens above it. */}
              <BanNotice />
              <ModalHost />
              <EnvBadge />
            </ModalProvider>
          </MultiplayerProvider>
        </PageTransitionProvider>
      </MotionConfig>
    </Provider>
  );
}
