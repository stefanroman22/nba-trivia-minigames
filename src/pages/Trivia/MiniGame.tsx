/* eslint-disable react-hooks/exhaustive-deps */
import { useState, useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useSelector, useDispatch } from 'react-redux';
import { games } from '../../utils/GameUtils';
import Navigation from '../../components/Navigation';
import { useModal } from '../../context/ModalContext';
import { useMultiplayer } from '../../context/MultiplayerContext';
import GameResult from '../../components/GameResult';
import OnlineMatch from '../../components/MultiPlayer/OnlineMatch';
import FriendPlay from '../../components/MultiPlayer/FriendPlay';
import { renderGame } from '../../Game Renderers/RenderGame';
import type { RootState, AppDispatch } from '../../store';
import { updatePoints } from '../../store/userSlice';
import { showErrorAlert } from '../../utils/Alerts';
import type { GameData } from '../../types/types';
import { apiFetch } from '../../utils/Api';
import { BACKEND_URL } from '../../configurations/backend';
import { Stage, CourtLoader, Button, Chip } from '../../components/ui';
import "../../styles/MiniGame.css";

function MiniGame() {
  const dispatch = useDispatch<AppDispatch>();
  const navigate = useNavigate();
  const { isLoggedIn } = useSelector((state: RootState) => state.user);
  const { open } = useModal();
  const { mp, findMatch } = useMultiplayer();
  const location = useLocation();
  // Prefer the id passed via router state, but fall back to the URL path so
  // deep-links and reloads still resolve the right game.
  const gameId = location.state?.id ?? games.find(g => g.urlPath === location.pathname)?.id;
  const game = games.find(g => g.id === gameId);
  const [loading, setLoading] = useState(false);
  const [gameStarted, setGameStarted] = useState(false);
  const [gameData, setGameData] = useState<GameData[]>([]);
  const [score, setScore] = useState(0);
  const [showResult, setShowResult] = useState(false);
  const [showFinalResult, setShowFinalResult] = useState(false);

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
  }, [gameId]);

  useEffect(() => {
    const awardPoints = async () => {
      if (showResult) {
        setShowFinalResult(false);
        const wait = (ms: number) => new Promise((res) => setTimeout(res, ms));
        try {
          if (score > 0) {
            const response = await apiFetch(`${BACKEND_URL}/update-profile/`, {
              method: "POST",
              body: JSON.stringify({ points: score }),
            });
            const data = await response.json();
            if (data.error) {
              showErrorAlert(data.error, "Updating profile failed!");
            } else {
              dispatch(updatePoints(score));
            }
          }
          await wait(2000);
        } catch (err) {
          console.error("Network error:", err);
        } finally {
          setShowFinalResult(true);
        }
      }
    };
    awardPoints();
  }, [showResult, score]);

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
              <Chip>~1 min</Chip>
              <Chip>up to <span className="tnum" style={{ color: "var(--brand)", fontWeight: 700, marginLeft: 4 }}>{game?.maxPoints}</span> pts</Chip>
            </div>
            {inLobby ? (
              <p className="idle-room-note">
                You're in a private room — the match starts as soon as it fills up.
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
            {renderGame({
              gameId: game?.id,
              gameData,
              pointsPerCorrect: game?.pointsPerCorrect,
              onGameEnd: (finalScore: number) => { setScore(finalScore); setShowResult(true); },
              onExit: handleExit,
              onPlayAgain: handleStart,
            })}
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
          <aside className="rail">
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
          <section className="stage-col">
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

          {/* Aside */}
          <aside className="game-aside">
            <div className="aside-card">
              <div className="aside-card-head">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--brand)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M9 7a4 4 0 1 0 0 .01M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" /></svg>
                <h3 className="font-display" style={{ fontSize: 15 }}>Multiplayer</h3>
              </div>
              {!isLoggedIn ? (
                <>
                  <p style={{ fontSize: 13, color: "var(--muted)", lineHeight: 1.5 }}>Challenge a random opponent in real time. You'll need an account to matchmake.</p>
                  <Button variant="secondary" block size="md" onClick={() => open("login")}>Log in to play online</Button>
                </>
              ) : (
                <Button block size="md" disabled={online || inLobby} onClick={() => game && findMatch(game)}>
                  {mp.phase === "searching" ? "Searching…" : online ? "In a match" : inLobby ? "In a room" : "Play online 1v1"}
                </Button>
              )}
            </div>

            <div className={`aside-card${inLobby ? " is-room" : ""}`}>
              <div className="aside-card-head">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--brand)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M19 8v6M22 11h-6" /></svg>
                <h3 className="font-display" style={{ fontSize: 15 }}>Play with a friend</h3>
              </div>
              {game && <FriendPlay game={game} blocked={gameStarted && !showResult} />}
            </div>
          </aside>
        </div>
      </main>
    </div>
  );
}

export default MiniGame;
