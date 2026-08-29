// SuperDraft Five — build a starting five under a rotating daily objective.
// A daily objective (Tallest Five / Most Rings / Most Career Points / Oldest
// Five) is picked by date-hash. Five slots each draw a RANDOM pool constraint
// (a franchise / a country / a draft decade) guaranteed >= 8 eligible players
// from the players-index pool (gameInfo). Draft one player per slot via an
// autocomplete filtered to that slot's eligible names; each player is usable
// once. After five picks the lineup's metric is graded as a percentile against
// 300 random valid lineups simulated client-side, and onGameEnd(percentile) is
// called exactly once. One slot re-roll per game reshuffles all constraints.
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
import { BACKEND_ORIGIN } from "../configurations/backend";
import { apiFetch } from "../utils/Api";
import { normalizeAnswer } from "../utils/answerMatch";
import type { PlayerIndexEntry, OnGameEnd } from "../types/types";
import "../styles/SuperDraft.css";

export interface SuperDraftProps {
  gameInfo: PlayerIndexEntry[];
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
const MIN_ELIGIBLE = 8; // every slot constraint must offer at least this many players
const SIM_LINEUPS = 300; // random valid lineups graded against
const REVEAL_STEP_MS = 260; // stagger between per-slot metric reveals (spec Rule 7.2)
const REVEAL_LEAD_MS = 300; // lead-in before the first reveal (spec Rule 7.2)
const END_DELAY = 1200; // let the grade land before handing back the score
const CURRENT_YEAR = new Date().getFullYear();

const headshotUrl = (personId: number) =>
  `https://cdn.nba.com/headshots/nba/latest/1040x760/${personId}.png`;

// ----- Objectives (canonical; mirrors superdraft_seed.json) -----
type MetricKey = "height_in" | "rings" | "career_pts" | "birth_year_desc";
interface Objective {
  key: string;
  label: string;
  metric: MetricKey;
  eyebrow: string;
  /** Goodness contribution for one player (higher is always better). */
  perPick: (p: PlayerIndexEntry) => number;
  /** Per-pick display of the metric. */
  fmtPick: (p: PlayerIndexEntry) => string;
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
const heightOf = (p: PlayerIndexEntry) => (typeof p.height_in === "number" ? p.height_in : 0);
const ageOf = (p: PlayerIndexEntry) =>
  typeof p.birth_year === "number" ? CURRENT_YEAR - p.birth_year : 0;
const ringsOf = (p: PlayerIndexEntry) => (Array.isArray(p.awards?.rings) ? p.awards.rings.length : 0);
const ptsOf = (p: PlayerIndexEntry) => (typeof p.career?.pts === "number" ? p.career.pts : 0);
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
    perPick: ringsOf,
    fmtPick: (p) => String(ringsOf(p)),
    aggregate: "sum",
    fmtAgg: (v) => String(Math.round(sum(v))),
    aggLabel: "Total rings",
  },
  {
    key: "points",
    label: "Most Career Points",
    metric: "career_pts",
    eyebrow: "Draft the biggest scorers",
    perPick: ptsOf,
    fmtPick: (p) => ptsOf(p).toLocaleString("en-US"),
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

// Pick one objective per calendar day (local date), stable within the day.
function dailyObjective(): Objective {
  const d = new Date();
  const ymd = d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();
  let h = ymd >>> 0;
  h = ((h ^ (h >>> 13)) * 0x9e3779b1) >>> 0; // cheap avalanche so adjacent days differ
  return OBJECTIVES[h % OBJECTIVES.length];
}

// ----- Slot constraints (random pools) -----
type ConstraintKind = "team" | "country" | "draft";
interface SlotConstraint {
  kind: ConstraintKind;
  value: string;
  label: string;
  sub: string;
  eligible: PlayerIndexEntry[];
}

const randInt = (n: number) => Math.floor(Math.random() * n);
function shuffled<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = randInt(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Every candidate pool constraint with >= MIN_ELIGIBLE eligible players,
// grouped by kind so slots can be drawn with variety.
function buildCandidates(pool: PlayerIndexEntry[]): Record<ConstraintKind, SlotConstraint[]> {
  const teams = new Map<string, { name: string; players: PlayerIndexEntry[] }>();
  const countries = new Map<string, PlayerIndexEntry[]>();
  const decades = new Map<number, PlayerIndexEntry[]>();

  for (const p of pool) {
    const seenAbbr = new Set<string>();
    for (const t of p.teams ?? []) {
      if (!t?.abbr || seenAbbr.has(t.abbr)) continue;
      seenAbbr.add(t.abbr);
      const entry = teams.get(t.abbr) ?? { name: t.name || t.abbr, players: [] };
      entry.players.push(p);
      teams.set(t.abbr, entry);
    }
    if (p.country) {
      const arr = countries.get(p.country) ?? [];
      arr.push(p);
      countries.set(p.country, arr);
    }
    if (p.draft) {
      const dec = Math.floor(p.draft.year / 10) * 10;
      const arr = decades.get(dec) ?? [];
      arr.push(p);
      decades.set(dec, arr);
    }
  }

  const teamC: SlotConstraint[] = [];
  for (const [abbr, { name, players }] of teams) {
    if (players.length >= MIN_ELIGIBLE)
      teamC.push({ kind: "team", value: abbr, label: name, sub: "Franchise", eligible: players });
  }
  const countryC: SlotConstraint[] = [];
  for (const [country, players] of countries) {
    if (players.length >= MIN_ELIGIBLE)
      countryC.push({ kind: "country", value: country, label: country, sub: "Country", eligible: players });
  }
  const draftC: SlotConstraint[] = [];
  for (const [dec, players] of decades) {
    if (players.length >= MIN_ELIGIBLE)
      draftC.push({
        kind: "draft",
        value: String(dec),
        label: `${dec}s Draft`,
        sub: "Draft class",
        eligible: players,
      });
  }
  return { team: teamC, country: countryC, draft: draftC };
}

// Round-robin across kinds so a draft mixes franchises / countries / decades.
function drawSlots(cands: Record<ConstraintKind, SlotConstraint[]>): SlotConstraint[] {
  const queues: SlotConstraint[][] = [
    shuffled(cands.team),
    shuffled(cands.draft),
    shuffled(cands.country),
  ];
  const picked: SlotConstraint[] = [];
  const usedValues = new Set<string>();
  let q = 0;
  let guard = 0;
  while (picked.length < SLOT_COUNT && guard < 200) {
    guard++;
    const queue = queues[q % queues.length];
    q++;
    const next = queue.shift();
    if (!next) continue;
    const id = `${next.kind}:${next.value}`;
    if (usedValues.has(id)) continue;
    usedValues.add(id);
    picked.push(next);
  }
  return picked;
}

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

function Headshot({ player }: { player: PlayerIndexEntry }) {
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

export default function SuperDraft({ gameInfo, onGameEnd, onPlayAgain, onClose }: SuperDraftProps) {
  const objective = useMemo(() => dailyObjective(), []);
  const [phase, setPhase] = useState<Phase>("loading");
  const [slots, setSlots] = useState<SlotConstraint[]>([]);
  const [picks, setPicks] = useState<(PlayerIndexEntry | null)[]>([]);
  const [draftValue, setDraftValue] = useState("");
  const [rerollUsed, setRerollUsed] = useState(false);
  const [percentile, setPercentile] = useState(0);
  const [revealCount, setRevealCount] = useState(0); // how many slot metrics are shown
  const [showResult, setShowResult] = useState(false);
  const [copied, setCopied] = useState(false);
  const [showPopup, setShowPopup] = useState(false);
  const [popup, setPopup] = useState({ Text: "", Color: "" });
  const reduce = useReducedMotion();

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

  const candidates = useMemo(() => buildCandidates(gameInfo ?? []), [gameInfo]);
  const candidateCount = candidates.team.length + candidates.country.length + candidates.draft.length;

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

  // Fresh draft whenever the pool changes (play-again / new payload).
  useEffect(() => {
    clearTimers();
    setDraftValue("");
    setRerollUsed(false);
    setPercentile(0);
    setRevealCount(0);
    setShowResult(false);
    setCopied(false);
    setShowPopup(false);
    endedRef.current = false;
    guessLogRef.current = [];
    startRef.current = Date.now();

    if (candidateCount < SLOT_COUNT) {
      setSlots([]);
      setPicks([]);
      setPhase("error");
      return;
    }
    const drawn = drawSlots(candidates);
    if (drawn.length < SLOT_COUNT) {
      setSlots([]);
      setPicks([]);
      setPhase("error");
      return;
    }
    setSlots(drawn);
    setPicks(Array(SLOT_COUNT).fill(null));
    setPhase("draft");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gameInfo]);

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
  const pickedIds = new Set(picks.filter(Boolean).map((p) => (p as PlayerIndexEntry).person_id));

  // Names offered for the active slot: eligible, minus anyone already drafted.
  const activeSuggestions = useMemo(() => {
    if (currentSlotIndex < 0 || !slots[currentSlotIndex]) return [];
    return slots[currentSlotIndex].eligible
      .filter((p) => !pickedIds.has(p.person_id))
      .map((p) => p.full_name);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentSlotIndex, slots, picks]);

  // Grade the finished lineup: percentile vs SIM_LINEUPS random valid lineups.
  const grade = (finalPicks: PlayerIndexEntry[]): number => {
    const myScore = sum(finalPicks.map((p) => objective.perPick(p)));
    let atOrBelow = 0;
    for (let i = 0; i < SIM_LINEUPS; i++) {
      const used = new Set<number>();
      let s = 0;
      for (const slot of slots) {
        // Draft a distinct random eligible player for this slot.
        let pick: PlayerIndexEntry | null = null;
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

  const finish = (finalPicks: PlayerIndexEntry[]) => {
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

    const match = slot.eligible.find(
      (p) =>
        !pickedIds.has(p.person_id) &&
        (normalizeAnswer(p.full_name) === norm ||
          (p.aliases ?? []).some((a) => normalizeAnswer(a) === norm)),
    );

    if (!match) {
      // Distinguish "already drafted" / "not in this pool" for a helpful nudge.
      const already = slot.eligible.find(
        (p) => pickedIds.has(p.person_id) && normalizeAnswer(p.full_name) === norm,
      );
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
      later(() => finish(next as PlayerIndexEntry[]), 350);
    }
  };

  const reroll = () => {
    if (rerollUsed || phase !== "draft") return;
    const drawn = drawSlots(candidates);
    if (drawn.length < SLOT_COUNT) return;
    setRerollUsed(true);
    setSlots(drawn);
    setPicks(Array(SLOT_COUNT).fill(null));
    setDraftValue("");
    guessLogRef.current = [];
    startRef.current = Date.now();
    flashPopup("Pools re-rolled", "var(--muted)");
  };

  const shareText = () => {
    const filled = picks.filter(Boolean) as PlayerIndexEntry[];
    const values = filled.map((p) => objective.perPick(p));
    const lines = slots.map((s, i) => {
      const p = picks[i];
      return p ? `${s.label}: ${p.full_name} (${objective.fmtPick(p)})` : `${s.label}: —`;
    });
    return [
      `SuperDraft Five — ${objective.label}`,
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
      </div>
    );
  }

  const filledCount = picks.filter(Boolean).length;
  const revealing = phase === "reveal";
  const drafting = !revealing && currentSlotIndex >= 0;
  const filledValues = (picks.filter(Boolean) as PlayerIndexEntry[]).map((p) => objective.perPick(p));

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
        {drafting && (
          <Button
            size="sm"
            variant="secondary"
            className="sd-reroll"
            onClick={reroll}
            disabled={rerollUsed}
            aria-label={rerollUsed ? "Re-roll already used" : "Re-roll all pools (one per game)"}
          >
            {rerollUsed ? "Re-roll used" : "Re-roll ×1"}
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
              {copied ? "Copied!" : "Share result"}
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
