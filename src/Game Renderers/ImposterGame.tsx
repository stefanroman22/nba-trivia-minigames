// NBA Imposter — a FRIEND-ROOM-ONLY social-deduction party game (3-5 players).
// The live game is server-authoritative (multiplayer_server/src/turnGames.js):
// this renderer only draws `state.imposter` (handed in via the `turn` prop) and
// emits player moves through `onTurnAction`. It never owns game logic.
//
// Two surfaces:
//   • OUT of a room (no `multiplayer`/`turn`): an EXPLAINER screen. It never
//     scores and NEVER calls onGameEnd — there is no solo path.
//   • IN a room (`turn` present): the three server phases — clue → vote →
//     reveal — with a role/mystery strip, a ring of player cards + clue bubbles,
//     a 45s deadline bar on the active step, and the final scoreboard.
//
// Conventions borrowed from TicTacToe (the peer turn game) + PackFive: state
// derived from the prop, a shared 500ms tick for the deadline, timersRef +
// later()/clearTimers() for every delayed call, and onGameEnd fired at most once
// (endedRef guard) once the reveal is finalized.
import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { useSelector } from "react-redux";
import AutocompleteInput from "../components/AutoCompleteInput";
import SubmitGuessPopup from "../components/SubmitGuessPopUp";
import { Button, CourtLoader } from "../components/ui";
import { playerKey, useMultiplayer } from "../context/MultiplayerContext";
import type { RootState } from "../store";
import type { OnGameEnd, PlayerIndexEntry } from "../types/types";
import "../styles/ImposterGame.css";

const CLUE_LIMIT = 30; // matches the server's clue slice
const STEP_SECONDS = 45; // IMPOSTER_STEP_MS on the server → the deadline bar span

/** One recorded clue in turn order (frozen contract #6). */
interface ImposterClue {
  uid: string;
  text: string;
}

/** Per-uid imposter turn state broadcast by the server (redacted per viewer). */
interface ImposterState {
  phase: "clue" | "vote" | "reveal";
  round: number;
  order: string[];
  clues: ImposterClue[];
  votes: Record<string, string>;
  mysteryPlayer: { full_name: string; person_id: number | null } | null;
  imposterUid: string | null;
  scores: Record<string, number>;
  turnUid: string | null;
  deadlineTs: number | null;
  youAreImposter: boolean;
  caught: boolean | null;
  awaitingGuess: boolean;
  imposterGuess: string | null;
  guessCorrect: boolean | null;
}

/** A move the client emits; the server validates + re-broadcasts. */
type ImposterAction =
  | { type: "clue"; text: string }
  | { type: "vote"; targetUid: string }
  | { type: "guess"; playerName: string };

export interface ImposterGameProps {
  gameInfo: PlayerIndexEntry[];
  onGameEnd: OnGameEnd;
  turn?: unknown; // present in a room: the server's per-uid ImposterState
  onTurnAction?: (a: unknown) => void;
  multiplayer?: boolean;
}

interface Seat {
  uid: string;
  name: string;
  photo?: string | null;
  isSelf: boolean;
}

/** Initials fallback avatar — no network, never breaks the card. */
function SeatAvatar({ seat }: { seat: Seat }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [seat.photo]);
  const initials = (seat.name || "?")
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0])
    .join("")
    .toUpperCase();
  if (seat.photo && !failed) {
    return (
      <img
        className="imp-av"
        src={seat.photo}
        alt=""
        onError={() => setFailed(true)}
        draggable={false}
      />
    );
  }
  return (
    <span className="imp-av imp-av--initials" aria-hidden="true">
      {initials || "?"}
    </span>
  );
}

