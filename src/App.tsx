import { BrowserRouter, Routes, Route, useLocation } from 'react-router-dom';
import { AnimatePresence, motion, MotionConfig } from 'framer-motion';
import type { ReactNode } from 'react';
import './App.css';
import './index.css';
import { login, logout } from "./store/userSlice";
import Landpage from './pages/Landpage';
import MiniGame from './pages/Trivia/MiniGame';
import NoPageFound from './pages/NoPageFound';
import Admin from './pages/Admin';
import { useDispatch } from "react-redux";
import { useEffect } from "react";
import { apiFetch } from './utils/Api';
import { BACKEND_URL } from './configurations/backend';
import { ModalProvider } from './context/ModalContext';
import { MultiplayerProvider } from './context/MultiplayerContext';
import ModalHost from './components/ModalHost';
import EnvBadge from './components/EnvBadge';


function App() {
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

  return (
    <MotionConfig reducedMotion="user">
      <BrowserRouter>
        <MultiplayerProvider>
          <ModalProvider>
            <AnimatedRoutes />
            <ModalHost />
            <EnvBadge />
          </ModalProvider>
        </MultiplayerProvider>
      </BrowserRouter>
    </MotionConfig>
  );
}

/**
 * Handles page routing with smooth fade transitions
 */
function AnimatedRoutes() {
  const location = useLocation();
  return (
    <AnimatePresence mode="wait">
      <Routes location={location} key={location.pathname}>
        <Route
          path="/"
          element={
            <PageTransition>
              <Landpage />
            </PageTransition>
          }
        />
        <Route
          path="/series-winner"
          element={
            <PageTransition>
              <MiniGame />
            </PageTransition>
          }
        />
        <Route
          path="/name-logo"
          element={
            <PageTransition>
              <MiniGame />
            </PageTransition>
          }
        />
        <Route
          path="/guess-mvps"
          element={
            <PageTransition>
              <MiniGame />
            </PageTransition>
          }
        />
        <Route
          path="/starting-five"
          element={
            <PageTransition>
              <MiniGame />
            </PageTransition>
          }
        />
        <Route
          path="/wordle"
          element={
            <PageTransition>
              <MiniGame />
            </PageTransition>
          }
        />
        <Route
          path="/fan-favorites"
          element={
            <PageTransition>
              <MiniGame />
            </PageTransition>
          }
        />
        <Route
          path="/heatmap"
          element={
            <PageTransition>
              <MiniGame />
            </PageTransition>
          }
        />
        <Route
          path="/connections"
          element={
            <PageTransition>
              <MiniGame />
            </PageTransition>
          }
        />
        <Route
          path="/career-path"
          element={
            <PageTransition>
              <MiniGame />
            </PageTransition>
          }
        />
        <Route
          path="/nba-grid"
          element={
            <PageTransition>
              <MiniGame />
            </PageTransition>
          }
        />
        <Route
          path="/who-are-ya"
          element={
            <PageTransition>
              <MiniGame />
            </PageTransition>
          }
        />
        <Route
          path="/tictactoe"
          element={
            <PageTransition>
              <MiniGame />
            </PageTransition>
          }
        />
        <Route
          path="/bingo"
          element={
            <PageTransition>
              <MiniGame />
            </PageTransition>
          }
        />
        <Route
          path="/contexto"
          element={
            <PageTransition>
              <MiniGame />
            </PageTransition>
          }
        />
        <Route
          path="/pack-five"
          element={
            <PageTransition>
              <MiniGame />
            </PageTransition>
          }
        />
        <Route
          path="/superdraft"
          element={
            <PageTransition>
              <MiniGame />
            </PageTransition>
          }
        />
        <Route
          path="/imposter"
          element={
            <PageTransition>
              <MiniGame />
            </PageTransition>
          }
        />
        <Route
          path="/coming-soon"
          element={
            <PageTransition>
              <NoPageFound />
            </PageTransition>
          }
        />
        <Route
          path="/admin"
          element={
            <PageTransition>
              <Admin />
            </PageTransition>
          }
        />
      </Routes>
    </AnimatePresence>
  );
}

/**
 * Simple fade-in/fade-out transition wrapper
 */
function PageTransition({ children }: { children: ReactNode }) {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.98 }} // start slightly smaller and faded
      animate={{
        opacity: 1,
        scale: 1,
        transition: { duration: 0.4, ease: "easeOut" },
      }}
      exit={{
        opacity: 0,
        scale: 0.98,
        transition: { duration: 0.3, ease: "easeIn" },
      }}
      className="w-full h-full"
    >
      {children}
    </motion.div>
  );
}



export default App;
