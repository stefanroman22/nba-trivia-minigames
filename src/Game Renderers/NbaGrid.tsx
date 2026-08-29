import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import SubmitGuessPopup from "../components/SubmitGuessPopUp";
import AutocompleteInput from "../components/AutoCompleteInput";
import { Button, GameFrame, ProgressBar, Spinner } from "../components/ui";
import { BACKEND_ORIGIN } from "../configurations/backend";
import { apiFetch } from "../utils/Api";
import { fetchWholePool } from "../utils/pool";
import { playerMatches } from "../utils/criteria";
import { matchAnswer, normalizeAnswer } from "../utils/answerMatch";
import type { Criterion, GridConfig, OnGameEnd, PlayerIndexEntry } from "../types/types";
import "../styles/NbaGrid.css";

export interface NbaGridProps {
  gameInfo: GridConfig[];
  onGameEnd: OnGameEnd;
  onPlayAgain?: () => void;
  onClose?: () => void;
  turn?: unknown;
  onTurnAction?: (a: unknown) => void;
  multiplayer?: boolean;
}

type Phase = "loading" | "error" | "empty" | "playing" | "finished";
interface CellState { name: string }
interface GuessEntry { question_id: string; answer: string; correct: boolean; elapsed_ms: number }
type Tally = Record<string, Record<string, number>>;

const TOTAL_GUESSES = 9;
const POINTS_PER_CELL = 30;
const MAX_POINTS = POINTS_PER_CELL * 9;
const RARITY_MIN = 20;
const cellKey = (r: number, c: number) => `r${r}c${c}`;

const fetchTally = (qid: string): Promise<Tally> =>
  fetch(`${BACKEND_ORIGIN}/trivia/nba-grid/tally/?qid=${encodeURIComponent(qid)}`)
    .then((r) => (r.ok ? (r.json() as Promise<Tally>) : {}))
    .catch(() => ({}));