export default function ImposterGame({ gameInfo, onGameEnd, turn, onTurnAction, multiplayer }: ImposterGameProps) {
  const isRoom = multiplayer === true;
  const state = (turn ?? null) as ImposterState | null;
  const reduce = useReducedMotion();

  const { mp } = useMultiplayer();
  const user = useSelector((s: RootState) => s.user.user);
  const selfUid = playerKey(user);

  const [clueText, setClueText] = useState("");
  const [guessText, setGuessText] = useState("");
  const [now, setNow] = useState(() => Date.now());
  const [showPopup, setShowPopup] = useState(false);
  const [popup, setPopup] = useState({ text: "", color: "" });

  const endedRef = useRef(false);
  const timersRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  const later = (fn: () => void, ms: number) => {
    timersRef.current.push(setTimeout(fn, ms));
  };
  const clearTimers = () => {
    timersRef.current.forEach(clearTimeout);
    timersRef.current = [];
  };

  const flashPopup = (text: string, color: string) => {
    setPopup({ text, color });
    setShowPopup(true);
    later(() => setShowPopup(false), 1400);
  };

  // Shared half-second tick drives the deadline countdown/bar.
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(id);
  }, []);

  // Unmount: cancel any pending onGameEnd / popup timers.
  useEffect(() => () => clearTimers(), []);

  // A fresh phase or turn means the last local input is stale — clear it.
  useEffect(() => {
    setClueText("");
    setGuessText("");
  }, [state?.phase, state?.turnUid]);

  // Roster: map every uid the server references to a display name + avatar.
  const seatByUid = useMemo(() => {
    const m = new Map<string, Seat>();
    m.set(selfUid, {
      uid: selfUid,
      name: user?.username || "You",
      photo: user?.profile_photo,
      isSelf: true,
    });
    mp.opponents.forEach((o) => {
      const uid = playerKey(o);
      if (!m.has(uid)) m.set(uid, { uid, name: o.username || "Player", photo: o.profile_photo, isSelf: false });
    });
    return m;
  }, [selfUid, user, mp.opponents]);

  const seatOf = (uid: string): Seat =>
    seatByUid.get(uid) ?? { uid, name: "Player", photo: null, isSelf: uid === selfUid };

  const suggestions = useMemo(() => (gameInfo ?? []).map((p) => p.full_name), [gameInfo]);

  // Fire onGameEnd exactly once when the reveal is finalized (no pending guess).
  const finalized = !!state && state.phase === "reveal" && !state.awaitingGuess;
  useEffect(() => {
    if (!isRoom || !finalized || endedRef.current) return;
    endedRef.current = true;
    const myScore = state?.scores?.[selfUid] ?? 0;
    later(() => onGameEnd?.(myScore), 700);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isRoom, finalized]);

  // ---------- OUT OF A ROOM → EXPLAINER (never scores) ----------
  if (!isRoom) {
    return (
      <div className="imp-wrap imp-wrap--explain">
        <div className="imp-explain">
          <span className="imp-explain-tag">Party · 3–5 players</span>
          <h2 className="imp-explain-title font-display">NBA Imposter</h2>
          <p className="imp-explain-lead">
            Grab 2–4 friends and create a private room to play. There's no solo mode — this one only
            comes alive with a crew.
          </p>
          <ol className="imp-steps">
            <li>
              <span className="imp-step-n font-display">1</span>
              <span>Everyone gets the same mystery NBA player — except one secret <strong>Imposter</strong>.</span>
            </li>
            <li>
              <span className="imp-step-n font-display">2</span>
              <span>Take turns dropping <strong>one-word clues</strong>. The Imposter has to fake it.</span>
            </li>
            <li>
              <span className="imp-step-n font-display">3</span>
              <span><strong>Vote</strong> out who you think is bluffing. Caught Imposters get one guess to steal it back.</span>
            </li>
          </ol>
          <p className="imp-explain-cta">Open “Play Online → Private room” to start a game.</p>
        </div>
      </div>
    );
  }

  // ---------- IN A ROOM, awaiting the first server snapshot ----------
  if (!state) {
    return (
      <div className="imp-wrap imp-wrap--center">
        <CourtLoader label="Setting up the room…" scale={0.8} />
      </div>
    );
  }

  // ---------- Derived room view ----------
  const seats: Seat[] = (state.order.length ? state.order : Object.keys(state.scores)).map(seatOf);
  const isImposter = state.youAreImposter;
  const myTurn = state.phase === "clue" && state.turnUid === selfUid;
  const myVote = state.votes[selfUid] ?? null;
  const votedCount = Object.keys(state.votes).length;
  const secondsLeft = state.deadlineTs ? Math.max(0, Math.ceil((state.deadlineTs - now) / 1000)) : 0;
  const barPct = state.deadlineTs ? Math.max(0, Math.min(1, (state.deadlineTs - now) / (STEP_SECONDS * 1000))) : 0;
  const showDeadline = state.phase === "clue" || state.phase === "vote";

  // Latest clue per uid (bubbles show the most recent word each player gave).
  const lastClueByUid = new Map<string, string>();
  state.clues.forEach((c) => lastClueByUid.set(c.uid, c.text));

  const phaseLabel =
    state.phase === "clue"
      ? `Clue round ${Math.min(state.round, 2)} of 2`
      : state.phase === "vote"
        ? "Vote out the imposter"
        : "The reveal";

  const turnLabel =
    state.phase === "clue"
      ? myTurn
        ? "Your turn — give a one-word clue"
        : `${seatOf(state.turnUid ?? "").name} is cluing…`
      : state.phase === "vote"
        ? myVote
          ? "Vote locked — waiting on the room…"
          : "Tap a player to cast your vote"
        : state.caught
          ? "Imposter caught!"
          : "The imposter got away…";

  const emit = (action: ImposterAction) => onTurnAction?.(action);

  const submitClue = () => {
    if (!myTurn) return;
    const text = clueText.trim().slice(0, CLUE_LIMIT);
    if (!text) return;
    emit({ type: "clue", text });
    setClueText("");
    flashPopup("Clue sent", "var(--muted)");
  };

  const castVote = (targetUid: string) => {
    if (state.phase !== "vote" || myVote || targetUid === selfUid) return;
    emit({ type: "vote", targetUid });
    flashPopup(`Voted ${seatOf(targetUid).name}`, "var(--brand)");
  };

  const submitGuess = (raw: string) => {
    const name = raw.trim();
    if (!name) return;
    emit({ type: "guess", playerName: name });
    setGuessText("");
    flashPopup("Guess locked", "var(--muted)");
  };

  const scoreboard = seats
    .map((s) => ({ seat: s, score: state.scores[s.uid] ?? 0 }))
    .sort((a, b) => b.score - a.score);

  return (
    <div className="imp-wrap">
      {/* Phase banner + deadline */}
      <div className="imp-top">
        <div className="imp-phaserow">
          <span className={`imp-phase imp-phase--${state.phase}`}>{phaseLabel}</span>
          {showDeadline && (
            <span
              className="imp-clock tnum"
              role="timer"
              aria-label={`${secondsLeft} seconds left`}
              data-low={secondsLeft <= 10 || undefined}
            >
              0:{String(secondsLeft).padStart(2, "0")}
            </span>
          )}
        </div>
        {showDeadline && (
          <div className="imp-bar" aria-hidden="true">
            <div className="imp-bar-fill" style={{ width: `${barPct * 100}%` }} data-low={secondsLeft <= 10 || undefined} />
          </div>
        )}
        <span className="imp-turn">{turnLabel}</span>
      </div>

      {/* Role / mystery strip */}
      <div className={`imp-role${isImposter ? " is-imposter" : ""}`} role="status">
        {isImposter && state.phase !== "reveal" ? (
          <>
            <span className="imp-role-eyebrow">Your secret</span>
            <span className="imp-role-main font-display">YOU ARE THE IMPOSTER</span>
            <span className="imp-role-sub">Bluff a clue and blend in — you don't know the player.</span>
          </>
        ) : (
          <>
            <span className="imp-role-eyebrow">{state.phase === "reveal" ? "The mystery player was" : "Mystery player"}</span>
            <span className="imp-role-main font-display">{state.mysteryPlayer?.full_name ?? "—"}</span>
            {state.phase !== "reveal" && <span className="imp-role-sub">Everyone sees this — except the imposter.</span>}
          </>
        )}
      </div>

      {/* Main area: player ring (clue/vote) or scoreboard (reveal) */}
      {state.phase === "reveal" ? (
        <div className="imp-reveal">
          <div className="imp-verdict">
            <span className="imp-verdict-name font-display">{seatOf(state.imposterUid ?? "").name}</span>
            <span className="imp-verdict-tag">was the Imposter</span>
            {state.imposterGuess != null && (
              <span className={`imp-verdict-guess${state.guessCorrect ? " is-right" : " is-wrong"}`}>
                Guessed “{state.imposterGuess}” — {state.guessCorrect ? "nailed it, +3" : "missed"}
              </span>
            )}
          </div>
          <ul className="imp-score">
            {scoreboard.map(({ seat, score }, i) => (
              <li
                key={seat.uid}
                className={`imp-score-row${seat.uid === state.imposterUid ? " is-imposter" : ""}${seat.isSelf ? " is-you" : ""}`}
              >
                <span className="imp-score-place tnum font-display">{i + 1}</span>
                <SeatAvatar seat={seat} />
                <span className="imp-score-name">
                  {seat.name}
                  {seat.isSelf && <span className="imp-you-tag">YOU</span>}
                  {seat.uid === state.imposterUid && <span className="imp-imp-tag">IMPOSTER</span>}
                </span>
                <span className="imp-score-num tnum">{score}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <div className={`imp-ring imp-ring--n${seats.length}`}>
          {seats.map((seat) => {
            const clue = lastClueByUid.get(seat.uid);
            const isTurn = state.phase === "clue" && state.turnUid === seat.uid;
            const hasVoted = state.votes[seat.uid] != null;
            const votable = state.phase === "vote" && !myVote && !seat.isSelf;
            const picked = myVote === seat.uid;
            return (
              <button
                key={seat.uid}
                type="button"
                className={`imp-card${isTurn ? " is-turn" : ""}${picked ? " is-picked" : ""}${votable ? " is-votable" : ""}`}
                disabled={!votable}
                aria-label={
                  state.phase === "vote"
                    ? seat.isSelf
                      ? `${seat.name} (you)`
                      : `Vote for ${seat.name}`
                    : seat.name
                }
                onClick={() => votable && castVote(seat.uid)}
              >
                <div className="imp-card-head">
                  <SeatAvatar seat={seat} />
                  {state.phase === "vote" && hasVoted && <span className="imp-voted" aria-label="has voted">✓</span>}
                </div>
                <span className="imp-card-name">
                  {seat.name}
                  {seat.isSelf && <span className="imp-you-tag">YOU</span>}
                </span>
                <AnimatePresence initial={false}>
                  {clue ? (
                    <motion.span
                      key={clue}
                      className="imp-bubble"
                      initial={reduce ? { opacity: 0 } : { opacity: 0, y: 6, scale: 0.9 }}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      transition={{ duration: 0.25 }}
                    >
                      {clue}
                    </motion.span>
                  ) : (
                    <span className="imp-bubble imp-bubble--empty">{isTurn ? "…" : ""}</span>
                  )}
                </AnimatePresence>
              </button>
            );
          })}
        </div>
      )}

      {/* Bottom action bar */}
      <div className="imp-action">
        {state.phase === "clue" && (
          myTurn ? (
            <div className="imp-inputrow">
              <input
                className="imp-input"
                type="text"
                maxLength={CLUE_LIMIT}
                value={clueText}
                placeholder="One-word clue…"
                aria-label="Your clue"
                onChange={(e) => setClueText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && clueText.trim()) submitClue();
                }}
                autoFocus
              />
              <Button size="sm" onClick={submitClue} disabled={clueText.trim() === ""}>
                Send
              </Button>
            </div>
          ) : (
            <p className="imp-hint">Watch the clues — trust nobody.</p>
          )
        )}

        {state.phase === "vote" && (
          <p className="imp-hint tnum">
            {myVote ? `Vote in · ${votedCount}/${seats.length} voted` : `Tap a card to vote · ${votedCount}/${seats.length} in`}
          </p>
        )}

        {state.phase === "reveal" && (
          isImposter && state.awaitingGuess ? (
            <div className="imp-inputrow imp-inputrow--guess">
              <AutocompleteInput
                placeholder="Name the mystery player to steal it…"
                value={guessText}
                setValue={setGuessText}
                suggestions={suggestions}
                onSubmit={submitGuess}
                customStyleInput={{ width: "100%", maxWidth: "none", height: "44px", padding: "0 12px", fontSize: "0.85rem" }}
                customStyleSuggestion={{ fontSize: "0.8rem", maxHeight: "150px", minWidth: "100%" }}
              />
              <Button size="sm" onClick={() => submitGuess(guessText)} disabled={guessText.trim() === ""}>
                Guess
              </Button>
            </div>
          ) : (
            <p className="imp-hint">
              {state.awaitingGuess ? "The imposter is guessing the mystery player…" : "Final scores are in."}
            </p>
          )
        )}
      </div>

      <SubmitGuessPopup show={showPopup} text={popup.text} color={popup.color} />
    </div>
  );
}
