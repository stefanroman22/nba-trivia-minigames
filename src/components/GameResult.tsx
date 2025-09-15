import { buttonStyle, handleMouseEnter, handleMouseLeave } from '../constants/styles'

interface GameResultProps{
    showFinalResult: boolean,
    score: number,
    maxPoints: number,
    handleRestart: () => void,
}

function GameResult({showFinalResult, score, maxPoints, handleRestart} : GameResultProps) {
  return (
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
                        Your Score: {score} / {maxPoints}
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
                        onMouseEnter={handleMouseEnter}
                        onMouseLeave={handleMouseLeave}
                      >
                        Close
                      </button>
                    </div>
                  )}
    </div>
  )
}

export default GameResult
