import React, { useState, useEffect } from 'react';
import { GameCard, games } from '../../components/GameCard';
import "../../styles/SeriesWinner.css";
import Swal from 'sweetalert2';
import { nbaTeamColors } from "../../constants/nbaTeamColors";
function SeriesWinner() {
  
  function getContrastColor(hexColor) {
    if (!hexColor) return '#000';
    
    // Convert hex to RGB
    const r = parseInt(hexColor.substr(1, 2), 16);
    const g = parseInt(hexColor.substr(3, 2), 16);
    const b = parseInt(hexColor.substr(5, 2), 16);
    
    // Calculate luminance
    const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    
    // Return black for light colors, white for dark colors
    return luminance > 0.5 ? '#000000' : '#FFFFFF';
  }
  const [loading, setLoading] = useState(false);
  const [gameStarted, setGameStarted] = useState(false);
  const [gameData, setGameData] = useState([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [selectedWinner, setSelectedWinner] = useState('');
  const [score, setScore] = useState(0);
  const [showResult, setShowResult] = useState(false);
  const [selectedTeam, setSelectedTeam] = useState(null);
  const [showPointsAnimation, setShowPointsAnimation] = useState(false);
  const [showWinner, setShowWinner] = useState(false);

  const handleStart = async () => {
    setLoading(true);
    setGameStarted(true);
    setCurrentIndex(0);
    setScore(0);
    setSelectedWinner('');
    setShowResult(false);

    try {
  const res = await fetch("http://127.0.0.1:8000/trivia/playoff-series/", {
    method: "GET",
    credentials: "include",
  });

  const data = await res.json();
  if (res.ok) {
    console.log(data);
    setGameData(data.series || []);
  } else {
    Swal.fire({
      icon: 'error',
      title: 'Failed to fetch series data',
      background: '#1f1f1f',
      color: '#ffffff',
      confirmButtonText: 'Try Again',
      confirmButtonColor: '#EA750E',
      customClass: {
        popup: 'swal2-custom-popup',
        confirmButton: 'swal2-custom-button'
      },
      buttonsStyling: false,
      allowOutsideClick: false,
      allowEscapeKey: true,
      iconColor: '#ff4d4d',
    });
    console.error("Failed to fetch series data");
  }
} catch (err) {
  console.error("Error while fetching series data:", err);
  
  Swal.fire({
    icon: 'error',
    title: 'Unable to connect to the server',
    text: 'Please check your internet connection or try again later.',
    background: '#1f1f1f',
    color: '#ffffff',
    confirmButtonText: 'Retry',
    confirmButtonColor: '#EA750E',
    customClass: {
      popup: 'swal2-custom-popup',
      confirmButton: 'swal2-custom-button'
    },
    buttonsStyling: false,
    allowOutsideClick: false,
    allowEscapeKey: true,
    iconColor: '#ff4d4d',
  });
  setGameStarted(false);
} finally {
  setLoading(false);
}

  };

  const handleRestart = async () => {
    setGameStarted(false);
    setGameData([]);
    setCurrentIndex(0);
    setScore(0);
    setSelectedWinner('');
    setShowResult(false);
  };

  const handlePickWinner = (event) => {
  const picked = event.target.innerText;
  setSelectedTeam(picked);
  setShowWinner(true);

  // Check if answer is correct
  const isCorrect = picked === currentSeries.winner;
  if (isCorrect) {
    setScore(prevScore => prevScore + 10);
    setShowPointsAnimation(true);
  }

  // Move to next game after a delay
  setTimeout(() => {
    setShowPointsAnimation(false);
    setShowWinner(false);
    setSelectedTeam(null);
    
    if (currentIndex < gameData.length - 1) {
      setCurrentIndex(currentIndex + 1);
    } else {
      // Game over - all questions answered
      setShowResult(true);
    }
  }, 1800); // 2 second delay before moving to next game
};


  useEffect(() => {
      const awardPoints = async () => {
        if (showResult && score > 0) {
          try {
            const response = await fetch("http://127.0.0.1:8000/api/update-profile/", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              credentials: "include", // Ensures session cookie is sent
              body: JSON.stringify({ points: score }),
            });
            const data = await response.json();
            if (data.error) {
              console.error("Error:", data.error);
            } else {
              console.log(`Success: Your profile has been awarded with ${score} points!`);
            }
          } catch (err) {
            console.error("Network error:", err);
          }
        }
      };

      awardPoints();
    }, [showResult, score]);


  const currentSeries = gameData[currentIndex];

  return (
    <div
      style={{
        display: "flex",
        flexWrap: "wrap",
        justifyContent: "center",
        alignItems: "center",
        backgroundColor: "#292929",
        padding: "2rem",
        gap: "2rem",
        color: "white",
      }}
    >
      {/* LEFT: Game List */}
      <div style={{
        flex: "1 1 250px",
        backgroundColor: "#1e1e1e",
        padding: "1rem",
        borderRadius: "10px",
        minHeight: "400px",
        maxHeight: "80vh",
        boxShadow: "0 4px 10px rgba(0,0,0,0.4)",
        overflowY: "auto",
      }}>
        <h3 style={{ color: "#ea750e", marginBottom: "1rem" }}>All Games</h3>
        {games.map((game, index) => (
          <div key={index} style={{ marginBottom: "1rem" }}>
            <GameCard {...game} />
          </div>
        ))}
      </div>

      {/* CENTER: Game Box */}
      <div style={{
        flex: "2 1 400px",
        backgroundColor: "#1e1e1e",
        padding: "1rem",
        borderRadius: "10px",
        boxShadow: "0 4px 10px rgba(0,0,0,0.4)",
        textAlign: "center",
        minHeight: "400px",
      }}>
        <h2 style={{ color: "#ffffffff", marginBottom: "1rem" }}>
          Guess the Series Winner
        </h2>

        {/* Before game starts */}
        {!gameStarted && (
          <>
            <button
              style={buttonStyle}
              onClick={handleStart}
              onMouseEnter={(e) => {
                e.currentTarget.style.backgroundColor = "#a14c07";
                e.currentTarget.style.transform = "scale(1.03)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.backgroundColor = "#ea750e";
                e.currentTarget.style.transform = "scale(1)";
              }}
            >
              Start
            </button>

            <p style={introTextStyle}>
              For Singleplayer use simply press the start button below. Each
              round consists of 5 playoff series for which you need to guess
              the winner. Each correct answer will give you 10 points.
            </p>
          </>
        )}

        {/* Loading Spinner */}
        {loading && (
          <div style={{ marginTop: "10rem" }}>
            <div className="loader" />
            <p style={{ marginTop: "1rem", color: "#ba620fff" }}>
              Fetching playoff series...
            </p>
          </div>
        )}

        {/* Game in Progress */}
        {!loading && gameStarted && gameData.length > 0 && !showResult && (
          <div style={{ marginTop: "2rem" }}>
            <div style={{
              marginBottom: "1.5rem",
              padding: "1rem",
              borderRadius: "10px",
              textAlign: "center"
            }}>
              <div style={{ display: "flex", justifyContent: "center", gap: "1rem" }}>
                <div style={{ textAlign: "center" }}>
                  <img
                    src={currentSeries.team_a_logo}
                    width="150"
                    alt={currentSeries.team_a}
                    style={{
                      filter: showWinner && currentSeries.team_a !== currentSeries.winner ? 'grayscale(100%)' : 'none',
                      opacity: showWinner && currentSeries.team_a !== currentSeries.winner ? 0.4 : 1,
                      transition: 'all 1s ease-in-out'
                    }}
                  />
                  <p style={{ color: "#fff", marginTop: "0.5rem", fontWeight: "bold" }}>
                    {currentSeries.team_a}
                  </p>
                </div>

                <span
                  style={{
                    marginTop: "4rem",
                    fontWeight: "bold",
                    color: selectedTeam != null ? (selectedTeam === currentSeries.winner ? "limegreen" : "#C8102E") : "white",
                    fontSize: "1.25rem",
                    display: "inline-block",
                    width: "60px", // fixed width so "vs" and "4:3" take up same space
                    textAlign: "center",
                    transition: "all 0.5s ease-in-out",
                  }}
                >
                  {showWinner ? `${currentSeries.team_a_wins}:${currentSeries.team_b_wins}` : "vs"}
                </span>



                <div style={{ textAlign: "center" }}>
                  <img
                        src={currentSeries.team_b_logo}
                        width="150"
                        alt={currentSeries.team_b}
                        style={{
                          filter: showWinner && currentSeries.team_b !== currentSeries.winner ? 'grayscale(100%)' : 'none',
                          opacity: showWinner && currentSeries.team_b !== currentSeries.winner ? 0.4 : 1,
                          transition: 'all 1s ease-in-out'
                        }}
                      />
                  <p style={{ color: "#fff", marginTop: "0.5rem", fontWeight: "bold" }}>
                    {currentSeries.team_b}
                  </p>
                </div>
              </div>


              <p style={{ fontWeight: "bold", marginTop: "0.5rem" }}>
                {currentSeries.round}
                <br/>
                {currentSeries.season}
              </p>

              <div style={{ marginTop: "1rem" }}>
                  <button
                    className="scaling-button"
                    onClick={handlePickWinner}
                    disabled={showWinner}
                    style={{
                      ...buttonTeamStyle,
                      marginRight: "4.5rem",
                      backgroundColor: showWinner && currentSeries.team_a !== currentSeries.winner ? "#999" :
                        nbaTeamColors[currentSeries.team_a]?.primary || '#ccc',
                      color: showWinner && currentSeries.team_a !== currentSeries.winner ? "#fff" :
                        getContrastColor(nbaTeamColors[currentSeries.team_a]?.primary),
                      opacity: showWinner && currentSeries.team_a !== currentSeries.winner ? 0.5 : 1,
                      cursor: showWinner ? 'default' : 'pointer'
                    }}
                  >
                    {currentSeries.team_a}
                  </button>


                  <button
                    className="scaling-button"
                    onClick={handlePickWinner}
                    disabled={showWinner}
                    style={{
                      ...buttonTeamStyle,
                      backgroundColor: showWinner && currentSeries.team_b !== currentSeries.winner ? "#999" :
                        nbaTeamColors[currentSeries.team_b]?.primary || '#ccc',
                      color: showWinner && currentSeries.team_b !== currentSeries.winner ? "#fff" :
                        getContrastColor(nbaTeamColors[currentSeries.team_b]?.primary),
                      opacity: showWinner && currentSeries.team_b !== currentSeries.winner ? 0.5 : 1,
                      cursor: showWinner ? 'default' : 'pointer'
                    }}
                  >
                    {currentSeries.team_b}
                  </button>


                  {showPointsAnimation && (
                    <div style={{
                      position: "absolute",
                      top: "20px",
                      left: "50%",
                      transform: "translateX(-50%)",
                      backgroundColor: "#28a745",
                      padding: "0.75rem 1.5rem",
                      borderRadius: "8px",
                      fontWeight: "bold",
                      color: "#fff",
                      fontSize: "1.2rem",
                      animation: "fadeInOut 2s ease-in-out"
                    }}>
                      +10
                    </div>
                  )}

              </div>
            </div>
          </div>
        )}

        {/* Game Result */}
        {showResult && (
          <div style={{ marginTop: "10rem" }}>
            <h3>Your Score: {score} / {gameData.length * 10}</h3>
            {score >  0 && <h4>In case you are logged in {score} points have been awarded to your profile</h4>}
            <button className="scaling-button" onClick={handleRestart} style={{ ...buttonStyle, marginTop: "1rem" }}>
              Play Again
            </button>
          </div>
        )}
      </div>

      {/* RIGHT SIDE: Multiplayer cards (unchanged) */}
      <div style={{ flex: "1 1 250px", display: "flex", flexDirection: "column", gap: "7rem" }}>
        <div style={sideCardStyle}>
          <h4 style={{ color: "#fff" }}>Multiplayer</h4>
          <p style={sideTextStyle}>Compete with others in real time.</p>
        </div>
        <div style={sideCardStyle}>
          <h4 style={{ color: "#fff" }}>Play with a Friend</h4>
          <p style={sideTextStyle}>Invite a friend to guess together!</p>
        </div>
      </div>

      <style>{`
        .loader {
          border: 5px solid #555;
          border-top: 5px solid #ea750e;
          border-radius: 50%;
          width: 40px;
          height: 40px;
          animation: spin 0.8s linear infinite;
          margin: auto;
        }

        @keyframes spin {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}

export default SeriesWinner;

const buttonStyle = {
  padding: "0.7rem 1.5rem",
  backgroundColor: "#ea750e",
  color: "#fff",
  borderRadius: "10px",
  fontWeight: "bold",
  border: "none",
  transition: "background 0.3s ease, transform 0.2s ease",
};

const introTextStyle = {
  fontSize: "0.9rem",
  color: "#ba620fff",
  fontWeight: "bold",
  marginTop: "14rem",
  opacity: 0.7,
};

const sideCardStyle = {
  backgroundColor: "#1e1e1e",
  padding: "1.5rem",
  borderRadius: "10px",
  boxShadow: "0 4px 10px rgba(0,0,0,0.4)",
  textAlign: "center",
};

const sideTextStyle = {
  fontSize: "0.8rem",
  color: "#ba620fff",
  fontWeight: "bold",
};

const buttonTeamStyle = {
  padding: "0.7rem 1.5rem",
  backgroundColor: "#2f1805ff",
  color: "#fff",
  borderRadius: "10px",
  fontWeight: "bold",
  border: "none",
  transition: "background 0.3s ease, transform 0.2s ease",
};


