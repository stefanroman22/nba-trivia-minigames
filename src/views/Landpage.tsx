"use client";
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "../hooks/useNavigate";
import { useSelector } from "react-redux";
import { AnimatePresence, motion } from "framer-motion";
import "../styles/LandPage.css";
import "../styles/GlobalStyles.css";
import { visibleGames as games } from "../utils/GameUtils";
import { dailyGameId } from "../utils/dailyGame";
import Navigation from "../components/Navigation";
import UserProfile from "../components/UserProfile";
import Leaderboard from "../components/Leaderboard";
import GuestPanel from "../components/GuestPanel";
import Reveal from "../components/motion/Reveal";
import { reducedFade, swap } from "../motion/variants";
import { useReducedMotionSafe } from "../hooks/useReducedMotionSafe";
import { Button, GameTile, SectionHeader, Field } from "../components/ui";
import { useModal } from "../context/ModalContext";
import { useWordleCardState } from "../hooks/useWordleCardState";
import { useLoginReveal } from "../hooks/useLoginReveal";
import { scrollToSection } from "../utils/ScrolllToSection";
import type { RootState } from "../store";

const Landpage = () => {
  const navigate = useNavigate();
  // Opacity-only swap under reduced motion; null (pre-hydration) counts as not reduced (UI-20).
  const swapVariants = useReducedMotionSafe() ? reducedFade : swap;
  const { user } = useSelector((state: RootState) => state.user);
  // The profile card fades in on a fresh login only (never on a cold load of an existing session).
  const profileReveal = useLoginReveal();
  const { open } = useModal();
  const [query, setQuery] = useState("");
  const wordleCard = useWordleCardState();

  // Navigation.tsx routes cross-page "Games"/"Leaderboard" taps to "/#<section>"
  // so the section is deep-linkable. Next scrolls to it on mount while the
  // route-enter scale transform (app/template.tsx) is still active, so its
  // rect-based target lands short. Re-run the same (now layout-based) scroll
  // our in-page nav uses, one frame after mount, so it lands after (and
  // overrides) Next's own scroll at the correct offset regardless of timing.
  useEffect(() => {
    const id = window.location.hash.slice(1);
    if (!id || !document.getElementById(id)) return;
    const raf = window.requestAnimationFrame(() => scrollToSection(id));
    return () => window.cancelAnimationFrame(raf);
  }, []);

  const playableCount = games.filter((g) => g.id !== "coming-soon").length;

  const openGame = (id: string, urlPath: string) => navigate(urlPath, { state: { id } });
  // Computed at call time (click / render), so a tab left open across Paris midnight picks the right game.
  const todaysGame = () => {
    const id = dailyGameId(games, new Date());
    return games.find((g) => g.id === id) ?? games[0];
  };
  // The label is date-derived, so it is set after mount (not during SSR) and refreshed when a tab returns to view.
  const [todaysName, setTodaysName] = useState("");
  useEffect(() => {
    const sync = () => setTodaysName(todaysGame().name);
    sync();
    document.addEventListener("visibilitychange", sync);
    return () => document.removeEventListener("visibilitychange", sync);
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return games;
    return games.filter((g) => `${g.name} ${g.description}`.toLowerCase().includes(q));
  }, [query]);

  return (
    <div className="app-shell">
      <Navigation type="full" />

      <main className="page">
        {/* ===== HERO ===== */}
        <section id="play" className="hero">
          <div className="hero-grain" aria-hidden="true" />
          <div className="hero-inner">
            {/* Hero entrances are slide-only (no opacity fade): these elements
                are server-rendered, and starting them at opacity 0 would make
                the static page paint incomplete until hydration. */}
            <motion.div className="hero-badge" role="note" aria-label="FREE · NO SIGN-UP NEEDED · NEW GAME EVERY WEEK" initial={{ y: 14 }} animate={{ y: 0 }} transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}>
              <span className="hero-badge-dot" />
              <span className="hero-badge-t-full">FREE · NO SIGN-UP NEEDED · NEW GAME EVERY WEEK</span>
              <span className="hero-badge-t-mid" aria-hidden="true">FREE · NO SIGN-UP · NEW GAME WEEKLY</span>
              <span className="hero-badge-t-short" aria-hidden="true">FREE · NO SIGN-UP · WEEKLY GAMES</span>
            </motion.div>
            {/* LCP element: slide-only entrance (no opacity fade) so its first
                paint isn't deferred to the animation — keeps mobile LCP honest. */}
            <motion.h1 className="font-display hero-h1" initial={{ y: 14 }} animate={{ y: 0 }} transition={{ duration: 0.4, delay: 0.04, ease: [0.22, 1, 0.36, 1] }}>
              Test your <span style={{ color: "var(--brand)" }}>hoops IQ.</span><br />One quick game at a time.
            </motion.h1>
            <motion.p className="hero-lead" initial={{ y: 14 }} animate={{ y: 0 }} transition={{ duration: 0.4, delay: 0.08, ease: [0.22, 1, 0.36, 1] }}>
              Bite-sized NBA trivia. Build a streak, climb the global board, and challenge friends when you're ready.
            </motion.p>
            <motion.div className="hero-cta-row" initial={{ y: 14 }} animate={{ y: 0 }} transition={{ duration: 0.4, delay: 0.12, ease: [0.22, 1, 0.36, 1] }}>
              <Button size="lg" aria-label={todaysName ? `Play today's game: ${todaysName}` : undefined} onClick={() => { const g = todaysGame(); openGame(g.id, g.urlPath); }}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z" /></svg>
                Play today's game
              </Button>
              <Button size="lg" variant="secondary" onClick={() => document.getElementById("games-grid")?.scrollIntoView({ behavior: "smooth" })}>
                Browse all games
              </Button>
            </motion.div>
            <motion.div className="hero-stats" initial={{ y: 14 }} animate={{ y: 0 }} transition={{ duration: 0.4, delay: 0.16, ease: [0.22, 1, 0.36, 1] }}>
              <div className="hero-stat">
                <span className="tnum font-display hero-stat-num" style={{ color: "var(--brand)" }}>{playableCount}</span>
                <span className="hero-stat-lbl">GAMES</span>
              </div>
              {user && (
                <>
                  <div className="hero-stat-sep" />
                  <div className="hero-stat">
                    <span className="tnum font-display hero-stat-num">{user.points}</span>
                    <span className="hero-stat-lbl">YOUR POINTS</span>
                  </div>
                </>
              )}
            </motion.div>
          </div>
        </section>

        {/* ===== GAMES GRID ===== */}
        <section id="games-grid" className="games-section">
          <SectionHeader
            title="Pick a game"
            subtitle="Jump straight in."
            action={
              <div className="games-search">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--muted)" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="M21 21l-4.3-4.3" /></svg>
                <Field search value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search games…" aria-label="Search games" />
              </div>
            }
          />
          {/* Grid <-> empty line cross-fade when the search crosses zero results. The query echo
              inside the empty line stays instant (typing feedback). */}
          <AnimatePresence mode="wait" initial={false}>
          {filtered.length === 0 ? (
            <motion.div key="empty" className="games-empty" variants={swapVariants} initial="hidden" animate="visible" exit="exit">No games match “<strong style={{ color: "var(--text)" }}>{query}</strong>”. Try another keyword.</motion.div>
          ) : (
            <motion.div key="grid" className="games-grid3" variants={swapVariants} initial="hidden" animate="visible" exit="exit">
              {filtered.map((game, index) => {
                // Today's Wordle already played: grey tile + "Next Wordle in …" countdown.
                const playedLabel = game.id === "wordle" && wordleCard.locked ? wordleCard.label : null;
                const wordlePlayed = playedLabel !== null;
                return (
                  <GameTile
                    key={game.id}
                    name={game.name}
                    description={game.description}
                    backgroundImage={game.backgroundImage}
                    tag={game.tag}
                    pointLabel={game.id === "coming-soon" ? "SOON" : game.maxPoints > 0 ? `${game.maxPoints} pts` : "VOTE"}
                    cta={game.id === "coming-soon" ? "Coming soon" : playedLabel ?? "Play now"}
                    dimmed={wordlePlayed}
                    ctaTone={wordlePlayed ? "muted" : "default"}
                    ctaSwapKey={game.id === "wordle" ? (wordlePlayed ? "locked" : "play") : undefined}
                    index={index}
                    disabled={game.id === "coming-soon"}
                    onClick={() => openGame(game.id, game.urlPath)}
                  />
                );
              })}
            </motion.div>
          )}
          </AnimatePresence>
        </section>

        {/* ===== ENGAGE STRIP: leaderboard + guest panel / profile ===== */}
        <section id="leaderboard" className="engage-section">
          <Reveal>
            <div className="engage-strip">
              <Leaderboard />
              {user ? <motion.div className="profile-card" {...profileReveal}><UserProfile /></motion.div> : <GuestPanel />}
            </div>
          </Reveal>
        </section>

        {/* ===== FEEDBACK BAND ===== */}
        <section className="feedback-section">
          <Reveal amount={0.1}>
            <div className="feedback-band">
              <div className="feedback-band-left">
                <div className="feedback-band-icon">
                  <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="var(--brand)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /></svg>
                </div>
                <div>
                  <h3 className="font-display" style={{ fontSize: 16 }}>Got 20 seconds?</h3>
                  <p style={{ fontSize: 13, color: "var(--muted)", marginTop: 2 }}>Tell us what to build next. No login required.</p>
                </div>
              </div>
              <button className="feedback-band-btn" onClick={() => open("feedback")}>Share feedback</button>
            </div>
          </Reveal>
        </section>
      </main>

      {/* Floating feedback button */}
      <button className="feedback-fab" aria-label="Feedback" onClick={() => open("feedback")}>
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /></svg>
      </button>
    </div>
  );
};

export default Landpage;
