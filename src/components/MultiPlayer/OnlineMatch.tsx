import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useSelector } from "react-redux";
import "../../styles/Multiplayer.css";
import { useMultiplayer } from "../../context/MultiplayerContext";
import { renderGame } from "../../Game Renderers/RenderGame";
import { games } from "../../utils/GameUtils";
import { CourtLoader } from "../ui";
import PlayerCard from "./PlayerCard";
import AnimatedNumber from "../motion/AnimatedNumber";
import defaultAvatar from "../../assets/default.png";
import type { RootState } from "../../store";
import type { Game } from "../../types/types";

const EASE = [0.22, 1, 0.36, 1] as [number, number, number, number];

const swap = {
  initial: { opacity: 0, y: 10, scale: 0.99 },
  animate: { opacity: 1, y: 0, scale: 1 },
  exit: { opacity: 0, y: -10, scale: 0.99 },
  transition: { duration: 0.34, ease: EASE },
};

type Mp = ReturnType<typeof useMultiplayer>["mp"];

/** Presence-pill state for one opponent, from the live status map. */
function chipStateOf(mp: Mp, username?: string): "playing" | "finished" | "offline" {
  const st = username ? mp.oppStatus[username] : undefined;
  if (!st) return "playing";
  if (!st.online) return "offline";
  return st.done ? "finished" : "playing";
}

