import { Fragment, useState, useEffect, useMemo, useRef, type ReactNode } from "react";
import SwapText from "../components/motion/SwapText";
import AutocompleteInput from "../components/AutoCompleteInput";
import SubmitGuessPopup from "../components/SubmitGuessPopUp";
import ProgressBar from "../components/ui/ProgressBar";
import { Button, GameFrame } from "../components/ui";
import { BACKEND_ORIGIN } from "../configurations/backend";
import { matchAnswer } from "../utils/answerMatch";
import { acceptedAnswers, awardPrompt, awardQuestionId, idsHitWinner, promptReserve, winnersText } from "../utils/awardSeasons";
import { useNames } from "../hooks/useNames";
import { buildNameLookup } from "../utils/questions";
import { createGuessLogger } from "../utils/guessLog";
import type { MvpSeason, OnGameEnd } from "../types/types";
import "../styles/NameLogo.css";

interface GuessMvpsProps {
  seasonsList: MvpSeason[];
  pointsPerCorrect: number;
  onGameEnd: OnGameEnd;
}

// The reserved (hidden) twin carries the widest possible season: digits are proportional ("1971-72" is far
// narrower than "2008-09"), so with the real season the reserve itself could wrap to a different number of
// lines per round and the stage would follow it.
const RESERVE_SEASON = "0000-00";
/** A season ("1985-86") never wraps mid-token on a narrow phone, so the title keeps one line count in every
 *  round (Rule 6.2); the text itself is unchanged. */
const SEASON = /(\d{4}-\d{2})/;
const noBreakSeason = (text: string): ReactNode =>
  text.split(SEASON).map((part, i) =>
    i % 2 ? <span key={i} style={{ whiteSpace: "nowrap" }}>{part}</span> : <Fragment key={i}>{part}</Fragment>
  );

function GuessMvps({ seasonsList, pointsPerCorrect, onGameEnd }: GuessMvpsProps) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [guess, setGuess] = useState("");
  const [showAnswer, setShowAnswer] = useState(false);
  const [showPointsAnimation, setShowPointsAnimation] = useState(false);
  const [score, setScore] = useState(0);
  const [allPlayers, setAllPlayers] = useState([]);
  const [playersError, setPlayersError] = useState(false);
  // Each round's guess and verdict, for the answer review handed back with the score.
  const picksRef = useRef<{ pick: string; correct: boolean }[]>([]);
  // Every answer, sent to the guess log on game end / unmount; the clock restarts each round.
  const [guessLog] = useState(() => createGuessLogger("guess-mvps"));
  const roundStartRef = useRef(Date.now());

  const currentSeason = seasonsList[currentIndex];
  // The shared names list: a typed name -> every player it can mean (aliases, namesakes).
  const names = useNames();
  const lookup = useMemo(() => (names ? buildNameLookup(names) : null), [names]);

  useEffect(() => { roundStartRef.current = Date.now(); }, [currentIndex]);
  useEffect(() => () => guessLog.flush(), [guessLog]);

  useEffect(() => {
    fetch(`${BACKEND_ORIGIN}/trivia/all-players/`)
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((data) => {
        if (data.players) setAllPlayers(data.players);
      })
      .catch((err) => {
        console.error("Failed to fetch players:", err);
        setPlayersError(true);
      });
  }, []);


  const handleGuessSubmit = (playerName : string) => {
  if (!playerName || typeof playerName !== "string" || playerName.trim() === "") {
    return; // don't run if no valid team
  }

  // Any co-winner is right (Rookie of the Year 1971, 1995, 2000), by the shared names lookup (aliases such as
  // "Lew Alcindor", spaces, suffixes) or, before the names load or on an old row, by his exact name.
  const isCorrect =
    idsHitWinner(currentSeason, lookup?.resolveIds(playerName) ?? []) ||
    matchAnswer(playerName, acceptedAnswers(currentSeason)) >= 0;
  // One entry per round: a second submit during the reveal is not a new answer.
  if (!picksRef.current[currentIndex]) {
    guessLog.add({
      question_id: awardQuestionId(currentSeason),
      answer: playerName.trim(),
      correct: isCorrect,
      elapsed_ms: Date.now() - roundStartRef.current,
    });
    if (currentIndex === seasonsList.length - 1) guessLog.flush();
  }
  picksRef.current[currentIndex] = { pick: playerName.trim(), correct: isCorrect };

  if (isCorrect) {
    setScore((prev) => prev + pointsPerCorrect);
    setShowPointsAnimation(true);
    setTimeout(() => {
      moveToNext(true);
    }, 1500);
  } else {
    setShowAnswer(true);
    setTimeout(() => {
      moveToNext(false);
    }, 1800);
  }
  };


  const moveToNext = (wasCorrect : boolean) => {
    setShowPointsAnimation(false);
    setShowAnswer(false);
    setGuess("");

    if (currentIndex < seasonsList.length - 1) {
      setCurrentIndex((prev) => prev + 1);
    } else {
      if (onGameEnd) onGameEnd(score + (wasCorrect ? pointsPerCorrect : 0), {
        review: {
          game: "guess-mvps",
          rounds: seasonsList.map((s, i) => ({
            season: s.season,
            award: s.award,
            mvp: winnersText(s),
            pick: picksRef.current[i]?.pick ?? null,
            correct: !!picksRef.current[i]?.correct,
          })),
        },
      });
    }
  };

  if (!currentSeason) return null;


  return (
    <GameFrame>
      <GameFrame.Status
        left={<GameFrame.Label>ROUND <SwapText className="tnum">{currentIndex + 1}</SwapText><span className="tnum">/{seasonsList.length}</span></GameFrame.Label>}
        right={<GameFrame.Score value={score} />}
      />
      <ProgressBar value={currentIndex + (showAnswer || showPointsAnimation ? 1 : 0)} max={seasonsList.length} />

      <GameFrame.Board>
      {/* The season and the row's question ("Who was the {award} in {season}?") swap between rounds. */}
      <GameFrame.Prompt
        eyebrow={<SwapText className="tnum">{currentSeason.season}</SwapText>}
        title={<SwapText swapKey={awardPrompt(currentSeason)} reserveWidth={[noBreakSeason(promptReserve(currentSeason).replace(currentSeason.season, RESERVE_SEASON))]}>{noBreakSeason(awardPrompt(currentSeason))}</SwapText>}
      />
      </GameFrame.Board>

      {/* Autocomplete Input and Confirm Button */}
      <GameFrame.Action>
        <GameFrame.InputRow>
          <AutocompleteInput
            placeholder="Guess the Player..."
            value={guess}
            setValue={setGuess}
            suggestions={allPlayers}
            onSubmit={handleGuessSubmit}
            customStyleInput={{ width: "100%" }}
          />

          <Button
            size="md"
            onClick={() => {
              if (guess.trim() !== "") {
                handleGuessSubmit(guess);
              }
            }}
            disabled={guess.trim() === ""}
          >
            Confirm
          </Button>
        </GameFrame.InputRow>

        {playersError && (
          <p style={{ color: "var(--brand)", fontSize: "0.8rem", textAlign: "center" }}>
            Couldn't load player suggestions.
          </p>
        )}
      </GameFrame.Action>

      <SubmitGuessPopup
        show={showPointsAnimation || showAnswer}
        text={showAnswer ? `It was ${winnersText(currentSeason) || "Unknown"}` : `Correct! +${pointsPerCorrect}`}
        color={showAnswer ? "var(--bad)" : "var(--good)"}
      />
    </GameFrame>
  );
}

export default GuessMvps;
