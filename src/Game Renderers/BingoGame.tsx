// NBA Bingo — deal a player, dab the matching category. All validation is
// client-side: playerMatches(criteria.ts) against the players-index pool.
// House patterns per StartingFive/FanFavorites: reset on [gameInfo],
// timersRef + later()/clearTimers(), onGameEnd exactly once (finishedRef).
import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import SubmitGuessPopup from "../components/SubmitGuessPopUp";
import { Button, Chip, CourtLoader, ProgressBar } from "../components/ui";
import { BACKEND_ORIGIN } from "../configurations/backend";
import { apiFetch } from "../utils/Api";
import { fetchWholePool, sampleN } from "../utils/pool";
import { playerMatches } from "../utils/criteria";
import type { BingoCard, GameError, OnGameEnd, PlayerIndexEntry } from "../types/types";
import "../styles/BingoGame.css";

export interface BingoGameProps {
  gameInfo: BingoCard[];
  onGameEnd: OnGameEnd;
  turn?: unknown;
  onTurnAction?: (a: unknown) => void;
  multiplayer?: boolean;
}

const MAX_SCORE = 200;
const DECK_SIZE = 24;       // total deals available
const CELL_COUNT = 16;
const PAR_DEALS = 16;       // no penalty up to a perfect 16-deal run
const OVERAGE_PENALTY = 4;  // per deal beyond par
const SCORE_FLOOR = 80;     // completed-card minimum
const MAX_FAME_DEALT = 3;   // fame_tier 4 players are never dealt

interface GuessEntry { question_id: string; answer: string; correct: boolean; elapsed_ms: number }
interface ClaimedBy { name: string; person_id: number }

const headshotUrl = (personId: number) =>
  `https://cdn.nba.com/headshots/nba/latest/260x190/${personId}.png`;

/** Orange silhouette shown when the NBA CDN headshot fails to load. */
function DealFallback() {
  return (
    <svg viewBox="0 0 64 72" className="bng-deal-fallback" aria-hidden="true">
      <circle cx="32" cy="26" r="13" fill="var(--brand)" />
      <path d="M8 72 C8 54 22 47 32 47 C42 47 56 54 56 72 Z" fill="var(--brand)" />
    </svg>
  );
}

function DealPhoto({ player }: { player: PlayerIndexEntry }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [player.person_id]);
  if (failed) return <DealFallback />;
  return (
    <img
      className="bng-deal-photo"
      src={headshotUrl(player.person_id)}
      alt=""
      onError={() => setFailed(true)}
    />
  );
}

