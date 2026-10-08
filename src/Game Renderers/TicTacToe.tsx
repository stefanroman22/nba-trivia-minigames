import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { useSelector } from "react-redux";
import AutocompleteInput from "../components/AutoCompleteInput";
import EndSequence, { type EndSequencePhase } from "../components/EndSequence";
import { ScoreLine, ScoreActions } from "../components/ScorePanel";
import SubmitGuessPopup from "../components/SubmitGuessPopUp";
import { Button, GameFrame, Spinner } from "../components/ui";
import SwapText from "../components/motion/SwapText";
import { playerKey } from "../context/MultiplayerContext";
import { BACKEND_ORIGIN } from "../configurations/backend";
import { apiFetch } from "../utils/Api";
import { useNames } from "../hooks/useNames";
import { buildNameLookup } from "../utils/questions";
import { normalizeAnswer } from "../utils/answerMatch";
import type { RootState } from "../store";
import type { Criterion, GridConfig, OnGameEnd, TicTacToeQuestion } from "../types/types";
import { popIn } from "../motion/variants";
import "../styles/TicTacToe.css";

const CELL_POINTS = 25; // 9 cells -> 225 max (registry maxPoints)
const SOLO_SECONDS = 180; // 3-minute clock

/** One claimed cell in the server-authoritative duel (contract #6). */
export interface TttCell {
  ownerUid: string;
  playerName: string;
}

/** Full authoritative Tic-Tac-Toe turn state broadcast by the server (contract #6). */
export interface TttTurnState {
  board: (TttCell | null)[]; // 9 entries
  criteria: { rows: Criterion[]; cols: Criterion[] };
  turnUid: string;
  deadlineTs: number; // epoch ms
  stealsLeft: Record<string, number>;
  winnerUid: string | null;
  draw: boolean;
}

/** A player's move (client emits, server validates and re-broadcasts). */
export type TttAction =
  | { type: "claim"; cell: number; playerName: string }
  | { type: "steal"; cell: number; playerName: string };

// Props stay compatible with the scaffolder's pre-staged RenderGame call site
// (turn: unknown, onTurnAction: (a: unknown) => void, multiplayer: boolean).
// The typed shapes above are used internally via casts.
export interface TicTacToeProps {
  gameInfo: (GridConfig | TicTacToeQuestion)[];
  onGameEnd: OnGameEnd;
  /** Solo only: the in-place end panel's "Play again". */
  onPlayAgain?: () => void;
  /** Solo only: closes the game and returns to idle (the in-place "Close game"). */
  onClose?: () => void;
  turn?: unknown; // present in the duel: the server's TttTurnState
  onTurnAction?: (action: unknown) => void;
  multiplayer?: boolean;
}

interface GuessEntry {
  question_id: string;
  answer: string;
  correct: boolean;
  elapsed_ms: number;
}

// Opacity-only swap for the end-of-game answer reveal ("?" fades out, the name fades in).
const REVEAL_FADE = { initial: { opacity: 0 }, animate: { opacity: 1 }, exit: { opacity: 0 } };
const REVEAL_START_MS = 500; // beat after the final board lands
const REVEAL_STEP_MS = 380; // one cell at a time, row by row

/** What one board cell shows and how it behaves (derived per mode by the caller). */
interface TttBoardCell {
  /** Claimed player's name; absent/null while the cell is empty. */
  name?: string | null;
  mine?: boolean;
  theirs?: boolean;
  stealable?: boolean;
  /** Solo time-up: the answer shown for a cell the player never solved. */
  revealed?: boolean;
  disabled: boolean;
}

interface TttBoardProps {
  ariaLabel: string;
  rows: Criterion[];
  cols: Criterion[];
  cell: (index: number) => TttBoardCell;
  selectedCell: number | null;
  onSelect: (cell: number | null) => void;
  /** Solo only: the small pulse when a cell is claimed (off under reduced motion). */
  animateClaim: boolean;
}

