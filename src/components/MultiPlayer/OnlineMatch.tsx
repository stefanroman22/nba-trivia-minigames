import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useSelector } from "react-redux";
import "../../styles/Multiplayer.css";
import { playerKey, useMultiplayer } from "../../context/MultiplayerContext";
import { useModal } from "../../context/ModalContext";
import { renderGame } from "../../Game Renderers/RenderGame";
import { popIn } from "../../motion/variants";
import { CourtLoader } from "../ui";
import SessionTimer from "../ui/SessionTimer";
import SwapText from "../motion/SwapText";
import PlayerCard from "./PlayerCard";
import AnimatedNumber from "../motion/AnimatedNumber";
import defaultAvatar from "../../assets/default.png";
import type { RootState } from "../../store";
import type { Game, GameData, PlayerInfo } from "../../types/types";

/** Stable empty round for turn games (no gameData): a fresh [] per render would re-trigger renderers' `[gameInfo]` effects. */
const EMPTY_ROUND: GameData[] = [];

const EASE = [0.22, 1, 0.36, 1] as [number, number, number, number];

const swap = {
  initial: { opacity: 0, y: 10, scale: 0.99 },
  animate: { opacity: 1, y: 0, scale: 1 },
  exit: { opacity: 0, y: -10, scale: 0.99 },
  transition: { duration: 0.34, ease: EASE },
};

type Mp = ReturnType<typeof useMultiplayer>["mp"];

/** Presence-pill state for one opponent, from the live status map. */
function chipStateOf(mp: Mp, opponent?: PlayerInfo): "playing" | "finished" | "offline" {
  const st = opponent ? mp.oppStatus[playerKey(opponent)] : undefined;
  if (!st) return "playing";
  if (!st.online) return "offline";
  return st.done ? "finished" : "playing";
}

/** "All-Star · 740 pts" context line for the VS cards. */
function skillLine(p?: { rank?: string | number; points?: string | number } | null): string | null {
  if (!p) return null;
  const bits = [p.rank, p.points != null ? `${Number(p.points).toLocaleString()} pts` : null].filter(Boolean);
  return bits.length ? bits.join(" · ") : null;
}

