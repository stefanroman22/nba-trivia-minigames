// SuperDraft Five — build a starting five under a rotating daily objective.
// A daily objective (Tallest Five / Most Rings / Most Career Points / Oldest
// Five) is picked by date-hash. Five slots each draw a RANDOM pool constraint
// (a franchise / a country / a draft decade) guaranteed >= 8 eligible players.
// Draft one player per slot via an autocomplete filtered to that slot's
// eligible names; each player is usable once. After five picks the lineup's
// metric is graded as a percentile against 300 random valid lineups simulated
// client-side, and onGameEnd(percentile) is called exactly once. One slot
// re-roll per game (single-player only — see below).
//
// Both modes are handed ONE precomputed SuperDraftQuestion as gameInfo[0]: five
// slots, each already carrying its eligible [person_id, height_in, rings,
// career_pts, birth_year] tuples resolved server-side
// (backend/trivia/questions/games/superdraft.py) — the renderer never downloads
// the player pool and never draws or resolves slots itself. Single-player
// fetches the question from the questions store (utils/questions.ts) and its
// one re-roll re-fetches a fresh one; a multiplayer room is dealt one by the
// relay (multiplayer_server/src/questions.js deal) and every member receives
// the same object, so both players draft under identical constraints. Names
// are resolved against the shared names list (useNames / buildNameLookup).
//
// The daily objective is the one thing the question does not carry (spec
// §7.4). Solo picks it from the local calendar day, as always. Online both
// clients derive it from the dealt question's qid instead — the one value the
// room provably shares — so two players in different timezones can never be
// graded on different objectives. Spec:
// docs/superpowers/specs/2026-09-10-questions-store-design.md §10.3.
//
// Conventions copied from PackFive/StartingFive: state reset on [gameInfo],
// timersRef + later()/clearTimers() for ALL delayed work, endedRef guards
// onGameEnd, reduced-motion respected, loading/empty/error states, image
// fallbacks, tokens-only CSS, fits the 390x844 budget with no page scroll.
import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import AutocompleteInput from "../components/AutoCompleteInput";
import SubmitGuessPopup from "../components/SubmitGuessPopUp";
import { Button, GameFrame, ProgressBar, Spinner } from "../components/ui";
import SwapText from "../components/motion/SwapText";
import { BACKEND_ORIGIN } from "../configurations/backend";
import { useNames } from "../hooks/useNames";
import { apiFetch } from "../utils/Api";
import { normalizeAnswer } from "../utils/answerMatch";
import { buildNameLookup, fetchQuestion, hashStr } from "../utils/questions";
import type { OnGameEnd, SuperDraftQuestion, SuperDraftSlot } from "../types/types";
import "../styles/SuperDraft.css";

export interface SuperDraftProps {
  /** One precomputed SuperDraftQuestion — the same shape in single-player and multiplayer. */
  gameInfo: SuperDraftQuestion[];
  onGameEnd: OnGameEnd;
  /** Restarts the game from the result panel (spec §7). */
  onPlayAgain?: () => void;
  /** Closes the game and returns to the idle screen (spec §7). */
  onClose?: () => void;
  turn?: unknown;
  onTurnAction?: (a: unknown) => void;
  multiplayer?: boolean;
}

const SLOT_COUNT = 5;
const SIM_LINEUPS = 300; // random valid lineups graded against
const REVEAL_STEP_MS = 260; // stagger between per-slot metric reveals (spec Rule 7.2)
const REVEAL_LEAD_MS = 300; // lead-in before the first reveal (spec Rule 7.2)
const END_DELAY = 1200; // let the grade land before handing back the score
const CURRENT_YEAR = new Date().getFullYear();

const headshotUrl = (personId: number) =>
  `https://cdn.nba.com/headshots/nba/latest/1040x760/${personId}.png`;

/** A drafted player, flattened from a precomputed eligible tuple — everything
 *  past the slot board (objectives, grading, JSX) reads this shape only. */
type Pick = {
  person_id: number;
  full_name: string;
  height_in: number | null;
  rings: number;
  career_pts: number;
  birth_year: number | null;
};