/** The single 3x3 criteria grid shared by solo and duel, so the two modes cannot drift.
 *  Empty cells show an orange "?" (aria-hidden; the button's aria-label carries the meaning). */
function TttBoard({ ariaLabel, rows, cols, cell, selectedCell, onSelect, animateClaim }: TttBoardProps) {
  return (
    <div className="ttt-grid" role="grid" aria-label={ariaLabel}>
      <span className="ttt-corner" aria-hidden="true" />
      {cols.map((c, i) => (
        <span key={`c${i}`} className="ttt-crit ttt-crit--col" lang="en">
          {c.label}
        </span>
      ))}
      {rows.map((r, ri) => (
        <div key={`r${ri}`} className="ttt-rowgroup" role="row">
          <span className="ttt-crit ttt-crit--row" lang="en">
            {r.label}
          </span>
          {[0, 1, 2].map((ci) => {
            const index = ri * 3 + ci;
            const { name, mine, theirs, stealable, revealed, disabled } = cell(index);
            const selected = selectedCell === index;
            return (
              <motion.button
                key={index}
                type="button"
                role="gridcell"
                className={`ttt-cell${mine ? " is-mine" : theirs ? " is-theirs" : ""}${
                  selected ? " is-selected" : ""
                }${stealable ? " is-stealable" : ""}${revealed ? " is-revealed" : ""}`}
                disabled={disabled}
                aria-label={`${r.label} and ${cols[ci].label}${name ? `: ${name}` : ""}`}
                onClick={() => onSelect(selected ? null : index)}
                animate={animateClaim ? { scale: name ? [1, 1.06, 1] : 1 } : undefined}
                transition={{ duration: 0.3 }}
              >
                <SwapText
                  swapKey={name ? `p:${name}` : "empty"}
                  className="ttt-cell-swap"
                  variants={revealed ? REVEAL_FADE : undefined}
                  duration={revealed ? 0.35 : undefined}
                >
                  {name ? (
                    <span className="ttt-cell-name">{name}</span>
                  ) : (
                    <span className="ttt-cell-blank" aria-hidden="true">
                      ?
                    </span>
                  )}
                </SwapText>
              </motion.button>
            );
          })}
        </div>
      ))}
    </div>
  );
}

