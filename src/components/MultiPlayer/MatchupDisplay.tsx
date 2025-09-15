import React, { useEffect, useState } from "react";
import PlayerCard from "./PlayerCard";
import { renderGame } from "../../Game Renderers/RenderGame";

const MatchupDisplay = ({ hostInfo, opponent, socket, roomState, score, setScore }) => {
  const [showResult, setShowResult] = useState(false);
  const [opponentScore, setOpponentScore] = useState(null);
  const [waitingForOpponent, setWaitingForOpponent] = useState(false);
  const [bothFinished, setBothFinished] = useState(false);

  // Request game data when a room is ready
  useEffect(() => {
    if (!roomState.code || !roomState.game) return;
    socket.emit("requestGameData", {
      code: roomState.code,
      gameId: roomState.game.id,
    });

    const handleGameData = (data) => {
      console.log("Received game data:", data);

      setRoomState({
        ...roomState,
        gameData: data.series,
        status: "ready",
      });
    };

    socket.on("gameData", handleGameData);

    return () => {
      socket.off("gameData", handleGameData);
    };
  }, [roomState.code, roomState.game, socket, setRoomState]); 



  // Handle multiplayer game lifecycle
  useEffect(() => {
    // Waiting for opponent
    socket.on("waitingForOpponent", ({ message }) => {
      console.log(message);
      setWaitingForOpponent(true);
    });

    // When both players finish
    socket.on("matchComplete", ({ yourScore, opponentScore }) => {
      console.log("Match complete! Your score:", yourScore, "Opponent score:", opponentScore);
      setOpponentScore(opponentScore);
      setWaitingForOpponent(false);
      setBothFinished(true);

      setRoomState((prev) => ({
        ...prev,
        status: "finished",
      }));
    });

    // Rematch starts
    socket.on("rematchStart", (newGameData) => {
      console.log("Rematch starting...");
      setShowResult(false);
      setOpponentScore(null);
      setBothFinished(false);
      setWaitingForOpponent(false);

      setRoomState((prev) => ({
        ...prev,
        status: "ready",
        gameData: newGameData,
      }));
    });

    return () => {
      socket.off("waitingForOpponent");
      socket.off("matchComplete");
      socket.off("rematchStart");
    };
  }, [socket, setRoomState]);

  // Emit when this player finishes
  const handleGameEnd = (finalScore) => {
    setScore(finalScore);
    setShowResult(true);

    socket.emit("playerFinished", {
      code: roomState.code,
      score: finalScore,
    });

    console.log("Player finished with score:", finalScore);
  };

  // Emit rematch request
  const handleRematch = () => {
    socket.emit("rematchRequest", { code: roomState.code });
  };

  return (
    <>
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          marginTop: "50px",
          gap: "20px",
        }}
      >
        {/* Top Section: Host, VS, Opponent */}
        {roomState.status !== 'ready' && (<div
          style={{
            display: "flex",
            justifyContent: "center",
            alignItems: "flex-start",
            gap: "30px",
            width: "100%",
            maxWidth: "600px",
          }}
        >
          {/* Host Card */}
          <div style={{ textAlign: "center" }}>
            <PlayerCard
              username={hostInfo.username}
              profilePhoto={hostInfo.profile_photo}
              rank={hostInfo.rank}
              points={hostInfo.points}
              role="You"
            />
            {showResult && (
              <p style={{ color: "#fff", marginTop: "8px", fontWeight: "bold" }}>
                Your Score: {score}
              </p>
            )}
          </div>

          {/* VS text */}
          <span
            style={{
              fontSize: "1.5rem",
              fontWeight: "bold",
              color: "#ff7400",
              textShadow: "0 2px 8px rgba(0,0,0,0.6)",
              alignSelf: "center",
              animation: "pulse 1.5s infinite ease-in-out",
            }}
          >
            VS
          </span>

          <style>
            {`
              @keyframes pulse {
                0%, 100% {
                  transform: scale(1);
                  opacity: 1;
                }
                50% {
                  transform: scale(1.2);
                  opacity: 0.7;
                }
              }
            `}
          </style>

          {/* Opponent Card */}
          <div style={{ textAlign: "center" }}>
            <PlayerCard
              username={opponent.username}
              profilePhoto={opponent.profile_photo}
              rank={opponent.rank}
              points={opponent.points}
              role="Opponent"
            />

            {showResult && (
              <>
                {bothFinished ? (
                  <p style={{ color: "#fff", marginTop: "8px", fontWeight: "bold" }}>
                    Opponent Score: {opponentScore}
                  </p>
                ) : (
                  <p style={{ color: "#ff7400", marginTop: "8px", fontWeight: "bold" }}>
                    Waiting for opponent...
                  </p>
                )}
              </>
            )}
          </div>
        </div>)}

        {/* Loader while fetching game data */}
        {roomState.status === "loading" && (
          <div style={{ marginTop: "20px", textAlign: "center" }}>
            <div className="loader" />
            <p style={{ color: "#fff", marginTop: "10px" }}>Loading Game Data...</p>
          </div>
        )}
      </div>

      {/* Game Section */}
      {roomState.status === "ready" && !showResult && (
          renderGame({
            gameId: roomState.game.id,
            gameData: roomState.gameData,
            pointsPerCorrect: roomState.game.pointsPerCorrect,
            onGameEnd: handleGameEnd,
          })
)}

      {/* After both finish: Rematch Button */}
      {roomState.status === "finished" && bothFinished && (
        <div style={{ textAlign: "center", marginTop: "20px" }}>
          <button
            onClick={handleRematch}
            style={{
              padding: "10px 20px",
              backgroundColor: "#ff7400",
              color: "#fff",
              border: "none",
              borderRadius: "8px",
              fontWeight: "bold",
              cursor: "pointer",
            }}
          >
            Play Again
          </button>
        </div>
      )}
    </>
  );
};

export default MatchupDisplay;