// ----- Objectives (canonical: the renderer owns them) -----
type MetricKey = "height_in" | "rings" | "career_pts" | "birth_year_desc";
interface Objective {
  key: string;
  label: string;
  metric: MetricKey;
  eyebrow: string;
  /** Goodness contribution for one player (higher is always better). */
  perPick: (p: Pick) => number;
  /** Per-pick display of the metric. */
  fmtPick: (p: Pick) => string;
  /** How the five per-pick values combine for the headline number. */
  aggregate: "sum" | "avg";
  /** Format the aggregated headline from the raw per-pick values. */
  fmtAgg: (values: number[]) => string;
  aggLabel: string;
}

const inchesToFtIn = (inches: number) => {
  const safe = Math.max(0, Math.round(inches));
  const ft = Math.floor(safe / 12);
  const inch = safe % 12;
  return `${ft}'${inch}"`;
};
const heightOf = (p: Pick) => (typeof p.height_in === "number" ? p.height_in : 0);
const ageOf = (p: Pick) => (typeof p.birth_year === "number" ? CURRENT_YEAR - p.birth_year : 0);
const mean = (v: number[]) => (v.length ? v.reduce((a, b) => a + b, 0) / v.length : 0);
const sum = (v: number[]) => v.reduce((a, b) => a + b, 0);

const OBJECTIVES: Objective[] = [
  {
    key: "tallest",
    label: "Tallest Five",
    metric: "height_in",
    eyebrow: "Build the biggest frontcourt",
    perPick: heightOf,
    fmtPick: (p) => inchesToFtIn(heightOf(p)),
    aggregate: "avg",
    fmtAgg: (v) => inchesToFtIn(mean(v)),
    aggLabel: "Avg height",
  },
  {
    key: "rings",
    label: "Most Rings",
    metric: "rings",
    eyebrow: "Stack the most championships",
    perPick: (p) => p.rings,
    fmtPick: (p) => String(p.rings),
    aggregate: "sum",
    fmtAgg: (v) => String(Math.round(sum(v))),
    aggLabel: "Total rings",
  },
  {
    key: "points",
    label: "Most Career Points",
    metric: "career_pts",
    eyebrow: "Draft the biggest scorers",
    perPick: (p) => p.career_pts,
    fmtPick: (p) => p.career_pts.toLocaleString("en-US"),
    aggregate: "sum",
    fmtAgg: (v) => Math.round(sum(v)).toLocaleString("en-US"),
    aggLabel: "Total points",
  },
  {
    key: "oldest",
    label: "Oldest Five",
    metric: "birth_year_desc",
    eyebrow: "Assemble the wisest veterans",
    perPick: ageOf,
    fmtPick: (p) => `${ageOf(p)} yrs`,
    aggregate: "avg",
    fmtAgg: (v) => `${Math.round(mean(v))} yrs`,
    aggLabel: "Avg age",
  },
];

// Solo: one objective per local calendar day, stable within the day.
function dailyObjective(): Objective {
  const d = new Date();
  const ymd = d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();
  let h = ymd >>> 0;
  h = ((h ^ (h >>> 13)) * 0x9e3779b1) >>> 0; // cheap avalanche so adjacent days differ
  return OBJECTIVES[h % OBJECTIVES.length];
}

// Online: the dealt question carries no day (spec §7.4), so the objective is
// derived from its qid — data every member of the room holds byte-identically,
// including after a reconnect — never from each client's own clock.
function objectiveForQid(qid: string): Objective {
  return OBJECTIVES[hashStr(qid) % OBJECTIVES.length];
}

// Build a Pick from a precomputed eligible tuple, naming it through the shared
// names list.
const toPickFromTuple = (t: SuperDraftSlot["eligible"][number], name: string): Pick => ({
  person_id: t[0],
  full_name: name,
  height_in: t[1],
  rings: t[2],
  career_pts: t[3],
  birth_year: t[4],
});

const randInt = (n: number) => Math.floor(Math.random() * n);

/** The render/scoring shape of one slot on the board. */
interface DraftSlot {
  kind: SuperDraftSlot["kind"];
  value: string;
  label: string;
  sub: string;
  eligible: Pick[];
}

