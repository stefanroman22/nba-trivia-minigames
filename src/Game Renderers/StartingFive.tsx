import { useState, useEffect } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { nbaTeamColors } from "../constants/nbaTeamColors";
import { buttonStyle } from "../constants/styles";
import { handleMouseEnter, handleMouseLeave } from "../constants/styles";
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faShirt, faHeart } from '@fortawesome/free-solid-svg-icons';
import AutocompleteInput from "../components/AutoCompleteInput";
import SubmitGuessPopup from "../components/SubmitGuessPopUp";
import { BACKEND_ORIGIN } from "../configurations/backend";
import type { StartingFiveGame, StartingFivePlayer, OnGameEnd } from "../types/types";
import courtBg from "../assets/Games Backrounds/basketball_positions.jpg";

interface StartingFiveProps {
  gameInfo: StartingFiveGame[];
  pointsPerCorrect: number;
  onGameEnd: OnGameEnd;
}

const COMPLETION_BONUS = 50; // perfect lineup → 5 * pointsPerCorrect + bonus = maxPoints

type PositionData = { key: string; top: string; left: string };

const positions: PositionData[] = [
  { key: "PG", top: "85%", left: "50%" },
  { key: "SG", top: "65%", left: "82%" },
  { key: "PF", top: "25%", left: "30%" },
  { key: "SF", top: "55%", left: "18%" },
  { key: "C", top: "25%", left: "70%" },
];

const normalizePosition = (pos: string) => {
  if (pos === "PF" || pos === "SF" || pos === "F") return "F";
  if (pos === "PG" || pos === "SG" || pos === "G") return "G";
  return pos; // "C"
};

