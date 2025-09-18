/* eslint-disable react-hooks/exhaustive-deps */
import { useState, useEffect, type SetStateAction } from 'react';
import { GameCard } from '../../components/GameCard';
import { games } from '../../utils/GameUtils';
import "../../styles/SeriesWinner.css";
import Navigation from '../../components/Navigation';
import { useLocation } from 'react-router-dom';
import "../../styles/MiniGame.css";
import { buttonStyle, handleMouseEnter, handleMouseLeave, introTextStyle, sideCardStyle } from '../../constants/styles';
import GameResult from '../../components/GameResult';
import socket from "../../socket";
import type { RootState, AppDispatch } from '../../store';
import { useSelector, useDispatch } from 'react-redux';
import { login, updatePoints } from '../../store/userSlice';
import MatchupDisplay from '../../components/MultiPlayer/MatchupDisplay';
import { renderGame } from '../../Game Renderers/RenderGame';
import { showErrorAlert } from '../../utils/Alerts';
import { leaveMultiplayer } from '../../utils/LeaveMultiplayer';
import type { RoomState } from '../../types/types';
import { apiFetch } from '../../utils/Api';

function MiniGame() {

  const dispatch = useDispatch<AppDispatch>();
  const { isLoggedIn, user } = useSelector((state: RootState) => state.user);

  const location = useLocation();
  const gameId = location.state?.id;
  let game = games.find(g => g.id === gameId);
  const [loading, setLoading] = useState(false);
  const [gameStarted, setGameStarted] = useState(false);
  const [multiplayerMode, setMultiPlayerMode] = useState(false);
  const [gameData, setGameData] = useState([]);
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


  const handleStart = async () => {
    if (!game) return;

    setLoading(true);
    setGameStarted(true);
    setScore(0);
    setShowResult(false);

    const result = await game.fetchData();

    if (result.success) {
      setGameData(result.data);

    } else {
      game.handleError(result.error);
      setGameStarted(false);
    }

    setLoading(false);
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
            const response = await apiFetch("http://localhost:8000/api/update-profile/", {
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

    //When the server does not find opponent in 30s
    socket.on("opponentNotFound", (game) => {
      console.log("Opponent not found for game:", game);
      setRoomState(prev => ({
        ...prev,
        status: "idle"
      }))
      setGameStarted(false);
      showErrorAlert("Please try again", "Opponent not found");
    });
    // When the server finds a match
    socket.on("matchFound", (data) => {
      console.log("Match found!", data);

      // Update the room state with opponent and room code
      setRoomState(prev => ({
        ...prev,
        status: "matched",      // <-- Update status here
        code: data.roomCode,    // <-- Save room code
        opponent: data.opponent, // <-- Opponent info
        game: data.game,         // <-- The selected game
        selfSocketId: data.selfSocketId,
        role: data.role,
      }));
    });

    // Cleanup to avoid duplicate listeners
    return () => {
      socket.off("matchFound");
      socket.off("opponentNotFound");
    };
  }, [socket]);


  return (
    <>

      <Navigation roomState={roomState} setRoomState={setRoomState} />

      <div id='minigame-container' className='minigame-container'>

        {/* LEFT: Game List */}
        <div id="game-list" className="game-list">
          <h3 style={{ color: "#ea750e", marginBottom: "1rem" }}>All Games</h3>
          {games.map((game, index) => (
            <div key={index} style={{ marginBottom: "1rem" }}>
              <GameCard
                game={game} gameStarted={gameStarted}
              />
            </div>
          ))}
        </div>

        <div id="game-box" className="game-box" >
          {
            <h2 style={{ color: "#ffffffff", marginBottom: "1rem" }}>
              {game?.name}
            </h2>}

          {/* Before game starts */}
          {roomState.status === "idle" && !gameStarted && (
            <>
              <button
                style={buttonStyle}
                onClick={handleStart}
                onMouseEnter={handleMouseEnter}
                onMouseLeave={handleMouseLeave}
              >
                Play
              </button>

              <p style={introTextStyle}>
                {game?.instruction + " For Multiplayer access make sure you are logged in!"}
              </p>

            </>
          )}

          {loading && game && (
            <div style={{ marginTop: "10rem" }}>
              <div className="loader" />
              <p style={{ marginTop: "1rem", color: "#ba620fff" }}>
                {game.loadingMessage}
              </p>
            </div>
          )}

          {/* Game in Progress */}
          {!loading && gameStarted && gameData.length > 0 && !showResult &&
            renderGame({
              gameId: game?.id,
              gameData,
              pointsPerCorrect: game?.pointsPerCorrect,
              onGameEnd: (finalScore: SetStateAction<number>) => {
                setScore(finalScore);
                setShowResult(true);
              },
            })
          }


          {roomState.status === "loading" && <div style={{ marginTop: "45px" }} className='loader' />}
          {roomState.status === "matched" &&
            <MatchupDisplay
              hostInfo={user}
              opponent={roomState.opponent}
              socket={socket}
              roomState={roomState}
              score={score}
              setScore={setScore}
            />
          }
          {/* Game Result */}
          {showResult && <GameResult showFinalResult={showFinalResult} score={score} maxPoints={game?.maxPoints ?? 0} handleRestart={handleRestart} />}

          {!multiplayerMode && gameStarted && !showResult && <button className='stop-playing-button' style={buttonStyle} onMouseEnter={handleMouseEnter} onMouseLeave={handleMouseLeave} onClick={() => {
            setGameData([]);
            setGameStarted(false);
            setLoading(false);
          }}>Exit</button>}

        </div>

        {/* RIGHT SIDE: Multiplayer cards (unchanged) */}
        <div id="side-features" className='side-features'>
          <div className="side-card" style={{ ...sideCardStyle, backgroundColor: "rgba(0,0,0,0.6)" }}>
            <h4>Multiplayer</h4>
            <div
              className={`button-container ${roomState.status === "loading" ? "two-buttons" : ""}`}
            >
              <button
                style={buttonStyle}
                disabled={gameStarted || roomState.status !== "idle" || !isLoggedIn}
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
                onMouseEnter={handleMouseEnter}
                onMouseLeave={handleMouseLeave}
              >
                {roomState.status === "loading" ? "Searching..." : "Play Online"}
              </button>

              {(roomState.status === "loading" || roomState.status === "matched") && (
                <button
                  style={buttonStyle}
                  onClick={() => {
                    leaveMultiplayer({ socket, user, setRoomState });
                    setGameStarted(false);
                    setMultiPlayerMode(false);
                  }}
                  onMouseEnter={handleMouseEnter}
                  onMouseLeave={handleMouseLeave}
                >
                  Cancel
                </button>
              )}
            </div>
          </div>
          <div className="side-card" style={{ ...sideCardStyle, backgroundColor: "rgba(0,0,0,0.6)" }}>
            <h4>Play with a Friend</h4>
            <p>Comming Soon</p>
          </div>
        </div>

      </div>

    </>
  );
}

export default MiniGame;