/** 83000 -> "1:23" (m:ss, zero-padded seconds) for the results time lines. */
function fmtElapsed(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** The full online-match experience, driven entirely by the multiplayer store. */
export default function OnlineMatch() {
  const { mp, submitScore, sendTurnAction, proposeAgain, respondProposal, cancelProposal, leaveMatch, findMatch, clearNotice, stopMatch, restartRoom, proposeSwitch } = useMultiplayer();
  const { open } = useModal();

  // Wall-clock start of the current round, re-armed on every transition INTO
  // "playing" (a matchRestart re-enters playing, so rematches re-arm too).
  // Feeds the score-then-time tiebreak and the on-screen session timer.
  const startRef = useRef<number>(Date.now());
  const [playStartedAt, setPlayStartedAt] = useState<number>();
  useEffect(() => {
    if (mp.phase === "playing") {
      startRef.current = Date.now();
      setPlayStartedAt(startRef.current);
    }
  }, [mp.phase]);

  const stillPlaying = mp.opponents.filter((o) => !mp.oppStatus[playerKey(o)]?.done);
  const waitingLabel = stillPlaying.length
    ? `Waiting for ${stillPlaying.map((o) => o.username || "Opponent").join(" & ")}...`
    : "Crunching the numbers...";

  const isFriend = mp.roomType === "friend";
  const isHost = isFriend && mp.role === "host";
  // Friend rooms: the host stops the match (everyone back to the lobby); a guest leaves the room.
  const ExitLink = isHost
    ? <button className="om-exit" onClick={stopMatch}>Stop match</button>
    : <button className="om-exit" onClick={leaveMatch}>{isFriend ? "Leave room" : "Exit game"}</button>;
  const pickGame = () => open("gamePicker", {
    currentId: mp.game?.id,
    seated: mp.roomSize,
    onPick: (g) => (isFriend ? restartRoom(g) : proposeSwitch(g)),
  });

  // ---- Per-phase body ----
  let body: React.ReactNode = null;

  if (mp.phase === "searching") {
    body = (
      <motion.div key="searching" {...swap} className="om-stage om-stage--compact">
        <CourtLoader label="Finding an opponent near your rank..." scale={0.8} />
        {mp.queueInfo && mp.queueInfo.inQueue > 1 && (
          <p className="om-queue-note">{`#${mp.queueInfo.position} in queue · the match widens the longer you wait`}</p>
        )}
        <button className="om-btn om-btn--ghost" onClick={leaveMatch} style={{ marginTop: 6 }}>Cancel</button>
      </motion.div>
    );
  } else if (mp.phase === "intro") {
    body = (
      <motion.div key="intro" {...swap} className="om-stage">
        <span className="om-eyebrow">{mp.roomType === "friend" ? "Private match" : "Match found"}</span>
        <Matchup mp={mp} />
        <p className="om-introline">
          <SwapText swapKey={mp.error ? "error" : mp.gameData || mp.turnState ? "ready" : "loading"}>
            {mp.error ? mp.error : mp.gameData || mp.turnState ? "Get ready..." : "Loading the game..."}
          </SwapText>
        </p>
      </motion.div>
    );
  } else if (mp.phase === "playing") {
    body = (
      <motion.div key="playing" {...swap} className="om-stage om-stage--play">
        {mp.gameData || mp.turnState ? (
          renderGame({
            gameId: mp.game?.id,
            // Turn games carry no round data (state comes via `turn`); renderers tolerate [].
            gameData: mp.gameData ?? EMPTY_ROUND,
            pointsPerCorrect: mp.game?.pointsPerCorrect,
            onGameEnd: (score: number) => submitScore(score, Date.now() - startRef.current),
            turn: mp.turnState,
            onTurnAction: sendTurnAction,
            multiplayer: true,
          })
        ) : (
          <CourtLoader label="Loading the game..." scale={0.8} />
        )}
        <div className="om-playbar">
          <SessionTimer startedAt={playStartedAt} />
          {mp.opponents.map((o, i) => (
            <OpponentChip key={playerKey(o) || i} name={o.username || "Player"} photo={o.profile_photo} state={chipStateOf(mp, o)} />
          ))}
        </div>
        {ExitLink}
      </motion.div>
    );
  } else if (mp.phase === "waiting") {
    body = (
      <motion.div key="waiting" {...swap} className="om-stage">
        <div className="om-playbar">
          {mp.opponents.map((o, i) => (
            <OpponentChip key={playerKey(o) || i} name={o.username || "Player"} photo={o.profile_photo} state={chipStateOf(mp, o)} />
          ))}
        </div>
        <div className="om-yourscore">
          <span className="om-yourscore-lbl">Your score</span>
          <span className="om-yourscore-num tnum font-display">{mp.yourScore ?? 0}</span>
        </div>
        <CourtLoader label={waitingLabel} scale={0.7} gap={2} />
        {ExitLink}
      </motion.div>
    );
  } else if (mp.phase === "results") {
    // A win/loss with the top two scores equal means the clock decided it.
    const timeBrokeTie = !!(
      mp.outcome && mp.outcome !== "tie" && mp.standings && mp.standings.length > 1 &&
      mp.standings[0].score === mp.standings[1].score && mp.standings[0].outcome === "win"
    );
    body = (
      <motion.div key="results" {...swap} className="om-stage om-stage--results">
        {/* Reserved row: the "+N pts" badge sits top-right in its own space, so it never covers
            the headline (phones included) and its arrival doesn't shift the layout. */}
        <div className="om-result-top">
          <AnimatePresence>
            {mp.notice?.kind === "points" && (
              <motion.span key="pts" className="om-points" variants={popIn} initial="hidden" animate="visible" exit="exit">
                {mp.notice.text}
              </motion.span>
            )}
          </AnimatePresence>
        </div>
        <ResultHeadline outcome={mp.outcome} />
        {timeBrokeTie && <p className="om-time-note">Same score, faster time wins</p>}
        {mp.roomSize > 2 && mp.standings ? (
          <Standings mp={mp} />
        ) : (
          <Matchup mp={mp} showScores />
        )}
        <ResultActions
          mp={mp}
          isFriend={isFriend}
          isHost={isHost}
          onAgain={isFriend ? () => restartRoom() : proposeAgain}
          onPickGame={pickGame}
          onLobby={stopMatch}
          onRespond={respondProposal}
          onCancel={cancelProposal}
        />
        {isHost
          ? <button className="om-exit" onClick={leaveMatch}>Close room</button>
          : <button className="om-exit" onClick={leaveMatch}>{isFriend ? "Leave room" : "Exit game"}</button>}
      </motion.div>
    );
  } else if (mp.phase === "ended") {
    body = (
      <motion.div key="ended" {...swap} className="om-stage">
        <div className="om-ended-icon">
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18M6 6l12 12" /></svg>
        </div>
        <h3 className="font-display om-ended-title">Match ended</h3>
        <p className="om-ended-msg">{mp.ended?.message || "Your opponent left the match."}</p>
        <div className="om-actions">
          {mp.game && mp.roomType !== "friend" && (
            <button className="om-btn om-btn--primary" onClick={() => findMatch(mp.game as Game)}>Find new match</button>
          )}
          <button className="om-btn om-btn--ghost" onClick={leaveMatch}>Exit game</button>
        </div>
      </motion.div>
    );
  }

  return (
    <div className="om">
      <NoticeBar notice={mp.notice?.kind === "points" ? null : mp.notice} onClose={clearNotice} />
      <AnimatePresence mode="wait">{body}</AnimatePresence>
    </div>
  );
}

/* ---------------- Sub-components ---------------- */

function Matchup({ mp, showScores = false }: { mp: Mp; showScores?: boolean }) {
  const { user } = useSelector((state: RootState) => state.user);
  const youWin = mp.outcome === "win";
  const oppWin = mp.outcome === "loss";
  const tie = mp.outcome === "tie";
  const opp0 = mp.opponents[0];
  // Results: each player's play time under their own card (bold, no "You · name" line).
  const rowOf = (p?: { id?: string | null; username?: string } | null) =>
    mp.standings?.find((r) => (p?.id ? r.id === p.id : p?.username != null && r.username === p.username));
  const timeOf = (p?: { id?: string | null; username?: string } | null) => {
    const ms = showScores ? rowOf(p)?.elapsedMs : null;
    return ms != null ? fmtElapsed(ms) : null;
  };

  // Rooms of 3+ (not used by the 2-player friend rooms, kept for flexibility):
  // a row of everyone in the room (scores come via Standings).
  if (mp.opponents.length > 1) {
    return (
      <div className="om-matchup is-trio">
        <PlayerCard side="You" name={user?.username || "You"} tag={user?.id} photo={user?.profile_photo} delay={0} />
        {mp.opponents.map((o, i) => (
          <PlayerCard
            key={playerKey(o) || i}
            side="Friend"
            name={o.username}
            tag={o.id}
            photo={o.profile_photo}
            state={chipStateOf(mp, o) === "offline" ? "offline" : undefined}
            delay={0.08 * (i + 1)}
          />
        ))}
      </div>
    );
  }

  return (
    <div className="om-matchup">
      <PlayerCard
        side="You"
        name={user?.username || "You"}
        tag={user?.id}
        sub={showScores ? null : skillLine(user)}
        photo={user?.profile_photo}
        score={showScores ? mp.yourScore : null}
        result={showScores ? (youWin ? "win" : tie ? "tie" : null) : null}
        time={timeOf(user)}
        delay={0}
      />
      <span className="om-vs font-display">VS</span>
      <PlayerCard
        side="Opponent"
        name={opp0?.username}
        tag={opp0?.id}
        sub={showScores ? null : skillLine(opp0)}
        photo={opp0?.profile_photo}
        score={showScores ? mp.opponentScore : null}
        state={!showScores && chipStateOf(mp, opp0) === "offline" ? "offline" : undefined}
        result={showScores ? (oppWin ? "win" : tie ? "tie" : null) : null}
        time={timeOf(opp0)}
        delay={0.1}
      />
    </div>
  );
}

/** Final scoreboard for 3-player rooms — ranked rows, winner highlighted. */
function Standings({ mp }: { mp: Mp }) {
  const { user } = useSelector((state: RootState) => state.user);
  if (!mp.standings) return null;
  return (
    <div className="om-standings">
      {mp.standings.map((row, i) => {
        const isYou = row.id ? row.id === user?.id : row.username === user?.username;
        return (
          <motion.div
            key={playerKey(row) || i}
            className={`om-strow${row.outcome === "win" ? " is-win" : ""}${isYou ? " is-you" : ""}`}
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.35, delay: i * 0.1, ease: EASE }}
          >
            <span className="om-st-place tnum font-display">{i + 1}</span>
            <img
              className="om-st-av"
              src={row.profile_photo || defaultAvatar.src}
              alt=""
              onError={(e) => { (e.currentTarget as HTMLImageElement).src = defaultAvatar.src; }}
            />
            <span className="om-st-name" title={row.id ? `${row.username} #${row.id}` : row.username}>
              <span className="om-st-namecol">
                <span className="om-st-uname">{row.username || "Player"}</span>
                {row.id && <span className="om-st-id tnum">#{row.id}</span>}
              </span>
              {isYou && <span className="om-st-you">YOU</span>}
            </span>
            {row.outcome === "win" && (
              <span className="om-st-crown" aria-label="Winner">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><path d="M5 16l-2-9 5.5 4L12 5l3.5 6L21 7l-2 9H5zm0 2h14v2H5v-2z" /></svg>
              </span>
            )}
            {row.elapsedMs != null && <span className="om-st-time tnum">{fmtElapsed(row.elapsedMs)}</span>}
            <span className="om-st-score tnum"><AnimatedNumber value={row.score} /></span>
          </motion.div>
        );
      })}
    </div>
  );
}

