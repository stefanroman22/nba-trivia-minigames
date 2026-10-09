import { useCallback, useEffect, useRef, useState, type MouseEvent } from "react";
import { SITE_NAME, SITE_TAGLINE } from "../configurations/site";
import { useNavigate } from "../hooks/useNavigate";
import { useFocusTrap } from "../hooks/useFocusTrap";
import { useLoginReveal } from "../hooks/useLoginReveal";
import { AnimatePresence, motion } from "framer-motion";
import { useSelector } from "react-redux";
import logo from "../assets/basketballLogo.webp";
import defaultAvatar from "../assets/default.png";
import type { RootState } from "../store";
import { scrollToSection } from "../utils/ScrolllToSection";
import { useModal, type ModalKind } from "../context/ModalContext";
import { useMultiplayer } from "../context/MultiplayerContext";
import Button from "./ui/Button";
import { useLogout } from "../hooks/useLogout";
import "../styles/Navigation.css";

interface NavigationProps {
  type?: "full" | "back";
}

const initials = (name?: string) =>
  (name || "You").trim().split(/\s+/).map((p) => p[0]).join("").slice(0, 2).toUpperCase() || "YS";

/** Round user avatar — profile photo when available, initials as fallback. */
// Let the browser handle ctrl/cmd/shift/middle-click (open in new tab/window) on real links.
const isModifiedClick = (e: MouseEvent<HTMLElement>) => e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0;

function UserAvatar({ photo, name, size = 28 }: { photo?: string | null; name?: string; size?: number }) {
  if (photo) {
    return (
      <span className="nav3-avatar nav3-avatar--photo" style={{ width: size, height: size }}>
        <img
          src={photo}
          alt=""
          onError={(e) => { (e.currentTarget as HTMLImageElement).src = defaultAvatar.src; }}
        />
      </span>
    );
  }
  return (
    <span className="nav3-avatar" style={{ width: size, height: size }}>{initials(name)}</span>
  );
}

/** Avatar + username + #id chip — the same identity summary on desktop; avatar-only on mobile. */
type ChipUser = { username: string; id: string | number; profile_photo?: string | null; points?: number };

function UserChip({ user, onClick, reveal, expanded }: { user: ChipUser; onClick: () => void; reveal: ReturnType<typeof useLoginReveal>; expanded?: boolean }) {
  return (
    <motion.button
      onClick={onClick}
      className="nav3-user"
      aria-label={`${user.username} #${user.id}`}
      aria-haspopup={expanded === undefined ? undefined : "menu"}
      aria-expanded={expanded}
      data-focus-fallback
      {...reveal}
    >
      <UserAvatar photo={user.profile_photo} name={user.username} />
      <span className="nav3-user-meta hide-md">
        <span style={{ fontSize: 12, fontWeight: 700 }}>{user.username}</span>
        <span className="tnum" style={{ fontSize: 9.5, fontWeight: 600, color: "var(--muted)" }}>#{user.id}</span>
      </span>
    </motion.button>
  );
}

/** The header's profile chip opens this menu: who you are at a glance, Profile settings, Log out.
 *  Closes on an outside press, Escape, or picking an item. */
