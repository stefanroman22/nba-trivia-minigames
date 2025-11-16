import { useEffect, useRef, useState } from 'react';
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

  const inputRef = useRef<HTMLInputElement>(null);

  // Initialize solution and auto-focus input
  useEffect(() => {
    setSolution(gameInfo[0].toUpperCase() || '');
    if (inputRef.current) {
      inputRef.current.focus();
    }
  }, [gameInfo]);

  useEffect(() => {
  if (inputRef.current) {
    const len = currentGuess.length;
    inputRef.current.setSelectionRange(len, len);
  }
}, [currentGuess]);

  const submitGuess = () => {
    if (currentGuess.length !== WORD_LENGTH) return;

    setGuesses(prevGuesses => {
      const nextGuesses = [...prevGuesses];
      const firstNullIndex = nextGuesses.findIndex(g => g === null);
      if (firstNullIndex === -1) return prevGuesses;

      nextGuesses[firstNullIndex] = currentGuess;

      // Mark this row as submitted
      setSubmitted(prev => {
        const newSubmitted = [...prev];
        newSubmitted[firstNullIndex] = true;
        return newSubmitted;
      });

      // Game end logic
      if (currentGuess === solution) {
        setTimeout(() => {
          onGameEnd((MAX_GUESSES - firstNullIndex) * 100);
        }, 2000);
      } else if (firstNullIndex === MAX_GUESSES - 1) {
        setTimeout(() => setShowAnimation(true), 1500);
        setTimeout(() => {
          setShowAnimation(false);
          onGameEnd(0);
        }, 3000);
      }
      setCurrentGuess('');

      return nextGuesses;
    });

    setCurrentGuess('');
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const rawValue = e.target.value.toUpperCase().replace(/[^A-Z]/g, '');

    // If user is deleting
    if (rawValue.length < currentGuess.length) {
      setCurrentGuess(rawValue);
      return;
    }

    // If user is typing new character
    const lastChar = rawValue[rawValue.length - 1];
    if (currentGuess.length < WORD_LENGTH) {
      setCurrentGuess(prev => prev + lastChar);
    }
  };



  return (
    <div
      className="wordle-container"
      onClick={() => inputRef.current?.focus()} // Focus input when container clicked
    >
      {showAnimation && (
        <SubmitGuessPopup text={`Correct answer: ${solution}`} color={"#C8102E"} />
      )}

      {/* Hidden input captures all keystrokes for both desktop and mobile */}
      <input
        ref={inputRef}
        type="text"
        value={currentGuess}
        onChange={(e) => {
          // Always clean input and limit to WORD_LENGTH
          const rawValue = e.target.value.toUpperCase().replace(/[^A-Z]/g, '');

          // Limit to max WORD_LENGTH
          setCurrentGuess(rawValue.slice(0, WORD_LENGTH));
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            submitGuess();
          }
          // ⚡ Remove Backspace handling here — handled by onChange automatically
        }}
        style={{
          opacity: 0,
          position: 'absolute',
          pointerEvents: 'none',
          height: 0,
          width: 0,
        }}
        autoFocus
      />

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
      if (char === solution[i]) className += ' correct';
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

  return <div className="line">{tiles}</div>;
}

export default Wordle;
