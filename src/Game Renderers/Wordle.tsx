import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import "../styles/Wordle.css";
import SubmitGuessPopup from '../components/SubmitGuessPopUp';
import { GameFrame } from '../components/ui';
import type { OnGameEnd } from '../types/types';

const WORD_LENGTH = 5;
const MAX_GUESSES = 5;       // matches the in-game instructions ("5 attempts")
const POINTS_PER_GUESS = 100; // first try = 500, then -100 per used attempt

const KEY_ROWS = [
  ["Q", "W", "E", "R", "T", "Y", "U", "I", "O", "P"],
  ["A", "S", "D", "F", "G", "H", "J", "K", "L"],
  ["ENTER", "Z", "X", "C", "V", "B", "N", "M", "DEL"],
];

interface WordleProps {
  gameInfo: string[];
  onGameEnd: OnGameEnd;
}

function Wordle({ gameInfo, onGameEnd }: WordleProps) {
  const [solution, setSolution] = useState('');
  const [guesses, setGuesses] = useState<Array<string | null>>(Array(MAX_GUESSES).fill(null));
  const [currentGuess, setCurrentGuess] = useState('');
  const [submitted, setSubmitted] = useState<boolean[]>(Array(MAX_GUESSES).fill(false));
  const [feedback, setFeedback] = useState<{ text: string; color: string } | null>(null);
  const lockedRef = useRef(false);

  // Initialize solution (guarded against empty payloads)
  useEffect(() => {
    const word = gameInfo?.[0];
    if (!word) return;
    setSolution(String(word).toUpperCase());
  }, [gameInfo]);

  const submitGuess = useCallback(() => {
    if (lockedRef.current) return;
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
      lockedRef.current = true;
      const points = (MAX_GUESSES - firstNullIndex) * POINTS_PER_GUESS;
      setFeedback({ text: `Correct! +${points}`, color: "var(--good)" });
      setTimeout(() => onGameEnd(points), 1800);
    } else if (firstNullIndex === MAX_GUESSES - 1) {
      lockedRef.current = true;
      setTimeout(() => setFeedback({ text: `Correct answer: ${solution}`, color: "var(--bad)" }), 1200);
      setTimeout(() => {
        setFeedback(null);
        onGameEnd(0);
      }, 3000);
    }

    setCurrentGuess('');
  }, [currentGuess, guesses, solution, onGameEnd]);

  // Central key handler — drives both the on-screen keyboard and physical keys.
  const handleKey = useCallback((key: string) => {
    if (lockedRef.current) return;
    if (key === "ENTER") {
      submitGuess();
    } else if (key === "DEL") {
      setCurrentGuess((g) => g.slice(0, -1));
    } else if (/^[A-Z]$/.test(key)) {
      setCurrentGuess((g) => (g.length < WORD_LENGTH ? g + key : g));
    }
  }, [submitGuess]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Enter") { e.preventDefault(); handleKey("ENTER"); }
      else if (e.key === "Backspace") { e.preventDefault(); handleKey("DEL"); }
      else if (/^[a-zA-Z]$/.test(e.key)) handleKey(e.key.toUpperCase());
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [handleKey]);

  // Best-known status for each letter, for keyboard coloring.
  const letterStatuses = computeLetterStatuses(guesses, submitted, solution);
  const activeRow = guesses.findIndex((g) => g === null);

  return (
    <GameFrame>
      <GameFrame.Status left={<GameFrame.Label>GUESS THE PLAYER&rsquo;S LAST NAME</GameFrame.Label>} />

      <GameFrame.Board>
      <div className="wordle-board">
        {guesses.map((guess, index) => {
          const isActive = index === activeRow;
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

      <div className="wk">
        {KEY_ROWS.map((row, r) => (
          <div className="wk-row" key={r}>
            {row.map((key) => {
              const wide = key === "ENTER" || key === "DEL";
              const status = letterStatuses[key] || "";
              return (
                <button
                  key={key}
                  className={`wk-key${wide ? " wk-key--wide" : ""}${status ? ` ${status}` : ""}`}
                  onClick={() => handleKey(key)}
                  type="button"
                  aria-label={key === "DEL" ? "Delete" : key === "ENTER" ? "Enter" : key}
                >
                  {key === "DEL" ? (
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 4H8l-7 8 7 8h13a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2z" /><path d="M18 9l-6 6M12 9l6 6" /></svg>
                  ) : key}
                </button>
              );
            })}
          </div>
        ))}
      </div>
      </GameFrame.Board>

      {/* The on-screen keyboard IS this game's input, and it lives in the board
          with the tiles — so the action slot stays empty and renders nothing. */}
      <GameFrame.Action>{null}</GameFrame.Action>

      <SubmitGuessPopup show={!!feedback} text={feedback?.text ?? ""} color={feedback?.color ?? "var(--bad)"} />
    </GameFrame>
  );
}

function gradeGuess(guess: string, solution: string): string[] {
  const status: string[] = Array(WORD_LENGTH).fill('');
  if (guess.length !== WORD_LENGTH) return status;
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
  return status;
}

const RANK: Record<string, number> = { correct: 3, present: 2, absent: 1 };

function computeLetterStatuses(
  guesses: Array<string | null>,
  submitted: boolean[],
  solution: string
): Record<string, string> {
  const out: Record<string, string> = {};
  guesses.forEach((guess, idx) => {
    if (!submitted[idx] || !guess) return;
    const grade = gradeGuess(guess, solution);
    for (let i = 0; i < WORD_LENGTH; i++) {
      const ch = guess[i];
      if (!ch) continue;
      if (!out[ch] || RANK[grade[i]] > RANK[out[ch]]) out[ch] = grade[i];
    }
  });
  return out;
}

function Line({ guess, solution, isSubmitted }: { guess: string; solution: string; isSubmitted: boolean }) {
  const status = isSubmitted && guess.length === WORD_LENGTH ? gradeGuess(guess, solution) : Array(WORD_LENGTH).fill('');

  const tiles = [];
  for (let i = 0; i < WORD_LENGTH; i++) {
    const char = guess[i] || '';
    const className = `tile font-display ${status[i]}${char && !isSubmitted ? ' filled' : ''}`.trim();
    tiles.push(
      <div
        key={i}
        className={className}
        style={{ '--i': i } as CSSProperties}
      >
        {char}
      </div>
    );
  }

  return <div className="line">{tiles}</div>;
}

export default Wordle;
