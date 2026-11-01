// NBA Tic-Tac-Toe, local multiplayer: two players take turns on one device (docs/superpowers/specs/
// 2026-11-01-ttt-local-multiplayer-design.md). The same board as solo and the online duel (TttBoard), the same judging
// (utils/tttDuel.ts, mirrored by the relay), one answer per turn on a 30-second clock. Frontend only: no login, no
// points, nothing stored — no onGameEnd, no guess log; the shell is told the board ended through `local.onEnd`.
import { useEffect, useMemo, useRef, useState } from "react";
import { useReducedMotion } from "framer-motion";
import AutocompleteInput from "../components/AutoCompleteInput";
import EndSequence, { type EndSequencePhase } from "../components/EndSequence";
import { ScoreActions } from "../components/ScorePanel";
import SubmitGuessPopup from "../components/SubmitGuessPopUp";
import { Avatar, Button, GameFrame, Spinner } from "../components/ui";
import SwapText from "../components/motion/SwapText";
import { AutoSize } from "../components/motion/AutoHeight";
import { TTT_DRAW_MS, TttMark } from "../components/motion/TttWinLine";
import { useNames } from "../hooks/useNames";
import { buildNameLookup } from "../utils/questions";
import { isFull, judgeAnswer, nextPlayer, winningLine, type Seat } from "../utils/tttDuel";
import type { AnswerReview } from "../types/review";
import type { GridConfig, TicTacToeQuestion } from "../types/types";
import { TttBoard } from "./TicTacToe";
import "../styles/TicTacToe.css";

const TURN_SECONDS = 30; // same clock as the online duel (relay TTT_TURN_MS)
const MARKS = ["X", "O"] as const; // Player 1 is always X, Player 2 always O

/** A local session as the shell holds it: the two names (Player 1 = X) and who starts this board. */
export interface TttLocalPlay {
  names: readonly [string, string];
  starter: Seat;
  /** The board is decided (after the win line has drawn): the shell swaps its Close game link. */
  onEnd: (review: AnswerReview | undefined) => void;
}

interface TicTacToeLocalProps {
  gameInfo: (GridConfig | TicTacToeQuestion)[];
  local: TttLocalPlay;
  /** Deals a new board (same difficulty); the other player starts it. */
  onPlayAgain?: () => void;
  onClose?: () => void;
}

/** The decided board as the status row's centre pill shows it: the winner's mark (null = draw) and name. */
interface ClockResult {
  winner: Seat | null;
  name: string | null;
}

/**
 * The turn clock (status row centre): ticks on its own half-second interval, so the board re-renders only when the
 * game changes, never twice a second; calls `onTimeUp` once when a running turn reaches 0:00. It stops on the
 * decided board (`ended`) and, once the win line has drawn (`result`), the same pill reads the result instead:
 * the winner's mark + "WINS", or "DRAW" — the board needs no title above it. The pill's width glides (AutoSize).
 */
function TurnClock({
  deadline,
  ended,
  result,
  onTimeUp,
}: {
  deadline: number | null;
  ended: boolean;
  result: ClockResult | null;
  onTimeUp: () => void;
}) {
  const [now, setNow] = useState(() => Date.now());
  const onTimeUpRef = useRef(onTimeUp);
  useEffect(() => {
    onTimeUpRef.current = onTimeUp;
  });
  useEffect(() => {
    if (ended) return; // the decided board's clock holds while the win line draws
    const id = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(id);
  }, [ended]);
  // A fresh deadline is read against a `now` up to 500 ms old: cap at the full turn.
  const secondsLeft = deadline === null ? TURN_SECONDS : Math.min(TURN_SECONDS, Math.max(0, Math.ceil((deadline - now) / 1000)));
  useEffect(() => {
    if (!ended && deadline !== null && secondsLeft <= 0) onTimeUpRef.current();
  }, [secondsLeft, ended, deadline]);
  const tone = result ? (result.winner === null ? "draw" : result.winner === 0 ? "x" : "o") : undefined;
  return (
    <AutoSize axis="width">
      <span
        className="ttt-clock tnum"
        role="timer"
        aria-label={result ? (result.winner === null ? "Draw" : `${result.name} wins`) : `${secondsLeft} seconds left`}
        data-low={(!ended && secondsLeft <= 5) || undefined}
        data-result={tone}
      >
        <SwapText swapKey={tone ?? "clock"}>
          {result ? (
            result.winner === null ? (
              "DRAW"
            ) : (
              <span className="tttl-result">
                <TttMark mark={MARKS[result.winner]} draw={false} className="tttl-result-mark" />
                WINS
              </span>
            )
          ) : (
            `0:${String(secondsLeft).padStart(2, "0")}`
          )}
        </SwapText>
      </span>
    </AutoSize>
  );
}

