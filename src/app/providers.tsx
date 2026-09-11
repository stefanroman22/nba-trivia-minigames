"use client";
import { useEffect, type ReactNode } from "react";
import { Provider, useDispatch } from "react-redux";
import { MotionConfig } from "framer-motion";
import { store } from "../store";
import { login, logout } from "../store/userSlice";
import { apiFetch } from "../utils/Api";
import { BACKEND_URL } from "../configurations/backend";
import { ModalProvider } from "../context/ModalContext";
import { MultiplayerProvider } from "../context/MultiplayerContext";
import { PageTransitionProvider } from "../context/PageTransitionContext";
import ModalHost from "../components/ModalHost";
import EnvBadge from "../components/EnvBadge";

/** The app-wide effects that used to live in the App component. */
function AppEffects() {
  const dispatch = useDispatch();

  // Dark-only theme: drop any previously saved light preference.
  useEffect(() => {
    document.documentElement.classList.remove("light");
    try { localStorage.setItem("nba3via-theme", "dark"); } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    const checkLogin = async () => {
      const accessToken = localStorage.getItem("accessToken");

      if (!accessToken) {
        // No token, clear state
        dispatch(logout());
        return;
      }

      const response = await apiFetch(`${BACKEND_URL}/me/`);

      if (response.ok) {
        const data = await response.json();
        dispatch(login(data.user));
      } else {
        // Token invalid or expired
        localStorage.removeItem("accessToken");
        localStorage.removeItem("refreshToken");
        dispatch(logout());
      }
    };

    checkLogin();
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
              <ModalHost />
              <EnvBadge />
            </ModalProvider>
          </MultiplayerProvider>
        </PageTransitionProvider>
      </MotionConfig>
    </Provider>
  );
}
