import { useEffect, useState } from 'react';
import type { GameRender } from '../types/types';
import "../styles/Wordle.css";
import SubmitGuessPopup from '../components/SubmitGuessPopUp';

const WORD_LENGTH = 5;
const MAX_GUESSES = 6;

function Wordle({ gameInfo, pointsPerCorrect, onGameEnd }: GameRender) {
  const [solution, setSolution] = useState('');
  const [guesses, setGuesses] = useState<Array<string | null>>(Array(MAX_GUESSES).fill(null));
  const [currentGuess, setCurrentGuess] = useState('');
  const [submitted, setSubmitted] = useState<boolean[]>(Array(MAX_GUESSES).fill(false));
  const [showAnimation, setShowAnimation] = useState(false);

  useEffect(() => {
    setSolution(gameInfo[0].toUpperCase() || '');
  }, [gameInfo]);

  // Key handling: attach listener once
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const { key } = event;

      if (/^[a-zA-Z]$/.test(key)) {
        // Add letter if not full
        setCurrentGuess(prev => (prev.length < WORD_LENGTH ? prev + key.toUpperCase() : prev));
      } else if (key === 'Backspace') {
        // Remove last letter
        setCurrentGuess(prev => prev.slice(0, -1));
      } else if (key === 'Enter') {
        if (currentGuess.length === WORD_LENGTH) {
          setGuesses(prevGuesses => {
            const nextGuesses = [...prevGuesses];
            const firstNullIndex = nextGuesses.findIndex(g => g === null);
            if (firstNullIndex !== -1) {
              nextGuesses[firstNullIndex] = currentGuess;

              // Mark this row as submitted
              setSubmitted(prev => {
                const newSubmitted = [...prev];
                newSubmitted[firstNullIndex] = true;
                return newSubmitted;
              });

            }
            // Check if solution guessed or last row
              if (currentGuess === solution){
                setTimeout(() => {
                  onGameEnd((MAX_GUESSES - firstNullIndex) * 100);
                }, 2000)
              }else if(firstNullIndex === MAX_GUESSES - 1){
                setTimeout(() => {setShowAnimation(true)}, 1500);
                setTimeout(() => {
                  setShowAnimation(false);
                  onGameEnd(0);
                }, 3000);
              }
            return nextGuesses;
          });

          setCurrentGuess('');
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [currentGuess, solution, onGameEnd]);

  return (
    <div className='wordle-container'>
      {showAnimation && <SubmitGuessPopup text={`Correct answer: ${solution}`} color={"#C8102E"}/>}
      {guesses.map((guess, index) => {
        const isActive = index === guesses.findIndex(g => g === null);
        const displayWord = isActive ? currentGuess : guess || '';
        return (
          <Line
            key={index}
            guess={displayWord}
            solution={solution}
            isSubmitted={submitted[index]}  
          />
        );
      })}
    </div>
  );
}

function Line({ guess, solution, isSubmitted }: { guess: string; solution: string; isSubmitted: boolean }) {
  const tiles = [];
  for (let i = 0; i < WORD_LENGTH; i++) {
    const char = guess[i] || '';
    let className = 'tile';
    
    if (isSubmitted && guess.length === WORD_LENGTH) {
      if (char == solution[i]) className += ' correct';
      else if (solution.includes(char)) className += ' present';
      else className += ' absent';
    }

    tiles.push(
      <div
        key={i}
        className={className}
        style={{ transitionDelay: `${i * 250}ms` }}
      >
        {char}
      </div>
    );
  }

  return <div className='line'>{tiles}</div>;
}

export default Wordle;