export default function NbaGrid({ gameInfo, onGameEnd, onPlayAgain, onClose }: NbaGridProps) {
  const [phase, setPhase] = useState<Phase>("loading");
  const [players, setPlayers] = useState<PlayerIndexEntry[]>([]);
  const [solved, setSolved] = useState<Record<string, CellState>>({});
  const [guessesLeft, setGuessesLeft] = useState(TOTAL_GUESSES);
  const [activeCell, setActiveCell] = useState<{ r: number; c: number } | null>(null);
  const [detailCell, setDetailCell] = useState<{ r: number; c: number } | null>(null);
  const [entry, setEntry] = useState("");
  const [popup, setPopup] = useState({ Text: "", Color: "" });
  const [showPopup, setShowPopup] = useState(false);
  const [tally, setTally] = useState<Tally>({});
  const [finalScore, setFinalScore] = useState(0);
  const [reloadKey, setReloadKey] = useState(0);

  const usedNamesRef = useRef<Set<string>>(new Set());
  const solvedRef = useRef<Record<string, CellState>>({});
  const guessLogRef = useRef<GuessEntry[]>([]);
  const startRef = useRef(Date.now());
  const endedRef = useRef(false); // onGameEnd fired once
  const overRef = useRef(false); // finished reached once
  const timersRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  const reduce = useReducedMotion();

  const config = gameInfo && gameInfo.length > 0 ? gameInfo[0] : null;
  const configRef = useRef(config);
  configRef.current = config;
  const playersRef = useRef(players);
  playersRef.current = players;

  const later = (fn: () => void, ms: number) => {
    timersRef.current.push(setTimeout(fn, ms));
  };
  const clearTimers = () => {
    timersRef.current.forEach(clearTimeout);
    timersRef.current = [];
  };

  // Fire-and-forget guess log (the flywheel); flushed at game end AND on unmount.
  const sendGuessLog = () => {
    const entries = guessLogRef.current;
    guessLogRef.current = [];
    if (!entries.length) return;
    apiFetch(`${BACKEND_ORIGIN}/trivia/log-guesses/`, {
      method: "POST",
      body: JSON.stringify({ game: "nba-grid", entries }),
    }).catch(() => { /* analytics only */ });
  };

  // Fetch the validation pool once (cache-hot on replays); Retry bumps reloadKey.
  useEffect(() => {
    let alive = true;
    setPhase("loading");
    fetchWholePool("players-index").then((res) => {
      if (!alive) return;
      if (!res.success || !res.data) {
        setPhase("error");
        return;
      }
      setPlayers(res.data as PlayerIndexEntry[]);
      setPhase(configRef.current ? "playing" : "empty");
    });
    return () => {
      alive = false;
    };
  }, [reloadKey]);

  // Fresh state whenever a new grid loads (e.g. play-again).
  useEffect(() => {
    clearTimers();
    setSolved({});
    solvedRef.current = {};
    setGuessesLeft(TOTAL_GUESSES);
    setActiveCell(null);
    setDetailCell(null);
    setEntry("");
    setShowPopup(false);
    setTally({});
    setFinalScore(0);
    endedRef.current = false;
    overRef.current = false;
    usedNamesRef.current = new Set();
    guessLogRef.current = [];
    startRef.current = Date.now();
    if (playersRef.current.length > 0) setPhase(configRef.current ? "playing" : "empty");
  }, [gameInfo]);

  // Unmount: cancel pending work AND flush any unsent guesses (abandoned
  // sessions feed the flywheel). Never calls onGameEnd after unmount.
  useEffect(() => {
    return () => {
      clearTimers();
      sendGuessLog();
    };
  }, []);

  // Pull the community rarity tally once the grid is over (graceful: {} => "be the first").
  useEffect(() => {
    if (phase !== "finished" || !configRef.current) return;
    let alive = true;
    fetchTally(configRef.current.qid).then((t) => {
      if (alive) setTally(t);
    });
    return () => {
      alive = false;
    };
  }, [phase]);

  const answerList = useMemo(
    () => players.map((p) => ({ answer: p.full_name, aliases: p.aliases })),
    [players],
  );
  const suggestions = useMemo(() => players.map((p) => p.full_name), [players]);

  const resolveEntry = (raw: string): PlayerIndexEntry | null => {
    const idx = matchAnswer(raw, answerList);
    return idx >= 0 ? players[idx] : null;
  };

  const flash = (Text: string, Color: string) => {
    setPopup({ Text, Color });
    setShowPopup(true);
    later(() => setShowPopup(false), 1400);
  };

  // The grid stays in place at the end (spec §7b): the breakdown strip IS the
  // end screen, so points are awarded the moment the grid finishes.
  const finish = () => {
    if (overRef.current) return;
    overRef.current = true;
    const cells = Object.keys(solvedRef.current).length;
    const score = POINTS_PER_CELL * cells;
    setFinalScore(score);
    setActiveCell(null);
    setEntry("");
    setDetailCell({ r: 0, c: 0 });
    setPhase("finished");
    sendGuessLog();
    if (endedRef.current) return;
    endedRef.current = true;
    onGameEnd?.(score, { inPlace: true });
  };

  const openCell = (r: number, c: number) => {
    if (overRef.current || phase !== "playing") return;
    if (solved[cellKey(r, c)]) return;
    setActiveCell({ r, c });
    setEntry("");
  };

  const submitGuess = (rawValue?: string) => {
    if (overRef.current || phase !== "playing" || !activeCell || !config) return;
    const { r, c } = activeCell;
    const key = cellKey(r, c);
    if (solved[key]) {
      setActiveCell(null);
      return;
    }
    const raw = (rawValue ?? entry).trim();
    if (!raw) return;
    setEntry("");

    const matched = resolveEntry(raw);
    if (!matched) {
      flash("No player by that name", "var(--muted)"); // typo: costs nothing
      return;
    }

    const norm = normalizeAnswer(matched.full_name);
    if (usedNamesRef.current.has(norm)) {
      flash("Already used on this grid", "var(--muted)"); // costs nothing
      return;
    }

    const ok =
      playerMatches(matched, config.rows[r]) && playerMatches(matched, config.cols[c]);
    guessLogRef.current.push({
      question_id: `${config.qid}:${key}`,
      answer: matched.full_name,
      correct: ok,
      elapsed_ms: Date.now() - startRef.current,
    });

    if (ok) {
      usedNamesRef.current.add(norm);
      const next = { ...solved, [key]: { name: matched.full_name } };
      setSolved(next);
      solvedRef.current = next;
      setActiveCell(null);
      if (Object.keys(next).length === 9) {
        flash("Immaculate! +30", "var(--good)");
        later(finish, 750);
        return;
      }
      flash(`Correct! +${POINTS_PER_CELL}`, "var(--good)");
      return;
    }

    // Wrong real player burns one guess; the cell stays open.
    const left = guessesLeft - 1;
    setGuessesLeft(left);
    flash("Doesn't fit that cell", "var(--bad)");
    if (left <= 0) {
      setActiveCell(null);
      later(finish, 750);
    }
  };

  const exampleAnswers = (rc: Criterion, cc: Criterion): string[] =>
    players
      .filter((p) => playerMatches(p, rc) && playerMatches(p, cc))
      .sort((a, b) => a.fame_tier - b.fame_tier)
      .slice(0, 3)
      .map((p) => p.full_name);

  const rarityNote = (cell: string, pick: string): { total: number; pct: number } => {
    const counts = tally[cell] || {};
    const total = Object.values(counts).reduce((a, b) => a + b, 0);
    const pct = total > 0 ? Math.round(((counts[pick] || 0) / total) * 100) : 0;
    return { total, pct };
  };

  // ---- States: loading / error / empty ----
  if (phase === "loading") {
    return <Spinner label="Drawing the grid…" />;
  }
  if (phase === "error") {
    return (
      <div className="ng-state">
        <p className="ng-state-msg">Couldn’t load the player list.</p>
        <Button size="sm" onClick={() => setReloadKey((k) => k + 1)}>
          Retry
        </Button>
      </div>
    );
  }
  if (phase === "empty" || !config) {
    return <p className="ng-state-msg">No grid available. Please try again later.</p>;
  }

  const solvedCount = Object.keys(solved).length;
  const finished = phase === "finished";

  // Detail data for the finished breakdown strip.
  let detail: {
    label: string;
    pick: string | null;
    examples: string[];
    total: number;
    pct: number;
  } | null = null;
  if (finished && detailCell) {
    const { r, c } = detailCell;
    const key = cellKey(r, c);
    const pick = solved[key]?.name ?? null;
    const rn = pick ? rarityNote(key, pick) : { total: 0, pct: 0 };
    detail = {
      label: `${config.rows[r].label} × ${config.cols[c].label}`,
      pick,
      examples: exampleAnswers(config.rows[r], config.cols[c]),
      total: rn.total,
      pct: rn.pct,
    };
  }

  return (
    <GameFrame>
      {/* Status: what you're doing + solved count, with the guesses meter on the
          right until the grid is over, when the final score takes that slot. */}
      <GameFrame.Status
        left={
          <>
            <GameFrame.Label>FILL THE GRID</GameFrame.Label>
            {!finished && <span className="ng-solved tnum">{solvedCount}/9</span>}
          </>
        }
        right={
          finished ? (
            <>
              <GameFrame.Score value={finalScore} />
              <span className="ng-score-max tnum">/ {MAX_POINTS} pts</span>
            </>
          ) : (
            <span className={`ng-meter${guessesLeft <= 2 ? " is-low" : ""}`}>
              <span className="ng-meter-label">GUESSES</span>
              <span className="ng-meter-num tnum">{guessesLeft}/{TOTAL_GUESSES}</span>
            </span>
          )
        }
      />

      {/* Progress — spec §5: always the root's 2nd child, full width */}
      <ProgressBar value={guessesLeft} max={TOTAL_GUESSES} />

      {/* Board: 4x4 (blank corner + 3 col chips + 3 row chips + 9 cells) */}
      <GameFrame.Board>
      <div className="ng-board" role="grid" aria-label="Immaculate grid">
        <div className="ng-corner" aria-hidden="true" />
        {config.cols.map((c, i) => (
          <div key={`col-${i}`} className="ng-head-cell ng-col-head">{c.label}</div>
        ))}

        {config.rows.map((rowC, r) => (
          <div key={`row-${r}`} className="ng-board-row" style={{ display: "contents" }}>
            <div className="ng-head-cell ng-row-head">{rowC.label}</div>
            {config.cols.map((colC, c) => {
              const key = cellKey(r, c);
              const cell = solved[key];
              const isActive = !finished && activeCell?.r === r && activeCell?.c === c;
              const isDetail = finished && detailCell?.r === r && detailCell?.c === c;
              const missed = finished && !cell;
              const cls =
                "ng-cell" +
                (cell ? " is-solved" : "") +
                (isActive ? " is-active" : "") +
                (missed ? " is-missed" : "") +
                (isDetail ? " is-detail" : "");
              return (
                <button
                  key={key}
                  type="button"
                  className={cls}
                  onClick={() => (finished ? setDetailCell({ r, c }) : openCell(r, c))}
                  aria-label={
                    `${rowC.label} and ${colC.label}: ` +
                    (cell ? cell.name : missed ? "not solved" : "empty, tap to answer")
                  }
                >
                  {cell ? (
                    <>
                      <svg className="ng-check" viewBox="0 0 24 24" aria-hidden="true">
                        <path d="M5 12.5l4.5 4.5L19 7" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                      <span className="ng-cell-name">{cell.name}</span>
                    </>
                  ) : missed ? (
                    <span className="ng-cell-plus" aria-hidden="true">—</span>
                  ) : (
                    <span className="ng-cell-plus" aria-hidden="true">+</span>
                  )}
                </button>
              );
            })}
          </div>
        ))}
      </div>
      </GameFrame.Board>

      {/* Bottom region — stable min-height so reveals never shift the board */}
      <GameFrame.Action>
      <div className="ng-bottom">
        <AnimatePresence mode="wait" initial={false}>
          {finished && detail ? (
            <motion.div
              key="summary"
              className="ng-detail"
              initial={reduce ? undefined : { opacity: 0, y: 8 }}
              animate={reduce ? undefined : { opacity: 1, y: 0 }}
              exit={reduce ? undefined : { opacity: 0, y: -8 }}
              transition={{ duration: 0.2 }}
            >
              <div className="ng-detail-head font-display">{detail.label}</div>
              <div className="ng-detail-pick">
                {detail.pick ? (
                  <>Your pick: <span className="ng-pick">{detail.pick}</span></>
                ) : (
                  <span className="ng-miss">You didn’t solve this cell</span>
                )}
              </div>
              <div className="ng-detail-ex">
                {detail.examples.length > 0
                  ? <>e.g. {detail.examples.join(", ")}</>
                  : "No sample answers"}
              </div>
              <div className="ng-detail-rarity">
                {detail.pick && detail.total >= RARITY_MIN ? (
                  <><span className="tnum">{detail.pct}%</span> picked this</>
                ) : (
                  "Be the first — community stats build as people play."
                )}
              </div>
              {(onPlayAgain || onClose) && (
                <div className="ng-detail-actions">
                  {onPlayAgain && <Button size="sm" onClick={onPlayAgain}>Play again</Button>}
                  {onClose && <Button size="sm" variant="secondary" onClick={onClose}>Close game</Button>}
                </div>
              )}
            </motion.div>
          ) : activeCell ? (
            <motion.div
              key="dock"
              className="ng-dock"
              initial={reduce ? undefined : { opacity: 0, y: 8 }}
              animate={reduce ? undefined : { opacity: 1, y: 0 }}
              exit={reduce ? undefined : { opacity: 0, y: -8 }}
              transition={{ duration: 0.2 }}
            >
              <div className="ng-dock-hint">
                {config.rows[activeCell.r].label} <span className="ng-x">×</span> {config.cols[activeCell.c].label}
              </div>
              <GameFrame.InputRow>
                <AutocompleteInput
                  placeholder="Name a player…"
                  value={entry}
                  setValue={setEntry}
                  suggestions={suggestions}
                  onSubmit={(v) => submitGuess(v)}
                  customStyleInput={{ width: "100%", maxWidth: "100%", height: "44px", fontSize: "0.9rem" }}
                />
                <Button size="sm" onClick={() => submitGuess()} disabled={entry.trim() === ""}>
                  Place
                </Button>
              </GameFrame.InputRow>
            </motion.div>
          ) : (
            <motion.div
              key="hint"
              className="ng-hintbar"
              initial={reduce ? undefined : { opacity: 0 }}
              animate={reduce ? undefined : { opacity: 1 }}
              exit={reduce ? undefined : { opacity: 0 }}
              transition={{ duration: 0.2 }}
            >
              <span className="ng-hint">Tap a cell to make your pick</span>
              <button type="button" className="ng-finish" onClick={finish}>
                Finish grid →
              </button>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
      </GameFrame.Action>

      <SubmitGuessPopup show={showPopup} text={popup.Text} color={popup.Color} />
    </GameFrame>
  );
}