function ProfileMenu({ user, reveal, onSettings, onLogout }: { user: ChipUser; reveal: ReturnType<typeof useLoginReveal>; onSettings: () => void; onLogout: () => void }) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => { if (!wrapRef.current?.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);
  const pick = (fn: () => void) => () => { setOpen(false); fn(); };

  return (
    <div className="nav3-menu-wrap" ref={wrapRef}>
      <UserChip user={user} onClick={() => setOpen((v) => !v)} reveal={reveal} expanded={open} />
      <AnimatePresence>
        {open && (
          <motion.div
            className="nav3-menu"
            role="menu"
            aria-label="Profile"
            initial={{ opacity: 0, y: -6, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.97 }}
            transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
          >
            <div className="nav3-menu-head">
              <UserAvatar photo={user.profile_photo} name={user.username} size={38} />
              <div className="nav3-menu-who">
                <span className="nav3-menu-name">{user.username}</span>
                <span className="tnum nav3-menu-id">#{user.id}</span>
              </div>
              {user.points != null && <span className="tnum nav3-menu-pts">{user.points} pts</span>}
            </div>
            <button type="button" role="menuitem" className="nav3-menu-item" onClick={pick(onSettings)}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="8" r="4" /><path d="M4 21v-1a7 7 0 0 1 14 0v1" /></svg>
              Profile settings
            </button>
            <button type="button" role="menuitem" className="nav3-menu-item nav3-menu-item--muted" onClick={pick(onLogout)}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9" /></svg>
              Log out
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function Navigation({ type = "full" }: NavigationProps) {
  const navigate = useNavigate();
  const { user } = useSelector((state: RootState) => state.user);
  // The chip fades in on a fresh login only (never on a cold load of an existing session).
  const reveal = useLoginReveal();
  const { open } = useModal();
  const { mp, leaveMatch } = useMultiplayer();
  const { logOut } = useLogout();
  const [drawer, setDrawer] = useState(false);
  const drawerRef = useRef<HTMLDivElement>(null);
  const closeDrawer = useCallback(() => setDrawer(false), []);
  // The drawer is a modal dialog: focus moves in, Tab wraps, Escape closes, focus returns to the hamburger.
  // Scroll lock stays off so the drawer keeps its current scrolling behaviour.
  useFocusTrap(drawerRef, closeDrawer, { active: drawer, lockScroll: false });

  const goHome = () => {
    if (mp.phase !== "idle") leaveMatch(); // leave any live match before heading home
    navigate("/");
  };

  // Scroll to a home section; from a game page, route home with the section
  // as a hash so Next.js's router scrolls to it once the page has mounted
  // (native hash-fragment scroll, honoring .games-section's scroll-margin-top)
  // instead of racing a fixed delay against the route load.
  const go = (section: string) => {
    setDrawer(false);
    if (type === "full") {
      scrollToSection(section);
    } else {
      navigate(`/#${section}`);
    }
  };

  // Open an overlay (also closes the mobile drawer if it's open).
  const openModal = (kind: ModalKind) => {
    setDrawer(false);
    open(kind);
  };

  // Route to a page (closes the mobile drawer if it's open).
  const goPage = (path: string) => {
    setDrawer(false);
    navigate(path);
  };

  const navLinks = (
    <>
      <button type="button" onClick={() => go("games-grid")} className="nav-link">Games</button>
      <button type="button" onClick={() => openModal("leaderboard")} className="nav-link">Leaderboard</button>
      <button type="button" onClick={() => openModal("feedback")} className="nav-link">Feedback</button>
      {user?.is_admin && (
        <button type="button" onClick={() => goPage("/admin")} className="nav-link nav-link--admin">Admin</button>
      )}
    </>
  );

  return (
    <nav className="nav3">
      <div className="nav3-left">
        <a
          href="/"
          className="nav3-brand"
          onClick={(e) => { if (isModifiedClick(e)) return; e.preventDefault(); goHome(); }}
        >
          <img src={logo.src} alt={SITE_NAME} className="nav3-logo" width={38} height={38} />
          <div className="nav3-brand-text">
            <span className="font-display" style={{ fontSize: 16, letterSpacing: 1 }}>{SITE_NAME.toUpperCase()}</span>
            <span className="nav3-tag">{SITE_TAGLINE}</span>
          </div>
        </a>
      </div>

      {/* Desktop links */}
      <div className="nav3-links hide-md">{navLinks}</div>

      {/* Desktop right */}
      <div className="nav3-right hide-md">
        {user ? (
          <ProfileMenu user={user} reveal={reveal} onSettings={() => goPage("/profile")} onLogout={logOut} />
        ) : (
          <Button size="sm" onClick={() => openModal("login")}>Log in</Button>
        )}
      </div>

      {/* Mobile: avatar-only chip (meta hidden ≤900px via hide-md), then the hamburger */}
      <div className="nav3-mobile-right show-md">
        {user && <ProfileMenu user={user} reveal={reveal} onSettings={() => goPage("/profile")} onLogout={logOut} />}
        <button onClick={() => setDrawer(true)} aria-label="Open menu" aria-expanded={drawer} aria-controls="nav-drawer" className="nav-icon-btn">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><path d="M3 6h18M3 12h18M3 18h18" /></svg>
        </button>
      </div>

      {/* Mobile full-screen menu */}
      <AnimatePresence>
        {drawer && (
          <motion.div
            ref={drawerRef}
            id="nav-drawer"
            role="dialog"
            aria-modal="true"
            aria-label="Menu"
            className="drawer-panel"
            initial={{ opacity: 0, x: "8%" }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: "8%" }}
            transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
          >
            <div className="drawer-head">
              <a
                href="/"
                className="nav3-brand"
                onClick={(e) => { if (isModifiedClick(e)) return; e.preventDefault(); setDrawer(false); goHome(); }}
              >
                <img src={logo.src} alt="" className="nav3-logo" width={38} height={38} />
                <div className="nav3-brand-text">
                  <span className="font-display" style={{ fontSize: 15, letterSpacing: 1 }}>{SITE_NAME.toUpperCase()}</span>
                  <span className="nav3-tag">{SITE_TAGLINE}</span>
                </div>
              </a>
              <div className="drawer-head-right">
                {user && <UserChip user={user} onClick={() => goPage("/profile")} reveal={reveal} />}
                <button onClick={() => setDrawer(false)} aria-label="Close" className="nav-icon-btn" style={{ width: 40, height: 40 }}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><path d="M18 6L6 18M6 6l12 12" /></svg>
                </button>
              </div>
            </div>

            <div className="drawer-body">
              <button onClick={() => go("games-grid")} className="drawer-link">
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
              {user && (
                <button onClick={() => goPage("/profile")} className="drawer-link">
                  <span>Profile settings</span>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 6l6 6-6 6" /></svg>
                </button>
              )}
              {user?.is_admin && (
                <button onClick={() => goPage("/admin")} className="drawer-link">
                  <span>Admin</span>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 6l6 6-6 6" /></svg>
                </button>
              )}
            </div>

            {/* Logged-in identity now lives in the top bar, next to the hamburger —
                no need to repeat it down here. */}
            {!user ? (
              <div className="drawer-foot">
                <Button block size="lg" onClick={() => openModal("login")}>Log in / Sign up</Button>
              </div>
            ) : (
              <div className="drawer-foot">
                <Button block size="lg" variant="secondary" onClick={() => { setDrawer(false); void logOut(); }}>Log out</Button>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </nav>
  );
}

export default Navigation;
