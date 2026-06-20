import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import { useSelector } from "react-redux";
import logo from "../assets/basketballLogo.webp";
import type { RootState } from "../store";
import type { RoomState } from "../types/types";
import socket from "../socket";
import { leaveMultiplayer } from "../utils/LeaveMultiplayer";
import { scrollToSection } from "../utils/ScrolllToSection";
import { useModal, type ModalKind } from "../context/ModalContext";
import Button from "./ui/Button";
import "../styles/Navigation.css";

interface NavigationProps {
  type?: "full" | "back";
  setRoomState?: React.Dispatch<React.SetStateAction<RoomState>>;
}

const initials = (name?: string) =>
  (name || "You").trim().split(/\s+/).map((p) => p[0]).join("").slice(0, 2).toUpperCase() || "YS";

function Navigation({ type = "full", setRoomState }: NavigationProps) {
  const navigate = useNavigate();
  const { user } = useSelector((state: RootState) => state.user);
  const { open } = useModal();
  const [drawer, setDrawer] = useState(false);

  const goHome = () => {
    if (type !== "full" && setRoomState) leaveMultiplayer({ socket, user, setRoomState });
    navigate("/");
  };

  // Scroll to a home section; from a game page, route home first.
  const go = (section: string) => {
    setDrawer(false);
    if (type === "full") {
      scrollToSection(section);
    } else {
      navigate("/");
      setTimeout(() => scrollToSection(section), 350);
    }
  };

  // Open an overlay (also closes the mobile drawer if it's open).
  const openModal = (kind: ModalKind) => {
    setDrawer(false);
    open(kind);
  };

  const navLinks = (
    <>
      <button type="button" onClick={() => go("play")} className="nav-link">Games</button>
      <button type="button" onClick={() => openModal("leaderboard")} className="nav-link">Leaderboard</button>
      <button type="button" onClick={() => openModal("feedback")} className="nav-link">Feedback</button>
    </>
  );

  return (
    <nav className="nav3">
      <div className="nav3-left">
        {type === "back" && (
          <button onClick={goHome} aria-label="Back to all games" className="nav-back">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6" /></svg>
            <span className="hide-sm">All games</span>
          </button>
        )}
        <div className="nav3-brand" onClick={goHome}>
          <img src={logo} alt="NBA 3VIA" className="nav3-logo" />
          <div className="nav3-brand-text hide-xs">
            <span className="font-display" style={{ fontSize: 16, letterSpacing: 1 }}>NBA 3VIA</span>
            <span className="nav3-tag">HOOPS MINIGAMES</span>
          </div>
        </div>
      </div>

      {/* Desktop links */}
      <div className="nav3-links hide-md">{navLinks}</div>

      {/* Desktop right */}
      <div className="nav3-right hide-md">
        {user ? (
          <button onClick={() => go("leaderboard")} className="nav3-user">
            <span className="nav3-avatar">{initials(user.username)}</span>
            <span className="nav3-user-meta hide-sm">
              <span style={{ fontSize: 12, fontWeight: 700 }}>{user.username}</span>
              <span className="tnum" style={{ fontSize: 10, color: "var(--brand)", fontWeight: 600 }}>{user.points} pts</span>
            </span>
          </button>
        ) : (
          <Button size="sm" onClick={() => openModal("login")}>Log in</Button>
        )}
      </div>

      {/* Mobile hamburger */}
      <button onClick={() => setDrawer(true)} aria-label="Open menu" className="nav-icon-btn show-md">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><path d="M3 6h18M3 12h18M3 18h18" /></svg>
      </button>

      {/* Mobile drawer */}
      <AnimatePresence>
        {drawer && (
          <motion.div
            className="drawer-backdrop"
            onClick={() => setDrawer(false)}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <motion.div
              className="drawer-panel"
              onClick={(e) => e.stopPropagation()}
              initial={{ x: "100%" }}
              animate={{ x: 0 }}
              exit={{ x: "100%" }}
              transition={{ type: "spring", stiffness: 320, damping: 34 }}
            >
              <div className="drawer-head">
                <div className="nav3-brand">
                  <img src={logo} alt="" className="nav3-logo" />
                  <span className="font-display" style={{ fontSize: 15, letterSpacing: 1 }}>NBA 3VIA</span>
                </div>
                <button onClick={() => setDrawer(false)} aria-label="Close" className="nav-icon-btn" style={{ width: 32, height: 32 }}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><path d="M18 6L6 18M6 6l12 12" /></svg>
                </button>
              </div>
              <div className="drawer-body">
                <button onClick={() => go("play")} className="drawer-link">Games</button>
                <button onClick={() => openModal("leaderboard")} className="drawer-link">Leaderboard</button>
                <button onClick={() => openModal("feedback")} className="drawer-link">Feedback</button>
              </div>
              <div className="drawer-foot">
                {user ? (
                  <div className="nav3-user" style={{ width: "100%" }}>
                    <span className="nav3-avatar">{initials(user.username)}</span>
                    <span className="nav3-user-meta">
                      <span style={{ fontSize: 14, fontWeight: 700 }}>{user.username}</span>
                      <span className="tnum" style={{ fontSize: 11, color: "var(--brand)", fontWeight: 600 }}>{user.points} pts</span>
                    </span>
                  </div>
                ) : (
                  <Button block size="lg" onClick={() => openModal("login")}>Log in / Sign up</Button>
                )}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </nav>
  );
}

export default Navigation;