function BingoGame({ gameInfo, onGameEnd }: BingoGameProps) {
  const [deckReady, setDeckReady] = useState(false);
  const [poolError, setPoolError] = useState<GameError | null>(null);
  const [dealt, setDealt] = useState<PlayerIndexEntry | null>(null);
  const [claimed, setClaimed] = useState<Record<number, ClaimedBy>>({});
  const [dealsLeft, setDealsLeft] = useState(DECK_SIZE);
  const [penalty, setPenalty] = useState(false);
  const [finished, setFinished] = useState(false);
  const [showPointsAnimation, setShowPointsAnimation] = useState(false);
  const [popUpInfo, setPopUpInfo] = useState({ Text: "", Color: "" });
  // Engine values live in refs (mirrored to state above) so later()-delayed
  // callbacks never act on stale closures.
  const deckRef = useRef<PlayerIndexEntry[]>([]);
  const ptrRef = useRef(0);
  const dealsLeftRef = useRef(DECK_SIZE);
  const claimedRef = useRef<Record<number, ClaimedBy>>({});
  const finishedRef = useRef(false);
  const fetchSeqRef = useRef(0); // ignores stale pool fetches after a reset
  const guessLogRef = useRef<GuessEntry[]>([]);
  const startRef = useRef(Date.now());
  const timersRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  const reduce = useReducedMotion();

  const card = gameInfo && gameInfo.length > 0 ? gameInfo[0] : null;

  const later = (fn: () => void, ms: number) => {
    timersRef.current.push(setTimeout(fn, ms));
  };
  const clearTimers = () => {
    timersRef.current.forEach(clearTimeout);
    timersRef.current = [];
  };

  const flashPopup = (text: string, color: string) => {
    setPopUpInfo({ Text: text, Color: color });
    setShowPointsAnimation(true);
    later(() => setShowPointsAnimation(false), 1500);
  };

  // Fire-and-forget guess log (flywheel); guests log anonymously via apiFetch.
  const sendGuessLog = () => {
    const entries = guessLogRef.current;
    guessLogRef.current = [];
    if (!entries.length) return;
    apiFetch(`${BACKEND_ORIGIN}/trivia/log-guesses/`, {
      method: "POST",
      body: JSON.stringify({ game: "bingo", entries }),
    }).catch(() => { /* analytics only */ });
  };

  const endGame = (score: number, msg: string, color: string) => {
    if (finishedRef.current) return; // GAME END CONTRACT: exactly once
    finishedRef.current = true;
    setFinished(true);
    setDealt(null);
    sendGuessLog();
    flashPopup(msg, color);
    later(() => onGameEnd?.(score), 1700);
  };

  const finishPartial = () => {
    const claimedCount = Object.keys(claimedRef.current).length;
    const score = Math.round(((MAX_SCORE * claimedCount) / CELL_COUNT) * 0.5);
    endGame(score, `Deck done — ${claimedCount}/16 dabbed`, "var(--bad)");
  };

  /** Consume one deal: advance to the first player matching an OPEN cell. */
  const drawNext = () => {
    if (finishedRef.current || !card) return;
    if (dealsLeftRef.current <= 0) { finishPartial(); return; }
    const deck = deckRef.current;
    let i = ptrRef.current;
    while (i < deck.length) {
      const p = deck[i];
      if (card.cells.some((c, idx) => !claimedRef.current[idx] && playerMatches(p, c))) break;
      i++; // matches no open cell: skipped silently, costs nothing
    }
    if (i >= deck.length) { finishPartial(); return; } // player list exhausted
    ptrRef.current = i + 1;
    dealsLeftRef.current -= 1;
    setDealsLeft(dealsLeftRef.current);
    setDealt(deck[i]);
  };

  // Fresh game whenever a new card loads (e.g. play-again): reset everything,
  // then fetch + shuffle the dealable player pool and deal the first player.
  useEffect(() => {
    clearTimers();
    setDeckReady(false);
    setPoolError(null);
    setDealt(null);
    setClaimed({});
    setDealsLeft(DECK_SIZE);
    setPenalty(false);
    setFinished(false);
    setShowPointsAnimation(false);
    deckRef.current = [];
    ptrRef.current = 0;
    dealsLeftRef.current = DECK_SIZE;
    claimedRef.current = {};
    finishedRef.current = false;
    guessLogRef.current = [];
    startRef.current = Date.now();

    if (!card) return;
    const seq = ++fetchSeqRef.current;
    fetchWholePool("players-index").then((res) => {
      if (seq !== fetchSeqRef.current) return; // a newer game superseded this fetch
      if (!res.success || !res.data) {
        setPoolError(res.error ?? { title: "No data available", message: "Please try again later." });
        return;
      }
      const dealable = (res.data as PlayerIndexEntry[]).filter((p) => p.fame_tier <= MAX_FAME_DEALT);
      if (dealable.length === 0) {
        setPoolError({ title: "No players to deal", message: "The player pool is empty. Please try again later." });
        return;
      }
      deckRef.current = sampleN(dealable, dealable.length); // whole pool, shuffled
      setDeckReady(true);
      drawNext(); // deal #1
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gameInfo]);

  // Unmount: cancel pending work, flush any unsent guesses (abandoned games
  // still feed the flywheel), and invalidate in-flight pool fetches.
  useEffect(() => {
    return () => {
      clearTimers();
      fetchSeqRef.current += 1;
      sendGuessLog();
    };
  }, []);

  const handleDab = (idx: number) => {
    if (!card || !dealt || finished || penalty || claimedRef.current[idx]) return;
    const elapsedMs = Date.now() - startRef.current;
    const correct = playerMatches(dealt, card.cells[idx]);
    guessLogRef.current.push({
      question_id: `${card.qid}#${idx}`,
      answer: dealt.full_name,
      correct,
      elapsed_ms: elapsedMs,
    });

    if (correct) {
      const next = { ...claimedRef.current, [idx]: { name: dealt.full_name, person_id: dealt.person_id } };
      claimedRef.current = next;
      setClaimed(next);
      setDealt(null);
      if (Object.keys(next).length === CELL_COUNT) {
        const dealsUsed = DECK_SIZE - dealsLeftRef.current;
        const score = Math.max(SCORE_FLOOR, MAX_SCORE - OVERAGE_PENALTY * Math.max(0, dealsUsed - PAR_DEALS));
        endGame(score, `BINGO! +${score}`, "var(--good)");
      } else {
        flashPopup("Dabbed!", "var(--good)");
        later(drawNext, 600);
      }
      return;
    }

    // Wrong dab: current player is gone AND the next deal is burned.
    setDealt(null);
    setPenalty(true);
    flashPopup("Wrong dab!", "var(--bad)");
    dealsLeftRef.current -= 1; // the skipped next deal
    setDealsLeft(Math.max(0, dealsLeftRef.current));
    later(() => {
      setPenalty(false);
      drawNext(); // finishes partial by itself when the deck just ran out
    }, 1400);
  };

  const handleSkip = () => {
    if (!dealt || finished || penalty) return;
    drawNext(); // pass: dealt player discarded, next draw consumes a deal
  };

  /* ---- loading / error / empty states ---- */
  if (!card) {
    return (
      <div className="bng-wrap">
        <p className="bng-state-msg">No bingo card available.</p>
      </div>
    );
  }
  if (poolError) {
    return (
      <div className="bng-wrap">
        <div className="bng-state" role="alert">
          <span className="bng-state-title font-display">{poolError.title}</span>
          <p className="bng-state-msg">{poolError.message}</p>
          <Button size="sm" onClick={() => onGameEnd?.(0)}>Exit game</Button>
        </div>
      </div>
    );
  }
  if (!deckReady) {
    return (
      <div className="bng-wrap">
        <CourtLoader label="Shuffling the deck…" />
      </div>
    );
  }

  const claimedCount = Object.keys(claimed).length;

  return (
    <div className="bng-wrap">
      {/* Deals meter + skip */}
      <div className="bng-top">
        <div className="bng-meter">
          <span className="bng-meter-label">
            Deals left <b className="tnum">{dealsLeft}</b><span className="tnum">/{DECK_SIZE}</span>
          </span>
          <ProgressBar value={dealsLeft} max={DECK_SIZE} />
        </div>
        <Chip variant="brand" className="tnum">{claimedCount}/16</Chip>
        <Button
          size="sm"
          variant="secondary"
          onClick={handleSkip}
          disabled={!dealt || finished || penalty}
          aria-label="Skip this player (costs one deal)"
        >
          Skip
        </Button>
      </div>

      {/* Dealt player / penalty banner — fixed-height strip, no layout shift */}
      <div className="bng-deal" aria-live="polite">
        <AnimatePresence mode="wait">
          {penalty ? (
            <motion.div
              key="penalty"
              className="bng-penalty"
              initial={reduce ? false : { opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={reduce ? undefined : { opacity: 0 }}
              transition={{ duration: 0.25 }}
              role="status"
            >
              Wrong dab — next deal burned
            </motion.div>
          ) : dealt ? (
            <motion.div
              key={dealt.person_id}
              className="bng-deal-card"
              initial={reduce ? false : { opacity: 0, x: 24 }}
              animate={{ opacity: 1, x: 0 }}
              exit={reduce ? undefined : { opacity: 0, x: -24 }}
              transition={{ duration: 0.25 }}
            >
              <DealPhoto player={dealt} />
              <div>
                <span className="bng-deal-name">{dealt.full_name}</span>
                <span className="bng-deal-hint">Tap the category this player fits</span>
              </div>
            </motion.div>
          ) : (
            <motion.div key="idle" className="bng-deal-hint" initial={false} animate={{ opacity: 1 }}>
              {finished ? "Card closed" : "Dealing…"}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* The 4x4 card */}
      <div className="bng-grid" role="grid" aria-label="Bingo card, 16 categories">
        {card.cells.map((c, idx) => {
          const claim = claimed[idx];
          return (
            <motion.button
              key={idx}
              type="button"
              className={`bng-cell${claim ? " is-claimed" : ""}`}
              onClick={() => handleDab(idx)}
              disabled={!!claim || !dealt || finished || penalty}
              aria-pressed={!!claim}
              aria-label={claim ? `${c.label} — claimed by ${claim.name}` : c.label}
              animate={reduce ? undefined : { scale: claim ? [1, 1.06, 1] : 1 }}
              transition={{ duration: 0.3 }}
            >
              <span className="bng-cell-label">{c.label}</span>
              {claim && <span className="bng-cell-claimer">{claim.name}</span>}
            </motion.button>
          );
        })}
      </div>

      <SubmitGuessPopup show={showPointsAnimation} text={popUpInfo.Text} color={popUpInfo.Color} />
    </div>
  );
}

export default BingoGame;