/** The full online-match experience, driven entirely by the multiplayer store. */
export default function OnlineMatch() {
  const { mp, submitScore, proposeAgain, proposeSwitch, respondProposal, cancelProposal, leaveMatch, findMatch, clearNotice } = useMultiplayer();
  const [switching, setSwitching] = useState(false);

  const stillPlaying = mp.opponents.filter((o) => !(o.username && mp.oppStatus[o.username]?.done));
  const waitingLabel = stillPlaying.length
    ? `Waiting for ${stillPlaying.map((o) => o.username || "Opponent").join(" & ")}...`
    : "Crunching the numbers...";

  const ExitLink = (
    <button className="om-exit" onClick={leaveMatch}>Exit game</button>
  );

  // ---- Per-phase body ----
  let body: React.ReactNode = null;

  if (mp.phase === "searching") {
    body = (
      <motion.div key="searching" {...swap} className="om-stage">
        <CourtLoader label="Finding an opponent..." scale={0.8} />
        <button className="om-btn om-btn--ghost" onClick={leaveMatch} style={{ marginTop: 18 }}>Cancel</button>
      </motion.div>
    );
  } else if (mp.phase === "intro") {
    body = (
      <motion.div key="intro" {...swap} className="om-stage">
        <span className="om-eyebrow">{mp.roomType === "friend" ? "Private match" : "Match found"}</span>
        <Matchup mp={mp} />
        <p className="om-introline">{mp.error ? mp.error : mp.gameData ? "Get ready..." : "Loading the game..."}</p>
      </motion.div>
    );
  } else if (mp.phase === "playing") {
    body = (
      <motion.div key="playing" {...swap} className="om-stage om-stage--play">
        {mp.gameData ? (
          renderGame({
            gameId: mp.game?.id,
            gameData: mp.gameData,
            pointsPerCorrect: mp.game?.pointsPerCorrect,
            onGameEnd: (score: number) => submitScore(score),
          })
        ) : (
          <CourtLoader label="Loading the game..." scale={0.8} />
        )}
        <div className="om-playbar">
          {mp.opponents.map((o, i) => (
            <OpponentChip key={o.username || i} name={o.username || "Player"} photo={o.profile_photo} state={chipStateOf(mp, o.username)} />
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
            <OpponentChip key={o.username || i} name={o.username || "Player"} photo={o.profile_photo} state={chipStateOf(mp, o.username)} />
          ))}
        </div>
        <div className="om-yourscore">
          <span className="om-yourscore-lbl">Your score</span>
          <span className="om-yourscore-num tnum font-display">{mp.yourScore ?? 0}</span>
        </div>
        <CourtLoader label={waitingLabel} scale={0.7} />
        {ExitLink}
      </motion.div>
    );
  } else if (mp.phase === "results") {
    body = (
      <motion.div key="results" {...swap} className="om-stage">
        <ResultHeadline outcome={mp.outcome} />
        {mp.roomSize > 2 && mp.standings ? <Standings mp={mp} /> : <Matchup mp={mp} showScores />}
        <ResultActions
          mp={mp}
          switching={switching}
          setSwitching={setSwitching}
          onAgain={proposeAgain}
          onSwitch={(g) => { setSwitching(false); proposeSwitch(g); }}
          onRespond={respondProposal}
          onCancel={cancelProposal}
        />
        {ExitLink}
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
      <NoticeBar notice={mp.notice} onClose={clearNotice} />
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

  // 3-player rooms: a row of everyone in the room (scores come via Standings).
  if (mp.opponents.length > 1) {
    return (
      <div className="om-matchup is-trio">
        <PlayerCard side="You" name={user?.username || "You"} photo={user?.profile_photo} delay={0} />
        {mp.opponents.map((o, i) => (
          <PlayerCard
            key={o.username || i}
            side="Friend"
            name={o.username}
            photo={o.profile_photo}
            state={chipStateOf(mp, o.username) === "offline" ? "offline" : undefined}
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
        photo={user?.profile_photo}
        score={showScores ? mp.yourScore : null}
        result={showScores ? (youWin ? "win" : tie ? "tie" : null) : null}
        delay={0}
      />
      <span className="om-vs font-display">VS</span>
      <PlayerCard
        side="Opponent"
        name={opp0?.username}
        photo={opp0?.profile_photo}
        score={showScores ? mp.opponentScore : null}
        state={!showScores && chipStateOf(mp, opp0?.username) === "offline" ? "offline" : undefined}
        result={showScores ? (oppWin ? "win" : tie ? "tie" : null) : null}
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
        const isYou = row.username === user?.username;
        return (
          <motion.div
            key={row.username || i}
            className={`om-strow${row.outcome === "win" ? " is-win" : ""}${isYou ? " is-you" : ""}`}
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.35, delay: i * 0.1, ease: EASE }}
          >
            <span className="om-st-place tnum font-display">{i + 1}</span>
            <img
              className="om-st-av"
              src={row.profile_photo || defaultAvatar}
              alt=""
              onError={(e) => { (e.currentTarget as HTMLImageElement).src = defaultAvatar; }}
            />
            <span className="om-st-name" title={row.username}>
              {row.username || "Player"}
              {isYou && <span className="om-st-you">YOU</span>}
            </span>
            {row.outcome === "win" && (
              <span className="om-st-crown" aria-label="Winner">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><path d="M5 16l-2-9 5.5 4L12 5l3.5 6L21 7l-2 9H5zm0 2h14v2H5v-2z" /></svg>
              </span>
            )}
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
  mp, switching, setSwitching, onAgain, onSwitch, onRespond, onCancel,
}: {
  mp: ReturnType<typeof useMultiplayer>["mp"];
  switching: boolean;
  setSwitching: (v: boolean) => void;
  onAgain: () => void;
  onSwitch: (g: Game) => void;
  onRespond: (accept: boolean) => void;
  onCancel: () => void;
}) {
  const [query, setQuery] = useState("");
  const closeSwitch = () => { setQuery(""); setSwitching(false); };

  let key: string;
  let content: React.ReactNode;

  if (mp.proposal?.role === "theirs") {
    // Incoming request from the opponent.
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
    // Outgoing request we're waiting on.
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
  } else if (switching) {
    // Switch-game picker with a name/keyword search.
    const q = query.trim().toLowerCase();
    const others = games
      .filter((g) => g.id !== "coming-soon" && g.id !== mp.game?.id)
      .filter((g) => !q || `${g.name} ${g.description} ${g.tag}`.toLowerCase().includes(q));
    key = "switch";
    content = (
      <div className="om-switch">
        <div className="om-switch-head">
          <span>Pick a game</span>
          <button className="om-switch-x" onClick={closeSwitch} aria-label="Close">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><path d="M18 6 6 18M6 6l12 12" /></svg>
          </button>
        </div>
        <div className="om-switch-search">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="M21 21l-4.3-4.3" /></svg>
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search games…"
            aria-label="Search games"
            autoFocus
          />
        </div>
        <div className="om-switch-list">
          {others.length === 0 ? (
            <p className="om-switch-empty">No games match “{query.trim()}”.</p>
          ) : (
            others.map((g) => (
              <button key={g.id} className="om-switch-item" onClick={() => { closeSwitch(); onSwitch(g); }}>
                <span className="om-switch-thumb" style={{ backgroundImage: g.backgroundImage }} />
                <span className="om-switch-name">{g.name}</span>
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 6l6 6-6 6" /></svg>
              </button>
            ))
          )}
        </div>
      </div>
    );
  } else {
    // Default result actions.
    key = "default";
    content = (
      <div className="om-actions">
        <button className="om-btn om-btn--primary" onClick={onAgain}>Play again</button>
        <button className="om-btn om-btn--secondary" onClick={() => setSwitching(true)}>Switch game</button>
      </div>
    );
  }

  // Crossfade between actions / prompts / picker so rematch + switch + cancel
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
      <img className="om-chip-av" src={photo || defaultAvatar} alt="" onError={(e) => { (e.currentTarget as HTMLImageElement).src = defaultAvatar; }} />
      <span className="om-chip-meta">
        <span className="om-chip-name" title={name}>{name}</span>
        <span className="om-chip-state">
          {state === "playing" && <span className="om-dots"><i /><i /><i /></span>}
          {label}
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
