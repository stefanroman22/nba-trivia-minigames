import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import SubmitGuessPopup from "../components/SubmitGuessPopUp";
import { Button, CourtLoader } from "../components/ui";
import { BACKEND_ORIGIN } from "../configurations/backend";
import { apiFetch } from "../utils/Api";
import type { ConnectionsBoard, OnGameEnd } from "../types/types";
import "../styles/ConnectionsGame.css";

export interface ConnectionsGameProps {
  gameInfo: ConnectionsBoard[];
  onGameEnd: OnGameEnd;
  turn?: unknown;
  onTurnAction?: (a: unknown) => void;
  multiplayer?: boolean;
}

const POINTS_PER_GROUP = 50; // 4 groups -> 200 max
const START_HEARTS = 5;

// Spec-mandated difficulty tiers (orange family only). --tier-ink is picked per
// tier so label contrast stays >= 4.5:1 on both the lightest and darkest fill.
const TIER_COLOR: Record<number, string> = {
  1: "#ffb347", 2: "#ff8a3d", 3: "var(--brand)", 4: "#c2510a",
};
const TIER_INK: Record<number, string> = {
  1: "#1a1206", 2: "#1a1206", 3: "#1a1206", 4: "#fff2e6",
};

const same = (a: string[], b: string[]) => {
  if (a.length !== b.length) return false;
  const sb = new Set(b);
  return a.every((x) => sb.has(x));
};

// Returns the exactly-matched unsolved group index (-1 if none) plus the best
// overlap with any unsolved group, so the caller can surface "One away!" at 3/4.
function evaluateGuess(
  picked: string[],
  groups: ConnectionsBoard["groups"],
  solvedIdx: Set<number>,
): { matchIdx: number; bestOverlap: number } {
  let matchIdx = -1;
  let bestOverlap = 0;
  groups.forEach((g, i) => {
    if (solvedIdx.has(i)) return;
    const overlap = picked.filter((p) => g.members.includes(p)).length;
    if (overlap > bestOverlap) bestOverlap = overlap;
    if (overlap === 4 && same(picked, g.members)) matchIdx = i;
  });
  return { matchIdx, bestOverlap };
}

const shuffle = (arr: string[]) => {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};

interface SolvedGroup { idx: number; label: string; difficulty: number; members: string[]; }
interface GuessEntry { question_id: string; answer: string; correct: boolean; elapsed_ms: number; }

