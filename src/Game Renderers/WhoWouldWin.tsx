import { useEffect, useRef, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { Button, CourtLoader } from "../components/ui";
import { BACKEND_ORIGIN } from "../configurations/backend";
import { apiFetch } from "../utils/Api";
import type { WwwMatchup, OnGameEnd } from "../types/types";
import "../styles/WhoWouldWin.css";

export interface WhoWouldWinProps {
  gameInfo: WwwMatchup[];
  onGameEnd: OnGameEnd;
  turn?: unknown;
  onTurnAction?: (a: unknown) => void;
  multiplayer?: boolean;
}

type Side = "a" | "b";

interface Tally {
  qid: string;
  a: number;
  b: number;
  total: number;
}

interface PickRecord {
  qid: string;
  choice: Side;
  /** true = voted with the majority (ties count as with); null = tally unavailable. */
  agreed: boolean | null;
}

/** Below this many total votes the split shows an "early votes" note. */
const EARLY_VOTES = 10;

export default function WhoWouldWin({ gameInfo, onGameEnd }: WhoWouldWinProps) {
  const [idx, setIdx] = useState(0);
  const [picked, setPicked] = useState<Side | null>(null);
  const [tally, setTally] = useState<Tally | null>(null);
  const [tallyLoading, setTallyLoading] = useState(false);
  const [tallyError, setTallyError] = useState(false);
  const [showSummary, setShowSummary] = useState(false);
  const picksRef = useRef<PickRecord[]>([]);
  const endedRef = useRef(false);
  // Bumped on reset/unmount so in-flight fetches can never setState (or worse,
  // record picks) into a new session — the async twin of the timersRef pattern.
  const sessionRef = useRef(0);
  const startRef = useRef(Date.now());
  const reduce = useReducedMotion();

  // Fresh state whenever a new matchup set loads (e.g. play-again).
  useEffect(() => {
    sessionRef.current += 1;
    setIdx(0);
    setPicked(null);
    setTally(null);
    setTallyLoading(false);
    setTallyError(false);
    setShowSummary(false);
    picksRef.current = [];
    endedRef.current = false;
    startRef.current = Date.now();
  }, [gameInfo]);

  // Unmount: invalidate in-flight fetches.
  useEffect(() => {
    return () => {
      sessionRef.current += 1;
    };
  }, []);

  const matchup = gameInfo && gameInfo.length > 0 ? gameInfo[idx] : null;

  const fetchTally = async (qid: string, side: Side) => {
    const sess = sessionRef.current;
    setTallyLoading(true);
    setTallyError(false);
    try {
      const res = await fetch(
        `${BACKEND_ORIGIN}/trivia/who-would-win/tally/?qid=${encodeURIComponent(qid)}`,
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const t = (await res.json()) as Tally;
      if (sess !== sessionRef.current) return;
      const mine = side === "a" ? t.a : t.b;
      const other = side === "a" ? t.b : t.a;
      const rec = picksRef.current[picksRef.current.length - 1];
      if (rec && rec.qid === qid) rec.agreed = mine >= other;
      setTally(t);
      setTallyLoading(false);
    } catch {
      if (sess !== sessionRef.current) return;
      setTallyLoading(false);
      setTallyError(true);
    }
  };

  const handlePick = (side: Side) => {
    if (picked || !matchup || showSummary) return;
    setPicked(side);
    picksRef.current.push({ qid: matchup.qid, choice: side, agreed: null });
    const elapsed = Date.now() - startRef.current;
    // Vote through the flywheel first, THEN read the tally so your own vote is
    // part of the split you see. Logging is best-effort — a failed POST still
    // shows the community numbers.
    apiFetch(`${BACKEND_ORIGIN}/trivia/log-guesses/`, {
      method: "POST",
      body: JSON.stringify({
        game: "who-would-win",
        entries: [
          { question_id: matchup.qid, answer: side, correct: false, elapsed_ms: elapsed },
        ],
      }),
    })
      .catch(() => {
        /* analytics only */
      })
      .finally(() => {
        void fetchTally(matchup.qid, side);
      });
  };

  const handleNext = () => {
    if (!picked) return;
    if (idx + 1 >= gameInfo.length) {
      setShowSummary(true);
      return;
    }
    setIdx(idx + 1);
    setPicked(null);
    setTally(null);
    setTallyError(false);
    startRef.current = Date.now();
  };

  // GAME END CONTRACT: exactly once, and only after the summary screen.
  const handleFinish = () => {
    if (endedRef.current) return;
    endedRef.current = true;
    onGameEnd?.(0);
  };

  // Empty state (pool missing / filtered out upstream).
  if (!matchup && !showSummary)
    return <p className="www-empty">No matchups available. Please try again later.</p>;

  // ===== Summary screen (shown BEFORE onGameEnd fires) =====
  if (showSummary) {
    const picks = picksRef.current;
    const agreedCount = picks.filter((p) => p.agreed === true).length;
    return (
      <div className="www-wrap">
        <motion.div
          className="www-summary"
          initial={reduce ? false : { opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35 }}
        >
          <span className="www-eyebrow">Debate settled</span>
          <h2 className="www-summary-title font-display">
            You sided with the crowd{" "}
            <span className="tnum">
              {agreedCount}/{picks.length}
            </span>
          </h2>
          <div className="www-summary-list">
            {picks.map((p, i) => {
              const m = gameInfo[i];
              if (!m) return null;
              const yours = p.choice === "a" ? m.a.label : m.b.label;
              const crowd =
                p.agreed === null
                  ? "split unknown"
                  : p.agreed
                    ? "with the crowd"
                    : `crowd took ${p.choice === "a" ? m.b.label : m.a.label}`;
              return (
                <div
                  key={p.qid}
                  className={`www-summary-row${p.agreed ? " is-agreed" : ""}`}
                >
                  <span className="www-summary-num tnum">{i + 1}</span>
                  <span className="www-summary-pick">{yours}</span>
                  <span className="www-summary-crowd">{crowd}</span>
                </div>
              );
            })}
          </div>
          <Button size="md" onClick={handleFinish}>
            Finish
          </Button>
        </motion.div>
      </div>
    );
  }

  const sideCard = (side: Side, m: WwwMatchup) => {
    const info = side === "a" ? m.a : m.b;
    const isMine = picked === side;
    const votes = tally ? (side === "a" ? tally.a : tally.b) : 0;
    const pct = tally && tally.total > 0 ? Math.round((votes / tally.total) * 100) : 0;
    return (
      <button
        type="button"
        className={`www-card${isMine ? " is-mine" : ""}${picked && !isMine ? " is-other" : ""}`}
        onClick={() => handlePick(side)}
        disabled={!!picked}
        aria-label={`Vote ${info.label}`}
      >
        <span className="www-card-label font-display">{info.label}</span>
        <span className="www-card-sub">{info.sub ?? ""}</span>
        {/* Fixed-height split area — reserved before the vote, no layout shift */}
        <span className="www-split">
          {tally && (
            <>
              <span className="www-bar-track" aria-hidden="true">
                <motion.span
                  className={`www-bar-fill${isMine ? " is-mine" : ""}`}
                  initial={reduce ? { width: `${pct}%` } : { width: "0%" }}
                  animate={{ width: `${pct}%` }}
                  transition={{ duration: 0.6, ease: "easeOut" }}
                />
              </span>
              <span className="www-split-nums tnum">
                {pct}% · {votes} {votes === 1 ? "vote" : "votes"}
              </span>
            </>
          )}
        </span>
      </button>
    );
  };

  return (
    <div className="www-wrap">
      <div className="www-head">
        <span className="www-eyebrow">Who would win?</span>
        <span className="www-progress tnum">
          Matchup {idx + 1} / {gameInfo.length}
        </span>
      </div>

      <div className="www-arena">
        {sideCard("a", matchup as WwwMatchup)}
        <span className="www-vs font-display" aria-hidden="true">
          VS
        </span>
        {sideCard("b", matchup as WwwMatchup)}
      </div>

      {/* Status line: hint → loader → early-votes note / error+retry */}
      <div className="www-status" aria-live="polite">
        {!picked && <span className="www-status-text">Tap a side to cast your vote.</span>}
        {picked && tallyLoading && <CourtLoader label="Counting votes…" />}
        {picked && !tallyLoading && tallyError && (
          <>
            <span className="www-status-text">Couldn't load the community split.</span>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => fetchTally((matchup as WwwMatchup).qid, picked)}
            >
              Retry
            </Button>
          </>
        )}
        {picked && !tallyLoading && !tallyError && tally && tally.total < EARLY_VOTES && (
          <span className="www-status-text">Early votes — small sample so far.</span>
        )}
      </div>

      <div className="www-foot">
        <Button size="md" block onClick={handleNext} disabled={!picked || tallyLoading}>
          {idx + 1 >= gameInfo.length ? "See results" : "Next matchup"}
        </Button>
      </div>
    </div>
  );
}
