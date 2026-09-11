"use client";
/* eslint-disable react-hooks/exhaustive-deps */
import { useState, useEffect, useRef } from 'react';
import { usePathname } from 'next/navigation';
import { useNavigate } from '../../hooks/useNavigate';
import { useDispatch } from 'react-redux';
import { games } from '../../utils/GameUtils';
import Navigation from '../../components/Navigation';
import { useModal } from '../../context/ModalContext';
import { useMultiplayer } from '../../context/MultiplayerContext';
import GameResult from '../../components/GameResult';
import OnlineMatch from '../../components/MultiPlayer/OnlineMatch';
import MultiplayerPanel from '../../components/MultiPlayer/MultiplayerPanel';
import { renderGame } from '../../Game Renderers/RenderGame';
import type { AppDispatch } from '../../store';
import { updatePoints } from '../../store/userSlice';
import { showErrorAlert } from '../../utils/Alerts';
import type { GameData } from '../../types/types';
import { apiFetch } from '../../utils/Api';
import { BACKEND_ORIGIN } from '../../configurations/backend';
import { Stage, CourtLoader, Button, Chip } from '../../components/ui';
import { FeedbackSlotContext } from '../../context/FeedbackSlotContext';
import "../../styles/MiniGame.css";

// NOTE: there is deliberately no CONTENT_STAGE_GAMES list here any more.
// Whether a game hugs its content or fills the stage is declared by the game
// itself via <GameFrame fill>, and `.playing-wrap` reads that with :has() (see
// MiniGame.css). The old hand-maintained id list drifted out of sync and left
// several games with 100-230px of dead space above the Exit button.

