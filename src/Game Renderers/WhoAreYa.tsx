import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import AutocompleteInput from "../components/AutoCompleteInput";
import SubmitGuessPopup from "../components/SubmitGuessPopUp";
import { Button, CourtLoader } from "../components/ui";
import { BACKEND_ORIGIN } from "../configurations/backend";
import { apiFetch } from "../utils/Api";
import { fetchWholePool } from "../utils/pool";
import { matchAnswer, normalizeAnswer } from "../utils/answerMatch";
import type { PlayerIndexEntry, PlayerTeamStint, OnGameEnd, GameError } from "../types/types";
import "../styles/WhoAreYa.css";

export interface WhoAreYaProps {
  gameInfo: PlayerIndexEntry[];
  onGameEnd: OnGameEnd;
  turn?: unknown;
  onTurnAction?: (a: unknown) => void;
  multiplayer?: boolean;
}

const MAX_SCORE = 240;
const COST_PER_WRONG = 30;
const MAX_GUESSES = 8;
/** blur(px) after 0..7 wrong guesses; index clamps at the end. */
const BLUR_STEPS = [26, 20, 15, 11, 8, 5, 2, 0];

const headshotUrl = (personId: number) =>
  `https://cdn.nba.com/headshots/nba/latest/1040x760/${personId}.png`;

/** Franchise abbr -> conference/division (current NBA alignment). */
const TEAM_META: Record<string, { conference: "East" | "West"; division: string }> = {
  BOS: { conference: "East", division: "Atlantic" },
  BKN: { conference: "East", division: "Atlantic" },
  NYK: { conference: "East", division: "Atlantic" },
  PHI: { conference: "East", division: "Atlantic" },
  TOR: { conference: "East", division: "Atlantic" },
  CHI: { conference: "East", division: "Central" },
  CLE: { conference: "East", division: "Central" },
  DET: { conference: "East", division: "Central" },
  IND: { conference: "East", division: "Central" },
  MIL: { conference: "East", division: "Central" },
  ATL: { conference: "East", division: "Southeast" },
  CHA: { conference: "East", division: "Southeast" },
  MIA: { conference: "East", division: "Southeast" },
  ORL: { conference: "East", division: "Southeast" },
  WAS: { conference: "East", division: "Southeast" },
  DEN: { conference: "West", division: "Northwest" },
  MIN: { conference: "West", division: "Northwest" },
  OKC: { conference: "West", division: "Northwest" },
  POR: { conference: "West", division: "Northwest" },
  UTA: { conference: "West", division: "Northwest" },
  GSW: { conference: "West", division: "Pacific" },
  LAC: { conference: "West", division: "Pacific" },
  LAL: { conference: "West", division: "Pacific" },
  PHX: { conference: "West", division: "Pacific" },
  SAC: { conference: "West", division: "Pacific" },
  DAL: { conference: "West", division: "Southwest" },
  HOU: { conference: "West", division: "Southwest" },
  MEM: { conference: "West", division: "Southwest" },
  NOP: { conference: "West", division: "Southwest" },
  SAS: { conference: "West", division: "Southwest" },
};

export type ChipState = "hit" | "close" | "miss" | "na";
export interface ChipVal { text: string; state: ChipState; arrow?: "up" | "down" }
export interface FeedbackRow {
  key: string;          // person_id — stable list key
  name: string;
  correct: boolean;
  conf: ChipVal; div: ChipVal; team: ChipVal;
  pos: ChipVal; age: ChipVal; jersey: ChipVal; draft: ChipVal;
}

/** Current team = stint with the greatest start_year (contract: last stint). */
const currentTeam = (p: PlayerIndexEntry): PlayerTeamStint =>
  p.teams.reduce((a, b) => (b.start_year >= a.start_year ? b : a), p.teams[0]);

const posFamily = (pos: PlayerIndexEntry["position"]) => new Set(pos.split("-"));
const familiesOverlap = (a: PlayerIndexEntry["position"], b: PlayerIndexEntry["position"]) =>
  [...posFamily(a)].some((x) => posFamily(b).has(x));