function TicTacToe({ gameInfo, onGameEnd, onPlayAgain, onClose, turn, onTurnAction, multiplayer }: TicTacToeProps) {
  const isMultiplayer = multiplayer === true;
  const mpState = (turn ?? null) as TttTurnState | null;

  const [solved, setSolved] = useState<Record<number, string>>({}); // cell -> player name
  const [selectedCell, setSelectedCell] = useState<number | null>(null);
  const [stealMode, setStealMode] = useState(false);
  const [guess, setGuess] = useState("");
  const [finished, setFinished] = useState(false);
  // Solo time-up: answers for unsolved cells, filled in one by one (cell -> player name).
  const [revealed, setRevealed] = useState<Record<number, string>>({});
  const [showPopup, setShowPopup] = useState(false);
  const [popUpInfo, setPopUpInfo] = useState({ Text: "", Color: "" });
  const [now, setNow] = useState(() => Date.now());
  // Solo end (Rule 7.3, in place): the final board stays; the input row swaps to
  // Play again / Close game and the status row shows the score line.
  const [bottomPhase, setBottomPhase] = useState<EndSequencePhase>("input");
  const [endState, setEndState] = useState<{ score: number; secondsLeft: number } | null>(null);
  const usedIdsRef = useRef<Set<number>>(new Set());
  const guessLogRef = useRef<GuessEntry[]>([]);
  const endedRef = useRef(false);
  const soloDeadlineRef = useRef(Date.now() + SOLO_SECONDS * 1000);
  const startRef = useRef(Date.now());
  const timersRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  const reduce = useReducedMotion();

  const user = useSelector((s: RootState) => s.user.user);
  const selfUid = playerKey(user);

  const later = (fn: () => void, ms: number) => {
    timersRef.current.push(setTimeout(fn, ms));
  };
  const clearTimers = () => {
    timersRef.current.forEach(clearTimeout);
    timersRef.current = [];
  };

  // Fire-and-forget guess log (the data flywheel; solo only — the server
  // validates multiplayer answers). apiFetch attaches the JWT only when present.
  const sendGuessLog = () => {
    const entries = guessLogRef.current;
    guessLogRef.current = [];
    if (!entries.length) return;
    apiFetch(`${BACKEND_ORIGIN}/trivia/log-guesses/`, {
      method: "POST",
      body: JSON.stringify({ game: "tictactoe", entries }),
    }).catch(() => {
      /* analytics only */
    });
  };

  // Fresh state whenever a new board loads (play-again / rematch).
  useEffect(() => {
    clearTimers();
    setSolved({});
    setRevealed({});
    setSelectedCell(null);
    setStealMode(false);
    setGuess("");
    setFinished(false);
    setShowPopup(false);
    setBottomPhase("input");
    setEndState(null);
    usedIdsRef.current = new Set();
    guessLogRef.current = [];
    endedRef.current = false;
    soloDeadlineRef.current = Date.now() + SOLO_SECONDS * 1000;
    startRef.current = Date.now();
  }, [gameInfo]);

  // Unmount: cancel pending work, flush un-sent guesses (abandoned games still feed the flywheel).
  useEffect(
    () => () => {
      clearTimers();
      sendGuessLog();
    },
    [],
  );

  // Names (id-based validation truth + autocomplete suggestions).
  const names = useNames();
  const lookup = useMemo(() => (names ? buildNameLookup(names) : null), [names]);

  // Shared half-second tick: drives the solo clock and the multiplayer deadline.
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(id);
  }, []);

  const question = gameInfo && gameInfo.length > 0 ? (gameInfo[0] as TicTacToeQuestion) : null;
  const suggestions = useMemo(() => lookup?.suggestions ?? [], [lookup]);

  const flashPopup = (text: string, color: string) => {
    setPopUpInfo({ Text: text, Color: color });
    setShowPopup(true);
    later(() => setShowPopup(false), 1400);
  };

  // ---------- SOLO ----------
  const soloSecondsLeft = Math.max(0, Math.ceil((soloDeadlineRef.current - now) / 1000));
  const soloScore = Object.keys(solved).length * CELL_POINTS;

  // Rule 7.2: only unearned answers are revealed. Row-major, one cell every REVEAL_STEP_MS;
  // prefer a player not used elsewhere so the board doesn't repeat one name.
  const revealRemaining = () => {
    if (!question || !lookup) return;
    const taken = new Set(usedIdsRef.current);
    let k = 0;
    for (let i = 0; i < 9; i++) {
      if (solved[i]) continue;
      const pool = question.valid[i] ?? [];
      const id = pool.find((p) => !taken.has(p)) ?? pool[0];
      if (id === undefined) continue;
      taken.add(id);
      const name = lookup.nameOf(id);
      if (!name) continue;
      later(() => setRevealed((prev) => ({ ...prev, [i]: name })), REVEAL_START_MS + k * REVEAL_STEP_MS);
      k++;
    }
  };

  // Ends in place (Rule 7.3, Career Path split): the final board stays on screen,
  // the score line takes the status row's right slot and Play again / Close game
  // take the input row's slot. Both fit their slot, so nothing resizes (Rule 6.2).
  const finishSolo = (score: number, text: string, color: string) => {
    if (endedRef.current) return;
    endedRef.current = true;
    setFinished(true);
    setSelectedCell(null);
    revealRemaining();
    sendGuessLog();
    flashPopup(text, color);
    onGameEnd?.(score, { inPlace: true });
    setEndState({ score, secondsLeft: soloSecondsLeft });
    setBottomPhase("score");
  };

  // Clock expiry ends the solo game exactly once.
  useEffect(() => {
    if (isMultiplayer || !question || finished) return;
    if (soloSecondsLeft <= 0) finishSolo(soloScore, "Time!", "var(--bad)");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [soloSecondsLeft, finished, question, isMultiplayer]);

  const handleSoloSubmit = () => {
    if (!question || finished || selectedCell == null || solved[selectedCell]) return;
    const raw = guess;
    setGuess("");
    const qid = `${question.qid}:${selectedCell}`;
    const elapsed = Date.now() - startRef.current;
    const id = lookup?.toId(raw) ?? null;
    if (id === null) {
      guessLogRef.current.push({ question_id: qid, answer: normalizeAnswer(raw), correct: false, elapsed_ms: elapsed });
      flashPopup("Not in our player index", "var(--muted)");
      return;
    }
    const displayName = lookup!.nameOf(id) ?? raw;
    if (usedIdsRef.current.has(id)) {
      flashPopup(`${displayName} already used`, "var(--muted)");
      return;
    }
    const ok = question.valid[selectedCell].includes(id);
    guessLogRef.current.push({ question_id: qid, answer: displayName, correct: ok, elapsed_ms: elapsed });
    if (!ok) {
      flashPopup(`${displayName} doesn't fit`, "var(--bad)");
      return;
    }
    usedIdsRef.current.add(id);
    const nextSolved = { ...solved, [selectedCell]: displayName };
    setSolved(nextSolved);
    setSelectedCell(null);
    const n = Object.keys(nextSolved).length;
    if (n === 9) finishSolo(9 * CELL_POINTS, "Board cleared! +225", "var(--good)");
    else flashPopup(`Correct! +${CELL_POINTS}`, "var(--good)");
  };

  // ---------- MULTIPLAYER (server authoritative) ----------
  const mpBoard: GridConfig | null = mpState
    ? { qid: question?.qid ?? "mp", rows: mpState.criteria.rows, cols: mpState.criteria.cols }
    : null;
  const myTurn = !!mpState && mpState.turnUid === selfUid && mpState.winnerUid == null && !mpState.draw;
  const myStealsLeft = mpState ? mpState.stealsLeft?.[selfUid] ?? 0 : 0;
  const mpSecondsLeft = mpState ? Math.max(0, Math.ceil((mpState.deadlineTs - now) / 1000)) : 0;
  const myCells = mpState ? mpState.board.filter((c) => c?.ownerUid === selfUid).length : 0;
  const terminal = !!mpState && (mpState.winnerUid !== null || mpState.draw);

  // New server snapshot => a move landed; clear local selection/steal intent.
  useEffect(() => {
    if (!isMultiplayer) return;
    setSelectedCell(null);
    setStealMode(false);
    setGuess("");
  }, [isMultiplayer, mpState?.turnUid, mpState?.board]);

  // Terminal state: hold the banner, then hand the score back exactly once.
  useEffect(() => {
    if (!isMultiplayer || !terminal || endedRef.current) return;
    endedRef.current = true;
    later(() => onGameEnd?.(myCells * CELL_POINTS), 1800); // game-results: online-duel
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isMultiplayer, terminal]);

  const handleMpSubmit = () => {
    if (!mpState || !mpBoard || !myTurn || selectedCell == null) return;
    const occupant = mpState.board[selectedCell];
    // claim: an empty cell; steal: an opponent cell with steals remaining.
    if (!stealMode && occupant) return;
    if (stealMode && (!occupant || occupant.ownerUid === selfUid || myStealsLeft <= 0)) return;
    if (!lookup) {
      flashPopup("Still loading players — try again in a moment", "var(--muted)");
      return;
    }
    const id = lookup?.toId(guess) ?? null;
    const p = id !== null ? lookup!.getEntry(id) : null;
    setGuess("");
    if (!p) {
      flashPopup("Not in our player index", "var(--muted)");
      return;
    }
    if (stealMode && occupant && normalizeAnswer(occupant.playerName) === normalizeAnswer(p.full_name)) {
      flashPopup("Name a different player to steal", "var(--muted)");
      return;
    }
    // Local fit pre-check is gone with the players-index pool — the server
    // remains authoritative and re-validates every claim/steal.
    const action: TttAction = { type: stealMode ? "steal" : "claim", cell: selectedCell, playerName: p.full_name };
    onTurnAction?.(action);
    flashPopup("Sent…", "var(--muted)");
  };

  // ===================== RENDER =====================

  // ---- Multiplayer duel ----
  if (isMultiplayer) {
    if (!mpState || !mpBoard) return <Spinner label="Waiting for the match…" />;
    const winnerIsMe = mpState.winnerUid === selfUid;
    return (
      <GameFrame>
        <GameFrame.Status
          left={
            <>
              <GameFrame.Label>
                <span className={`ttt-turn${myTurn ? " is-you" : ""}`}>
                  <SwapText>{terminal ? "FINAL" : myTurn ? "YOUR TURN" : "OPPONENT'S TURN"}</SwapText>
                </span>
              </GameFrame.Label>
              <span
                className="ttt-clock tnum"
                role="timer"
                aria-label={`${mpSecondsLeft} seconds left`}
                data-low={mpSecondsLeft <= 5 || undefined}
              >
                0:{String(mpSecondsLeft).padStart(2, "0")}
              </span>
            </>
          }
          right={<GameFrame.Score value={myCells * CELL_POINTS} />}
        />

        <GameFrame.Board>
          <div className="ttt-board">
            <TttBoard
              ariaLabel="Tic-tac-toe duel board"
              rows={mpBoard.rows}
              cols={mpBoard.cols}
              cell={(i) => {
                const occ = mpState.board[i];
                const mine = occ?.ownerUid === selfUid;
                const selectable = myTurn && !terminal && (stealMode ? !!occ && !mine : !occ);
                return {
                  name: occ?.playerName,
                  mine,
                  theirs: !!occ && !mine,
                  stealable: stealMode && selectable,
                  disabled: !selectable,
                };
              }}
              selectedCell={selectedCell}
              onSelect={setSelectedCell}
              animateClaim={false}
            />

            <AnimatePresence initial={false}>
              {terminal && (
                <motion.div
                  key="banner"
                  className={`ttt-banner${mpState.draw ? "" : winnerIsMe ? " is-win" : " is-loss"}`}
                  role="status"
                  variants={popIn}
                  initial="hidden"
                  animate="visible"
                  exit="exit"
                >
                  <span className="font-display">
                    {mpState.draw ? "Draw!" : winnerIsMe ? "You win!" : "Opponent wins"}
                  </span>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </GameFrame.Board>

        <GameFrame.Action>
          <GameFrame.InputRow>
            <AutocompleteInput
              placeholder={
                !myTurn
                  ? "Waiting…"
                  : selectedCell == null
                    ? stealMode
                      ? "Pick a cell to steal…"
                      : "Pick a square…"
                    : "Name a player…"
              }
              value={guess}
              setValue={setGuess}
              suggestions={suggestions}
              onSubmit={handleMpSubmit}
              customStyleInput={{ width: "100%", maxWidth: "none", height: "44px", padding: "0 12px", fontSize: "0.85rem" }}
              customStyleSuggestion={{ fontSize: "0.8rem", maxHeight: "150px", minWidth: "100%" }}
            />
            <button
              type="button"
              className={`ttt-steal${stealMode ? " is-on" : ""}`}
              disabled={!myTurn || myStealsLeft <= 0 || terminal}
              aria-pressed={stealMode}
              onClick={() => {
                setStealMode((s) => !s);
                setSelectedCell(null);
              }}
            >
              Steal <span className="tnum"><SwapText swapKey={myStealsLeft}>x{myStealsLeft}</SwapText></span>
            </button>
            <Button
              size="md"
              aria-label="Confirm move"
              onClick={handleMpSubmit}
              disabled={!myTurn || terminal || selectedCell == null || guess.trim() === ""}
            >
              <SwapText reserveWidth={["Claim", "Steal"]}>{stealMode ? "Steal" : "Claim"}</SwapText>
            </Button>
          </GameFrame.InputRow>
        </GameFrame.Action>

        <SubmitGuessPopup show={showPopup} text={popUpInfo.Text} color={popUpInfo.Color} />
      </GameFrame>
    );
  }

  // ---- Solo: loading / empty states for the shared names fetch ----
  if (names === null) return <Spinner label="Loading players…" />;
  if (names.length === 0)
    return (
      <div className="ttt-fetchfail">
        <p>No data available. Please try again later.</p>
      </div>
    );

  // ---- Solo: empty state ----
  if (!question) return <p style={{ color: "var(--muted)" }}>No board available.</p>;

  // ---- Solo board ----
  // Once the game has ended the clock shows the time left at that moment.
  const clockSeconds = endState ? endState.secondsLeft : soloSecondsLeft;
  return (
    <GameFrame>
      <GameFrame.Status
        left={
          <>
            <GameFrame.Label>
              <SwapText>{endState ? "FINAL BOARD" : "CLAIM THREE IN A ROW"}</SwapText>
            </GameFrame.Label>
            <span
              className="ttt-clock tnum"
              role="timer"
              aria-label={`${clockSeconds} seconds left`}
              data-low={clockSeconds <= 30 || undefined}
            >
              {Math.floor(clockSeconds / 60)}:{String(clockSeconds % 60).padStart(2, "0")}
            </span>
          </>
        }
        right={
          <SwapText swapKey={endState ? "result" : "score"}>
            {endState ? (
              <ScoreLine score={endState.score} outOf={9 * CELL_POINTS} />
            ) : (
              <GameFrame.Score value={soloScore} />
            )}
          </SwapText>
        }
      />

      <GameFrame.Board>
        <div className="ttt-board">
          <TttBoard
            ariaLabel="Tic-tac-toe criteria board"
            rows={question.rows}
            cols={question.cols}
            cell={(i) => ({ name: solved[i] ?? revealed[i], mine: !!solved[i], revealed: finished && !solved[i], disabled: !!solved[i] || finished })}
            selectedCell={selectedCell}
            onSelect={setSelectedCell}
            animateClaim={!reduce}
          />
        </div>
      </GameFrame.Board>

      <GameFrame.Action>
        {/* Input → score (shared answers-shown end sequence; no loader beat, as in
            Career Path: the 38px buttons fit the 46px input slot, a labelled
            spinner would not) */}
        <EndSequence
          phase={bottomPhase}
          input={
            <GameFrame.InputRow>
              <AutocompleteInput
                placeholder={selectedCell == null ? "Pick a square first…" : "Name a player…"}
                value={guess}
                setValue={setGuess}
                suggestions={suggestions}
                onSubmit={handleSoloSubmit}
                customStyleInput={{ width: "100%", maxWidth: "none", height: "44px", padding: "0 12px", fontSize: "0.85rem" }}
                customStyleSuggestion={{ fontSize: "0.8rem", maxHeight: "150px", minWidth: "100%" }}
              />
              <Button
                size="md"
                aria-label="Confirm player"
                onClick={handleSoloSubmit}
                disabled={finished || selectedCell == null || guess.trim() === ""}
              >
                Confirm
              </Button>
            </GameFrame.InputRow>
          }
          score={<ScoreActions onPlayAgain={onPlayAgain} onClose={onClose} />}
        />
      </GameFrame.Action>

      <SubmitGuessPopup show={showPopup} text={popUpInfo.Text} color={popUpInfo.Color} />
    </GameFrame>
  );
}

export default TicTacToe;
