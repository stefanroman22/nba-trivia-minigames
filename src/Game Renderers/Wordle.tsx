import { useEffect, useRef, useState } from 'react';
import "../styles/Wordle.css";
import SubmitGuessPopup from '../components/SubmitGuessPopUp';
import type { OnGameEnd } from '../types/types';

const WORD_LENGTH = 5;
const MAX_GUESSES = 5;       // matches the in-game instructions ("5 attempts")
const POINTS_PER_GUESS = 100; // first try = 500, then -100 per used attempt

interface WordleProps {
  gameInfo: string[];
  onGameEnd: OnGameEnd;
}

function Wordle({ gameInfo, onGameEnd }: WordleProps) {
  const [solution, setSolution] = useState('');
  const [guesses, setGuesses] = useState<Array<string | null>>(Array(MAX_GUESSES).fill(null));
  const [currentGuess, setCurrentGuess] = useState('');
  const [submitted, setSubmitted] = useState<boolean[]>(Array(MAX_GUESSES).fill(false));
  const [showAnimation, setShowAnimation] = useState(false);

  const inputRef = useRef<HTMLInputElement>(null);

  // Initialize solution and auto-focus input (guarded against empty payloads)
  useEffect(() => {
    const word = gameInfo?.[0];
    if (!word) return;
    setSolution(String(word).toUpperCase());
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

    const firstNullIndex = guesses.findIndex((g) => g === null);
    if (firstNullIndex === -1) return;

    const nextGuesses = [...guesses];
    nextGuesses[firstNullIndex] = currentGuess;
    setGuesses(nextGuesses);

    setSubmitted((prev) => {
      const next = [...prev];
      next[firstNullIndex] = true;
      return next;
    });

    const solved = currentGuess === solution;
    if (solved) {
      setTimeout(() => onGameEnd((MAX_GUESSES - firstNullIndex) * POINTS_PER_GUESS), 1800);
    } else if (firstNullIndex === MAX_GUESSES - 1) {
      setTimeout(() => setShowAnimation(true), 1200);
      setTimeout(() => {
        setShowAnimation(false);
        onGameEnd(0);
      }, 3000);
    }

    setCurrentGuess('');
  };

  return (
    <div
      className="wordle-container"
      onClick={() => inputRef.current?.focus()} // Focus input when container clicked
    >
      <SubmitGuessPopup show={showAnimation} text={`Correct answer: ${solution}`} color={"#C8102E"} />

      {/* Hidden input captures all keystrokes for both desktop and mobile */}
      <input
        ref={inputRef}
        type="text"
        inputMode="text"
        autoCapitalize="characters"
        value={currentGuess}
        onChange={(e) => {
          // Always clean input and limit to WORD_LENGTH
          const rawValue = e.target.value.toUpperCase().replace(/[^A-Z]/g, '');
          setCurrentGuess(rawValue.slice(0, WORD_LENGTH));
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            submitGuess();
          }
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
        const isActive = index === guesses.findIndex((g) => g === null);
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
  const status: string[] = Array(WORD_LENGTH).fill('');

  // Two-pass Wordle coloring so duplicate letters are graded correctly
  if (isSubmitted && guess.length === WORD_LENGTH) {
    const remaining: Record<string, number> = {};
    for (const ch of solution) remaining[ch] = (remaining[ch] || 0) + 1;

    for (let i = 0; i < WORD_LENGTH; i++) {
      if (guess[i] === solution[i]) {
        status[i] = 'correct';
        remaining[guess[i]]--;
      }
    }
    for (let i = 0; i < WORD_LENGTH; i++) {
      if (status[i]) continue;
      const ch = guess[i];
      if (remaining[ch] > 0) {
        status[i] = 'present';
        remaining[ch]--;
      } else {
        status[i] = 'absent';
      }
    }
  }

  const tiles = [];
  for (let i = 0; i < WORD_LENGTH; i++) {
    const char = guess[i] || '';
    const className = `tile ${status[i]}`.trim();
    tiles.push(
      <div
        key={i}
        className={className}
        style={{ transitionDelay: `${i * 200}ms` }}
      >
        {char}
      </div>
    );
  }

  return <div className="line">{tiles}</div>;
}

export default Wordle;
