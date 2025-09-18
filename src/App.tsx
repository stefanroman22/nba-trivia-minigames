import { BrowserRouter, Routes, Route, useLocation } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import type { ReactNode } from 'react';
import './App.css';
import { login, logout } from "./store/userSlice";
import Landpage from './pages/Landpage';
import MiniGame from './pages/Trivia/MiniGame';
import NoPageFound from './pages/NoPageFound';
import { useDispatch } from "react-redux";
import { useEffect } from "react";
import { apiFetch } from './utils/Api';


function App() {
  const dispatch = useDispatch();

  useEffect(() => {
    const checkLogin = async () => {
      const accessToken = localStorage.getItem("accessToken");

      if (!accessToken) {
        // No token, clear state
        dispatch(logout());
        return;
      }

      const response = await apiFetch("http://localhost:8000/api/me/");

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
  }, []);

  return (
    <BrowserRouter>
      <AnimatedRoutes />
    </BrowserRouter>
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
          path="/coming-soon"
          element={
            <PageTransition>
              <NoPageFound />
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
