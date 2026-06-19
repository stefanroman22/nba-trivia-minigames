/* eslint-disable react-hooks/exhaustive-deps */
import { useState, useEffect } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { GameCard } from '../../components/GameCard';
import { games } from '../../utils/GameUtils';
import Navigation from '../../components/Navigation';
import { useLocation } from 'react-router-dom';
import "../../styles/MiniGame.css";
import { sideCardStyle } from '../../constants/styles';
import GameResult from '../../components/GameResult';
import socket from "../../socket";
import type { RootState, AppDispatch } from '../../store';
import { useSelector, useDispatch } from 'react-redux';
import { updatePoints } from '../../store/userSlice';
import MatchupDisplay from '../../components/MultiPlayer/MatchupDisplay';
import { renderGame } from '../../Game Renderers/RenderGame';
import { showErrorAlert } from '../../utils/Alerts';
import { leaveMultiplayer } from '../../utils/LeaveMultiplayer';
import type { RoomState, Game, PlayerInfo, GameData } from '../../types/types';
import { apiFetch } from '../../utils/Api';
import { BACKEND_URL } from '../../configurations/backend';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faCaretDown, faCircleInfo } from '@fortawesome/free-solid-svg-icons';
import Loader from '../../components/Loader';
import Spinner from '../../components/motion/Spinner';
import MotionButton from '../../components/motion/MotionButton';
import { swap } from '../../motion/variants';

