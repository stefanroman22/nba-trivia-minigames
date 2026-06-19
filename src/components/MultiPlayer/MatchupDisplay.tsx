import { useEffect, useState, type Dispatch, type SetStateAction } from "react";
import { AnimatePresence, motion } from "framer-motion";
import type { Socket } from "socket.io-client";
import PlayerCard from "./PlayerCard";
import { renderGame } from "../../Game Renderers/RenderGame";
import "../../styles/MatcupDisplay.css";
import MotionButton from "../motion/MotionButton";
import AnimatedNumber from "../motion/AnimatedNumber";
import type { User, PlayerInfo, RoomState, GameData } from "../../types/types";

const INTRO_DISPLAY_TIME = 3000; // 3 seconds

interface MatchupDisplayProps {
  hostInfo: User | null;
  opponent: PlayerInfo | null;
  socket: Socket;
  roomState: RoomState;
  score: number;
  setScore: Dispatch<SetStateAction<number>>;
}

const MatchupDisplay = ({ hostInfo, opponent, socket, roomState, score, setScore }: MatchupDisplayProps) => {
  const [showIntro, setShowIntro] = useState(true);                       // Show Host vs Opponent intro
  const [opponentScore, setOpponentScore] = useState<number | null>(null); // Opponent final score
  const [, setWaitingForOpponent] = useState(false);
  const [bothFinished, setBothFinished] = useState(false);
  const [opponentLeft, setOpponentLeft] = useState(false);               // Track opponent disconnection
  const [gameData, setGameData] = useState<GameData[] | null>(null);     // Loaded game data
  const [localStatus, setLocalStatus] = useState("intro");               // intro | loading | ready | finished
  const [hasFinished, setHasFinished] = useState(false);
  const [rematchWaiting, setRematchWaiting] = useState(false);
  const [rematchTimeout, setRematchTimeout] = useState(false);
  const [rematchData, setRematchData] = useState<GameData[] | null>(null); // store incoming game data
  const [introTimerActive, setIntroTimerActive] = useState(false);

  // ====== 1. Intro display, then request game data ======
  useEffect(() => {
    if (!roomState.code || !roomState.game) return;

    const introTimer = setTimeout(() => {
      setShowIntro(false);
      // Only set to "loading" if game isn't ready yet
      setLocalStatus((prev) => (prev === "intro" ? "loading" : prev));

      if (roomState.role === "host") {
        socket.emit("requestGameData", {
          code: roomState.code,
          gameId: roomState.game?.id,
        });
      }
    }, INTRO_DISPLAY_TIME);

    return () => clearTimeout(introTimer);
  }, [roomState.code, roomState.game, roomState.role, socket]);

  // ====== 2. Listen for game data response ======
  useEffect(() => {
    const handleGameData = (data: { series: GameData[] }) => {
      setGameData(data.series);
      setLocalStatus("ready");
    };

    socket.on("gameData", handleGameData);
    return () => {
      socket.off("gameData", handleGameData);
    };
  }, [socket]);

  // ====== 3. Rematch lifecycle ======
  useEffect(() => {
    const handleRematchWaiting = ({ message }: { message: string }) => {
      console.log(message);
      setShowIntro(true);
      setRematchWaiting(true);
    };

    const handleRematchTimeout = ({ message }: { message: string }) => {
      console.log(message);
      setShowIntro(false);
      setRematchWaiting(false);
      setRematchTimeout(true);
    };

    const handleRematchStart = (newGameData: { series: GameData[] }) => {
      // Reset relevant game state
      setOpponentScore(null);
      setBothFinished(false);
      setOpponentLeft(false);
      setHasFinished(false);
      setRematchWaiting(false);
      setRematchTimeout(false);
      setWaitingForOpponent(false);
      setScore(0);

      // Store new data and show intro
      setRematchData(newGameData.series);
      setShowIntro(true);
      setLocalStatus("intro");
      setIntroTimerActive(true);
    };

    socket.on("rematchWaiting", handleRematchWaiting);
    socket.on("rematchTimeout", handleRematchTimeout);
    socket.on("rematchStart", handleRematchStart);

    return () => {
      socket.off("rematchWaiting", handleRematchWaiting);
      socket.off("rematchTimeout", handleRematchTimeout);
      socket.off("rematchStart", handleRematchStart);
    };
  }, [socket, setScore]);

  useEffect(() => {
    if (!introTimerActive) return;

    const timer = setTimeout(() => {
      setShowIntro(false);
      setLocalStatus("ready");
      setGameData(rematchData); // load new data for rendering
      setIntroTimerActive(false);
    }, INTRO_DISPLAY_TIME);

    return () => clearTimeout(timer);
  }, [introTimerActive, rematchData]);

  // ====== 4. Handle multiplayer game lifecycle ======
  useEffect(() => {
    const handleWaiting = ({ message }: { message: string }) => {
      console.log(message);
      setWaitingForOpponent(true);
    };

    const handleMatchComplete = ({ opponentScore }: { opponentScore: number }) => {
      setOpponentScore(opponentScore);
      setWaitingForOpponent(false);
      setBothFinished(true);
      setLocalStatus("finished");
    };

    const handleOpponentLeft = () => {
      setOpponentLeft(true);
      setLocalStatus("finished");
    };

    socket.on("waitingForOpponent", handleWaiting);
    socket.on("matchComplete", handleMatchComplete);
    socket.on("opponentLeft", handleOpponentLeft);

    return () => {
      socket.off("waitingForOpponent", handleWaiting);
      socket.off("matchComplete", handleMatchComplete);
      socket.off("opponentLeft", handleOpponentLeft);
    };
  }, [socket]);


  // ====== 5. Emit when this player finishes ======
  const handleGameEnd = (finalScore: number) => {
    if (hasFinished) return; // Prevent duplicate calls
    setHasFinished(true);

    setScore(finalScore);
    setLocalStatus("finished");

    socket.emit("playerFinished", {
      code: roomState.code,
      score: finalScore,
    });

    setWaitingForOpponent(true);
  };

  // ====== 6. Emit rematch request ======
  const handleRematch = () => {
    setRematchTimeout(false);
    setShowIntro(true);
    setLocalStatus("intro");
    socket.emit("rematchRequest", { code: roomState.code, gameId: roomState.game?.id });
  };


  // ====== UI Components ======
  const renderPlayerCards = (showScores = false) => {
    const myScore = Number(score);
    const oppScore = Number(opponentScore);
    const hostWins = bothFinished && myScore > oppScore;
    const oppWins = bothFinished && oppScore > myScore;
    const isTie = bothFinished && myScore === oppScore;

    return (
      <div className="matchup-container">
        {/* Host Card */}
        <div className={`player-card-container ${hostWins ? "winner" : ""} ${isTie ? "tie" : ""}`}>
          <PlayerCard
            username={hostInfo?.username}
            profilePhoto={hostInfo?.profile_photo}
            rank={hostInfo?.rank}
            points={hostInfo?.points}
            role="You"
            delay={0}
          />
          {showScores && (
            <p className="player-score tnum">Score: <AnimatedNumber value={myScore} /></p>
          )}
        </div>

        {/* VS Text */}
        <span className="vs-text font-display">VS</span>

        {/* Opponent Card */}
        <div className={`player-card-container ${oppWins ? "winner" : ""} ${isTie ? "tie" : ""}`}>
          <PlayerCard
            username={opponent?.username}
            profilePhoto={opponent?.profile_photo}
            rank={opponent?.rank}
            points={opponent?.points}
            role="Opponent"
            delay={0.12}
          />

          {/* Overlay if opponent disconnected */}
          <AnimatePresence>
            {opponentLeft && (
              <motion.div
                className="opponent-overlay"
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0 }}
              >
                Opponent Disconnected
              </motion.div>
            )}
          </AnimatePresence>

          {showScores && (
            <>
              {bothFinished ? (
                <p className="player-score tnum">Score: <AnimatedNumber value={oppScore} /></p>
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
  };

  const isTie = bothFinished && Number(score) === Number(opponentScore);

  return (
    <>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
        {/* ====== 1. Intro or Waiting Screen ====== */}
        <AnimatePresence mode="wait">
          {showIntro && (
            <motion.div
              key="intro"
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
              style={{ marginTop: "20px", textAlign: "center" }}
            >
              {renderPlayerCards(false)}
              <p className="loading-text">
                {!opponentLeft ? (rematchWaiting ? "Waiting for Opponent to Confirm..." : "Starting new game...") : ""}
              </p>
            </motion.div>
          )}
        </AnimatePresence>

        {/* ====== 3. Results Screen ====== */}
        <AnimatePresence mode="wait">
          {localStatus === "finished" && !rematchWaiting && (
            <motion.div
              key="results"
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -16 }}
              transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
              style={{ width: "100%" }}
            >
              {renderPlayerCards(true)}
              <div style={{ textAlign: "center", marginTop: "20px" }}>
                {isTie && (
                  <p className="font-display" style={{ color: "var(--brand, #ff7a1a)", marginBottom: "0.5rem" }}>
                    It's a draw!
                  </p>
                )}
                <MotionButton
                  onClick={handleRematch}
                  disabled={opponentLeft || rematchWaiting}
                >
                  {rematchWaiting ? "Waiting for Opponent..." : "Play Again"}
                </MotionButton>

                {rematchTimeout && (
                  <p style={{ color: "#ff5a5a", marginTop: "10px" }}>
                    Opponent did not confirm in time.
                  </p>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* ====== 2. Game Screen ====== */}
      {localStatus === "ready" && !bothFinished && gameData && (
        renderGame({
          gameId: roomState.game?.id,
          gameData,
          pointsPerCorrect: roomState.game?.pointsPerCorrect,
          onGameEnd: handleGameEnd,
        })
      )}
    </>
  );
};

export default MatchupDisplay;
