import { useEffect, useRef, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { Button, GameFrame, ProgressBar, Spinner } from "../components/ui";
import EndSequence, { type EndSequencePhase } from "../components/EndSequence";
import ScorePanel from "../components/ScorePanel";
import { BACKEND_ORIGIN } from "../configurations/backend";
import { apiFetch } from "../utils/Api";
// Scoring constants (WWW_POINTS_MAJORITY = 20, WWW_POINTS_MINORITY = 5) live in
// whoWouldWinPoints.ts so the node test can import them — change them there.
import { pointsFor, WWW_MAX_POINTS, WWW_POINTS_MAJORITY, WWW_POINTS_MINORITY } from "../utils/whoWouldWinPoints";
import type { WwwMatchup, OnGameEnd } from "../types/types";
import "../styles/WhoWouldWin.css";

interface WhoWouldWinProps {
  gameInfo: WwwMatchup[];
  onGameEnd: OnGameEnd;
  onPlayAgain?: () => void;
  onClose?: () => void;
}

type Side = "a" | "b";

interface Tally {
  qid: string;
  a: number;
  b: number;
  total: number;
}

type TallyMap = Record<string, Tally | "error">;

interface PickRecord {
  qid: string;
  /** null = skipped (no vote, no points). */
  choice: Side | null;
}

const TALLY_TIMEOUT_MS = 8000;
/** The end loader shows at least this long (shared end-sequence timing). */
const END_LOADER_MS = 1500;

const totalScore = (picks: PickRecord[], tallies: TallyMap) =>
  picks.reduce((sum, p) => sum + pointsFor(p.choice, tallies[p.qid]), 0);

function WhoWouldWin({ gameInfo, onGameEnd, onPlayAgain, onClose }: WhoWouldWinProps) {
  const [idx, setIdx] = useState(0);
  const [picked, setPicked] = useState<Side | null>(null);
  const [picks, setPicks] = useState<PickRecord[]>([]);
  // Community split per matchup. Absent for a picked matchup = still loading;
  // "error" = the tally request failed (play continues without a split).
  const [tallies, setTallies] = useState<TallyMap>({});
  const [phase, setPhase] = useState<EndSequencePhase>("input");
  // Tallies frozen when the game ends, so a late tally can never make the list
  // disagree with the score that was awarded.
  const [endTallies, setEndTallies] = useState<TallyMap | null>(null);
  const talliesRef = useRef<TallyMap>({});
  const pendingVotesRef = useRef<Set<Promise<void>>>(new Set());
  const endedRef = useRef(false);
  // Bumped on reset/unmount so an in-flight vote/tally can never set state
  // into a new session.
  const sessionRef = useRef(0);
  const startRef = useRef(Date.now());
  const nextRef = useRef<HTMLButtonElement>(null);
  const timersRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  const reduce = useReducedMotion();

  // All delayed work goes through these so a reset/unmount can never fire a
  // stale onGameEnd (or setState) for an abandoned game.
  const later = (fn: () => void, ms: number) => {
    timersRef.current.push(setTimeout(fn, ms));
  };
  const clearTimers = () => {
    timersRef.current.forEach(clearTimeout);
    timersRef.current = [];
  };

  // Fresh state whenever a new matchup set loads (e.g. play-again).
  useEffect(() => {
    sessionRef.current += 1;
    clearTimers();
    setIdx(0);
    setPicked(null);
    setPicks([]);
    setTallies({});
    setPhase("input");
    setEndTallies(null);
    talliesRef.current = {};
    pendingVotesRef.current = new Set();
    endedRef.current = false;
    startRef.current = Date.now();
  }, [gameInfo]);

  // Disabling the chosen card drops its focus, so hand it to Next.
  useEffect(() => {
    if (picked) nextRef.current?.focus({ preventScroll: true });
  }, [picked]);

  useEffect(() => {
    return () => {
      sessionRef.current += 1;
      clearTimers();
    };
  }, []);

  const matchup = gameInfo && gameInfo.length > 0 ? gameInfo[idx] : null;
  const total = gameInfo?.length ?? 0;
  const ended = phase !== "input";

  // Log the vote through the guess-log flywheel (best effort — apiFetch adds the
  // JWT only when one exists, so guests vote anonymously), THEN read the tally so
  // the player's own vote is part of the split they see (and are scored on).
  const castVote = async (qid: string, side: Side, elapsedMs: number) => {
    const sess = sessionRef.current;
    try {
      await apiFetch(`${BACKEND_ORIGIN}/trivia/log-guesses/`, {
        method: "POST",
        body: JSON.stringify({
          game: "who-would-win",
          entries: [{ question_id: qid, answer: side, correct: false, elapsed_ms: elapsedMs }],
        }),
      });
    } catch {
      /* analytics only — still show the community numbers */
    }
    let result: Tally | "error";
    try {
      const res = await fetch(
        `${BACKEND_ORIGIN}/trivia/who-would-win/tally/?qid=${encodeURIComponent(qid)}`,
        { signal: AbortSignal.timeout(TALLY_TIMEOUT_MS) },
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const t = (await res.json()) as Tally;
      if (typeof t.a !== "number" || typeof t.b !== "number") throw new Error("bad tally");
      result = { qid, a: t.a, b: t.b, total: t.a + t.b };
    } catch {
      result = "error";
    }
    if (sess !== sessionRef.current) return;
    talliesRef.current = { ...talliesRef.current, [qid]: result };
    setTallies(talliesRef.current);
  };

  // GAME END CONTRACT: exactly once, in place. The loader waits for any vote
  // still in flight (bounded by the tally timeout) with a 1.5s floor; then the
  // score is computed from the tallies as they stand and frozen.
  const startEnd = (finalPicks: PickRecord[]) => {
    if (endedRef.current) return;
    setPhase("loader");
    const sess = sessionRef.current;
    const votesSettled = Promise.race([
      Promise.all([...pendingVotesRef.current]),
      new Promise<void>((resolve) => later(resolve, TALLY_TIMEOUT_MS)),
    ]);
    const floor = new Promise<void>((resolve) => later(resolve, END_LOADER_MS));
    void Promise.all([votesSettled, floor]).then(() => {
      if (sess !== sessionRef.current || endedRef.current) return;
      endedRef.current = true;
      const frozen = talliesRef.current;
      setEndTallies(frozen);
      onGameEnd?.(totalScore(finalPicks, frozen), { inPlace: true });
      setPhase("score");
    });
  };

  const advance = (nextPicks: PickRecord[]) => {
    if (idx + 1 >= total) {
      startEnd(nextPicks);
      return;
    }
    setIdx(idx + 1);
    setPicked(null);
    startRef.current = Date.now();
  };

  const handlePick = (side: Side) => {
    if (picked || !matchup || ended) return;
    setPicked(side);
    setPicks((prev) => [...prev, { qid: matchup.qid, choice: side }]);
    const vote = castVote(matchup.qid, side, Date.now() - startRef.current);
    const pending = pendingVotesRef.current;
    pending.add(vote);
    void vote.finally(() => pending.delete(vote));
  };

  const handleNext = () => {
    if (!picked || ended) return;
    advance(picks);
  };

  // Skip: no vote request, no points, straight to the next matchup.
  const handleSkip = () => {
    if (picked || !matchup || ended) return;
    const nextPicks: PickRecord[] = [...picks, { qid: matchup.qid, choice: null }];
    setPicks(nextPicks);
    advance(nextPicks);
  };

  if (!matchup && !ended)
    return (
      <GameFrame>
        <GameFrame.Board>
          <p style={{ color: "var(--muted)" }}>No matchups available.</p>
        </GameFrame.Board>
      </GameFrame>
    );

  // Live score counts a vote once its tally lands (so it never shows 20 and then
  // drops to 5); at the end the frozen tallies decide, a still-pending one as majority.
  const shownTallies = endTallies ?? tallies;
  const score = endTallies
    ? totalScore(picks, endTallies)
    : totalScore(
        picks.filter((p) => p.choice === null || tallies[p.qid] !== undefined),
        tallies,
      );

  const last = idx + 1 >= total;
  // One row in every state: only `disabled` toggles, so it never moves (Rule 6.2).
  const actionsRow = (
    <div className="www-actions">
      <Button variant="secondary" size="md" className="www-skip" disabled={!!picked} onClick={handleSkip}>
        Skip
      </Button>
      <Button ref={nextRef} size="md" className="www-next" disabled={!picked} onClick={handleNext}>
        {last ? "See results" : "Next matchup"}
      </Button>
    </div>
  );

  const action = (
    <GameFrame.Action>
      {/* Skip/Next → spinner → score (shared answers-shown end sequence) */}
      <EndSequence
        phase={phase}
        input={actionsRow}
        score={<ScorePanel score={score} outOf={WWW_MAX_POINTS} onPlayAgain={onPlayAgain} onClose={onClose} />}
      />
    </GameFrame.Action>
  );

  // ===== End in place: the per-matchup list is the final board =====
  if (ended) {
    return (
      <GameFrame fill>
        <GameFrame.Status
          left={<GameFrame.Label>MATCHUPS COMPLETE</GameFrame.Label>}
          right={<GameFrame.Score value={score} />}
        />
        <ProgressBar value={total} max={total} label="Matchups played" />
        <GameFrame.Prompt title="How you voted" />
        <GameFrame.Board>
          <motion.div
            className="www-summary-list"
            initial={reduce ? false : { opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.25 }}
          >
            {picks.map((p, i) => {
              const m = gameInfo.find((g) => g.qid === p.qid);
              if (!m) return null;
              const t = shownTallies[p.qid];
              const pts = pointsFor(p.choice, t);
              let pick: string;
              let crowd: string;
              let cls = "";
              if (p.choice === null) {
                pick = `${m.a.label} vs ${m.b.label}`;
                crowd = "skipped";
                cls = " is-skipped";
              } else {
                const mine = p.choice === "a" ? m.a : m.b;
                const theirs = p.choice === "a" ? m.b : m.a;
                pick = mine.label;
                if (!t || t === "error") crowd = "split unknown";
                else if (pts === WWW_POINTS_MAJORITY) {
                  crowd = "with the crowd";
                  cls = " is-agreed";
                } else crowd = `crowd took ${theirs.label}`;
              }
              return (
                <div key={p.qid} className={`www-summary-row${cls}`}>
                  <span className="www-summary-num tnum">{i + 1}</span>
                  <span className="www-summary-pick">{pick}</span>
                  <span className="www-summary-crowd">{crowd}</span>
                  <span className="www-summary-pts tnum">{pts > 0 ? `+${pts}` : "0"}</span>
                </div>
              );
            })}
          </motion.div>
        </GameFrame.Board>
        {action}
      </GameFrame>
    );
  }

  const tally = tallies[matchup!.qid];
  const hasSplit = !!tally && tally !== "error";
  const loading = !!picked && !tally;

  const splitOf = (side: Side) => {
    if (!hasSplit) return { pct: 0, votes: 0 };
    const pctA = tally.total > 0 ? Math.round((tally.a / tally.total) * 100) : 0;
    return {
      pct: side === "a" ? pctA : tally.total > 0 ? 100 - pctA : 0,
      votes: side === "a" ? tally.a : tally.b,
    };
  };

  const sideCard = (side: Side) => {
    const info = side === "a" ? matchup!.a : matchup!.b;
    const isMine = picked === side;
    const { pct, votes } = splitOf(side);
    return (
      <motion.button
        type="button"
        className={`www-card${isMine ? " is-mine" : ""}${picked && !isMine ? " is-other" : ""}`}
        onClick={() => handlePick(side)}
        disabled={!!picked}
        aria-pressed={isMine}
        whileHover={!picked && !reduce ? { y: -2 } : undefined}
        whileTap={!picked && !reduce ? { scale: 0.96 } : undefined}
      >
        <span className="www-card-label font-display">{info.label}</span>
        <span className="www-card-sub">{info.sub ?? " "}</span>
        {/* Reserved before the vote so the reveal never shifts layout (Rule 6.2).
            The picked card shows its loading / error line in the same space. */}
        <span className="www-split" aria-hidden={!hasSplit}>
          {hasSplit ? (
            <>
              <span className="www-bar-track" aria-hidden="true">
                <motion.span
                  className={`www-bar-fill${isMine ? " is-mine" : ""}`}
                  initial={{ width: reduce ? `${pct}%` : "0%" }}
                  animate={{ width: `${pct}%` }}
                  transition={{ duration: 0.6, ease: "easeOut" }}
                />
              </span>
              <span className="www-split-nums tnum">
                {pct}% · {votes} {votes === 1 ? "vote" : "votes"}
              </span>
            </>
          ) : isMine && loading ? (
            <span className="www-split-state">
              <Spinner size={14} />
              Counting votes…
            </span>
          ) : isMine && tally === "error" ? (
            <span className="www-split-state">No split yet</span>
          ) : null}
        </span>
      </motion.button>
    );
  };

  // Screen-reader text for the split of the player's pick.
  let srNote = "";
  if (loading) srNote = "Counting votes";
  else if (picked && tally === "error") srNote = "Couldn't load the community split.";
  else if (picked && hasSplit) {
    const pts = pointsFor(picked, tally);
    const label = (picked === "a" ? matchup!.a : matchup!.b).label;
    srNote = `${splitOf(picked).pct}% picked ${label}. Plus ${pts} points${
      pts === WWW_POINTS_MINORITY ? ", against the crowd" : ""
    }.`;
  }

  return (
    <GameFrame fill>
      <GameFrame.Status
        left={<GameFrame.Label>{`MATCHUP ${idx + 1}/${total}`}</GameFrame.Label>}
        right={<GameFrame.Score value={score} />}
      />
      <ProgressBar value={idx + (picked ? 1 : 0)} max={total} label="Matchups played" />
      <GameFrame.Prompt title="Who would win?" />

      <GameFrame.Board>
        <div className="www-arena">
          {sideCard("a")}
          <span className="www-vs font-display" aria-hidden="true">
            VS
          </span>
          {sideCard("b")}
        </div>
        <span className="www-sr" aria-live="polite">
          {srNote}
        </span>
      </GameFrame.Board>

      {action}
    </GameFrame>
  );
}

export default WhoWouldWin;
