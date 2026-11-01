import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { useSelector } from "react-redux";
import AutocompleteInput from "../components/AutoCompleteInput";
import EndSequence, { type EndSequencePhase } from "../components/EndSequence";
import { ScoreLine, ScoreActions } from "../components/ScorePanel";
import SubmitGuessPopup from "../components/SubmitGuessPopUp";
import { Button, GameFrame, Spinner } from "../components/ui";
import SwapText from "../components/motion/SwapText";
import TttWinLine, { TTT_DRAW_MS, TttMark, type TttMarkKind } from "../components/motion/TttWinLine";
import { playerKey } from "../context/MultiplayerContext";
import { BACKEND_ORIGIN } from "../configurations/backend";
import { apiFetch } from "../utils/Api";
import { useNames } from "../hooks/useNames";
import { buildNameLookup } from "../utils/questions";
import { normalizeAnswer } from "../utils/answerMatch";
import type { RootState } from "../store";
import type { Criterion, GridConfig, OnGameEnd, TicTacToeQuestion } from "../types/types";
import type { AnswerReview } from "../types/review";
import { tttReview } from "../utils/turnReview";
import { popIn } from "../motion/variants";
import { durations, easing } from "../motion/tokens";
import { TTT_CELL_POINTS as CELL_POINTS, TTT_SOLO_MAX } from "../utils/gameScoring";
import { TTT_END_HOLD_MS } from "../utils/tttDuel";
import "../styles/TicTacToe.css";

const SOLO_SECONDS = 180; // 3-minute clock

/** One claimed cell in the server-authoritative duel (contract #6). */
export interface TttCell {
  ownerUid: string;
  playerName: string;
}

/** Full authoritative Tic-Tac-Toe turn state broadcast by the server (contract #6). Since 2026-11-01 (standard
 *  rules, no steals) it carries no `stealsLeft`, and `winLine` holds the winning line's three cells once decided. */
export interface TttTurnState {
  board: (TttCell | null)[]; // 9 entries
  criteria: { rows: Criterion[]; cols: Criterion[] };
  turnUid: string;
  deadlineTs: number; // epoch ms
  winnerUid: string | null;
  draw: boolean;
  /** Absent from a relay older than 2026-11-01. */
  winLine?: number[] | null;
}

/** A player's move (client emits, server validates and re-broadcasts). */
export type TttAction = { type: "claim"; cell: number; playerName: string };

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
  /** Local multiplayer: the claiming player's stroke-drawn mark, shown above the name. */
  mark?: TttMarkKind;
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
  /** Local 2-player: the selected cell's tint follows the player whose turn it is (default "brand" = orange). */
  selectedTone?: "brand" | "text";
  onSelect: (cell: number | null) => void;
  /** Solo only: the small pulse when a cell is claimed (off under reduced motion). */
  animateClaim: boolean;
  /** A decided duel: the three cells of the winning line, drawn over the board. */
  winLine?: readonly number[] | null;
  /** The win line's colour: `text` (near-white gradient) over the online duel's orange cells and for local O,
   *  `brand` (orange gradient) for local X. */
  winTone?: "brand" | "text";
}

/** A claimed cell's mark above its name. In a cell the win line crosses (`crossOrder` >= 0, the cell's place along the
 *  line) the name fades out while the mark grows and slides to the cell's centre, on the line's own timing: the
 *  cells' offsets and the scale are measured here and handed to the CSS (`.is-crossed`) as variables, so only
 *  transform + opacity move. */