const THIS_YEAR = new Date().getFullYear();
const ageOf = (p: PlayerIndexEntry) => (p.birth_year == null ? null : THIS_YEAR - p.birth_year);

/** Numeric chip: exact=hit, |diff|<=closeWithin=close, arrow points toward the mystery value. */
function numChip(guessVal: number | null, mysteryVal: number | null, closeWithin: number): ChipVal {
  if (guessVal == null || mysteryVal == null) {
    return { text: guessVal == null ? "—" : String(guessVal), state: "na" };
  }
  const diff = mysteryVal - guessVal;
  if (diff === 0) return { text: String(guessVal), state: "hit" };
  return {
    text: String(guessVal),
    state: Math.abs(diff) <= closeWithin ? "close" : "miss",
    arrow: diff > 0 ? "up" : "down",
  };
}

function buildFeedback(guess: PlayerIndexEntry, mystery: PlayerIndexEntry): FeedbackRow {
  const g = currentTeam(guess);
  const m = currentTeam(mystery);
  const gMeta = TEAM_META[g.abbr];
  const mMeta = TEAM_META[m.abbr];
  const confState: ChipState =
    !gMeta || !mMeta ? "na" : gMeta.conference === mMeta.conference ? "hit" : "miss";
  const divState: ChipState =
    !gMeta || !mMeta ? "na" : gMeta.division === mMeta.division ? "hit" : "miss";
  const posState: ChipState =
    guess.position === mystery.position ? "hit"
    : familiesOverlap(guess.position, mystery.position) ? "close" : "miss";

  let draftChip: ChipVal;
  if (guess.draft == null && mystery.draft == null) draftChip = { text: "Undrafted", state: "hit" };
  else if (guess.draft == null || mystery.draft == null)
    draftChip = { text: guess.draft == null ? "Undrafted" : String(guess.draft.year), state: "miss" };
  else draftChip = numChip(guess.draft.year, mystery.draft.year, 3);

  return {
    key: String(guess.person_id),
    name: guess.full_name,
    correct: guess.person_id === mystery.person_id,
    conf: { text: gMeta?.conference ?? "—", state: confState },
    div: { text: gMeta?.division ?? "—", state: divState },
    team: { text: g.abbr, state: g.abbr === m.abbr ? "hit" : "miss" },
    pos: { text: guess.position, state: posState },
    age: numChip(ageOf(guess), ageOf(mystery), 2),
    jersey: numChip(guess.jersey, mystery.jersey, 5),
    draft: draftChip,
  };
}

const isEligible = (p: PlayerIndexEntry) =>
  (p.fame_tier === 1 || p.fame_tier === 2) && p.teams.length > 0;

interface GuessEntry { question_id: string; answer: string; correct: boolean; elapsed_ms: number }