function StartingFive({ gameInfo, pointsPerCorrect, onGameEnd }: StartingFiveProps) {
  // --- Hooks first, unconditionally (Rules of Hooks) ---
  const [guesses, setGuesses] = useState<Record<string, string>>({});
  const [correctGuesses, setCorrectGuesses] = useState<Record<string, string>>({});
  const [showPointsAnimation, setShowPointsAnimation] = useState(false);
  const [score, setScore] = useState(0);
  const [allPlayers, setAllPlayers] = useState([]);
  const [numberLifes, setNumberLifes] = useState(3);
  const [popUpInfo, setPopUpInfo] = useState({ Text: "", Color: "" });
  const reduce = useReducedMotion();

  useEffect(() => {
    fetch(`${BACKEND_ORIGIN}/trivia/all-players/`)
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((data) => {
        if (data.players) setAllPlayers(data.players);
      })
      .catch((err) => console.error("Failed to fetch players:", err));
  }, []);

  const currentGame = gameInfo && gameInfo.length > 0 ? gameInfo[0] : null;

  const handleGuessSubmit = (posKey: string) => {
    if (!currentGame?.starting_5) return;
    const playerName = guesses[posKey];
    if (!playerName) return;

    // Check if already guessed in this input
    if (correctGuesses[posKey] === playerName) return;

    const normalizedStarting5 = currentGame.starting_5.map((p: StartingFivePlayer) => ({
      ...p,
      position: normalizePosition(p.position),
    }));

    const expectedPos = posKey === "C" ? "C" : normalizePosition(posKey);

    let match;
    if (posKey === "C") {
      match = normalizedStarting5.find(
        (p: StartingFivePlayer) =>
          p.position === "C" && p.name.toLowerCase() === playerName.trim().toLowerCase()
      );
    } else {
      match = normalizedStarting5.find(
        (p: StartingFivePlayer) =>
          p.position === expectedPos &&
          !Object.values(correctGuesses).includes(p.name) &&
          p.name.toLowerCase() === playerName.trim().toLowerCase()
      );
    }

    if (match) {
      setCorrectGuesses((prev) => ({ ...prev, [posKey]: match.name }));
      setScore((prev) => prev + pointsPerCorrect);
      setPopUpInfo({ Text: `+${pointsPerCorrect}`, Color: "#25a602" });
      setShowPointsAnimation(true);

      // Completing the 5th slot wins the round
      if (Object.keys(correctGuesses).length + 1 === 5) {
        const finalScore = 5 * pointsPerCorrect + COMPLETION_BONUS;
        setTimeout(() => setShowPointsAnimation(false), 1500);
        setTimeout(() => onGameEnd?.(finalScore), 1500);
      } else {
        setTimeout(() => setShowPointsAnimation(false), 1500);
      }
    } else {
      const newLifes = numberLifes - 1;
      setNumberLifes(newLifes);

      if (newLifes <= 0) {
        // Last life lost -> reveal all answers
        const revealAll: Record<string, string> = {};
        currentGame.starting_5.forEach((p: StartingFivePlayer) => {
          const normPos = normalizePosition(p.position);
          if (normPos === "C") revealAll["C"] = p.name;
          else if (normPos === "F") {
            if (!revealAll["PF"]) revealAll["PF"] = p.name;
            else revealAll["SF"] = p.name;
          } else if (normPos === "G") {
            if (!revealAll["PG"]) revealAll["PG"] = p.name;
            else revealAll["SG"] = p.name;
          }
        });

        setCorrectGuesses(revealAll);
        setPopUpInfo({ Text: "Game Over", Color: "#ba0505" });
        setShowPointsAnimation(true);
        setTimeout(() => {
          setShowPointsAnimation(false);
          onGameEnd?.(score);
        }, 2500);
      } else {
        setPopUpInfo({ Text: "Incorrect Answer", Color: "#ba0505" });
        setShowPointsAnimation(true);
        setTimeout(() => setShowPointsAnimation(false), 1500);
      }
    }

    // reset input for this position
    setGuesses((prev) => ({ ...prev, [posKey]: "" }));
  };

  // --- Early returns AFTER all hooks ---
  if (!currentGame) return <p style={{ color: "white" }}>Loading lineup…</p>;
  if (!currentGame.starting_5) return <p style={{ color: "white" }}>No lineup data available.</p>;

  return (
    <>
      {/* Teams & Score */}
      <div style={{ position: "relative", display: "flex", justifyContent: "center", gap: "1rem", alignItems: "center" }}>
        {/* Team A */}
        <div className="flex flex-col justify-center items-center">
          <img
            src={currentGame.team_a_logo}
            width="60"
            alt={currentGame.team_a}
            style={{ filter: currentGame.winning_team !== currentGame.team_a ? "grayscale(100%)" : "none" }}
          />
          <p style={{ color: "#fff", marginTop: "0.5rem", fontWeight: "bold", fontSize: "0.8rem" }}>
            {currentGame.team_a}
          </p>
        </div>

        {/* Score & date */}
        <div className="relative flex flex-col items-center gap-2 w-32 h-auto sm:w-36">
          <span className="font-display tnum text-lg sm:text-xl text-white px-2 py-1 bg-black/30 rounded-lg shadow-md whitespace-nowrap">
            {currentGame.final_score}
          </span>
          <span className="text-[0.65rem] sm:text-sm text-white/80 mt-1 px-3 py-1 rounded-xl bg-black/20 border border-white/10 shadow-sm backdrop-blur-sm whitespace-nowrap">
            {new Date(currentGame.game_date).toLocaleDateString("en-US", {
              month: "short",
              day: "numeric",
              year: "numeric",
            })}
          </span>
        </div>

        {/* Team B */}
        <div className="flex flex-col justify-center items-center">
          <img
            src={currentGame.team_b_logo}
            width="60"
            alt={currentGame.team_b}
            style={{ filter: currentGame.winning_team !== currentGame.team_b ? "grayscale(100%)" : "none" }}
          />
          <p style={{ color: "#fff", marginTop: "0.5rem", fontWeight: "bold", fontSize: "0.8rem" }}>
            {currentGame.team_b}
          </p>
        </div>
      </div>

      {/* Lives */}
      <div style={{ position: "relative", display: "flex", flexDirection: "row", gap: "0.5rem" }} className="mt-2 sm:mt-0">
        {[...Array(3)].map((_, index) => {
          const alive = index < numberLifes;
          return (
            <motion.span
              key={index}
              animate={reduce ? undefined : { scale: alive ? 1 : 0.85, rotate: alive ? 0 : [0, -16, 14, -8, 0] }}
              transition={{ duration: 0.45 }}
              style={{ display: "inline-block" }}
            >
              <FontAwesomeIcon
                icon={faHeart}
                size="lg"
                style={{
                  color: alive ? "#ff0707" : "#cccccc",
                  opacity: alive ? 1 : 0.6,
                  filter: alive ? "none" : "grayscale(60%)",
                }}
              />
            </motion.span>
          );
        })}
      </div>

      {/* Court */}
      <div
        style={{
          position: "relative",
          marginTop: "1rem",
          width: "100%",
          maxWidth: "560px",
          marginLeft: "auto",
          marginRight: "auto",
          textAlign: "center",
          backgroundImage: `url(${courtBg})`,
          backgroundSize: "cover",
          backgroundPosition: "center",
          backgroundRepeat: "no-repeat",
          borderRadius: "12px",
          height: "clamp(360px, 60vh, 540px)",
        }}
      >
        {positions.map((pos) => {
          const filled = correctGuesses[pos.key];
          return (
            <div
              key={pos.key}
              style={{
                position: "absolute",
                top: pos.top,
                left: pos.left,
                transform: "translate(-50%, -50%)",
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                zIndex: 2,
              }}
            >
              <div style={{ position: "relative", width: "3em", height: "3em" }}>
                <FontAwesomeIcon
                  icon={faShirt}
                  size="3x"
                  style={{
                    position: "absolute",
                    top: "40%",
                    left: "50%",
                    transform: "translate(-50%, -50%)",
                    color: nbaTeamColors[currentGame.winning_team]?.primary || "#ccc",
                    zIndex: 100,
                    pointerEvents: "none",
                  }}
                />
                <img
                  src={currentGame.winning_team === currentGame.team_b ? currentGame.team_b_logo : currentGame.team_a_logo}
                  width="30"
                  alt={currentGame.winning_team === currentGame.team_b ? currentGame.team_b : currentGame.team_a}
                  style={{
                    position: "absolute",
                    top: "50%",
                    left: "50%",
                    transform: "translate(-50%, -50%)",
                    zIndex: 101,
                    display: "block",
                  }}
                />
              </div>

              <AnimatePresence mode="wait">
                {filled ? (
                  <motion.p
                    key="filled"
                    initial={reduce ? false : { opacity: 0, scale: 0.6 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={reduce ? undefined : { opacity: 0, scale: 0.8 }}
                    transition={{ type: "spring", stiffness: 380, damping: 20 }}
                    style={{
                      color: "#fff",
                      fontWeight: "bold",
                      marginTop: "0.25rem",
                      padding: "0.3rem 0.6rem",
                      backgroundColor: "rgba(0,0,0,0.7)",
                      borderRadius: "6px",
                      boxShadow: "0 2px 6px rgba(0,0,0,0.5)",
                      textAlign: "center",
                      minWidth: "4.5em",
                      fontSize: "0.85rem",
                      letterSpacing: "0.5px",
                    }}
                  >
                    {filled}
                  </motion.p>
                ) : (
                  <motion.div
                    key="input"
                    initial={reduce ? false : { opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={reduce ? undefined : { opacity: 0 }}
                    style={{ display: "flex", flexDirection: "column", alignItems: "center" }}
                  >
                    <AutocompleteInput
                      placeholder="Player…"
                      value={guesses[pos.key] || ""}
                      setValue={(val: string) => setGuesses((prev) => ({ ...prev, [pos.key]: val }))}
                      suggestions={allPlayers}
                      onSubmit={() => handleGuessSubmit(pos.key)}
                      customStyleInput={{
                        width: "clamp(80px, 24vw, 130px)",
                        padding: "0.5rem 0.6rem",
                        fontSize: "clamp(0.7rem, 1.6vw, 0.85rem)",
                      }}
                      customStyleSuggestion={{ fontSize: "0.85rem", maxHeight: "100px" }}
                    />

                    <button
                      style={{ ...buttonStyle, fontSize: "0.75rem", padding: "0.45rem 0.8rem", marginTop: "8px", minHeight: "40px", cursor: "pointer" }}
                      onClick={() => handleGuessSubmit(pos.key)}
                      onMouseEnter={handleMouseEnter}
                      onMouseLeave={handleMouseLeave}
                      disabled={!guesses[pos.key] || guesses[pos.key].trim() === ""}
                    >
                      Confirm
                    </button>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          );
        })}
      </div>
      <SubmitGuessPopup show={showPointsAnimation} text={popUpInfo.Text} color={popUpInfo.Color} />
    </>
  );
}

export default StartingFive;