function ConnectionsGame({ gameInfo, onGameEnd, multiplayer }: ConnectionsGameProps) {
  const board = gameInfo && gameInfo.length > 0 ? gameInfo[0] : null;

  const [order, setOrder] = useState<string[]>([]);
  const [solved, setSolved] = useState<SolvedGroup[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [hearts, setHearts] = useState(START_HEARTS);
  const [finished, setFinished] = useState(false);
  const [popup, setPopup] = useState({ show: false, text: "", color: "" });

  const timersRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  const guessLogRef = useRef<GuessEntry[]>([]);
  const startRef = useRef(Date.now());
  const endedRef = useRef(false);
  const reduce = useReducedMotion();

  const later = (fn: () => void, ms: number) => { timersRef.current.push(setTimeout(fn, ms)); };
  const clearTimers = () => { timersRef.current.forEach(clearTimeout); timersRef.current = []; };

  // Fire-and-forget guess log (the data flywheel). apiFetch adds the JWT only
  // when one exists, so guests log anonymously and it never blocks the game.
  const sendGuessLog = () => {
    const entries = guessLogRef.current;
    guessLogRef.current = [];
    if (!entries.length) return;
    apiFetch(`${BACKEND_ORIGIN}/trivia/log-guesses/`, {
      method: "POST",
      body: JSON.stringify({ game: "connections", entries }),
    }).catch(() => { /* analytics only */ });
  };

  // Fresh state whenever a new board loads (play-again / next round).
  useEffect(() => {
    clearTimers();
    setOrder(board ? shuffle(board.tiles) : []);
    setSolved([]);
    setSelected([]);
    setHearts(START_HEARTS);
    setFinished(false);
    setPopup({ show: false, text: "", color: "" });
    guessLogRef.current = [];
    endedRef.current = false;
    startRef.current = Date.now();
  }, [board]);

  // Unmount: cancel pending timers + flush guess log (abandoned rounds still feed the flywheel).
  useEffect(() => () => { clearTimers(); sendGuessLog(); }, []);

  const flash = (text: string, color: string) => {
    setPopup({ show: true, text, color });
    later(() => setPopup((p) => ({ ...p, show: false })), 1500);
  };

  const toggleTile = (name: string) => {
    if (finished) return;
    setSelected((prev) => {
      if (prev.includes(name)) return prev.filter((n) => n !== name);
      if (prev.length >= 4) return prev; // hard cap at 4
      return [...prev, name];
    });
  };

  // onGameEnd exactly once (endedRef guard + timersRef cleared on unmount/reset).
  const endGame = (solvedCount: number) => {
    if (endedRef.current) return;
    endedRef.current = true;
    setFinished(true);
    sendGuessLog();
    later(() => onGameEnd?.(POINTS_PER_GROUP * solvedCount), 300);
  };

  const revealRemaining = (currentSolved: SolvedGroup[]) => {
    if (!board) return;
    // Hearts exhausted: reveal every still-unsolved group as a muted bar, in
    // difficulty order, then end with the score for what the player DID solve.
    const solvedIdxSet = new Set(currentSolved.map((s) => s.idx));
    const remaining = board.groups
      .map((g, i) => ({ g, i }))
      .filter(({ i }) => !solvedIdxSet.has(i))
      .sort((a, b) => a.g.difficulty - b.g.difficulty);
    remaining.forEach(({ g, i }, k) => {
      later(() => {
        setSolved((prev) => [...prev, { idx: i, label: g.label, difficulty: g.difficulty, members: g.members, missed: true } as SolvedGroup & { missed: boolean }]);
        setOrder((prev) => prev.filter((t) => !g.members.includes(t)));
      }, 400 + k * 450);
    });
    later(() => endGame(currentSolved.length), 400 + remaining.length * 450 + 500);
  };

  const handleSubmit = () => {
    if (finished || selected.length !== 4 || !board) return;
    const solvedIdxSet = new Set(solved.map((s) => s.idx));
    const { matchIdx, bestOverlap } = evaluateGuess(selected, board.groups, solvedIdxSet);
    const elapsed = Date.now() - startRef.current;
    const picked = [...selected];

    if (matchIdx >= 0) {
      const g = board.groups[matchIdx];
      guessLogRef.current.push({ question_id: board.qid, answer: g.members.join(" | "), correct: true, elapsed_ms: elapsed });
      const nextSolved = [...solved, { idx: matchIdx, label: g.label, difficulty: g.difficulty, members: g.members }];
      setSolved(nextSolved);
      setOrder((prev) => prev.filter((t) => !g.members.includes(t)));
      setSelected([]);
      if (nextSolved.length === 4) {
        flash("Solved! Board cleared", "var(--good)");
        endGame(4);
      } else {
        flash("+50", "var(--good)");
      }
      return;
    }

    // Wrong group: -1 heart, "One away!" when exactly 3/4 belong to one unsolved group.
    guessLogRef.current.push({ question_id: board.qid, answer: picked.join(" | "), correct: false, elapsed_ms: elapsed });
    const nextHearts = hearts - 1;
    setHearts(nextHearts);
    setSelected([]);
    if (nextHearts <= 0) {
      flash("Out of hearts", "var(--bad)");
      revealRemaining(solved);
    } else {
      flash(bestOverlap === 3 ? "One away!" : "Not a group", "var(--bad)");
    }
  };

  if (!board) {
    return <div className="cn-wrap"><CourtLoader label="Loading board…" /></div>;
  }
  if (!board.tiles || board.tiles.length !== 16 || !board.groups || board.groups.length !== 4) {
    return <div className="cn-wrap"><p className="cn-note">This board is unavailable. Please try another round.</p></div>;
  }

  const canSubmit = !finished && selected.length === 4;

  return (
    <div className="cn-wrap">
      <div className="cn-head">
        <h2 className="cn-title font-display">NBA Connections</h2>
        <span className="cn-sub">Find four groups of four.</span>
      </div>

      {/* Hearts */}
      <div className="cn-hearts" aria-label={`${hearts} of ${START_HEARTS} hearts left`}>
        {[...Array(START_HEARTS)].map((_, i) => {
          const alive = i < hearts;
          return (
            <motion.svg
              key={i} width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"
              animate={reduce ? undefined : { scale: alive ? 1 : 0.82, rotate: alive ? 0 : [0, -14, 12, -6, 0] }}
              transition={{ duration: 0.45 }}
              fill={alive ? "var(--bad)" : "none"} stroke={alive ? "var(--bad)" : "var(--line2)"}
              strokeWidth="2" style={{ opacity: alive ? 1 : 0.55 }}
            >
              <path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.6l-1-1a5.5 5.5 0 0 0-7.8 7.8l1 1L12 21l7.8-7.6 1-1a5.5 5.5 0 0 0 0-7.8z" />
            </motion.svg>
          );
        })}
      </div>

      {/* Solved (and revealed) group bars, colored by difficulty tier */}
      {solved.length > 0 && (
        <div className="cn-solved">
          <AnimatePresence>
            {solved.map((s) => {
              const missed = (s as SolvedGroup & { missed?: boolean }).missed;
              return (
                <motion.div
                  key={s.idx}
                  className={`cn-solved-bar${missed ? " is-missed" : ""}`}
                  style={{ ["--tier" as string]: TIER_COLOR[s.difficulty], ["--tier-ink" as string]: TIER_INK[s.difficulty] }}
                  initial={reduce ? false : { opacity: 0, scale: 0.96 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ duration: 0.3 }}
                >
                  <span className="cn-solved-label">{s.label}</span>
                  <span className="cn-solved-members">{s.members.join(" · ")}</span>
                </motion.div>
              );
            })}
          </AnimatePresence>
        </div>
      )}

      {/* Remaining tiles (4-column grid; a solved row collapses into a bar above) */}
      <div className="cn-grid">
        {order.map((name) => {
          const isSel = selected.includes(name);
          return (
            <button
              key={name}
              type="button"
              className={`cn-tile${isSel ? " is-selected" : ""}`}
              onClick={() => toggleTile(name)}
              disabled={finished}
              aria-pressed={isSel}
            >
              {name}
            </button>
          );
        })}
      </div>

      {/* Controls: Deselect always; Shuffle hidden in multiplayer (spec) */}
      <div className="cn-controls">
        {!multiplayer && (
          <Button
            size="sm" variant="secondary"
            onClick={() => setOrder((prev) => shuffle(prev))}
            disabled={finished || order.length === 0}
          >
            Shuffle
          </Button>
        )}
        <Button
          size="sm" variant="secondary"
          onClick={() => setSelected([])}
          disabled={finished || selected.length === 0}
        >
          Deselect
        </Button>
        <Button size="sm" onClick={handleSubmit} disabled={!canSubmit}>
          Submit
        </Button>
      </div>

      <SubmitGuessPopup show={popup.show} text={popup.text} color={popup.color} />
    </div>
  );
}

export default ConnectionsGame;