function WhoAreYa({ gameInfo, onGameEnd }: WhoAreYaProps) {
  const [pool, setPool] = useState<PlayerIndexEntry[] | null>(null);
  const [poolError, setPoolError] = useState<GameError | null>(null);
  const [mystery, setMystery] = useState<PlayerIndexEntry | null>(null);
  const [rows, setRows] = useState<FeedbackRow[]>([]);
  const [wrongCount, setWrongCount] = useState(0);
  const [guess, setGuess] = useState("");
  const [hidePhoto, setHidePhoto] = useState(false);
  const [photoFailed, setPhotoFailed] = useState(false);
  const [finished, setFinished] = useState(false);
  const [won, setWon] = useState(false);
  const [showPointsAnimation, setShowPointsAnimation] = useState(false);
  const [popUpInfo, setPopUpInfo] = useState({ Text: "", Color: "" });
  const guessLogRef = useRef<GuessEntry[]>([]);
  const startRef = useRef(Date.now());
  const timersRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  const reduce = useReducedMotion();

  // All delayed work goes through these so an exit/unmount can never fire a
  // stale onGameEnd (or setState) for an abandoned game.
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
      body: JSON.stringify({ game: "who-are-ya", entries }),
    }).catch(() => { /* analytics only */ });
  };

  // The whole curated pool: suggestions + name->attributes lookup. Cached by
  // fetchWholePool, so this is a no-op network-wise after the first game.
  useEffect(() => {
    let alive = true;
    fetchWholePool("players-index").then((res) => {
      if (!alive) return;
      if (res.success && res.data) setPool(res.data as PlayerIndexEntry[]);
      else setPoolError(res.error ?? { title: "No data available", message: "Please try again later." });
    });
    return () => { alive = false; };
  }, []);

  // Fresh state whenever a new round loads (play-again / multiplayer round).
  // Mystery: exactly-one-row payload = server-chosen (multiplayer, contract);
  // otherwise sample an eligible fame 1-2 player from the payload locally.
  useEffect(() => {
    clearTimers();
    const eligible = (gameInfo ?? []).filter(isEligible);
    if (gameInfo?.length === 1 && isEligible(gameInfo[0])) setMystery(gameInfo[0]);
    else if (eligible.length > 0) setMystery(eligible[Math.floor(Math.random() * eligible.length)]);
    else setMystery(null);
    setRows([]);
    setWrongCount(0);
    setGuess("");
    setHidePhoto(false);
    setPhotoFailed(false);
    setFinished(false);
    setWon(false);
    setShowPointsAnimation(false);
    guessLogRef.current = [];
    startRef.current = Date.now();
  }, [gameInfo]);

  // Unmount: cancel pending end-calls and flush any un-sent guesses (abandoned
  // sessions still feed the flywheel; no-op when already flushed).
  useEffect(() => () => { clearTimers(); sendGuessLog(); }, []);

  const flashPopup = (text: string, color: string) => {
    setPopUpInfo({ Text: text, Color: color });
    setShowPointsAnimation(true);
    later(() => setShowPointsAnimation(false), 1500);
  };

  const handleGuessSubmit = () => {
    if (!pool || !mystery || finished) return;
    const raw = guess;
    setGuess("");
    if (!normalizeAnswer(raw)) return;

    // Resolve the typed name to a pool player via canonical name + aliases.
    const idx = matchAnswer(raw, pool.map((p) => ({ answer: p.full_name, aliases: p.aliases })));
    if (idx < 0) { flashPopup("Not in our player pool", "var(--muted)"); return; } // costs nothing
    const guessed = pool[idx];
    if (rows.some((r) => r.key === String(guessed.person_id))) {
      flashPopup("Already tried", "var(--muted)"); return; // costs nothing
    }

    const row = buildFeedback(guessed, mystery);
    setRows((prev) => [row, ...prev]); // newest on top
    guessLogRef.current.push({
      question_id: String(mystery.person_id),
      answer: guessed.full_name,
      correct: row.correct,
      elapsed_ms: Date.now() - startRef.current,
    });

    if (row.correct) {
      const finalScore = MAX_SCORE - COST_PER_WRONG * wrongCount;
      setFinished(true);
      setWon(true);
      sendGuessLog();
      flashPopup(`That's ${mystery.full_name}! +${finalScore}`, "var(--good)");
      later(() => onGameEnd?.(finalScore), 2200);
      return;
    }

    const nextWrong = wrongCount + 1;
    setWrongCount(nextWrong);
    if (nextWrong >= MAX_GUESSES) {
      setFinished(true);
      sendGuessLog();
      flashPopup("Out of guesses", "var(--bad)");
      later(() => onGameEnd?.(0), 3200); // linger on the reveal card
    } else {
      flashPopup(`Not ${guessed.full_name} — photo sharpened`, "var(--bad)");
    }
  };

  /* ---- render states ---- */
  if (poolError)
    return (
      <div className="waya-state">
        <p className="waya-state-title">{poolError.title}</p>
        <p className="waya-state-msg">{poolError.message}</p>
      </div>
    );
  if (!pool) return <CourtLoader label="Loading players…" />;
  if (!mystery)
    return (
      <div className="waya-state">
        <p className="waya-state-title">No mystery player available</p>
        <p className="waya-state-msg">Please try again later.</p>
      </div>
    );

  const blurPx = finished ? 0 : BLUR_STEPS[Math.min(wrongCount, BLUR_STEPS.length - 1)];
  const suggestions = pool.filter(isEligible).map((p) => p.full_name);
  const guessesLeft = MAX_GUESSES - wrongCount;
  const mysteryStint = currentTeam(mystery);

  const chip = (label: string, v: ChipVal) => (
    <span className={`waya-chip is-${v.state}`}>
      <span className="waya-chip-label">{label}</span>
      <span className="waya-chip-val tnum">
        {v.text}{v.arrow ? (v.arrow === "up" ? " ▲" : " ▼") : ""}
      </span>
    </span>
  );

  return (
    <div className="waya-wrap">
      {/* Photo card — fixed frame so sharpening never shifts layout */}
      <div className="waya-photo-card">
        {(hidePhoto && !finished) || photoFailed ? (
          <svg viewBox="0 0 64 72" className="waya-silhouette"
            aria-label={hidePhoto ? "Photo hidden (hard mode)" : "Player photo unavailable"}>
            <circle cx="32" cy="26" r="13" />
            <path d="M8 72 C8 54 22 47 32 47 C42 47 56 54 56 72 Z" />
          </svg>
        ) : (
          <img
            className="waya-photo"
            src={headshotUrl(mystery.person_id)}
            alt="Mystery player headshot"
            style={{ filter: `blur(${blurPx}px)`, transition: reduce ? "none" : "filter 0.6s ease" }}
            onError={() => setPhotoFailed(true)}
            draggable={false}
          />
        )}
        <div className="waya-photo-meta">
          <span className="waya-left tnum" aria-live="polite">{guessesLeft} guesses left</span>
          <Button size="sm" variant="secondary" aria-pressed={hidePhoto}
            onClick={() => setHidePhoto((h) => !h)} disabled={finished}>
            {hidePhoto ? "Show photo" : "Hide photo"}
          </Button>
        </div>
      </div>

      {/* Reveal card (win or fail) */}
      <AnimatePresence>
        {finished && (
          <motion.div
            className={`waya-reveal${won ? " is-won" : ""}`}
            initial={reduce ? false : { opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.35 }}
          >
            <span className="waya-reveal-name font-display">{mystery.full_name}</span>
            <span className="waya-reveal-sub">
              {mysteryStint.name} · {mystery.position}
              {mystery.jersey != null ? ` · #${mystery.jersey}` : ""}
              {mystery.draft ? ` · Draft ${mystery.draft.year} #${mystery.draft.pick}` : " · Undrafted"}
            </span>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Feedback rows — newest on top, scrolls inside itself (page never scrolls) */}
      <div className="waya-feed" role="log" aria-label="Guess feedback">
        {rows.length === 0 && !finished && (
          <p className="waya-feed-empty">Guess a player — every miss sharpens the photo and drops a clue trail here.</p>
        )}
        <AnimatePresence initial={false}>
          {rows.map((r) => (
            <motion.div
              key={r.key}
              className={`waya-row${r.correct ? " is-correct" : ""}`}
              initial={reduce ? false : { opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.25 }}
            >
              <span className="waya-row-name">{r.name}</span>
              <div className="waya-chips">
                {chip("Conf", r.conf)}{chip("Div", r.div)}{chip("Team", r.team)}
                {chip("Pos", r.pos)}{chip("Age", r.age)}{chip("No.", r.jersey)}{chip("Draft", r.draft)}
              </div>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>

      {/* Input — anchored at the bottom of the play area */}
      <div className="waya-inputrow">
        <AutocompleteInput
          placeholder="Who are ya…?"
          value={guess}
          setValue={setGuess}
          suggestions={suggestions}
          onSubmit={handleGuessSubmit}
          customStyleInput={{ width: "100%", height: "44px", padding: "0 12px", fontSize: "0.85rem" }}
          customStyleSuggestion={{ fontSize: "0.8rem", maxHeight: "160px", minWidth: "100%" }}
        />
        <Button size="sm" aria-label="Confirm guess" onClick={handleGuessSubmit}
          disabled={finished || guess.trim() === ""}>
          Guess
        </Button>
      </div>

      <SubmitGuessPopup show={showPointsAnimation} text={popUpInfo.Text} color={popUpInfo.Color} />
    </div>
  );
}

export default WhoAreYa;
