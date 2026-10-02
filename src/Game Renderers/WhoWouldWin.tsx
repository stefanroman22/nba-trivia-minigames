import { useEffect, useRef, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { Button, GameFrame, ProgressBar, Spinner } from "../components/ui";
import { BACKEND_ORIGIN } from "../configurations/backend";
import { apiFetch } from "../utils/Api";
import type { WwwMatchup, OnGameEnd } from "../types/types";
import "../styles/WhoWouldWin.css";

interface WhoWouldWinProps {
  gameInfo: WwwMatchup[];
  onGameEnd: OnGameEnd;
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
}

/** Below this many total votes the split carries an "early votes" note. */
const EARLY_VOTES = 10;
const TALLY_TIMEOUT_MS = 8000;

/** Did the player side with the majority? Ties count as agreeing. The tally includes
 *  the player's own vote, so fewer than 2 votes is no usable split (null). */
function agreement(choice: Side, t: Tally | "error" | undefined): boolean | null {
  if (!t || t === "error" || t.total < 2) return null;
  const mine = choice === "a" ? t.a : t.b;
  const other = choice === "a" ? t.b : t.a;
  return mine >= other;
}

function WhoWouldWin({ gameInfo, onGameEnd }: WhoWouldWinProps) {
  const [idx, setIdx] = useState(0);
  const [picked, setPicked] = useState<Side | null>(null);
  const [picks, setPicks] = useState<PickRecord[]>([]);
  // Community split per matchup. Absent for a picked matchup = still loading;
  // "error" = the tally request failed (play continues without a split).
  const [tallies, setTallies] = useState<Record<string, Tally | "error">>({});
  const [showSummary, setShowSummary] = useState(false);
  const endedRef = useRef(false);
  // Bumped on reset/unmount so an in-flight vote/tally can never set state
  // into a new session.
  const sessionRef = useRef(0);
  const startRef = useRef(Date.now());
  const nextRef = useRef<HTMLButtonElement>(null);
  const reduce = useReducedMotion();

  // Fresh state whenever a new matchup set loads (e.g. play-again).
  useEffect(() => {
    sessionRef.current += 1;
    setIdx(0);
    setPicked(null);
    setPicks([]);
    setTallies({});
    setShowSummary(false);
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
    };
  }, []);

  const matchup = gameInfo && gameInfo.length > 0 ? gameInfo[idx] : null;
  const total = gameInfo?.length ?? 0;

  // Log the vote through the guess-log flywheel (best effort — apiFetch adds the
  // JWT only when one exists, so guests vote anonymously), THEN read the tally so
  // the player's own vote is part of the split they see.
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
    setTallies((prev) => ({ ...prev, [qid]: result }));
  };

  const handlePick = (side: Side) => {
    if (picked || !matchup || showSummary) return;
    setPicked(side);
    setPicks((prev) => [...prev, { qid: matchup.qid, choice: side }]);
    void castVote(matchup.qid, side, Date.now() - startRef.current);
  };

  const handleNext = () => {
    if (!picked) return;
    if (idx + 1 >= total) {
      setShowSummary(true);
      return;
    }
    setIdx(idx + 1);
    setPicked(null);
    startRef.current = Date.now();
  };

  // GAME END CONTRACT: exactly once, and only after the summary screen.
  const handleFinish = () => {
    if (endedRef.current) return;
    endedRef.current = true;
    onGameEnd?.(0);
  };

  if (!matchup && !showSummary)
    return (
      <GameFrame>
        <GameFrame.Board>
          <p style={{ color: "var(--muted)" }}>No matchups available.</p>
        </GameFrame.Board>
      </GameFrame>
    );

  // ===== Summary (shown BEFORE onGameEnd fires) =====
  if (showSummary) {
    const agreed = picks.filter((p) => agreement(p.choice, tallies[p.qid]) === true).length;
    return (
      <GameFrame fill>
        <GameFrame.Status left={<GameFrame.Label>MATCHUPS COMPLETE</GameFrame.Label>} />
        <GameFrame.Prompt
          eyebrow="How you voted"
          title={
            <>
              You sided with the crowd{" "}
              <span className="tnum www-agree">
                {agreed}/{picks.length}
              </span>
            </>
          }
        />
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
              const mine = p.choice === "a" ? m.a : m.b;
              const theirs = p.choice === "a" ? m.b : m.a;
              const ag = agreement(p.choice, tallies[p.qid]);
              return (
                <div key={p.qid} className={`www-summary-row${ag ? " is-agreed" : ""}`}>
                  <span className="www-summary-num tnum">{i + 1}</span>
                  <span className="www-summary-pick">{mine.label}</span>
                  <span className="www-summary-crowd">
                    {ag === null ? "split unknown" : ag ? "with the crowd" : `crowd took ${theirs.label}`}
                  </span>
                </div>
              );
            })}
          </motion.div>
        </GameFrame.Board>
        <GameFrame.Action>
          <Button size="md" block className="www-btn" onClick={handleFinish}>
            Finish
          </Button>
        </GameFrame.Action>
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
        {/* Reserved before the vote so the reveal never shifts layout (Rule 6.2) */}
        <span className="www-split" aria-hidden={!hasSplit}>
          {hasSplit && (
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
          )}
        </span>
      </motion.button>
    );
  };

  let note = " ";
  if (!picked) note = "Tap a side to cast your vote.";
  else if (tally === "error") note = "Couldn't load the community split.";
  else if (hasSplit && tally.total < EARLY_VOTES) note = "Early votes — small sample so far.";

  // Screen-reader text for the live note: the split for the player's pick.
  const srNote = loading
    ? "Counting votes"
    : picked && hasSplit
      ? `${splitOf(picked).pct}% picked ${(picked === "a" ? matchup!.a : matchup!.b).label}. ${note.trim()}`
      : note.trim();

  return (
    <GameFrame fill>
      <GameFrame.Status left={<GameFrame.Label>{`MATCHUP ${idx + 1}/${total}`}</GameFrame.Label>} />
      <ProgressBar value={idx + (picked ? 1 : 0)} max={total} label="Matchups voted" />
      <GameFrame.Prompt title="Who would win?" />

      <GameFrame.Board>
        <div className="www-arena">
          {sideCard("a")}
          <span className="www-vs font-display" aria-hidden="true">
            VS
          </span>
          {sideCard("b")}
        </div>
      </GameFrame.Board>

      <GameFrame.Action>
        <div className="www-note" aria-live="polite">
          {/* One row in every state (spinner / hint / early votes / error) so the
              slot never changes height. The live region announces srNote only. */}
          <span className="www-note-row" aria-hidden="true">
            {loading ? (
              <>
                <Spinner size={14} />
                Counting votes…
              </>
            ) : (
              note
            )}
          </span>
          <span className="www-sr">{srNote}</span>
        </div>
        <Button ref={nextRef} size="md" block className="www-btn" onClick={handleNext} disabled={!picked}>
          {idx + 1 >= total ? "See results" : "Next matchup"}
        </Button>
      </GameFrame.Action>
    </GameFrame>
  );
}

export default WhoWouldWin;
