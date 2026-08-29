// Pack 5 — stat-trumps card pack. Deal 11 comparable players left→right from the
// curated players-index pool (gameInfo). The current card is face-up (headshot +
// 5 career stats); the next card is a mystery. Pick ONE stat you bet is >= the
// next card's same stat. Correct → advance (+20, next card flips in a Panini foil
// frame). First miss = orange warning (play continues), second miss = red, run
// ends. Clear the whole deck (all 10 comparisons) → +20 completion bonus (220 max).
//
// Conventions copied from StartingFive/FanFavorites: state reset on [gameInfo],
// timersRef + later()/clearTimers() for ALL delayed work, onGameEnd exactly once
// (endedRef guard), reduced-motion respected, image fallbacks.
import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import SubmitGuessPopup from "../components/SubmitGuessPopUp";
import { GameFrame, ProgressBar, Spinner } from "../components/ui";
import { BACKEND_ORIGIN } from "../configurations/backend";
import { apiFetch } from "../utils/Api";
import { sampleN } from "../utils/pool";
import type { PlayerIndexEntry, OnGameEnd } from "../types/types";
import "../styles/PackFive.css";

export interface PackFiveProps {
  gameInfo: PlayerIndexEntry[];
  onGameEnd: OnGameEnd;
  turn?: unknown;
  onTurnAction?: (a: unknown) => void;
  multiplayer?: boolean;
}

const PACK_SIZE = 11; // 11 cards → 10 comparisons
const POINTS = 20; // per won comparison
const COMPLETION_BONUS = 20; // survive the whole deck → +20 (max 220)
const REVEAL_MS = 1200; // hold the reveal before sliding on
const END_DELAY = 900; // let the final reveal land before handing back the score

const headshotUrl = (personId: number) =>
  `https://cdn.nba.com/headshots/nba/latest/1040x760/${personId}.png`;

// The five trump stats, in display order. Numeric getters read the frozen
// PlayerIndexEntry shape (career.* + awards.*); fmt keeps decimals tabular.
type StatKey = "ppg" | "rpg" | "apg" | "rings" | "allstar";
interface StatDef {
  key: StatKey;
  label: string;
  get: (p: PlayerIndexEntry) => number;
  fmt: (v: number) => string;
}
const STATS: StatDef[] = [
  { key: "ppg", label: "PPG", get: (p) => p.career.ppg, fmt: (v) => v.toFixed(1) },
  { key: "rpg", label: "RPG", get: (p) => p.career.rpg, fmt: (v) => v.toFixed(1) },
  { key: "apg", label: "APG", get: (p) => p.career.apg, fmt: (v) => v.toFixed(1) },
  { key: "rings", label: "RINGS", get: (p) => p.awards.rings.length, fmt: (v) => String(v) },
  { key: "allstar", label: "ALL-STAR", get: (p) => p.awards.allstar_count, fmt: (v) => String(v) },
];

interface GuessEntry {
  question_id: string;
  answer: string;
  correct: boolean;
  elapsed_ms: number;
}

// A row is dealable when it carries all five trump stats and is a marquee name
// (fame 1-3 — fame-4 deep cuts are never dealt, matching the backend).
const isDealable = (p: PlayerIndexEntry): boolean =>
  !!p &&
  (p.fame_tier === 1 || p.fame_tier === 2 || p.fame_tier === 3) &&
  !!p.career &&
  typeof p.career.ppg === "number" &&
  typeof p.career.rpg === "number" &&
  typeof p.career.apg === "number" &&
  !!p.awards &&
  typeof p.awards.allstar_count === "number" &&
  Array.isArray(p.awards.rings);

const currentTeam = (p: PlayerIndexEntry): string => {
  const t = p.teams && p.teams.length ? p.teams[p.teams.length - 1] : null;
  return t ? t.abbr : "NBA";
};

/** Orange silhouette used when a headshot can't load — never breaks the card. */
function Silhouette() {
  return (
    <svg viewBox="0 0 64 72" className="pf-silhouette" aria-hidden="true">
      <circle cx="32" cy="26" r="13" />
      <path d="M8 72 C8 54 22 47 32 47 C42 47 56 54 56 72 Z" />
    </svg>
  );
}

function Headshot({ player }: { player: PlayerIndexEntry }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [player.person_id]);
  if (failed) return <Silhouette />;
  return (
    <img
      className="pf-photo"
      src={headshotUrl(player.person_id)}
      alt={`${player.full_name} headshot`}
      onError={() => setFailed(true)}
      draggable={false}
    />
  );
}