function ResultHeadline({ outcome }: { outcome: "win" | "loss" | "tie" | null }) {
  const map = {
    win: { text: "You win!", cls: "is-win" },
    loss: { text: "You lost", cls: "is-loss" },
    tie: { text: "It's a draw", cls: "is-tie" },
  } as const;
  const r = outcome ? map[outcome] : null;
  if (!r) return null;
  return (
    <motion.h3
      className={`font-display om-headline ${r.cls}`}
      initial={{ opacity: 0, scale: 0.8 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ type: "spring", stiffness: 320, damping: 18, delay: 0.1 }}
    >
      {r.text}
    </motion.h3>
  );
}

function ResultActions({
  mp, isFriend, isHost, onAgain, onPickGame, onLobby, onRespond, onCancel,
}: {
  mp: ReturnType<typeof useMultiplayer>["mp"];
  isFriend: boolean;
  isHost: boolean;
  onAgain: () => void;
  onPickGame: () => void;
  onLobby: () => void;
  onRespond: (accept: boolean) => void;
  onCancel: () => void;
}) {
  let key: string;
  let content: React.ReactNode;

  if (mp.proposal?.role === "theirs") {
    // Incoming request from the opponent (1v1 only).
    const label = mp.proposal.type === "switch"
      ? `wants to switch to ${mp.proposal.gameName || "another game"}`
      : "wants a rematch";
    key = "incoming";
    content = (
      <div className="om-prompt">
        <p className="om-prompt-text"><strong>{mp.proposal.fromName || "Opponent"}</strong> {label}</p>
        <div className="om-actions">
          <button className="om-btn om-btn--primary" onClick={() => onRespond(true)}>Accept</button>
          <button className="om-btn om-btn--ghost" onClick={() => onRespond(false)}>Decline</button>
        </div>
      </div>
    );
  } else if (mp.proposal?.role === "mine") {
    const label = mp.proposal.type === "switch"
      ? `Switch to ${mp.proposal.gameName || "new game"} sent`
      : "Rematch request sent";
    key = "outgoing";
    content = (
      <div className="om-prompt">
        <p className="om-prompt-text">{label}. Waiting for your opponent...</p>
        <button className="om-btn om-btn--ghost" onClick={onCancel}>Cancel request</button>
      </div>
    );
  } else if (isFriend && !isHost) {
    // Guests wait for the host's call.
    key = "guest";
    content = (
      <p className="om-prompt-text">Waiting for the host<span className="om-dots"><i /><i /><i /></span></p>
    );
  } else {
    // The host (friend room) or either player (1v1): rematch or a different game.
    key = "default";
    content = (
      <div className="om-result-actions">
        <div className="om-actions">
          <button className="om-btn om-btn--primary" onClick={onAgain}>Play again</button>
          <button className="om-btn om-btn--secondary" onClick={onPickGame}>Change game</button>
        </div>
        {isFriend && <button className="om-link" onClick={onLobby}>Back to lobby</button>}
      </div>
    );
  }

  // Crossfade between actions / prompts so rematch + switch + cancel
  // notifications fade in and out smoothly.
  return (
    <AnimatePresence mode="wait">
      <motion.div
        key={key}
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -6 }}
        transition={{ duration: 0.22, ease: EASE }}
        style={{ width: "100%", display: "flex", justifyContent: "center" }}
      >
        {content}
      </motion.div>
    </AnimatePresence>
  );
}

