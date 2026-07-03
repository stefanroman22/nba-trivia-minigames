import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import { useSelector } from "react-redux";
import logo from "../assets/basketballLogo.webp";
import defaultAvatar from "../assets/default.png";
import type { RootState } from "../store";
import { scrollToSection } from "../utils/ScrolllToSection";
import { useModal, type ModalKind } from "../context/ModalContext";
import { useMultiplayer } from "../context/MultiplayerContext";
import Button from "./ui/Button";
import "../styles/Navigation.css";

interface NavigationProps {
  type?: "full" | "back";
}

const initials = (name?: string) =>
  (name || "You").trim().split(/\s+/).map((p) => p[0]).join("").slice(0, 2).toUpperCase() || "YS";

/** Round user avatar — profile photo when available, initials as fallback. */
function UserAvatar({ photo, name, size = 28 }: { photo?: string | null; name?: string; size?: number }) {
  if (photo) {
    return (
      <span className="nav3-avatar nav3-avatar--photo" style={{ width: size, height: size }}>
        <img
          src={photo}
          alt=""
          onError={(e) => { (e.currentTarget as HTMLImageElement).src = defaultAvatar; }}
        />
      </span>
    );
  }
  return (
    <span className="nav3-avatar" style={{ width: size, height: size }}>{initials(name)}</span>
  );
}

function Navigation({ type = "full" }: NavigationProps) {
  const navigate = useNavigate();
  const { user } = useSelector((state: RootState) => state.user);
  const { open } = useModal();
  const { mp, leaveMatch } = useMultiplayer();
  const [drawer, setDrawer] = useState(false);

  const goHome = () => {
    if (mp.phase !== "idle") leaveMatch(); // leave any live match before heading home
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
        <div className="nav3-brand" onClick={goHome}>
          <img src={logo} alt="HOOPS24" className="nav3-logo" />
          <div className="nav3-brand-text">
            <span className="font-display" style={{ fontSize: 16, letterSpacing: 1 }}>HOOPS24</span>
            <span className="nav3-tag">NBA MINIGAMES</span>
          </div>
        </div>
      </div>

      {/* Desktop links */}
      <div className="nav3-links hide-md">{navLinks}</div>

      {/* Desktop right */}
      <div className="nav3-right hide-md">
        {user ? (
          <button onClick={() => go("leaderboard")} className="nav3-user">
            <UserAvatar photo={user.profile_photo} name={user.username} />
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

      {/* Mobile full-screen menu */}
      <AnimatePresence>
        {drawer && (
          <motion.div
            className="drawer-panel"
            initial={{ opacity: 0, x: "8%" }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: "8%" }}
            transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
          >
            <div className="drawer-head">
              <div className="nav3-brand" onClick={() => { setDrawer(false); goHome(); }}>
                <img src={logo} alt="" className="nav3-logo" />
                <div className="nav3-brand-text">
                  <span className="font-display" style={{ fontSize: 15, letterSpacing: 1 }}>HOOPS24</span>
                  <span className="nav3-tag">NBA MINIGAMES</span>
                </div>
              </div>
              <button onClick={() => setDrawer(false)} aria-label="Close" className="nav-icon-btn" style={{ width: 40, height: 40 }}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><path d="M18 6L6 18M6 6l12 12" /></svg>
              </button>
            </div>

            <div className="drawer-body">
              <button onClick={() => go("play")} className="drawer-link">
                <span>Games</span>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 6l6 6-6 6" /></svg>
              </button>
              <button onClick={() => openModal("leaderboard")} className="drawer-link">
                <span>Leaderboard</span>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 6l6 6-6 6" /></svg>
              </button>
              <button onClick={() => openModal("feedback")} className="drawer-link">
                <span>Feedback</span>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 6l6 6-6 6" /></svg>
              </button>
            </div>

            <div className="drawer-foot">
              {user ? (
                <div className="nav3-user" style={{ width: "100%", justifyContent: "center" }}>
                  <UserAvatar photo={user.profile_photo} name={user.username} size={34} />
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
        )}
      </AnimatePresence>
    </nav>
  );
}

export default Navigation;