export default function PackFive({ gameInfo, onGameEnd }: PackFiveProps) {
  const [dealState, setDealState] = useState<"loading" | "ready" | "error">("loading");
  const [pack, setPack] = useState<PlayerIndexEntry[]>([]);
  const [index, setIndex] = useState(0); // current = pack[index], next = pack[index + 1]
  const [correct, setCorrect] = useState(0);
  const [misses, setMisses] = useState(0);
  const [phase, setPhase] = useState<"bet" | "reveal">("bet");
  const [chosen, setChosen] = useState<StatKey | null>(null);
  const [lastHit, setLastHit] = useState<boolean | null>(null);
  const [finished, setFinished] = useState(false);
  const [showPopup, setShowPopup] = useState(false);
  const [popup, setPopup] = useState({ Text: "", Color: "" });
  const reduce = useReducedMotion();

  // Refs mirror the score/miss counters so a delayed finish() reads live values,
  // and guard onGameEnd to fire exactly once.
  const correctRef = useRef(0);
  const missRef = useRef(0);
  const endedRef = useRef(false);
  const startRef = useRef(Date.now());
  const guessLogRef = useRef<GuessEntry[]>([]);
  const timersRef = useRef<ReturnType<typeof setTimeout>[]>([]);

  const later = (fn: () => void, ms: number) => {
    timersRef.current.push(setTimeout(fn, ms));
  };
  const clearTimers = () => {
    timersRef.current.forEach(clearTimeout);
    timersRef.current = [];
  };

  const sendGuessLog = () => {
    const entries = guessLogRef.current;
    guessLogRef.current = [];
    if (!entries.length) return;
    apiFetch(`${BACKEND_ORIGIN}/trivia/log-guesses/`, {
      method: "POST",
      body: JSON.stringify({ game: "pack-five", entries }),
    }).catch(() => {
      /* analytics only */
    });
  };

  // Deal a fresh pack whenever the pool changes (play-again / new payload).
  useEffect(() => {
    clearTimers();
    setIndex(0);
    setCorrect(0);
    setMisses(0);
    setPhase("bet");
    setChosen(null);
    setLastHit(null);
    setFinished(false);
    setShowPopup(false);
    correctRef.current = 0;
    missRef.current = 0;
    endedRef.current = false;
    guessLogRef.current = [];
    startRef.current = Date.now();

    const dealable = (gameInfo ?? []).filter(isDealable);
    if (dealable.length < PACK_SIZE) {
      setPack([]);
      setDealState("error");
      return;
    }
    setPack(sampleN(dealable, PACK_SIZE));
    setDealState("ready");
  }, [gameInfo]);

  // Unmount: cancel pending reveals/end-calls and flush any un-sent guesses.
  useEffect(() => () => {
    clearTimers();
    sendGuessLog();
  }, []);

  const flashPopup = (text: string, color: string) => {
    setPopup({ Text: text, Color: color });
    setShowPopup(true);
    later(() => setShowPopup(false), 1400);
  };

  const finish = (reachedEnd: boolean) => {
    if (endedRef.current) return;
    endedRef.current = true;
    setFinished(true);
    sendGuessLog();
    const final = POINTS * correctRef.current + (reachedEnd ? COMPLETION_BONUS : 0);
    later(() => onGameEnd?.(final), END_DELAY);
  };

  const nextCard = () => {
    setIndex((i) => i + 1);
    setPhase("bet");
    setChosen(null);
    setLastHit(null);
    startRef.current = Date.now();
  };

  const handlePick = (statKey: StatKey) => {
    if (phase !== "bet" || finished || dealState !== "ready") return;
    const cur = pack[index];
    const nxt = pack[index + 1];
    if (!cur || !nxt) return;
    const stat = STATS.find((s) => s.key === statKey)!;
    const cv = stat.get(cur);
    const nv = stat.get(nxt);
    const hit = cv >= nv; // ties count as correct

    setChosen(statKey);
    setLastHit(hit);
    setPhase("reveal");

    guessLogRef.current.push({
      question_id: `${cur.person_id}v${nxt.person_id}:${statKey}`,
      answer: statKey,
      correct: hit,
      elapsed_ms: Date.now() - startRef.current,
    });

    const isLastComparison = index === pack.length - 2;

    if (hit) {
      correctRef.current += 1;
      setCorrect(correctRef.current);
      flashPopup(`Correct! +${POINTS}`, "var(--good)");
      later(() => (isLastComparison ? finish(true) : nextCard()), REVEAL_MS);
      return;
    }

    // Miss.
    missRef.current += 1;
    setMisses(missRef.current);
    if (missRef.current >= 2) {
      flashPopup("Two misses — run over", "var(--bad)");
      later(() => finish(false), REVEAL_MS);
    } else {
      flashPopup("Missed — one life left", "var(--bad)");
      later(() => (isLastComparison ? finish(true) : nextCard()), REVEAL_MS);
    }
  };

  // ----- States: loading / error (no valid pool) -----
  if (dealState === "loading") {
    return <Spinner label="Opening the pack…" />;
  }
  if (dealState === "error" || pack.length < 2) {
    return (
      <div className="pf-state" role="alert">
        <span className="pf-state-title">Pack unavailable</span>
        <span className="pf-state-msg">Not enough players to build a pack right now. Please try again later.</span>
      </div>
    );
  }

  const cur = pack[index];
  const nxt = pack[index + 1];
  const comparisonNo = index + 1; // 1..10
  const totalComparisons = pack.length - 1; // 10
  const bannerTone = finished && lastHit === false && misses >= 2 ? "bad" : misses >= 1 ? "warn" : "neutral";
  const bannerText =
    misses >= 2
      ? "Run over — that's two misses."
      : misses === 1
        ? "One life left — one more miss ends the run."
        : "Pick a stat where your card beats the mystery card (ties win).";

  return (
    <GameFrame>
      {/* Card count + lives on the left, running score on the right */}
      <GameFrame.Status
        left={
          <>
            <GameFrame.Label>CARD <span className="tnum">{comparisonNo}/{totalComparisons}</span></GameFrame.Label>
            <span className="pf-lives" aria-label={`${Math.max(0, 2 - misses)} lives left`}>
              {[0, 1].map((i) => (
                <span key={i} className={`pf-life${i < 2 - misses ? " is-on" : ""}`} aria-hidden="true" />
              ))}
            </span>
          </>
        }
        right={<GameFrame.Score value={POINTS * correct} />}
      />

      <ProgressBar value={comparisonNo} max={totalComparisons} />

      <GameFrame.Board>
      {/* Status banner — fixed height so reveals never shift layout */}
      <div className={`pf-banner pf-banner--${bannerTone}`} role="status">
        {bannerText}
      </div>

      {/* Arena — current (foil) card slides in from the right on each advance */}
      <div className="pf-arena">
        <AnimatePresence mode="popLayout" initial={false}>
          <motion.div
            key={index}
            className="pf-card"
            initial={reduce ? { opacity: 0 } : { opacity: 0, x: "60%", rotateY: 10 }}
            animate={reduce ? { opacity: 1 } : { opacity: 1, x: 0, rotateY: 0 }}
            exit={reduce ? { opacity: 0 } : { opacity: 0, x: "-55%", rotateY: -8 }}
            transition={{ duration: 0.42, ease: [0.22, 0.61, 0.36, 1] }}
          >
            <div className="pf-photo-frame">
              <Headshot player={cur} />
              <div className="pf-photo-scrim" />
              <div className="pf-name-plate">
                <span className="pf-name font-display">{cur.full_name}</span>
                <span className="pf-team">{currentTeam(cur)}{cur.is_active ? "" : " · retired"}</span>
              </div>
            </div>

            <div className="pf-stats" role="group" aria-label="Pick a stat to bet">
              {STATS.map((s) => {
                const picked = chosen === s.key;
                const revealTone = picked && phase === "reveal" ? (lastHit ? " is-hit" : " is-miss") : "";
                return (
                  <button
                    key={s.key}
                    type="button"
                    className={`pf-stat${picked ? " is-picked" : ""}${revealTone}`}
                    onClick={() => handlePick(s.key)}
                    disabled={phase !== "bet" || finished}
                    aria-label={`Bet ${s.label}: ${s.fmt(s.get(cur))}`}
                  >
                    <span className="pf-stat-label">{s.label}</span>
                    <span className="pf-stat-val tnum">{s.fmt(s.get(cur))}</span>
                  </button>
                );
              })}
            </div>
          </motion.div>
        </AnimatePresence>
      </div>

      {/* Mystery "next" card — name + team only; the picked stat reveals here */}
      <div className={`pf-next${phase === "reveal" ? " is-revealing" : ""}`}>
        <div className="pf-next-head">
          <span className="pf-next-eyebrow">Next up</span>
          <span className="pf-next-name font-display">{nxt.full_name}</span>
          <span className="pf-next-team">{currentTeam(nxt)}</span>
        </div>
        <div className="pf-next-stats" aria-hidden={phase !== "reveal"}>
          {STATS.map((s) => {
            const picked = chosen === s.key;
            const show = picked && phase === "reveal";
            const tone = show ? (lastHit ? " is-lose" : " is-win") : ""; // next-card tone is the mirror of ours
            return (
              <div key={s.key} className={`pf-next-stat${picked ? " is-picked" : ""}${tone}`}>
                <span className="pf-next-stat-label">{s.label}</span>
                <span className="pf-next-stat-val tnum">{show ? s.fmt(s.get(nxt)) : "?"}</span>
              </div>
            );
          })}
        </div>
      </div>
      </GameFrame.Board>

      {/* No input row: the stats are tapped on the card itself, so the slot
          renders nothing (see GameFrame.Action's doc comment). */}
      <GameFrame.Action>{null}</GameFrame.Action>

      <SubmitGuessPopup show={showPopup} text={popup.Text} color={popup.Color} />
    </GameFrame>
  );
}
