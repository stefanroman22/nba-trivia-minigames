import { useState, useEffect } from 'react';
import { GameCard, games } from '../../components/GameCard';
import "../../styles/SeriesWinner.css";
import { getContrastColor, nbaTeamColors } from "../../constants/nbaTeamColors";
import Navigation from '../../components/Navigation';
import { useLocation } from 'react-router-dom';
import PlayOffSeries from '../../Game Renderers/PlayOffSeries';
import NameLogo from '../../Game Renderers/NameLogo';
import { nbaTeams } from '../../constants/nbaTeams';
import GuessMvps from '../../Game Renderers/GuessMvps';
import StartingFive from '../../Game Renderers/StartingFive';
import NoPageFound from '../NoPageFound';
import "../../styles/MiniGame.css";
import { buttonStyle, buttonTeamStyle, handleMouseEnter, handleMouseLeave, introTextStyle, sideCardStyle} from '../../constants/styles';

function MiniGame() {
  const location = useLocation();
  const gameId = location.state?.id;
  const game = games.find(g => g.id === gameId);
  const [loading, setLoading] = useState(false);
  const [gameStarted, setGameStarted] = useState(false);
  const [gameData, setGameData] = useState([]);
  const [score, setScore] = useState(0);
  const [showResult, setShowResult] = useState(false);
  const [showFinalResult, setShowFinalResult] = useState(false);


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
  }, [gameId]); // runs every time a new game is selected
    
  useEffect(() => {
      const awardPoints = async () => {
        if (showResult) {
          setShowFinalResult(false); // reset to "calculating"

          // fake delay in case score = 0 (so it still shows "Calculating...")
          const wait = (ms) => new Promise((res) => setTimeout(res, ms));

          try {
            if (score > 0) {
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

  return (
    <>

    <Navigation/>
    
    <div id='minigame-container' className='minigame-container'>

      {/* LEFT: Game List */}
      <div id="game-list" className="game-list">
        <h3 style={{ color: "#ea750e", marginBottom: "1rem" }}>All Games</h3>
        {games.map((game, index) => (
          <div key={index} style={{ marginBottom: "1rem" }}>
            <GameCard
              game={game}
            />
          </div>
        ))}
      </div>

      {/* CENTER: Game Box */}
      <div id="game-box" className="game-box" >
        <h2 style={{ color: "#ffffffff", marginBottom: "1rem" }}>
          {game?.name}
        </h2>

        {/* Before game starts */}
        {!gameStarted && (
          <>
            <button
              style={buttonStyle}
              onClick={handleStart}
              onMouseEnter={handleMouseEnter}
              onMouseLeave={handleMouseLeave}
            >
              Start
            </button>

            <p style={introTextStyle}>
              {game?.instruction}
            </p>
          </>
        )}

        {/* Loading Spinner */}
        {loading && (
          <div style={{ marginTop: "10rem" }}>
            <div className="loader" />
            <p style={{ marginTop: "1rem", color: "#ba620fff" }}>
              {game?.loadingMessage}
            </p>
          </div>
        )}

        {/* Game in Progress */}
        {!loading && gameStarted && gameData.length > 0 && !showResult && (
        (() => {
          switch (game.id) {
            case "series-winner":
              return (
                <PlayOffSeries
                  seriesList={gameData}
                  pointsPerCorrect={game?.pointsPerCorrect}
                  buttonTeamStyle={buttonTeamStyle}
                  nbaTeamColors={nbaTeamColors}
                  getContrastColor={getContrastColor}
                  onGameEnd={(finalScore) => {
                    setScore(finalScore);
                    setShowResult(true);
                  }}
                />
              );
            case "name-logo":
              return (
                <NameLogo
                  seriesList={gameData}
                  pointsPerCorrect={game?.pointsPerCorrect}
                  onGameEnd={(finalScore) => {
                    setScore(finalScore);
                    setShowResult(true);
                  }}
                  allTeams={nbaTeams}
                />
              );
            case "guess-mvps":
              return (
                <GuessMvps
                  seasonsList={gameData}
                  pointsPerCorrect={game?.pointsPerCorrect}
                  onGameEnd={(finalScore) => {
                    setScore(finalScore);
                    setShowResult(true);
                  }}
                />
              );
            case "starting-five":
              return (
                <StartingFive
                  gameInfo={gameData}
                  pointsPerCorrect={game?.pointsPerCorrect}
                  onGameEnd={(finalScore) => {
                    setScore(finalScore);
                    setShowResult(true);
                  }}
                />
              );
            case "coming-soon":
              return (
                <NoPageFound/>
              );
            default:
              return <p style={{ color: "white" }}>Game mode not supported yet.</p>;
          }
        })()
        )}

        {/* Game Result */}
        {showResult && (
            <div style={{ marginTop: "10rem" }}>
              {!showFinalResult ? (
                // Loading state
                <div className="flex flex-col items-center">
                  <h3 className="text-xl font-semibold animate-pulse">Calculating Score...</h3>
                  <div className="loader"></div> {/* spinner */}
                </div>
              ) : (
                // Actual result with fade-in
                <div className="result-container fade-in">
                  <h3>
                    Your Score: {score} / {game?.maxPoints}
                  </h3>
                  {score > 0 && (
                    <h4>
                      In case you are logged in {score} points have been awarded to your
                      profile
                    </h4>
                  )}
                  <button
                    className="scaling-button"
                    onClick={handleRestart}
                    style={{ ...buttonStyle, marginTop: "1rem" }}
                  >
                    Play Again
                  </button>
                </div>
              )}
            </div>
        )}

      </div>

      {/* RIGHT SIDE: Multiplayer cards (unchanged) */}
      <div id="side-features">
          <div className="side-card" style={{...sideCardStyle, backgroundColor: "rgba(0,0,0,0.6)"}}>
            <h4>Multiplayer</h4>
            <p>Coming Soon</p>
          </div>
          <div className="side-card" style={{...sideCardStyle, backgroundColor: "rgba(0,0,0,0.6)"}}>
            <h4>Play with a Friend</h4>
            <p>Coming Soon</p>
          </div>
      </div>
      
    </div>

    </>
  );
}

export default MiniGame;