function MiniGame() {
  const dispatch = useDispatch<AppDispatch>();
  const navigate = useNavigate();
  const { open } = useModal();
  const { mp } = useMultiplayer();
  const pathname = usePathname();
  // Every game is routed at its urlPath, so the URL alone resolves the game —
  // deep-links and reloads included.
  const gameId = games.find(g => g.urlPath === pathname)?.id;
  const game = games.find(g => g.id === gameId);
  const [loading, setLoading] = useState(false);
  const [gameStarted, setGameStarted] = useState(false);
  const [gameData, setGameData] = useState<GameData[]>([]);
  const [score, setScore] = useState(0);
  const [showResult, setShowResult] = useState(false);
  const [showFinalResult, setShowFinalResult] = useState(false);
  // The shell feedback slot node (in .playing-wrap, above Exit) that every game's
  // "Correct! +10" popup portals into — one consistent spot across all games.
  const [feedbackSlot, setFeedbackSlot] = useState<HTMLDivElement | null>(null);
  // Epoch ms the current single-player play started (set when the stage
  // enters "playing") — feeds the session timer + duration logging.
  const playStartRef = useRef(0);
  const prevStageRef = useRef("idle");
  // Guarantees a finished game awards profile points exactly once — shared by
  // the result-overview effect and the in-place (answers-in-view) end path.
  const awardedRef = useRef(false);
  // Desktop rail: matched to the stage's actual rendered height (which varies
  // by game and by phase) so the "all games" list is as tall as the game
  // container instead of shrinking to its own content or a fixed cap.
  const stageColRef = useRef<HTMLElement | null>(null);
  const [railHeight, setRailHeight] = useState<number | null>(null);

  useEffect(() => {
    const el = stageColRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setRailHeight(entry.contentRect.height));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // An online match takes over the whole stage area. A friend-room lobby does
  // NOT — the stage stays idle (with Play disabled) while the room card waits.
  const inLobby = mp.phase === "lobby";
  const online = mp.phase !== "idle" && !inLobby;

  const handleStart = async () => {
    if (!game) return;
    setLoading(true);
    setGameStarted(true);
    setScore(0);
    setShowResult(false);
    awardedRef.current = false;
    setTimeout(async () => {
      if (!game) return;
      const result = await game.fetchData();
      if (result.success) {
        setGameData(result.data ?? []);
      } else {
        game.handleError(result.error ?? { title: "Something went wrong", message: "Please try again." });
        setGameStarted(false);
      }
      setLoading(false);
    }, 2000);
  };

  const handleRestart = async () => {
    setGameStarted(false);
    setGameData([]);
    setScore(0);
    setShowResult(false);
  };

  const handleExit = () => {
    setGameData([]);
    setGameStarted(false);
    setLoading(false);
  };

  useEffect(() => {
    setLoading(false);
    setGameStarted(false);
    setGameData([]);
    setScore(0);
    setShowResult(false);
    awardedRef.current = false;
  }, [gameId]);

  // Log a finished single-player game exactly once (guarded by awardedRef).
  // The session log is also what awards the points: the server records the
  // GameSession, clamps the score and credits the account in one step, then
  // reports back what it actually granted. We trust that number, not ours —
  // the client no longer tells the backend how many points it deserves.
  const awardPoints = async (finalScore: number) => {
    if (awardedRef.current) return;
    awardedRef.current = true;
    if (!game) return;
    try {
      // apiFetch only attaches the JWT when one exists, so guests log anonymously
      // and are simply awarded nothing.
      const response = await apiFetch(`${BACKEND_ORIGIN}/trivia/log-session/`, {
        method: "POST",
        body: JSON.stringify({
          game: game.id,
          mode: "single",
          score: finalScore,
          duration_ms: playStartRef.current ? Date.now() - playStartRef.current : 0,
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (data.error) showErrorAlert(data.error, "Saving your score failed!");
      else if (data.awarded > 0) dispatch(updatePoints(data.awarded));
    } catch (err) {
      console.error("Network error:", err);
    }
  };

  // Result-overview flow: award points, then flip GameResult from "Calculating…"
  // to the animated final screen after a beat.
  useEffect(() => {
    if (!showResult) return;
    let cancelled = false;
    (async () => {
      setShowFinalResult(false);
      await awardPoints(score);
      await new Promise((res) => setTimeout(res, 1500));
      if (!cancelled) setShowFinalResult(true);
    })();
    return () => { cancelled = true; };
  }, [showResult]);

  // A game is "locked in" while actively playing single-player, in an online
  // match, or waiting in a friend room — the player can't hop games from the
  // rail until they finish/exit (in a lobby, the HOST changes the game from
  // the room card instead).
  const inProgress = (gameStarted && !showResult) || online || inLobby;

  // ---- Derive the single-player stage phase ----
  let stage: "idle" | "loading" | "playing" | "result";
  if (showResult) stage = "result";
  else if (loading) stage = "loading";
  else if (gameStarted && gameData.length > 0) stage = "playing";
  else stage = "idle";

  // Stamp the play start whenever the stage transitions into "playing".
  useEffect(() => {
    if (stage === "playing" && prevStageRef.current !== "playing") playStartRef.current = Date.now();
    prevStageRef.current = stage;
  }, [stage]);

  const renderStage = () => {
    switch (stage) {
      case "idle":
        return (
          <div className="idle">
            <div className="idle-thumb" style={{ backgroundImage: game?.backgroundImage }} />
            <div className="idle-head">
              <h2 className="font-display" style={{ fontSize: 23 }}>{game?.name}</h2>
              <p style={{ fontSize: 14, color: "var(--muted)", lineHeight: 1.5 }}>{game?.description}</p>
            </div>
            <div className="idle-chips">
              <Chip>5 rounds</Chip>
              <Chip>up to <span className="tnum" style={{ color: "var(--brand)", fontWeight: 700, marginLeft: 4 }}>{game?.maxPoints}</span> pts</Chip>
            </div>
            {inLobby ? (
              <p className="idle-room-note">
                You're in a private room.
              </p>
            ) : (
              <Button size="lg" onClick={handleStart}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z" /></svg> Play
              </Button>
            )}
          </div>
        );
      case "loading":
        return <CourtLoader label="Warming up the court…" />;
      case "playing":
        return (
          <div className="playing-wrap">
            <FeedbackSlotContext.Provider value={feedbackSlot}>
              {renderGame({
                gameId: game?.id,
                gameData,
                pointsPerCorrect: game?.pointsPerCorrect,
                onGameEnd: (finalScore: number, opts?: { inPlace?: boolean }) => {
                  setScore(finalScore);
                  if (opts?.inPlace) awardPoints(finalScore);
                  else setShowResult(true);
                },
                onExit: handleExit,
                onPlayAgain: handleStart,
                onClose: handleRestart,
              })}
            </FeedbackSlotContext.Provider>
            {/* Shell-owned feedback slot: game popups portal here so "Correct! +10"
                shows in one consistent spot in the gap above Exit for every game. */}
            <div className="feedback-slot" ref={setFeedbackSlot} aria-hidden="true" />
            <button className="exit-link" onClick={handleExit}>Exit game</button>
          </div>
        );
      case "result":
        return <GameResult showFinalResult={showFinalResult} score={score} maxPoints={game?.maxPoints ?? 0} onPlayAgain={handleStart} onClose={handleRestart} />;
    }
  };

  return (
    <div className="app-shell">
      <Navigation type="back" />

      <main className="page game-page">
        {/* is-room floats the friend-room card to the top on small screens */}
        <div className={`game-grid${inLobby ? " is-room" : ""}`}>
          {/* Mobile game strip */}
          <div className="rail-strip">
            {games.map((g) => (
              <button
                key={g.id}
                className={`rail-chip${g.id === game?.id ? " is-active" : ""}`}
                disabled={inProgress || g.id === "coming-soon"}
                onClick={() => navigate(g.urlPath, { state: { id: g.id } })}
              >
                {g.name}
              </button>
            ))}
          </div>

          {/* Desktop rail */}
          <aside className="rail" style={railHeight != null ? { height: `min(${railHeight}px, calc(100dvh - 104px))` } : undefined}>
            <div className="rail-head"><span>ALL GAMES</span><span>{games.length}</span></div>
            <div className="rail-list">
              {games.map((g) => (
                <button
                  key={g.id}
                  disabled={g.id === "coming-soon"}
                  onClick={() => {
                    if (inProgress) { showErrorAlert("Finish your current game first.", "Game in progress", "Continue playing"); return; }
                    navigate(g.urlPath, { state: { id: g.id } });
                  }}
                  className={`rail-item${g.id === game?.id ? " is-active" : ""}`}
                >
                  <span className="rail-thumb" style={{ backgroundImage: g.backgroundImage }} />
                  <span className="rail-meta">
                    <span className="rail-name">{g.name}</span>
                    <span className="rail-sub">{g.maxPoints > 0 ? `up to ${g.maxPoints} pts` : "soon"}</span>
                  </span>
                </button>
              ))}
            </div>
          </aside>

          {/* Center stage */}
          <section className="stage-col" ref={stageColRef}>
            <div className="stage-title">
              <h1 className="font-display" style={{ fontSize: "clamp(19px,2.6vw,26px)" }}>{game?.name}</h1>
              <button className="info-btn" aria-label="How to play" onClick={() => game && open("instructions", { game, onPlay: stage === "idle" ? handleStart : undefined })}>
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><path d="M12 16v-4M12 8h.01" /></svg>
              </button>
              {online
                ? <Chip variant="brand" dot style={{ marginLeft: "auto" }}>{mp.roomType === "friend" ? "PRIVATE MATCH" : "ONLINE 1V1"}</Chip>
                : inLobby
                  ? <Chip variant="brand" dot style={{ marginLeft: "auto" }}>PRIVATE ROOM</Chip>
                  : <Chip variant="brand" dot style={{ marginLeft: "auto" }}>{game?.tag}</Chip>}
            </div>

            <Stage phaseKey={online ? "online" : stage}>
              {online ? <OnlineMatch /> : renderStage()}
            </Stage>
          </section>

          {/* Aside: one merged Multiplayer card, same on mobile and desktop. */}
          <aside className="game-aside">
            <MultiplayerPanel game={game} gameStarted={gameStarted} showResult={showResult} />
          </aside>
        </div>
      </main>
    </div>
  );
}

export default MiniGame;
