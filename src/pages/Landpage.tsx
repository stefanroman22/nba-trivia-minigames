import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useSelector } from "react-redux";
import { motion } from "framer-motion";
import "../styles/LandPage.css";
import "../styles/GlobalStyles.css";
import { games } from "../utils/GameUtils";
import Navigation from "../components/Navigation";
import UserProfile from "../components/UserProfile";
import Leaderboard from "../components/Leaderboard";
import GuestPanel from "../components/GuestPanel";
import Reveal from "../components/motion/Reveal";
import { Button, GameTile, SectionHeader, Field } from "../components/ui";
import { useModal } from "../context/ModalContext";
import type { RootState } from "../store";

const Landpage = () => {
  const navigate = useNavigate();
  const { user } = useSelector((state: RootState) => state.user);
  const { open } = useModal();
  const [query, setQuery] = useState("");

  const playableCount = games.filter((g) => g.id !== "coming-soon").length;

  const openGame = (id: string, urlPath: string) => navigate(urlPath, { state: { id } });

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
            <motion.div className="hero-badge" initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }}>
              <span className="hero-badge-dot" />
              {playableCount} GAMES · NO SIGN-UP NEEDED
            </motion.div>
            <motion.h1 className="font-display hero-h1" initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, delay: 0.05 }}>
              Test your <span style={{ color: "var(--brand)" }}>hoops IQ.</span><br />One quick game at a time.
            </motion.h1>
            <motion.p className="hero-lead" initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, delay: 0.1 }}>
              Bite-sized NBA trivia you can play in under a minute. Build a streak, climb the global board, and challenge friends when you're ready.
            </motion.p>
            <motion.div className="hero-cta-row" initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, delay: 0.15 }}>
              <Button size="lg" onClick={() => openGame(games[0].id, games[0].urlPath)}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z" /></svg>
                Play today's game
              </Button>
              <Button size="lg" variant="secondary" onClick={() => document.getElementById("games-grid")?.scrollIntoView({ behavior: "smooth" })}>
                Browse all games
              </Button>
            </motion.div>
            <motion.div className="hero-stats" initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, delay: 0.2 }}>
              <div className="hero-stat">
                <span className="tnum font-display hero-stat-num" style={{ color: "var(--brand)" }}>{playableCount}</span>
                <span className="hero-stat-lbl">GAMES</span>
              </div>
              <div className="hero-stat-sep" />
              <div className="hero-stat">
                <span className="tnum font-display hero-stat-num">{user ? user.points : "0"}</span>
                <span className="hero-stat-lbl">{user ? "YOUR POINTS" : "FREE TO PLAY"}</span>
              </div>
              <div className="hero-stat-sep" />
              <div className="hero-stat">
                <span className="font-display hero-stat-num">~1<span style={{ fontSize: "0.5em" }}>min</span></span>
                <span className="hero-stat-lbl">PER GAME</span>
              </div>
            </motion.div>
          </div>
        </section>

        {/* ===== GAMES GRID ===== */}
        <section id="games-grid" className="games-section">
          <SectionHeader
            title="Pick a game"
            subtitle="Jump straight in — your progress saves to your profile."
            action={
              <div className="games-search">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--muted)" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="M21 21l-4.3-4.3" /></svg>
                <Field search value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search games…" aria-label="Search games" />
              </div>
            }
          />
          {filtered.length === 0 ? (
            <div className="games-empty">No games match “<strong style={{ color: "var(--text)" }}>{query}</strong>”. Try another keyword.</div>
          ) : (
            <div className="games-grid3">
              {filtered.map((game, index) => (
                <GameTile
                  key={game.id}
                  name={game.name}
                  description={game.description}
                  backgroundImage={game.backgroundImage}
                  tag={game.tag}
                  pointLabel={game.id === "coming-soon" ? "SOON" : `${game.maxPoints} pts`}
                  cta={game.id === "coming-soon" ? "Coming soon" : "Play now"}
                  index={index}
                  onClick={() => openGame(game.id, game.urlPath)}
                />
              ))}
            </div>
          )}
        </section>

        {/* ===== ENGAGE STRIP: leaderboard + guest panel / profile ===== */}
        <section id="leaderboard" className="engage-section">
          <Reveal>
            <div className="engage-strip">
              <Leaderboard />
              {user ? <div className="profile-card"><UserProfile /></div> : <GuestPanel />}
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
