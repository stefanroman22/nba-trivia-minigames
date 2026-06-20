/* eslint-disable react-hooks/exhaustive-deps */
import { useState, useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useSelector, useDispatch } from 'react-redux';
import { games } from '../../utils/GameUtils';
import Navigation from '../../components/Navigation';
import { useModal } from '../../context/ModalContext';
import GameResult from '../../components/GameResult';
import MatchupDisplay from '../../components/MultiPlayer/MatchupDisplay';
import { renderGame } from '../../Game Renderers/RenderGame';
import socket from "../../socket";
import type { RootState, AppDispatch } from '../../store';
import { updatePoints } from '../../store/userSlice';
import { showErrorAlert } from '../../utils/Alerts';
import { leaveMultiplayer } from '../../utils/LeaveMultiplayer';
import type { RoomState, Game, PlayerInfo, GameData } from '../../types/types';
import { apiFetch } from '../../utils/Api';
import { BACKEND_URL } from '../../configurations/backend';
import { Stage, CourtLoader, Button, Chip } from '../../components/ui';
import "../../styles/MiniGame.css";

function MiniGame() {
  const dispatch = useDispatch<AppDispatch>();
  const navigate = useNavigate();
  const { isLoggedIn, user } = useSelector((state: RootState) => state.user);
  const { open } = useModal();
  const location = useLocation();
  // Prefer the id passed via router state, but fall back to the URL path so
  // deep-links and reloads still resolve the right game.
  const gameId = location.state?.id ?? games.find(g => g.urlPath === location.pathname)?.id;
  let game = games.find(g => g.id === gameId);
  const [loading, setLoading] = useState(false);
  const [gameStarted, setGameStarted] = useState(false);
  const [multiplayerMode, setMultiPlayerMode] = useState(false);
  const [gameData, setGameData] = useState<GameData[]>([]);
  const [score, setScore] = useState(0);
  const [showResult, setShowResult] = useState(false);
  const [showFinalResult, setShowFinalResult] = useState(false);
  const [roomState, setRoomState] = useState<RoomState>({
    status: "idle", code: null, game: null, opponent: null, gameData: null, selfSocketId: null, role: null,
  });

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
    game = games.find(g => g.id === gameId);
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

  useEffect(() => {
    const onOpponentNotFound = (g: unknown) => {
      console.log("Opponent not found for game:", g);
      setRoomState(prev => ({ ...prev, status: "idle" }));
      setGameStarted(false);
      showErrorAlert("Please try again", "Opponent not found");
    };
    const onMatchFound = (data: {
      roomCode: number; opponent: PlayerInfo; game: Game; selfSocketId: string; role: "host" | "guest";
    }) => {
      setRoomState(prev => ({
        ...prev, status: "matched", code: data.roomCode, opponent: data.opponent,
        game: data.game, selfSocketId: data.selfSocketId, role: data.role,
      }));
    };
    socket.on("opponentNotFound", onOpponentNotFound);
    socket.on("matchFound", onMatchFound);
    return () => {
      socket.off("matchFound", onMatchFound);
      socket.off("opponentNotFound", onOpponentNotFound);
    };
  }, []);

  useEffect(() => {
    if (isLoggedIn && user) {
      socket.emit("setUserInfo", {
        username: user.username, profile_photo: user.profile_photo, rank: user.rank, points: user.points,
      });
    }
  }, [isLoggedIn, user]);

  // ---- Derive the stage phase ----
  let stage: "idle" | "loading" | "playing" | "searching" | "matched" | "result";
  if (showResult) stage = "result";
  else if (roomState.status === "matched") stage = "matched";
  else if (roomState.status === "loading") stage = "searching";
  else if (loading) stage = "loading";
  else if (gameStarted && gameData.length > 0) stage = "playing";
  else stage = "idle";

  const startOnline = async () => {
    if (!socket.connected) {
      showErrorAlert("Unable to connect to server. Please try again.", "Connection Error");
      return;
    }
    setGameStarted(true);
    setMultiPlayerMode(true);
    setRoomState({ ...roomState, status: "loading" });
    socket.emit("playOnline", { game });
  };

  const cancelOnline = () => {
    leaveMultiplayer({ socket, user, setRoomState });
    setGameStarted(false);
    setMultiPlayerMode(false);
  };

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
            <Button size="lg" onClick={handleStart}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z" /></svg> Play
            </Button>
          </div>
        );
      case "loading":
        return <CourtLoader label="Warming up the court…" />;
      case "searching":
        return (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 18 }}>
            <CourtLoader label="Searching for an opponent…" />
            <Button variant="secondary" size="sm" onClick={cancelOnline}>Cancel</Button>
          </div>
        );
      case "playing":
        return (
          <div className="playing-wrap">
            {renderGame({
              gameId: game?.id,
              gameData,
              pointsPerCorrect: game?.pointsPerCorrect,
              onGameEnd: (finalScore: number) => { setScore(finalScore); setShowResult(true); },
            })}
            {!multiplayerMode && (
              <button className="exit-link" onClick={handleExit}>Exit game</button>
            )}
          </div>
        );
      case "matched":
        return (
          <MatchupDisplay hostInfo={user} opponent={roomState.opponent} socket={socket} roomState={roomState} score={score} setScore={setScore} />
        );
      case "result":
        return <GameResult showFinalResult={showFinalResult} score={score} maxPoints={game?.maxPoints ?? 0} handleRestart={handleRestart} />;
    }
  };

  return (
    <div className="app-shell">
      <Navigation setRoomState={setRoomState} type="back" />

      <main className="page game-page">
        <div className="game-grid">
          {/* Mobile game strip */}
          <div className="rail-strip">
            {games.map((g) => (
              <button
                key={g.id}
                className={`rail-chip${g.id === game?.id ? " is-active" : ""}`}
                disabled={gameStarted}
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
                  onClick={() => {
                    if (gameStarted) { showErrorAlert("Finish your current game first.", "Game in progress"); return; }
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
              <Chip variant="brand" dot style={{ marginLeft: "auto" }}>{game?.tag}</Chip>
            </div>

            <Stage phaseKey={stage}>{renderStage()}</Stage>
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
                <Button block size="md" disabled={gameStarted || roomState.status !== "idle"} onClick={startOnline}>
                  {roomState.status === "loading" ? "Searching…" : "Play online 1v1"}
                </Button>
              )}
            </div>

            <div className="aside-card">
              <h3 className="font-display" style={{ fontSize: 15 }}>Play with a friend</h3>
              <p style={{ fontSize: 13, color: "var(--muted)", lineHeight: 1.5 }}>Private rooms with a share code are coming soon.</p>
              <Chip variant="brand" style={{ alignSelf: "flex-start" }}>SOON</Chip>
            </div>
          </aside>
        </div>
      </main>
    </div>
  );
}

export default MiniGame;