function TttClaim({ mark, name, crossOrder }: { mark: TttMarkKind; name: string; crossOrder: number }) {
  const claimRef = useRef<HTMLSpanElement>(null);
  const nameRef = useRef<HTMLSpanElement>(null);
  const crossed = crossOrder >= 0;

  useLayoutEffect(() => {
    const claim = claimRef.current;
    const cell = claim?.closest<HTMLElement>('[role="gridcell"]');
    const markEl = claim?.querySelector<SVGElement>(".ttt-mark");
    const nameEl = nameRef.current;
    if (!crossed || !claim || !cell || !markEl || !nameEl) return;
    const measure = () => {
      const gap = parseFloat(getComputedStyle(claim).rowGap) || 0;
      // The mark sits above the name; half of (name + gap) is how far down the centre is.
      claim.style.setProperty("--ttt-shift", `${(nameEl.offsetHeight + gap) / 2}px`);
      // The mark's laid-out size (the computed width ignores the transform this very scale sets).
      const size = parseFloat(getComputedStyle(markEl).width) || 1;
      const room = Math.min(cell.clientWidth, cell.clientHeight) * 0.9;
      claim.style.setProperty("--ttt-scale", String(Math.max(1, room / size)));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(cell);
    return () => ro.disconnect();
  }, [crossed]);

  return (
    <span
      ref={claimRef}
      className="ttt-cell-claim"
      style={
        crossed
          ? ({
              "--ttt-win-delay": `${crossOrder * durations.fast}s`,
              "--ttt-win-dur": `${durations.slow}s`,
              "--ttt-win-ease": `cubic-bezier(${easing.out.join(",")})`,
            } as CSSProperties)
          : undefined
      }
    >
      <TttMark mark={mark} />
      <span ref={nameRef} className="ttt-cell-name">
        {name}
      </span>
    </span>
  );
}

/** The single 3x3 criteria grid shared by solo, the online duel and local multiplayer, so the modes cannot drift.
 *  Empty cells show an orange "?" (aria-hidden; the button's aria-label carries the meaning). */
export function TttBoard({ ariaLabel, rows, cols, cell, selectedCell, selectedTone = "brand", onSelect, animateClaim, winLine, winTone }: TttBoardProps) {
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
            const { name, mine, theirs, mark, revealed, disabled } = cell(index);
            const selected = selectedCell === index;
            const crossed = !!winLine && winLine.length === 3 && winLine.includes(index);
            return (
              <motion.button
                key={index}
                type="button"
                role="gridcell"
                className={`ttt-cell${mine ? " is-mine" : theirs ? " is-theirs" : ""}${
                  selected ? ` is-selected${selectedTone === "text" ? " is-selected-o" : ""}` : ""
                }${revealed ? " is-revealed" : ""}${mark ? ` is-marked is-mark-${mark.toLowerCase()}` : ""}${
                  crossed ? " is-crossed" : ""
                }`}
                disabled={disabled}
                aria-label={`${r.label} and ${cols[ci].label}${name ? `: ${name}${mark ? ` (${mark})` : ""}` : ""}`}
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
                  {name && mark ? (
                    <TttClaim mark={mark} name={name} crossOrder={crossed ? (winLine?.indexOf(index) ?? -1) : -1} />
                  ) : name ? (
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
      {winLine && winLine.length === 3 && <TttWinLine line={winLine} tone={winTone} />}
    </div>
  );
}

function TicTacToe({ gameInfo, onGameEnd, onPlayAgain, onClose, turn, onTurnAction, multiplayer }: TicTacToeProps) {
  const isMultiplayer = multiplayer === true;
  const mpState = (turn ?? null) as TttTurnState | null;

  const [solved, setSolved] = useState<Record<number, string>>({}); // cell -> player name
  const [selectedCell, setSelectedCell] = useState<number | null>(null);
  const [guess, setGuess] = useState("");
  const [finished, setFinished] = useState(false);
  // Solo time-up: answers for unsolved cells, filled in one by one (cell -> player name).
  const [revealed, setRevealed] = useState<Record<number, string>>({});
  const [showPopup, setShowPopup] = useState(false);
  const [popUpInfo, setPopUpInfo] = useState({ Text: "", Color: "" });
  const [popKey, setPopKey] = useState(0);
  const popTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [now, setNow] = useState(() => Date.now());
  // Solo end (Rule 7.3, in place): the final board stays; the input row swaps to
  // Play again / Close game and the status row shows the score line.
  const [bottomPhase, setBottomPhase] = useState<EndSequencePhase>("input");
  const [endState, setEndState] = useState<{ score: number; secondsLeft: number } | null>(null);
  // Duel: the decided board's banner, shown once the win line has drawn (at once for a draw).
  const [bannerShown, setBannerShown] = useState(false);
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
    if (popTimerRef.current) clearTimeout(popTimerRef.current);
    popTimerRef.current = null;
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
    setGuess("");
    setFinished(false);
    setShowPopup(false);
    setBottomPhase("input");
    setEndState(null);
    setBannerShown(false);
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
    setPopKey((k) => k + 1); // every answer enters again (Rule 6.1)
    setShowPopup(true);
    // One hide timer: a newer answer restarts the 1.4 s window instead of being hidden by the older timer.
    if (popTimerRef.current) clearTimeout(popTimerRef.current);
    popTimerRef.current = setTimeout(() => setShowPopup(false), 1400);
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
  const finishSolo = (score: number, text: string, color: string, finalSolved: Record<number, string> = solved) => {
    if (endedRef.current) return;
    endedRef.current = true;
    setFinished(true);
    setSelectedCell(null);
    revealRemaining();
    sendGuessLog();
    flashPopup(text, color);
    // The solo answer review: the dealt grid (its qid), the cells you filled; a cleared board is the win.
    const review: AnswerReview | undefined = question
      ? {
          game: "tictactoe",
          qid: question.qid,
          rows: question.rows,
          cols: question.cols,
          cells: Array.from({ length: 9 }, (_, i) => ({ name: finalSolved[i] ?? null, mine: !!finalSolved[i] })),
          result: Object.keys(finalSolved).length === 9 ? "win" : "loss",
        }
      : undefined;
    onGameEnd?.(score, { inPlace: true, review });
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
    // Namesakes (two Eddie Johnsons): the one who fits this cell and is not used yet wins. An exact name wins
    // outright, so "Gary Payton" never fills a cell only Gary Payton II fits.
    const ids = lookup?.resolveIds(raw) ?? [];
    const id = ids.find((x) => question.valid[selectedCell].includes(x) && !usedIdsRef.current.has(x)) ?? ids[0] ?? null;
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
    if (n === 9) finishSolo(TTT_SOLO_MAX, `Board cleared! +${TTT_SOLO_MAX}`, "var(--good)", nextSolved);
    else flashPopup(`Correct! +${CELL_POINTS}`, "var(--good)");
  };

  // ---------- MULTIPLAYER (server authoritative) ----------
  const mpBoard: GridConfig | null = mpState
    ? { qid: question?.qid ?? "mp", rows: mpState.criteria.rows, cols: mpState.criteria.cols }
    : null;
  const myTurn = !!mpState && mpState.turnUid === selfUid && mpState.winnerUid == null && !mpState.draw;
  const mpSecondsLeft = mpState ? Math.max(0, Math.ceil((mpState.deadlineTs - now) / 1000)) : 0;
  const myCells = mpState ? mpState.board.filter((c) => c?.ownerUid === selfUid).length : 0;
  const terminal = !!mpState && (mpState.winnerUid !== null || mpState.draw);
  const winLine = mpState?.winLine ?? null;

  // New server snapshot => a move landed (or the turn passed); clear the local selection.
  useEffect(() => {
    if (!isMultiplayer) return;
    setSelectedCell(null);
    setGuess("");
  }, [isMultiplayer, mpState?.turnUid, mpState?.board]);

  // Terminal state: the win line draws, then the banner; hand the score back exactly once.
  useEffect(() => {
    if (!isMultiplayer || !terminal || endedRef.current) return;
    endedRef.current = true;
    later(() => setBannerShown(true), winLine && !reduce ? TTT_DRAW_MS : 0);
    // The final board is the duel's answer review (both players finish at once, so nothing leaks).
    const review = mpState ? tttReview(mpState, selfUid) : undefined;
    later(() => onGameEnd?.(myCells * CELL_POINTS, { review }), TTT_END_HOLD_MS); // game-results: online-duel
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isMultiplayer, terminal]);

  const handleMpSubmit = () => {
    if (!mpState || !mpBoard || !myTurn || selectedCell == null) return;
    // One answer per turn, on an empty square (the relay judges it: a miss passes the turn).
    if (mpState.board[selectedCell]) return;
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
    // Local fit pre-check is gone with the players-index pool — the server
    // remains authoritative and re-validates every claim.
    const action: TttAction = { type: "claim", cell: selectedCell, playerName: p.full_name };
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
                return {
                  name: occ?.playerName,
                  mine,
                  theirs: !!occ && !mine,
                  disabled: !myTurn || terminal || !!occ,
                };
              }}
              selectedCell={selectedCell}
              onSelect={setSelectedCell}
              animateClaim={false}
              winLine={winLine}
              winTone="text"
            />

            <AnimatePresence initial={false}>
              {terminal && bannerShown && (
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
              placeholder={!myTurn ? "Waiting…" : selectedCell == null ? "Pick a square…" : "Name a player…"}
              value={guess}
              setValue={setGuess}
              suggestions={suggestions}
              onSubmit={handleMpSubmit}
              customStyleInput={{ width: "100%", maxWidth: "none", height: "44px", padding: "0 12px", fontSize: "0.85rem" }}
              customStyleSuggestion={{ fontSize: "0.8rem", maxHeight: "150px", minWidth: "100%" }}
            />
            <Button
              size="md"
              aria-label="Confirm move"
              onClick={handleMpSubmit}
              disabled={!myTurn || terminal || selectedCell == null || guess.trim() === ""}
            >
              Claim
            </Button>
          </GameFrame.InputRow>
        </GameFrame.Action>

        <SubmitGuessPopup show={showPopup} text={popUpInfo.Text} color={popUpInfo.Color} popKey={popKey} />
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
              <ScoreLine score={endState.score} outOf={TTT_SOLO_MAX} />
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

      <SubmitGuessPopup show={showPopup} text={popUpInfo.Text} color={popUpInfo.Color} popKey={popKey} />
    </GameFrame>
  );
}

export default TicTacToe;
