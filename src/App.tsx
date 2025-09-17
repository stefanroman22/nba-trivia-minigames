import { BrowserRouter, Routes, Route, useLocation } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import './App.css';

import Landpage from './pages/Landpage';
import MiniGame from './pages/Trivia/MiniGame';
import NoPageFound from './pages/NoPageFound';


function App() {
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
function PageTransition({ children }) {
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
