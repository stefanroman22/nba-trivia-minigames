/* eslint-disable react-hooks/rules-of-hooks */
/* eslint-disable @typescript-eslint/no-unused-vars */
import { useState, useEffect } from "react";
import PropTypes from "prop-types";
import { nbaTeamColors } from "../constants/nbaTeamColors";
import { buttonStyle } from "../constants/styles";
import { handleMouseEnter, handleMouseLeave } from "../constants/styles";
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faShirt, faHeart } from '@fortawesome/free-solid-svg-icons';
import AutocompleteInput from "../components/AutoCompleteInput";
import SubmitGuessPopup from "../components/SubmitGuessPopUp";

function StartingFive({ gameInfo, pointsPerCorrect, onGameEnd }) {

  if (!gameInfo || gameInfo.length === 0) {
    return <p style={{ color: "white" }}>Loading lineup...</p>;
  }
  const currentGame = gameInfo[0];
  if (!currentGame.starting_5) {
    return <p style={{ color: "white" }}>No lineup data available.</p>;
  }

  const [guesses, setGuesses] = useState({}); // { PG: "", SG: "", PF: "", SF: "", C: "" }
  const [correctGuesses, setCorrectGuesses] = useState({});
  const [showPointsAnimation, setShowPointsAnimation] = useState(false);
  const [score, setScore] = useState(0);
  const [allPlayers, setAllPlayers] = useState([]);
  const [numberLifes, setNumberLifes] = useState(3);
  const [popUpInfo, setPopUpInfo] = useState({ Text: "", Color: "" });


  useEffect(() => {
    fetch("http://127.0.0.1:8000/trivia/all-players/")
      .then((res) => res.json())
      .then((data) => {
        if (data.players) setAllPlayers(data.players);
      })
      .catch((err) => console.error("Failed to fetch players:", err));
  }, []);

  type PositionData = {
    key: string;
    top: string;   // e.g. "20%"
    left: string;  // e.g. "40%"
  };

  const positions: PositionData[] = [
    { key: "PG", top: "85%", left: "50%" },
    { key: "SG", top: "65%", left: "80%" },
    { key: "PF", top: "25%", left: "30%" },
    { key: "SF", top: "55%", left: "15%" },
    { key: "C", top: "25%", left: "70%" },
  ];

  const normalizePosition = (pos) => {
    if (pos === "PF" || pos === "SF" || pos === "F") return "F";
    if (pos === "PG" || pos === "SG" || pos === "G") return "G";
    return pos; // "C"
  };



  if (!currentGame) return null;


  const handleGuessSubmit = (posKey) => {
    const playerName = guesses[posKey];
    if (!playerName) return;

    // Check if already guessed in this input
    if (correctGuesses[posKey] === playerName) return;

    const normalizedStarting5 = currentGame.starting_5.map(p => ({
      ...p,
      position: normalizePosition(p.position)
    }));

    const expectedPos = posKey === "C" ? "C" : normalizePosition(posKey); // C must match exactly, F/G flexible

    // Check for match
    let match;
    if (posKey === "C") {
      match = normalizedStarting5.find(
        p => p.position === "C" && p.name.toLowerCase() === playerName.trim().toLowerCase()
      );
    } else {
      // For F/G, accept any remaining correct player of that type
      match = normalizedStarting5.find(
        p => p.position === expectedPos && !Object.values(correctGuesses).includes(p.name) && p.name.toLowerCase() === playerName.trim().toLowerCase()
      );
    }

    if (match) {
      setCorrectGuesses(prev => ({ ...prev, [posKey]: match.name }));
      setScore(prev => prev + pointsPerCorrect);
      setPopUpInfo({ Text: `+${pointsPerCorrect}`, Color: "#25a602ff" });
      setShowPointsAnimation(true);

      // check for game end
      if (Object.keys(correctGuesses).length + 1 === 5) {
        setTimeout(() => {
          setTimeout(() => setShowPointsAnimation(false), 1500);
          onGameEnd?.(score + pointsPerCorrect + 50);
        }, 1500)
      } else setTimeout(() => setShowPointsAnimation(false), 1500);
    } else {
      setPopUpInfo({ Text: "Incorrect Answer", Color: "#ba0505ff" });
      setShowPointsAnimation(true);
      setNumberLifes(prevLifes => {
        const newLifes = prevLifes - 1;

        if (newLifes <= 0) {
          // Last life lost -> reveal all answers
          const revealAll = {};
          currentGame.starting_5.forEach((p) => {
            const normPos = normalizePosition(p.position);

            if (normPos === "C") {
              revealAll["C"] = p.name;
            } else if (normPos === "F") {
              if (!revealAll["PF"]) revealAll["PF"] = p.name;
              else revealAll["SF"] = p.name;
            } else if (normPos === "G") {
              if (!revealAll["PG"]) revealAll["PG"] = p.name;
              else revealAll["SG"] = p.name;
            }
          });

          setCorrectGuesses(revealAll);

          // Final popup and game over
          setPopUpInfo({ Text: "Incorrect Answer", Color: "#ba0505ff" });
          setShowPointsAnimation(true);

          setTimeout(() => {
            setShowPointsAnimation(false);
            onGameEnd?.(score);
          }, 3000);
        } else {
          // Just a normal incorrect guess
          setPopUpInfo({ Text: "Incorrect Answer", Color: "#ba0505ff" });
          setShowPointsAnimation(true);
          setTimeout(() => setShowPointsAnimation(false), 1500);
        }

        return newLifes; // <- Important! This updates the state correctly
      });


    }

    // reset input for this position
    setGuesses(prev => ({ ...prev, [posKey]: "" }));

  };

  return (
    <>
      {/* Teams & Score */}
      <div style={{ position: "relative", display: "flex", justifyContent: "center", gap: "1rem", alignItems: "center" }}>
        {/* Team A */}
        <div style={{ textAlign: "center", }}>
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

        {/* VS or Score */}
        <div style={{
          position: 'relative',
          display: 'flex', // Changed to flex
          flexDirection: 'column', // Stack vertically
          alignItems: 'center', // Center horizontally
          gap: '0.5rem', // Space between items
          width: '8em',
          height: '3em',
        }}>
          <span
            style={{
              fontWeight: "bold",
              fontSize: "1.2rem",
              color: "#fff",
              padding: "0.25rem 0.5rem",
              backgroundColor: "rgba(0, 0, 0, 0.3)", // semi-transparent dark background
              borderRadius: "8px",
              boxShadow: "0 2px 4px rgba(0,0,0,0.5)", // subtle shadow for depth
              textShadow: "1px 1px 2px rgba(0,0,0,0.7)", // makes text pop
              letterSpacing: "0.5px",
            }}
          >
            {currentGame.final_score}
          </span>
          <span style={{
            color: "rgba(255, 255, 255, 0.8)",
            fontSize: "0.85rem",
            fontFamily: "'Segoe UI', Roboto, sans-serif",
            letterSpacing: "0.3px",
            backgroundColor: "rgba(38, 36, 36, 0.2)",
            padding: "0.25rem 0.75rem",
            borderRadius: "12px",
            display: "inline-block",
            marginTop: "0.25rem",
            boxShadow: "0 1px 2px rgba(0,0,0,0.2)",
            backdropFilter: "blur(2px)",
            border: "1px solid rgba(255,255,255,0.1)"
          }}>
            {new Date(currentGame.game_date).toLocaleDateString('en-US', {
              month: 'short',
              day: 'numeric',
              year: 'numeric'
            })}
          </span>
        </div>


        {/* Team B */}
        <div style={{ textAlign: "center" }}>
          <img
            src={currentGame.team_b_logo}
            width="60"
            alt={currentGame.team_b}
            style={{ filter: currentGame.winning_team !== currentGame.team_b ? "grayscale(100%)" : "none" }}
          />
          <p style={{ color: "#fff", marginTop: "0.5rem", fontWeight: "bold", fontSize: "0.8rem", }}>
            {currentGame.team_b}
          </p>
        </div>
      </div>

      <div style={{ position: "relative", display: "flex", flexDirection: "row", gap: "0.5rem" }}>
        {[...Array(3)].map((_, index) => (
          <FontAwesomeIcon
            key={index}
            icon={faHeart}
            style={{
              color: index < numberLifes ? "#ff0707ff" : "#cccccc",
              transition: "all 0.3s ease-in-out",
              transform: index < numberLifes ? "scale(1)" : "scale(0.9)",
              opacity: index < numberLifes ? 1 : 0.7,
              filter: index < numberLifes ? "none" : "grayscale(50%)"
            }}
            size="lg"

          />
        ))}
      </div>

      <div
        style={{
          position: "relative",
          marginTop: "1rem",
          textAlign: "center",
          backgroundImage: "url('src/assets/Games Backrounds/basketball_positions.jpg')",
          backgroundSize: "cover",
          backgroundPosition: "center",
          backgroundRepeat: "no-repeat",
          height: "50vh", // fills 70% of screen height
        }}>



        {positions.map((pos) => {
          // expected position (F, G, or C)


          return (
            <div key={pos.key} style={{
              position: "absolute",
              top: pos.top,
              left: pos.left,
              transform: "translate(-50%, -50%)", // centers group
              display: "flex",
              flexDirection: "column",          // vertical stack
              alignItems: "center",
              zIndex: 2,
            }}
            >
              <div style={{ position: "relative", width: "3em", height: "3em" }}>
                {/* Shirt + logo stays */}
                <FontAwesomeIcon icon={faShirt} size="3x" style={{
                  position: 'absolute',
                  top: '40%',
                  left: '50%',
                  transform: 'translate(-50%, -50%)',
                  color: nbaTeamColors[currentGame.winning_team]?.primary || "#ccc",
                  zIndex: 100,
                  pointerEvents: 'none'
                }}
                />
                <img
                  src={currentGame.winning_team === currentGame.team_b ? currentGame.team_b_logo : currentGame.team_a_logo}
                  width="30"
                  alt={currentGame.winning_team === currentGame.team_b ? currentGame.team_b : currentGame.team_a}
                  style={{
                    position: 'absolute',
                    top: '50%',
                    left: '50%',
                    transform: 'translate(-50%, -50%)',
                    zIndex: 101,
                    display: 'block'
                  }}
                />
              </div>

              {correctGuesses[pos.key] ? (
                <p
                  style={{
                    color: "#fff",
                    fontWeight: "bold",
                    marginTop: "0.25rem",
                    padding: "0.25rem 0.5rem",
                    backgroundColor: "rgba(0,0,0,0.6)",
                    borderRadius: "6px",
                    boxShadow: "0 2px 4px rgba(0,0,0,0.4)",
                    textAlign: "center",
                    minWidth: "4em",
                    fontSize: "0.85rem",
                    letterSpacing: "0.5px"
                  }}
                >
                  {correctGuesses[pos.key]}
                </p>

              ) : (
                <>
                  <AutocompleteInput
                    placeholder="Guess the Player..."
                    value={guesses[pos.key] || ""}
                    setValue={(val) =>
                      setGuesses(prev => ({ ...prev, [pos.key]: val }))
                    }
                    suggestions={allPlayers}
                    onSubmit={() => handleGuessSubmit(pos.key)}
                    customStyleInput={{
                      width: "clamp(60px, 20vw, 120px)",
                      padding: "0.4rem 0.6rem",
                      fontSize: "clamp(0.6rem, 1.5vw, 0.8rem)",
                    }}
                    customStyleSuggestion={{ fontSize: "0.85rem", maxHeight: "100px" }}
                  />

                  <button
                    style={{ ...buttonStyle, fontSize: "0.65rem", padding: "0.25rem 0.5rem", marginTop: "10px" }}
                    onClick={() => handleGuessSubmit(pos.key)}
                    onMouseEnter={handleMouseEnter}
                    onMouseLeave={handleMouseLeave}
                    disabled={!guesses[pos.key] || guesses[pos.key].trim() === ""}
                  >
                    Confirm
                  </button>

                </>
              )}
            </div>
          );
        })}
      </div>
      {showPointsAnimation && (<SubmitGuessPopup text={popUpInfo.Text} color={popUpInfo.Color} />)}
    </>
  );
}

StartingFive.propTypes = {
  gameInfo: PropTypes.array.isRequired,
  pointsPerCorrect: PropTypes.number.isRequired,
  onGameEnd: PropTypes.func,
};

export default StartingFive;