const slotFromQuestion = (s: SuperDraftSlot, lookup: ReturnType<typeof buildNameLookup>): DraftSlot => ({
  kind: s.kind,
  value: s.value,
  label: s.label,
  sub: s.sub,
  eligible: s.eligible.map((t) => toPickFromTuple(t, lookup.nameOf(t[0]) ?? `#${t[0]}`)),
});

interface GuessEntry {
  question_id: string;
  answer: string;
  correct: boolean;
  elapsed_ms: number;
}

/** Orange silhouette used when a headshot can't load — never breaks the card. */
function Silhouette() {
  return (
    <svg viewBox="0 0 64 72" className="sd-silhouette" aria-hidden="true">
      <circle cx="32" cy="26" r="13" />
      <path d="M8 72 C8 54 22 47 32 47 C42 47 56 54 56 72 Z" />
    </svg>
  );
}

function Headshot({ player }: { player: Pick }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [player.person_id]);
  if (failed) return <Silhouette />;
  return (
    <img
      className="sd-photo"
      src={headshotUrl(player.person_id)}
      alt=""
      onError={() => setFailed(true)}
      draggable={false}
    />
  );
}

type Phase = "loading" | "error" | "draft" | "reveal";

export default function SuperDraft({
  gameInfo,
  onGameEnd,
  onPlayAgain,
  onClose,
  multiplayer,
}: SuperDraftProps) {
  // The round IS the question, however it arrived (fetched solo, dealt online).
  // Held in state because a solo re-roll swaps it for a fresh one.
  const [question, setQuestion] = useState<SuperDraftQuestion | null>(
    (gameInfo[0] as SuperDraftQuestion) ?? null,
  );
  // Solo: the local daily objective (unchanged). Online: derived from the
  // dealt question's qid so both clients grade against the same one.
  const objective = useMemo(
    () => (multiplayer && question ? objectiveForQid(question.qid) : dailyObjective()),
    [multiplayer, question],
  );
  const [phase, setPhase] = useState<Phase>("loading");
  const [slots, setSlots] = useState<DraftSlot[]>([]);
  const [picks, setPicks] = useState<(Pick | null)[]>([]);
  const [draftValue, setDraftValue] = useState("");
  const [rerollUsed, setRerollUsed] = useState(false);
  const [percentile, setPercentile] = useState(0);
  const [revealCount, setRevealCount] = useState(0); // how many slot metrics are shown
  const [showResult, setShowResult] = useState(false);
  const [copied, setCopied] = useState(false);
  const [showPopup, setShowPopup] = useState(false);
  const [popup, setPopup] = useState({ Text: "", Color: "" });
  const reduce = useReducedMotion();

  // Shared names list (id <-> full name, aliases) — the eligible tuples' ids
  // resolve through it, and so does a typed pick.
  const names = useNames();
  const lookup = useMemo(() => (names ? buildNameLookup(names) : null), [names]);

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
      body: JSON.stringify({ game: "superdraft", entries }),
    }).catch(() => {
      /* analytics only */
    });
  };

  // ----- A fresh gameInfo payload (mount / play-again / a new online round)
  // resets the round and adopts its question; reroll() below swaps `question`
  // without going through this reset (rerollUsed must stay true for the rest
  // of the game). -----
  useEffect(() => {
    clearTimers();
    setRerollUsed(false);
    setPercentile(0);
    setRevealCount(0);
    setShowResult(false);
    setCopied(false);
    setShowPopup(false);
    endedRef.current = false;
    setQuestion((gameInfo[0] as SuperDraftQuestion) ?? null);
  }, [gameInfo]);

  // ----- Derive the slot board from the current question once the shared
  // names list is ready. Runs again on a solo reroll (new question). -----
  useEffect(() => {
    setDraftValue("");
    guessLogRef.current = [];
    startRef.current = Date.now();

    if (!question || !lookup) {
      setSlots([]);
      setPicks([]);
      setPhase("loading");
      return;
    }
    if (question.slots.length < SLOT_COUNT) {
      setSlots([]);
      setPicks([]);
      setPhase("error");
      return;
    }
    setSlots(question.slots.map((s) => slotFromQuestion(s, lookup)));
    setPicks(Array(SLOT_COUNT).fill(null));
    setPhase("draft");
  }, [question, lookup]);

  // Unmount: cancel pending reveals/end-calls and flush any un-sent guesses.
  useEffect(
    () => () => {
      clearTimers();
      sendGuessLog();
    },
    [],
  );

  const flashPopup = (text: string, color: string) => {
    setPopup({ Text: text, Color: color });
    setShowPopup(true);
    later(() => setShowPopup(false), 1500);
  };

  const currentSlotIndex = picks.findIndex((p) => p === null);
  const pickedIds = new Set(picks.filter(Boolean).map((p) => (p as Pick).person_id));

  // Names offered for the active slot: eligible, minus anyone already drafted.
  const activeSuggestions = useMemo(() => {
    if (currentSlotIndex < 0 || !slots[currentSlotIndex]) return [];
    return slots[currentSlotIndex].eligible
      .filter((p) => !pickedIds.has(p.person_id))
      .map((p) => p.full_name);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentSlotIndex, slots, picks]);

  // Grade the finished lineup: percentile vs SIM_LINEUPS random valid lineups.
  const grade = (finalPicks: Pick[]): number => {
    const myScore = sum(finalPicks.map((p) => objective.perPick(p)));
    let atOrBelow = 0;
    for (let i = 0; i < SIM_LINEUPS; i++) {
      const used = new Set<number>();
      let s = 0;
      for (const slot of slots) {
        // Draft a distinct random eligible player for this slot.
        let pick: Pick | null = null;
        for (let tries = 0; tries < 6; tries++) {
          const cand = slot.eligible[randInt(slot.eligible.length)];
          if (!used.has(cand.person_id)) {
            pick = cand;
            break;
          }
        }
        if (!pick) pick = slot.eligible[randInt(slot.eligible.length)];
        used.add(pick.person_id);
        s += objective.perPick(pick);
      }
      if (s <= myScore) atOrBelow++;
    }
    return Math.max(0, Math.min(100, Math.round((atOrBelow / SIM_LINEUPS) * 100)));
  };

  const finish = (finalPicks: Pick[]) => {
    if (endedRef.current) return;
    endedRef.current = true;
    const pct = grade(finalPicks);
    setPercentile(pct);
    setPhase("reveal");
    sendGuessLog();

    // Stagger the per-slot metric reveals, then the headline, then hand back.
    // Every slot's metric is hidden until now (none are "already solved" during
    // the draft), so all five are legitimately staggered — spec Rule 7.2.
    for (let i = 0; i < SLOT_COUNT; i++) {
      later(() => setRevealCount(i + 1), REVEAL_LEAD_MS + i * REVEAL_STEP_MS);
    }
    later(() => setShowResult(true), REVEAL_LEAD_MS + SLOT_COUNT * REVEAL_STEP_MS + 200);
    // inPlace: the bespoke .sd-result panel below IS the end screen (spec §7).
    later(() => onGameEnd?.(pct, { inPlace: true }), REVEAL_LEAD_MS + SLOT_COUNT * REVEAL_STEP_MS + 200 + END_DELAY);
  };

  const submitPick = (raw: string) => {
    if (phase !== "draft") return;
    const idx = currentSlotIndex;
    if (idx < 0) return;
    const slot = slots[idx];
    const norm = normalizeAnswer(raw);
    if (!norm) return;
    // Resolve the guess against the shared names list, then find that id
    // inside this slot's precomputed eligible tuples — both modes.
    const id = lookup?.toId(raw) ?? null;
    const match: Pick | undefined =
      id !== null ? slot.eligible.find((p) => p.person_id === id && !pickedIds.has(p.person_id)) : undefined;

    if (!match) {
      // Distinguish "already drafted" / "not in this pool" for a helpful nudge.
      const already = id !== null && pickedIds.has(id);
      guessLogRef.current.push({
        question_id: `${slot.kind}:${slot.value}`,
        answer: raw,
        correct: false,
        elapsed_ms: Date.now() - startRef.current,
      });
      flashPopup(already ? "Already drafted" : `Not in ${slot.label}`, "var(--bad)");
      return;
    }

    guessLogRef.current.push({
      question_id: `${slot.kind}:${slot.value}`,
      answer: match.full_name,
      correct: true,
      elapsed_ms: Date.now() - startRef.current,
    });

    const next = [...picks];
    next[idx] = match;
    setPicks(next);
    setDraftValue("");
    flashPopup(`${match.full_name} drafted`, "var(--good)");

    if (next.every((p) => p !== null)) {
      later(() => finish(next as Pick[]), 350);
    }
  };

  // Solo only: a reroll now means "get a different pre-generated draft board"
  // (fetchQuestion) rather than locally redrawing from a pool solo no longer
  // has. Online the room shares one server-drawn set of slots; a local
  // re-roll would put the two players back on different drafts.
  const reroll = async () => {
    if (multiplayer || rerollUsed || phase !== "draft") return;
    setRerollUsed(true);
    setPhase("loading");
    const res = await fetchQuestion("superdraft");
    if (!res.success || !res.data?.length) {
      setPhase("error");
      return;
    }
    setQuestion(res.data[0] as SuperDraftQuestion);
    flashPopup("Pools re-rolled", "var(--muted)");
  };

  const shareText = () => {
    const filled = picks.filter(Boolean) as Pick[];
    const values = filled.map((p) => objective.perPick(p));
    const lines = slots.map((s, i) => {
      const p = picks[i];
      return p ? `${s.label}: ${p.full_name} (${objective.fmtPick(p)})` : `${s.label}: —`;
    });
    return [
      `SuperDraft Five: ${objective.label}`,
      ...lines,
      `${objective.aggLabel}: ${objective.fmtAgg(values)}`,
      `Top ${100 - percentile}% • ${percentile}/100`,
    ].join("\n");
  };

  const copyShare = () => {
    const text = shareText();
    const done = () => {
      setCopied(true);
      later(() => setCopied(false), 1800);
    };
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(text).then(done).catch(done);
    } else {
      done();
    }
  };

  // ----- Loading / error states (no frame: the shell already centres them) -----
  if (phase === "loading") {
    return <Spinner label="Opening the draft room…" />;
  }
  if (phase === "error") {
    return (
      <div className="sd-state" role="alert">
        <span className="sd-state-title font-display">Draft room unavailable</span>
        <span className="sd-state-msg">
          Not enough player pools to build a draft right now. Please try again later.
        </span>
        {(onPlayAgain || onClose) && (
          <div className="sd-result-actions">
            {onPlayAgain && (
              <Button size="sm" block onClick={onPlayAgain}>
                Play again
              </Button>
            )}
            {onClose && (
              <Button size="sm" block variant="secondary" onClick={onClose}>
                Close game
              </Button>
            )}
          </div>
        )}
      </div>
    );
  }

  const filledCount = picks.filter(Boolean).length;
  const revealing = phase === "reveal";
  const drafting = !revealing && currentSlotIndex >= 0;
  const filledValues = (picks.filter(Boolean) as Pick[]).map((p) => objective.perPick(p));

  return (
    // fill: the slot list is the scroller (`.sd-slots` is flex:1 1 auto + overflow-y:auto).
    <GameFrame fill>
      <GameFrame.Status
        left={<GameFrame.Label>DRAFT YOUR FIVE</GameFrame.Label>}
        right={<GameFrame.Score value={filledCount} label="DRAFTED" />}
      />

      <ProgressBar value={filledCount} max={SLOT_COUNT} />

      <GameFrame.Prompt eyebrow={objective.eyebrow} title={objective.label} />

      {/* Slot list. The re-roll sits in its own right-aligned row directly above
          the first card so it lines up with the cards' right edge. It is reserved
          at a fixed height/width so swapping "Re-roll x1" → "Re-roll used" (or the
          row disappearing once drafting ends) never shifts the cards. */}
      <GameFrame.Board>
      <div className="sd-tools">
        {drafting && !multiplayer && (
          <Button
            size="sm"
            variant="secondary"
            className="sd-reroll"
            onClick={reroll}
            disabled={rerollUsed}
            aria-label={rerollUsed ? "Re-roll already used" : "Re-roll all pools (one per game)"}
          >
            <SwapText>{rerollUsed ? "Re-roll used" : "Re-roll ×1"}</SwapText>
          </Button>
        )}
      </div>
      <ul className="sd-slots">
        {slots.map((slot, i) => {
          const p = picks[i];
          const isActive = !revealing && i === currentSlotIndex;
          const metricShown = revealing && i < revealCount;
          return (
            <li
              key={`${slot.kind}:${slot.value}`}
              className={`sd-slot${p ? " is-filled" : ""}${isActive ? " is-active" : ""}`}
            >
              <span className="sd-slot-no tnum" aria-hidden="true">
                {i + 1}
              </span>
              <div className="sd-slot-body">
                <div className="sd-slot-head">
                  <span className="sd-slot-label font-display">{slot.label}</span>
                  <span className={`sd-slot-sub sd-slot-sub--${slot.kind}`}>{slot.sub}</span>
                </div>
                <span className="sd-slot-pick font-display">
                  {p ? p.full_name : isActive ? "Drafting…" : "Empty"}
                </span>
              </div>
              <div className="sd-slot-right">
                {p ? (
                  <div className="sd-slot-face">
                    <Headshot player={p} />
                  </div>
                ) : (
                  <div className="sd-slot-face sd-slot-face--empty" aria-hidden="true">
                    <Silhouette />
                  </div>
                )}
                <AnimatePresence>
                  {metricShown && p && (
                    <motion.span
                      className="sd-slot-metric tnum"
                      initial={reduce ? false : { opacity: 0, scale: 0.7 }}
                      animate={{ opacity: 1, scale: 1 }}
                      transition={{ duration: 0.28 }}
                    >
                      {objective.fmtPick(p)}
                    </motion.span>
                  )}
                </AnimatePresence>
              </div>
            </li>
          );
        })}
      </ul>
      </GameFrame.Board>

      {/* Draft row, then the bespoke result panel (accepted deviation — it owns
          the Share action). Always mounted; Action renders nothing when empty. */}
      <GameFrame.Action>
      {drafting && (
        <GameFrame.InputRow>
          <AutocompleteInput
            placeholder={`${slots[currentSlotIndex].label} player…`}
            value={draftValue}
            setValue={setDraftValue}
            suggestions={activeSuggestions}
            onSubmit={() => submitPick(draftValue)}
            customStyleInput={{ width: "100%", height: "44px", padding: "0 12px", fontSize: "0.9rem" }}
            customStyleSuggestion={{ fontSize: "0.82rem", maxHeight: "168px", minWidth: "100%" }}
          />
          <Button
            size="md"
            aria-label="Confirm pick"
            onClick={() => submitPick(draftValue)}
            disabled={!draftValue.trim()}
          >
            Draft
          </Button>
        </GameFrame.InputRow>
      )}

      <AnimatePresence>
        {showResult && (
          <motion.div
            className="sd-result"
            initial={reduce ? false : { opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.32 }}
          >
            <div className="sd-result-top">
              <div className="sd-result-grade">
                <span className="sd-result-pct tnum font-display">{percentile}</span>
                <span className="sd-result-pct-of tnum">/100</span>
              </div>
              <div className="sd-result-meta">
                <span className="sd-result-agg">
                  {objective.aggLabel}: <strong className="tnum">{objective.fmtAgg(filledValues)}</strong>
                </span>
                <span className="sd-result-rank tnum">Beats {percentile}% of random lineups</span>
              </div>
            </div>
            <button type="button" className="sd-share" onClick={copyShare}>
              <SwapText>{copied ? "Copied!" : "Share result"}</SwapText>
            </button>
            {(onPlayAgain || onClose) && (
              <div className="sd-result-actions">
                {onPlayAgain && (
                  <Button size="sm" block onClick={onPlayAgain}>
                    Play again
                  </Button>
                )}
                {onClose && (
                  <Button size="sm" block variant="secondary" onClick={onClose}>
                    Close game
                  </Button>
                )}
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
      </GameFrame.Action>

      <SubmitGuessPopup show={showPopup} text={popup.Text} color={popup.Color} />
    </GameFrame>
  );
}