function OpponentChip({ name, photo, state }: { name: string; photo?: string | null; state: "playing" | "finished" | "offline" }) {
  const label = state === "offline" ? "Reconnecting" : state === "finished" ? "Finished" : "Playing";
  return (
    <div className={`om-chip is-${state}`}>
      <img className="om-chip-av" src={photo || defaultAvatar.src} alt="" onError={(e) => { (e.currentTarget as HTMLImageElement).src = defaultAvatar.src; }} />
      <span className="om-chip-meta">
        <span className="om-chip-name" title={name}>{name}</span>
        <span className="om-chip-state">
          {state === "playing" && <span className="om-dots"><i /><i /><i /></span>}
          <SwapText>{label}</SwapText>
        </span>
      </span>
    </div>
  );
}

function NoticeBar({ notice, onClose }: { notice: { kind: string; text: string } | null; onClose: () => void }) {
  return (
    <AnimatePresence>
      {notice && (
        <motion.div
          className={`om-notice is-${notice.kind}`}
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -10 }}
          transition={{ duration: 0.3, ease: EASE }}
        >
          <span>{notice.text}</span>
          {notice.kind === "error" && (
            <button className="om-notice-x" onClick={onClose} aria-label="Dismiss">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><path d="M18 6 6 18M6 6l12 12" /></svg>
            </button>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
