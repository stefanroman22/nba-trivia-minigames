import { useEffect, useMemo, useRef, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { useSelector } from "react-redux";
import AutocompleteInput from "../components/AutoCompleteInput";
import SubmitGuessPopup from "../components/SubmitGuessPopUp";
import { Button, CourtLoader } from "../components/ui";
import { playerKey } from "../context/MultiplayerContext";
import { BACKEND_ORIGIN } from "../configurations/backend";
import { apiFetch } from "../utils/Api";
import { fetchWholePool } from "../utils/pool";
import { playerMatches } from "../utils/criteria";
import { normalizeAnswer } from "../utils/answerMatch";
import type { RootState } from "../store";
import type { Criterion, GridConfig, OnGameEnd, PlayerIndexEntry } from "../types/types";
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
  gameInfo: GridConfig[];
  onGameEnd: OnGameEnd;
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
type PoolState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; players: PlayerIndexEntry[] };

function TicTacToe({ gameInfo, onGameEnd, turn, onTurnAction, multiplayer }: TicTacToeProps) {
  const isMultiplayer = multiplayer === true;
  const mpState = (turn ?? null) as TttTurnState | null;

  const [pool, setPool] = useState<PoolState>({ status: "loading" });
  const [solved, setSolved] = useState<Record<number, string>>({}); // cell -> player name
  const [selectedCell, setSelectedCell] = useState<number | null>(null);
  const [stealMode, setStealMode] = useState(false);
  const [guess, setGuess] = useState("");
  const [finished, setFinished] = useState(false);
  const [showPopup, setShowPopup] = useState(false);
  const [popUpInfo, setPopUpInfo] = useState({ Text: "", Color: "" });
  const [now, setNow] = useState(() => Date.now());
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
    setSelectedCell(null);
    setStealMode(false);
    setGuess("");
    setFinished(false);
    setShowPopup(false);
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

  // Players index (validation truth + autocomplete suggestions).
  useEffect(() => {
    let alive = true;
    fetchWholePool("players-index").then((res) => {
      if (!alive) return;
      if (res.success && res.data) setPool({ status: "ready", players: res.data as PlayerIndexEntry[] });
      else setPool({ status: "error", message: res.error?.message ?? "Couldn't load players." });
    });
    return () => {
      alive = false;
    };
  }, []);

  // Shared half-second tick: drives the solo clock and the multiplayer deadline.
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(id);
  }, []);

  const board = gameInfo && gameInfo.length > 0 ? gameInfo[0] : null;
  const players = pool.status === "ready" ? pool.players : [];
  const suggestions = useMemo(
    () => (pool.status === "ready" ? pool.players.map((p) => p.full_name) : []),
    [pool],
  );

  const flashPopup = (text: string, color: string) => {
    setPopUpInfo({ Text: text, Color: color });
    setShowPopup(true);
    later(() => setShowPopup(false), 1400);
  };

  const findPlayer = (raw: string): PlayerIndexEntry | null => {
    const n = normalizeAnswer(raw);
    if (!n) return null;
    return (
      players.find(
        (p) => normalizeAnswer(p.full_name) === n || p.aliases.some((a) => normalizeAnswer(a) === n),
      ) ?? null
    );
  };

  // ---------- SOLO ----------
  const soloSecondsLeft = Math.max(0, Math.ceil((soloDeadlineRef.current - now) / 1000));
  const soloScore = Object.keys(solved).length * CELL_POINTS;

  const finishSolo = (score: number, text: string, color: string) => {
    if (endedRef.current) return;
    endedRef.current = true;
    setFinished(true);
    sendGuessLog();
    flashPopup(text, color);
    later(() => onGameEnd?.(score), 1500);
  };

  // Clock expiry ends the solo game exactly once.
  useEffect(() => {
    if (isMultiplayer || !board || finished) return;
    if (soloSecondsLeft <= 0) finishSolo(soloScore, "Time!", "var(--bad)");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [soloSecondsLeft, finished, board, isMultiplayer]);

  const handleSoloSubmit = () => {
    if (!board || finished || selectedCell == null || solved[selectedCell]) return;
    const raw = guess;
    setGuess("");
    const rowCrit = board.rows[Math.floor(selectedCell / 3)];
    const colCrit = board.cols[selectedCell % 3];
    const qid = `${board.qid}:${selectedCell}`;
    const elapsed = Date.now() - startRef.current;
    const p = findPlayer(raw);
    if (!p) {
      guessLogRef.current.push({ question_id: qid, answer: normalizeAnswer(raw), correct: false, elapsed_ms: elapsed });
      flashPopup("Not in our player index", "var(--muted)");
      return;
    }
    if (usedIdsRef.current.has(p.person_id)) {
      flashPopup(`${p.full_name} already used`, "var(--muted)");
      return;
    }
    const ok = playerMatches(p, rowCrit) && playerMatches(p, colCrit);
    guessLogRef.current.push({ question_id: qid, answer: p.full_name, correct: ok, elapsed_ms: elapsed });
    if (!ok) {
      flashPopup(`${p.full_name} doesn't fit`, "var(--bad)");
      return;
    }
    usedIdsRef.current.add(p.person_id);
    const nextSolved = { ...solved, [selectedCell]: p.full_name };
    setSolved(nextSolved);
    setSelectedCell(null);
    const n = Object.keys(nextSolved).length;
    if (n === 9) finishSolo(9 * CELL_POINTS, "Board cleared! +225", "var(--good)");
    else flashPopup(`+${CELL_POINTS}`, "var(--good)");
  };

  // ---------- MULTIPLAYER (server authoritative) ----------
  const mpBoard: GridConfig | null = mpState
    ? { qid: board?.qid ?? "mp", rows: mpState.criteria.rows, cols: mpState.criteria.cols }
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
    later(() => onGameEnd?.(myCells * CELL_POINTS), 1800);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isMultiplayer, terminal]);

  const handleMpSubmit = () => {
    if (!mpState || !mpBoard || !myTurn || selectedCell == null) return;
    const occupant = mpState.board[selectedCell];
    // claim: an empty cell; steal: an opponent cell with steals remaining.
    if (!stealMode && occupant) return;
    if (stealMode && (!occupant || occupant.ownerUid === selfUid || myStealsLeft <= 0)) return;
    const p = findPlayer(guess);
    setGuess("");
    if (!p) {
      flashPopup("Not in our player index", "var(--muted)");
      return;
    }
    if (stealMode && occupant && normalizeAnswer(occupant.playerName) === normalizeAnswer(p.full_name)) {
      flashPopup("Name a different player to steal", "var(--muted)");
      return;
    }
    // Local pre-check is UX only — the server re-validates (authoritative).
    const rowCrit = mpBoard.rows[Math.floor(selectedCell / 3)];
    const colCrit = mpBoard.cols[selectedCell % 3];
    if (players.length && !(playerMatches(p, rowCrit) && playerMatches(p, colCrit))) {
      flashPopup(`${p.full_name} doesn't fit`, "var(--bad)");
      return;
    }
    const action: TttAction = { type: stealMode ? "steal" : "claim", cell: selectedCell, playerName: p.full_name };
    onTurnAction?.(action);
    flashPopup("Sent…", "var(--muted)");
  };

  // ===================== RENDER =====================

  // ---- Multiplayer duel ----
  if (isMultiplayer) {
    if (!mpState || !mpBoard) return <CourtLoader label="Waiting for the match…" />;
    const winnerIsMe = mpState.winnerUid === selfUid;
    return (
      <div className="ttt-wrap">
        <div className="ttt-head">
          <span className={`ttt-turnpill${myTurn ? " is-you" : ""}`}>
            {terminal ? "Final" : myTurn ? "Your turn" : "Opponent's turn"}
          </span>
          <span
            className="ttt-clock tnum"
            role="timer"
            aria-label={`${mpSecondsLeft} seconds left`}
            data-low={mpSecondsLeft <= 5 || undefined}
          >
            0:{String(mpSecondsLeft).padStart(2, "0")}
          </span>
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
            Steal <span className="tnum">x{myStealsLeft}</span>
          </button>
        </div>

        <div className="ttt-grid" role="grid" aria-label="Tic-tac-toe duel board">
          <span className="ttt-corner" aria-hidden="true" />
          {mpBoard.cols.map((c, i) => (
            <span key={`c${i}`} className="ttt-crit ttt-crit--col">
              {c.label}
            </span>
          ))}
          {mpBoard.rows.map((r, ri) => (
            <div key={`r${ri}`} className="ttt-rowgroup" role="row">
              <span className="ttt-crit ttt-crit--row">{r.label}</span>
              {[0, 1, 2].map((ci) => {
                const cell = ri * 3 + ci;
                const occ = mpState.board[cell];
                const mine = occ?.ownerUid === selfUid;
                const selectable = myTurn && !terminal && (stealMode ? !!occ && !mine : !occ);
                const selected = selectedCell === cell;
                return (
                  <button
                    key={cell}
                    type="button"
                    role="gridcell"
                    className={`ttt-cell${mine ? " is-mine" : occ ? " is-theirs" : ""}${
                      selected ? " is-selected" : ""
                    }${stealMode && selectable ? " is-stealable" : ""}`}
                    disabled={!selectable}
                    aria-label={`${r.label} and ${mpBoard.cols[ci].label}${occ ? `: ${occ.playerName}` : ""}`}
                    onClick={() => setSelectedCell(selected ? null : cell)}
                  >
                    {occ ? (
                      <span className="ttt-cell-name">{occ.playerName}</span>
                    ) : (
                      <span className="ttt-cell-blank" aria-hidden="true" />
                    )}
                  </button>
                );
              })}
            </div>
          ))}
        </div>

        {terminal && (
          <div
            className={`ttt-banner${mpState.draw ? "" : winnerIsMe ? " is-win" : " is-loss"}`}
            role="status"
          >
            <span className="font-display">
              {mpState.draw ? "Draw!" : winnerIsMe ? "You win!" : "Opponent wins"}
            </span>
          </div>
        )}

        <div className="ttt-inputrow">
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
          <Button
            size="sm"
            aria-label="Confirm move"
            onClick={handleMpSubmit}
            disabled={!myTurn || terminal || selectedCell == null || guess.trim() === ""}
          >
            {stealMode ? "Steal" : "Claim"}
          </Button>
        </div>

        <SubmitGuessPopup show={showPopup} text={popUpInfo.Text} color={popUpInfo.Color} />
      </div>
    );
  }

  // ---- Solo: loading / empty / error states ----
  if (!board) return <p style={{ color: "var(--muted)" }}>No board available.</p>;
  if (pool.status === "loading") return <CourtLoader />;
  if (pool.status === "error")
    return (
      <div className="ttt-fetchfail">
        <p>{pool.message}</p>
        <Button
          size="sm"
          onClick={() => {
            setPool({ status: "loading" });
            fetchWholePool("players-index").then((res) => {
              if (res.success && res.data) setPool({ status: "ready", players: res.data as PlayerIndexEntry[] });
              else setPool({ status: "error", message: res.error?.message ?? "Couldn't load players." });
            });
          }}
        >
          Retry
        </Button>
      </div>
    );

  // ---- Solo board ----
  return (
    <div className="ttt-wrap">
      <div className="ttt-head">
        <span
          className="ttt-clock tnum"
          role="timer"
          aria-label={`${soloSecondsLeft} seconds left`}
          data-low={soloSecondsLeft <= 30 || undefined}
        >
          {Math.floor(soloSecondsLeft / 60)}:{String(soloSecondsLeft % 60).padStart(2, "0")}
        </span>
        <span className="ttt-score tnum">{soloScore} / 225</span>
      </div>

      <div className="ttt-grid" role="grid" aria-label="Tic-tac-toe criteria board">
        <span className="ttt-corner" aria-hidden="true" />
        {board.cols.map((c, i) => (
          <span key={`c${i}`} className="ttt-crit ttt-crit--col">
            {c.label}
          </span>
        ))}
        {board.rows.map((r, ri) => (
          <div key={`r${ri}`} className="ttt-rowgroup" role="row">
            <span className="ttt-crit ttt-crit--row">{r.label}</span>
            {[0, 1, 2].map((ci) => {
              const cell = ri * 3 + ci;
              const name = solved[cell];
              const selected = selectedCell === cell;
              return (
                <motion.button
                  key={cell}
                  type="button"
                  role="gridcell"
                  className={`ttt-cell${name ? " is-mine" : ""}${selected ? " is-selected" : ""}`}
                  disabled={!!name || finished}
                  aria-label={`${r.label} and ${board.cols[ci].label}${name ? `: ${name}` : ""}`}
                  onClick={() => setSelectedCell(selected ? null : cell)}
                  animate={reduce ? undefined : { scale: name ? [1, 1.06, 1] : 1 }}
                  transition={{ duration: 0.3 }}
                >
                  {name ? (
                    <span className="ttt-cell-name">{name}</span>
                  ) : (
                    <span className="ttt-cell-blank" aria-hidden="true" />
                  )}
                </motion.button>
              );
            })}
          </div>
        ))}
      </div>

      <div className="ttt-inputrow">
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
          size="sm"
          aria-label="Confirm player"
          onClick={handleSoloSubmit}
          disabled={finished || selectedCell == null || guess.trim() === ""}
        >
          Confirm
        </Button>
      </div>

      <SubmitGuessPopup show={showPopup} text={popUpInfo.Text} color={popUpInfo.Color} />
    </div>
  );
}

export default TicTacToe;
