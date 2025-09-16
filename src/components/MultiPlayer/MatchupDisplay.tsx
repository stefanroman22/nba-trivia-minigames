import { useEffect, useState } from "react";
import PlayerCard from "./PlayerCard";
import { renderGame } from "../../Game Renderers/RenderGame";
import "../../styles/MatcupDisplay.css";
import { buttonStyle, handleMouseEnter, handleMouseLeave } from "../../constants/styles";

const INTRO_DISPLAY_TIME = 3000; // 3 seconds

const MatchupDisplay = ({ hostInfo, opponent, socket, roomState, score, setScore }) => {
  const [showIntro, setShowIntro] = useState(true);           // Show Host vs Opponent intro
  const [opponentScore, setOpponentScore] = useState(null);   // Opponent final score
  const [waitingForOpponent, setWaitingForOpponent] = useState(false);
  const [bothFinished, setBothFinished] = useState(false);
  const [opponentLeft, setOpponentLeft] = useState(false);    // Track opponent disconnection
  const [gameData, setGameData] = useState(null);             // Loaded game data
  const [localStatus, setLocalStatus] = useState("intro");    // intro | loading | ready | finished
  const [hasFinished, setHasFinished] = useState(false);
  const [rematchWaiting, setRematchWaiting] = useState(false);
  const [rematchTimeout, setRematchTimeout] = useState(false);
  const [rematchData, setRematchData] = useState(null); // store incoming game data
  const [introTimerActive, setIntroTimerActive] = useState(false);

  // ====== 1. Intro display, then request game data ======
  useEffect(() => {
    console.log("Intro effect running for role:", roomState.role, "code:", roomState.code);

    if (!roomState.code || !roomState.game) {
      console.log("Missing code or game, skipping intro effect.");
      return;
    }

    const introTimer = setTimeout(() => {
      console.log("Intro timer finished, setting showIntro=false for role:", roomState.role);
      setShowIntro(false);

      // Only set to "loading" if game isn't ready yet
      setLocalStatus((prev) => (prev === "intro" ? "loading" : prev));

      if (roomState.role === "host") {
        console.log("Host emitting requestGameData");
        socket.emit("requestGameData", {
          code: roomState.code,
          gameId: roomState.game.id,
        });
      }
    }, INTRO_DISPLAY_TIME);

    return () => {
      console.log("Cleaning up intro timer");
      clearTimeout(introTimer);
    };
  }, [roomState.code, roomState.game, roomState.role, socket]);

  // ====== 2. Listen for game data response ======
  useEffect(() => {
    const handleGameData = (data) => {
      console.log("Received game data:", data);
      setGameData(data.series);
      setLocalStatus("ready");
    };

    socket.on("gameData", handleGameData);
    return () => socket.off("gameData", handleGameData);
  }, [socket]);

  useEffect(() => {
    socket.on("rematchWaiting", ({ message }) => {
      console.log(message);
      setShowIntro(true);
      setRematchWaiting(true);
    });

    socket.on("rematchTimeout", ({ message }) => {
      console.log(message);
      setShowIntro(false);
      setRematchWaiting(false);
      setRematchTimeout(true);
    });

    socket.on("rematchStart", (newGameData) => {
      console.log("Rematch starting with new data:", newGameData);

      // Reset relevant game state
      setOpponentScore(null);
      setBothFinished(false);
      setOpponentLeft(false);
      setHasFinished(false);
      setRematchWaiting(false);
      setRematchTimeout(false);

      // Store new data and show intro
      setRematchData(newGameData.series);
      setShowIntro(true);
      setLocalStatus("intro");

      // Trigger timer
      setIntroTimerActive(true);
    });

    return () => {
      socket.off("rematchWaiting");
      socket.off("rematchTimeout");
      socket.off("rematchStart");
    };
  }, [socket]);

  useEffect(() => {
    if (!introTimerActive) return;

    console.log("Starting 3-second intro timer...");

    const timer = setTimeout(() => {
      console.log("Intro finished, loading game...");
      setShowIntro(false);
      setLocalStatus("ready");
      setGameData(rematchData); // load new data for rendering
      setIntroTimerActive(false);
    }, INTRO_DISPLAY_TIME);

    return () => clearTimeout(timer);
  }, [introTimerActive, rematchData]);

  // ====== 3. Handle multiplayer game lifecycle ======
  useEffect(() => {
    socket.on("waitingForOpponent", ({ message }) => {
      console.log(message);
      setWaitingForOpponent(true);
    });

    socket.on("matchComplete", ({ yourScore, opponentScore }) => {
      console.log("Match complete! Score:", yourScore, "Score:", opponentScore);

      setOpponentScore(opponentScore);
      setWaitingForOpponent(false);
      setBothFinished(true);
      setLocalStatus("finished");
    });

    socket.on("opponentLeft", () => {
      console.log("Opponent has left the game.");
      setOpponentLeft(true);
      setLocalStatus("finished");
    });

    return () => {
      socket.off("waitingForOpponent");
      socket.off("matchComplete");
      socket.off("opponentLeft");
    };
  }, [socket]);


  // ====== 4. Emit when this player finishes ======
  const handleGameEnd = (finalScore) => {
    if (hasFinished) return; // ✅ Prevent duplicate calls
    setHasFinished(true);

    setScore(finalScore);
    setLocalStatus("finished");

    socket.emit("playerFinished", {
      code: roomState.code,
      score: finalScore,
    });

    console.log("Player finished with score:", finalScore);
    setWaitingForOpponent(true);
  };
  // ====== 5. Emit rematch request ======
  const handleRematch = () => {
    setRematchTimeout(false); // clear old timeout message
    setShowIntro(true);       // Show intro/waiting screen immediately
    setLocalStatus("intro");  // Hide results screen right away
    socket.emit("rematchRequest", { code: roomState.code, gameId: roomState.game.id });
  };


  // ====== UI Components ======
  const renderPlayerCards = (showScores = false) => (
    <div className="matchup-container">
      {/* Host Card */}
      <div className={`player-card-container ${score > opponentScore && bothFinished ? 'winner' : ''}`}>
        <PlayerCard
          username={hostInfo.username}
          profilePhoto={hostInfo.profile_photo}
          rank={hostInfo.rank}
          points={hostInfo.points}
          role="You"
        />
        {showScores && (
          <p className="player-score">Score: {score}</p>
        )}
      </div>

      {/* VS Text */}
      <span className="vs-text">VS</span>

      {/* Opponent Card */}
      <div className={`player-card-container ${opponentScore > score && bothFinished ? 'winner' : ''}`}>
        <PlayerCard
          username={opponent.username}
          profilePhoto={opponent.profile_photo}
          rank={opponent.rank}
          points={opponent.points}
          role="Opponent"
        />

        {/* Overlay if opponent disconnected */}
        {opponentLeft && (
          <div className="opponent-overlay">
            Opponent Disconnected
          </div>
        )}

        {showScores && (
          <>
            {bothFinished ? (
              <p className="player-score">Score: {opponentScore}</p>
            ) : (
              <p className="waiting-text">
                {opponentLeft ? "Opponent Left" : "Waiting for opponent..."}
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );


  return (
    <>
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",

        }}
      >
        {/* ====== 1. Intro or Waiting Screen ====== */}
        {showIntro && (
          <div style={{ marginTop: "20px", textAlign: "center" }}>
            {renderPlayerCards(false)}
            <p className="loading-text">
              {!opponentLeft ? (rematchWaiting ? "Waiting for Opponent to Confirm..." : "Starting new game...") : ''}
            </p>
          </div>
        )}



        {/* ====== 3. Results Screen ====== */}
        {localStatus === "finished" && !rematchWaiting && (
          <>
            {renderPlayerCards(true)}
            <div style={{ textAlign: "center", marginTop: "20px" }}>
              <button
                onClick={handleRematch}
                disabled={opponentLeft || rematchWaiting}
                style={buttonStyle}
                onMouseEnter={handleMouseEnter}
                onMouseLeave={handleMouseLeave}
              >
                {rematchWaiting ? "Waiting for Opponent..." : "Play Again"}
              </button>

              {/* Show timeout message if opponent never confirmed */}
              {rematchTimeout && (
                <p style={{ color: "red", marginTop: "10px" }}>
                  Opponent did not confirm in time.
                </p>
              )}
            </div>
          </>
        )}


      </div>

      {/* ====== 2. Game Screen ====== */}
      {localStatus === "ready" && !bothFinished && gameData && (
        renderGame({
          gameId: roomState.game.id,
          gameData,
          pointsPerCorrect: roomState.game.pointsPerCorrect,
          onGameEnd: handleGameEnd,
        })
      )}
    </>
  );
};

export default MatchupDisplay;