/** The first letter of a name, for its avatar circle. */
const initialOf = (name: string) => (Array.from(name.trim())[0] ?? "?").toUpperCase();

export default function TicTacToeLocal({ gameInfo, local, onPlayAgain, onClose }: TicTacToeLocalProps) {
  const question = gameInfo.length > 0 ? (gameInfo[0] as TicTacToeQuestion) : null;
  const { names: players, starter, onEnd } = local;

  const [owners, setOwners] = useState<(Seat | null)[]>(() => Array(9).fill(null));
  const [cellNames, setCellNames] = useState<(string | null)[]>(() => Array(9).fill(null));
  const [turn, setTurn] = useState<Seat>(starter);
  const [selectedCell, setSelectedCell] = useState<number | null>(null);
  const [guess, setGuess] = useState("");
  // The decided board: its winner (null = draw) and line; `endShown` flips once the line has drawn.
  const [end, setEnd] = useState<{ winner: Seat | null; line: number[] | null } | null>(null);
  const [endShown, setEndShown] = useState(false);
  const [bottomPhase, setBottomPhase] = useState<EndSequencePhase>("input");
  const [deadline, setDeadline] = useState<number | null>(null);
  const [showPopup, setShowPopup] = useState(false);
  const [popUpInfo, setPopUpInfo] = useState({ Text: "", Color: "" });
  const [popKey, setPopKey] = useState(0);
  const usedIdsRef = useRef<Set<number>>(new Set());
  const timersRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  const popTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reduce = useReducedMotion();

  const names = useNames();
  const lookup = useMemo(() => (names ? buildNameLookup(names) : null), [names]);
  const suggestions = useMemo(() => lookup?.suggestions ?? [], [lookup]);

  const later = (fn: () => void, ms: number) => {
    timersRef.current.push(setTimeout(fn, ms));
  };
  useEffect(
    () => () => {
      timersRef.current.forEach(clearTimeout);
      if (popTimerRef.current) clearTimeout(popTimerRef.current);
    },
    [],
  );

  // Fresh state whenever a new board loads (Play again), as solo does, so a stalled stage swap can never
  // leave the previous board's marks or result on top of the new board.
  const qid = question?.qid;
  useEffect(() => {
    timersRef.current.forEach(clearTimeout);
    timersRef.current = [];
    if (popTimerRef.current) clearTimeout(popTimerRef.current);
    popTimerRef.current = null;
    usedIdsRef.current = new Set();
    setOwners(Array(9).fill(null));
    setCellNames(Array(9).fill(null));
    setTurn(starter);
    setSelectedCell(null);
    setGuess("");
    setEnd(null);
    setEndShown(false);
    setBottomPhase("input");
    setShowPopup(false);
    setDeadline(null);
  }, [qid, starter]);

  // The first turn's clock starts once the names are in (TurnClock ticks it).
  useEffect(() => {
    if (lookup && deadline === null) setDeadline(Date.now() + TURN_SECONDS * 1000);
  }, [lookup, deadline]);

  const flashPopup = (text: string, color: string) => {
    setPopUpInfo({ Text: text, Color: color });
    setPopKey((k) => k + 1); // every answer enters again (Rule 6.1)
    setShowPopup(true);
    if (popTimerRef.current) clearTimeout(popTimerRef.current);
    popTimerRef.current = setTimeout(() => setShowPopup(false), 1400);
  };

  /** The other player's turn, on a fresh clock. */
  const passTurn = () => {
    setTurn((t) => nextPlayer(t));
    setDeadline(Date.now() + TURN_SECONDS * 1000);
    setSelectedCell(null);
    setGuess("");
  };

  // Time-out: "Time's up", the turn passes.
  const onTimeUp = () => {
    flashPopup("Time's up", "var(--bad)");
    passTurn();
  };

  /** Three in a row (winner) or a full board (winner null): the line draws, then the result and Play again. */
  const finish = (winner: Seat | null, line: number[] | null, finalOwners: (Seat | null)[], finalNames: (string | null)[]) => {
    setEnd({ winner, line });
    const review: AnswerReview | undefined = question
      ? {
          game: "tictactoe",
          qid: question.qid,
          rows: question.rows,
          cols: question.cols,
          cells: finalNames.map((name, i) => ({ name, mine: finalOwners[i] === 0 })),
          result: winner === null ? "draw" : winner === 0 ? "win" : "loss",
        }
      : undefined;
    later(() => {
      setEndShown(true);
      setSelectedCell(null);
      setBottomPhase("score");
      onEnd(review);
    }, line && !reduce ? TTT_DRAW_MS : 0);
  };

  const handleSubmit = () => {
    if (!question || !lookup || end || selectedCell == null || owners[selectedCell] != null) return;
    const raw = guess;
    if (!raw.trim()) return;
    setGuess("");
    const verdict = judgeAnswer(raw, selectedCell, question.valid, usedIdsRef.current, lookup);
    if (verdict.kind === "unknown") {
      flashPopup("Not in our player index", "var(--muted)");
      return;
    }
    const name = lookup.nameOf(verdict.id) ?? raw;
    if (verdict.kind === "used") {
      flashPopup(`${name} already used`, "var(--muted)");
      return;
    }
    if (verdict.kind === "wrong") {
      flashPopup(`${name} doesn't fit`, "var(--bad)");
      passTurn();
      return;
    }
    usedIdsRef.current.add(verdict.id);
    const nextOwners = owners.map((o, i) => (i === selectedCell ? turn : o));
    const nextNames = cellNames.map((n, i) => (i === selectedCell ? name : n));
    setOwners(nextOwners);
    setCellNames(nextNames);
    flashPopup("Correct!", "var(--good)");
    const won = winningLine(nextOwners);
    if (won) finish(won.winner, won.line, nextOwners, nextNames);
    else if (isFull(nextOwners)) finish(null, null, nextOwners, nextNames);
    else passTurn();
  };

  // ---- the players' own wait for the shared names list (Rule 3.2: the shell fades the frame in) ----
  if (names === null) return <Spinner label="Loading players…" />;
  if (names.length === 0)
    return (
      <div className="ttt-fetchfail">
        <p>No data available. Please try again later.</p>
      </div>
    );
  if (!question) return <p style={{ color: "var(--muted)" }}>No board available.</p>;

  // The lit chip: whose turn it is, and the winner once decided (none on a draw).
  const lit = (seat: Seat) => (end ? end.winner === seat : turn === seat);
  const chip = (seat: Seat) => (
    <span className={`tttl-player${lit(seat) ? " is-active" : ""}`}>
      <Avatar
        initials={initialOf(players[seat])}
        size={20}
        shape="circle"
        bg={seat === 0 ? undefined : "var(--surface3)"}
        color={seat === 0 ? undefined : "var(--text)"}
      />
      <span className="tttl-player-name">{players[seat]}</span>
      <span className="sr-only">({MARKS[seat]})</span>
      <TttMark mark={MARKS[seat]} draw={false} className="tttl-player-mark" />
    </span>
  );

  // No prompt (owner, 2026-11-01): the layout is solo's — status row, board, input row — so the board and the
  // name dropdown stay in view on a phone. The lit chip says whose turn it is; the centre pill reads the result.
  const result: ClockResult | null =
    end && endShown ? { winner: end.winner, name: end.winner === null ? null : players[end.winner] } : null;

  return (
    <GameFrame>
      <GameFrame.Status
        left={chip(0)}
        center={<TurnClock deadline={deadline} ended={!!end} result={result} onTimeUp={onTimeUp} />}
        right={chip(1)}
      />

      <GameFrame.Board>
        <div className="ttt-board">
          <TttBoard
            ariaLabel="Tic-tac-toe local board"
            rows={question.rows}
            cols={question.cols}
            cell={(i) => {
              const o = owners[i];
              return { name: cellNames[i], mark: o === null ? undefined : MARKS[o], disabled: o !== null || !!end };
            }}
            selectedCell={selectedCell}
            selectedTone={turn === 1 ? "text" : "brand"}
            onSelect={setSelectedCell}
            animateClaim={false}
            winLine={end?.line ?? null}
            winTone={end?.winner === 0 ? "brand" : "text"}
          />
        </div>
      </GameFrame.Board>

      <GameFrame.Action>
        <EndSequence
          phase={bottomPhase}
          input={
            <GameFrame.InputRow>
              <AutocompleteInput
                placeholder={selectedCell == null ? "Pick a square first…" : "Name a player…"}
                value={guess}
                setValue={setGuess}
                suggestions={suggestions}
                onSubmit={handleSubmit}
                customStyleInput={{ width: "100%", maxWidth: "none", height: "44px", padding: "0 12px", fontSize: "0.85rem" }}
                customStyleSuggestion={{ fontSize: "0.8rem", maxHeight: "150px", minWidth: "100%" }}
              />
              <Button
                size="md"
                aria-label="Confirm player"
                onClick={handleSubmit}
                disabled={!!end || selectedCell == null || guess.trim() === ""}
              >
                Confirm
              </Button>
            </GameFrame.InputRow>
          }
          score={<ScoreActions onPlayAgain={onPlayAgain} onClose={onClose} />}
        />
      </GameFrame.Action>

      <SubmitGuessPopup show={showPopup} text={popUpInfo.Text} color={popUpInfo.Color} popKey={popKey} />
    </GameFrame>
  );
}