function MiniGame() {

  const dispatch = useDispatch<AppDispatch>();
  const { isLoggedIn, user } = useSelector((state: RootState) => state.user);
  const [showInfo, setShowInfo] = useState(false);
  const location = useLocation();
  const gameId = location.state?.id;
  let game = games.find(g => g.id === gameId);
  const [loading, setLoading] = useState(false);
  const [gameStarted, setGameStarted] = useState(false);
  const [multiplayerMode, setMultiPlayerMode] = useState(false);
  const [gameData, setGameData] = useState<GameData[]>([]);
  const [score, setScore] = useState(0);
  const [showResult, setShowResult] = useState(false);
  const [showFinalResult, setShowFinalResult] = useState(false);
  const [roomState, setRoomState] = useState<RoomState>({
    status: "idle",
    code: null,
    game: null,
    opponent: null,
    gameData: null,
    selfSocketId: null,
    role: null,
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
    }, 2000)


  };

  const handleRestart = async () => {
    setGameStarted(false);
    setGameData([]);
    setScore(0);
    setShowResult(false);
  };

  useEffect(() => {
    // Reset all game-related state whenever the game changes
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
        setShowFinalResult(false); // reset to "calculating"

        // fake delay in case score = 0 (so it still shows "Calculating...")
        const wait = (ms: number | undefined) => new Promise((res) => setTimeout(res, ms));

        try {
          if (score > 0) {
            const response = await apiFetch(`${BACKEND_URL}/update-profile/`, {
              method: "POST",
              body: JSON.stringify({ points: score }),
            });
            const data = await response.json();
            if (data.error) {
              showErrorAlert(data.error, "Updating profile failed!")
            } else {
              dispatch(updatePoints(score));
              console.log(`Success: Your profile has been awarded with ${score} points!`);
            }
          }

          // wait at least 2 seconds so user sees "Calculating..."
          await wait(2000);

        } catch (err) {
          console.error("Network error:", err);
        } finally {
          setShowFinalResult(true); // show result after done
        }
      }
    };

    awardPoints();
  }, [showResult, score]);


  useEffect(() => {
    // When the server does not find opponent in 30s
    const onOpponentNotFound = (game: unknown) => {
      console.log("Opponent not found for game:", game);
      setRoomState(prev => ({ ...prev, status: "idle" }));
      setGameStarted(false);
      showErrorAlert("Please try again", "Opponent not found");
    };

    // When the server finds a match
    const onMatchFound = (data: {
      roomCode: number; opponent: PlayerInfo; game: Game; selfSocketId: string; role: "host" | "guest";
    }) => {
      console.log("Match found!", data);
      setRoomState(prev => ({
        ...prev,
        status: "matched",
        code: data.roomCode,
        opponent: data.opponent,
        game: data.game,
        selfSocketId: data.selfSocketId,
        role: data.role,
      }));
    };

    socket.on("opponentNotFound", onOpponentNotFound);
    socket.on("matchFound", onMatchFound);

    // Cleanup with the exact handler refs so we don't strip app-wide listeners
    return () => {
      socket.off("matchFound", onMatchFound);
      socket.off("opponentNotFound", onOpponentNotFound);
    };
  }, []);

  useEffect(() => {
    if (isLoggedIn && user) {
      const userInfo = {
        username: user.username,
        profile_photo: user.profile_photo,
        rank: user.rank,
        points: user.points,
      };
      socket.emit("setUserInfo", userInfo);
    }
  }, [isLoggedIn, user]);

  // ---- Derive a single "stage" for clean animated transitions ----
  let stage: "idle" | "loading" | "playing" | "searching" | "matched" | "result";
  if (showResult) stage = "result";
  else if (roomState.status === "matched") stage = "matched";
  else if (roomState.status === "loading") stage = "searching";
  else if (loading) stage = "loading";
  else if (gameStarted && gameData.length > 0) stage = "playing";
  else stage = "idle";

  const renderStage = () => {
    switch (stage) {
      case "idle":
        return (
          <MotionButton onClick={handleStart}>Play</MotionButton>
        );

      case "loading":
        return <Loader />;

      case "searching":
        return <Spinner size={56} label="Searching for an opponent…" showLabel />;

      case "playing":
        return (
          <div className="flex flex-col items-center w-full">
            {renderGame({
              gameId: game?.id,
              gameData,
              pointsPerCorrect: game?.pointsPerCorrect,
              onGameEnd: (finalScore: number) => {
                setScore(finalScore);
                setShowResult(true);
              },
            })}
            {!multiplayerMode && (
              <MotionButton
                className="stop-playing-button"
                onClick={() => {
                  setGameData([]);
                  setGameStarted(false);
                  setLoading(false);
                }}
              >
                Exit
              </MotionButton>
            )}
          </div>
        );

      case "matched":
        return (
          <MatchupDisplay
            hostInfo={user}
            opponent={roomState.opponent}
            socket={socket}
            roomState={roomState}
            score={score}
            setScore={setScore}
          />
        );

      case "result":
        return (
          <GameResult
            showFinalResult={showFinalResult}
            score={score}
            maxPoints={game?.maxPoints ?? 0}
            handleRestart={handleRestart}
          />
        );
    }
  };

  return (
    <>

      <Navigation setRoomState={setRoomState} type='back' />

      <div id='minigame-container' className='minigame-container'>

        {/* LEFT: Game List */}
        <div id="game-list" className="game-list" >
          <h3 className='font-display text-2xl' style={{ color: "#ea750e", marginBottom: "1rem" }}>All Games</h3>
          {games.map((game, index) => (
            <div key={index} style={{ marginBottom: "1rem" }}>
              <GameCard
                game={game} gameStarted={gameStarted} index={index}
              />
            </div>
          ))}
        </div>

        <div id="game-box" className="game-box" >

          <div className='flex gap-2 justify-center items-center mb-4'>
            <h2 className='font-display text-xl sm:text-3xl align-middle' style={{ color: "#ffffff" }} >
              {game?.name}
            </h2>
            <div className="relative inline-block">
              <FontAwesomeIcon
                icon={faCircleInfo}
                onMouseEnter={() => setShowInfo(true)}
                onMouseLeave={() => setShowInfo(false)}
                onClick={() => setShowInfo(!showInfo)}
                className="
                    hover:text-orange-500
                    transition-colors
                    duration-300
                    ease-in-out
                    cursor-pointer
                    info-icon
                  "
              />

              <div className={`info-box ${showInfo ? "show" : ""}`}>
                <div
                  className="instruction-content"
                  dangerouslySetInnerHTML={{ __html: game?.instruction ?? "" }}
                />
              </div>
            </div>
          </div>

          {/* Animated stage: Play / loader / game / matchup / result */}
          <div className="stage-area">
            <AnimatePresence mode="wait">
              <motion.div
                key={stage}
                className="stage-content"
                variants={swap}
                initial="hidden"
                animate="visible"
                exit="exit"
              >
                {renderStage()}
              </motion.div>
            </AnimatePresence>
          </div>

        </div>

        <div id="mobile-info-box" className='mobile-info-box sm:hidden'>
          <div className='flex flex-row gap-1 justify-center align-middle info-trigger' onClick={() => {
            setShowInfo(!showInfo);
          }}>
            <h1 className='font-bold'>How to play {game?.name}?</h1>
            <FontAwesomeIcon
              icon={faCaretDown}
              className={`
    cursor-pointer
    top-1.5
    transition-transform
    duration-300
    ease-in-out
    ${showInfo ? "rotate-180" : ""}
  `}
            />
          </div>

          <div
            className={`instruction-content ${showInfo ? 'show' : ''}`}
            dangerouslySetInnerHTML={{ __html: game?.instruction ?? "" }}
          />
        </div>

        {/* RIGHT SIDE: Multiplayer cards */}
        <div id="side-features" className='side-features'>
          <div className="side-card" style={{ ...sideCardStyle, backgroundColor: "rgba(0,0,0,0.6)" }}>
            <h4 className='font-bold'>Multiplayer</h4>

            <div
              className={`button-container ${roomState.status === "loading" ? "two-buttons" : ""}`}
            >
              {!isLoggedIn && <p>Please log in to play online</p>}
              {isLoggedIn && <MotionButton
                disabled={gameStarted || roomState.status !== "idle"}
                onClick={async () => {
                  if (!socket.connected) {
                    console.error("Socket is not connected");
                    showErrorAlert("Unable to connect to server. Please try again.", "Connection Error");
                    return;
                  }
                  setGameStarted(true);
                  setMultiPlayerMode(true);
                  setRoomState({ ...roomState, status: "loading" });
                  socket.emit("playOnline", { game });
                  console.log("Searching for opponent in:", game);
                }}
              >
                {roomState.status === "loading" ? "Searching..." : "Play Online"}
              </MotionButton>}

              {(roomState.status === "loading" || roomState.status === "matched") && (
                <MotionButton
                  onClick={() => {
                    leaveMultiplayer({ socket, user, setRoomState });
                    setGameStarted(false);
                    setMultiPlayerMode(false);
                  }}
                >
                  Cancel
                </MotionButton>
              )}
            </div>
          </div>
          <div className="side-card" style={{ ...sideCardStyle, backgroundColor: "rgba(0,0,0,0.6)" }}>
            <h4 className='font-bold'>Play with a Friend</h4>

            <div className='button-container'>
              <p>Comming Soon</p>
            </div>

          </div>
        </div>

      </div>

    </>
  );
}

export default MiniGame;
