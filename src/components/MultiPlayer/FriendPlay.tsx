import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useSelector } from "react-redux";
import copy from "copy-to-clipboard";
import { useMultiplayer } from "../../context/MultiplayerContext";
import { useModal } from "../../context/ModalContext";
import { games } from "../../utils/GameUtils";
import { Button } from "../ui";
import CodeInput from "./CodeInput";
import defaultAvatar from "../../assets/default.png";
import type { RootState } from "../../store";
import type { Game } from "../../types/types";
import "../../styles/FriendPlay.css";

const EASE = [0.22, 1, 0.36, 1] as [number, number, number, number];
const swap = {
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -8 },
  transition: { duration: 0.24, ease: EASE },
};

/**
 * "Play with a friend" card: generate a 6-digit room code or enter one, then
 * the live lobby (seats, share code, host controls). The match itself starts
 * automatically the moment the room is full and takes over the stage.
 */
export default function FriendPlay({ game, blocked = false }: { game: Game; blocked?: boolean }) {
  const {
    mp, createFriendRoom, joinFriendRoom, changeFriendGame, leaveMatch, resetFriendJoinError,
  } = useMultiplayer();
  const { user, isLoggedIn } = useSelector((state: RootState) => state.user);
  const { open } = useModal();

  const [mode, setMode] = useState<"menu" | "enter">("menu");
  const [code, setCode] = useState("");
  const [copied, setCopied] = useState(false);
  const [picking, setPicking] = useState(false);
  const copyTimer = useRef<number | null>(null);

  const lobby = mp.phase === "lobby" ? mp.lobby : null;
  const searching = mp.phase === "searching";
  const inMatch = mp.phase !== "idle" && mp.phase !== "lobby" && !searching;
  const isHost = !!lobby && lobby.hostUid === user?.username;
  const creating = mp.friendPending === "create";
  const joining = mp.friendPending === "join";

  // Leaving the flow (room closed, match started…) resets the card's local state.
  useEffect(() => {
    if (mp.phase !== "idle") { setMode("menu"); setCode(""); }
    if (mp.phase !== "lobby") { setPicking(false); setCopied(false); }
  }, [mp.phase]);

  useEffect(() => () => { if (copyTimer.current) window.clearTimeout(copyTimer.current); }, []);

  const doCopy = () => {
    if (!lobby) return;
    copy(String(lobby.code));
    setCopied(true);
    if (copyTimer.current) window.clearTimeout(copyTimer.current);
    copyTimer.current = window.setTimeout(() => setCopied(false), 1800);
  };

  const submitCode = (v?: string) => {
    const c = (v ?? code).trim();
    if (c.length === 6 && !joining) joinFriendRoom(c);
  };

  // ---- Card body per state ----
  let key: string;
  let body: React.ReactNode;

  if (!isLoggedIn) {
    key = "login";
    body = (
      <>
        <p className="fp-sub">Set up a private room with a share code and play against 2 friends.</p>
        <Button variant="secondary" block size="md" onClick={() => open("login")}>
          Log in to play with friends
        </Button>
      </>
    );
  } else if (inMatch) {
    key = "inmatch";
    body = (
      <p className="fp-sub">
        {mp.roomType === "friend" ? "Private match in progress." : "You're in a match — finish it to open a room."}
      </p>
    );
  } else if (lobby) {
    const empties = Math.max(0, lobby.capacity - lobby.members.length);
    key = "lobby";
    body = (
      <>
        <div className="fp-code-row" aria-label="Room code">
          <div className="fp-tiles">
            {String(lobby.code).split("").map((d, i) => (
              <span key={i} className="fp-tile is-code">{d}</span>
            ))}
          </div>
          <button
            className={`fp-copy${copied ? " is-copied" : ""}`}
            onClick={doCopy}
            aria-label={copied ? "Code copied" : "Copy room code"}
            title="Copy code"
          >
            {copied ? (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>
            ) : (
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></svg>
            )}
          </button>
        </div>
        <p className="fp-sub" style={{ textAlign: "center" }}>
          {copied ? "Copied — send it to your friends!" : `Share this code. The game starts when ${lobby.capacity} players are in.`}
        </p>

        <div className="fp-seats">
          {lobby.members.map((m) => (
            <div key={m.username} className="fp-seat">
              <img
                className="fp-seat-av"
                src={m.profile_photo || defaultAvatar}
                alt=""
                onError={(e) => { (e.currentTarget as HTMLImageElement).src = defaultAvatar; }}
              />
              <span className="fp-seat-name" title={m.username}>
                {m.username}{m.username === user?.username ? " (you)" : ""}
              </span>
              {m.isHost && <span className="fp-host-chip">HOST</span>}
              <span className={`fp-dot${m.online ? "" : " is-off"}`} aria-label={m.online ? "Online" : "Reconnecting"} />
            </div>
          ))}
          {Array.from({ length: empties }).map((_, i) => (
            <div key={`empty-${i}`} className="fp-seat is-empty">
              <span className="fp-seat-hole" aria-hidden="true">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" /></svg>
              </span>
              <span className="fp-seat-wait">Waiting for a friend<span className="om-dots"><i /><i /><i /></span></span>
            </div>
          ))}
        </div>

        <div className="fp-meta">
          <span>Playing: <strong>{mp.game?.name}</strong></span>
          <span className="tnum">{lobby.members.length}/{lobby.capacity}</span>
        </div>

        <AnimatePresence mode="wait">
          {picking ? (
            <motion.div key="picker" {...swap} className="fp-picker">
              <div className="fp-picker-head">
                <span>Pick a game</span>
                <button className="fp-picker-x" onClick={() => setPicking(false)} aria-label="Close">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><path d="M18 6 6 18M6 6l12 12" /></svg>
                </button>
              </div>
              <div className="fp-picker-list">
                {games.filter((g) => g.id !== "coming-soon" && g.id !== mp.game?.id).map((g) => (
                  <button key={g.id} className="fp-picker-item" onClick={() => { setPicking(false); changeFriendGame(g); }}>
                    <span className="fp-picker-thumb" style={{ backgroundImage: g.backgroundImage }} />
                    <span className="fp-picker-name">{g.name}</span>
                  </button>
                ))}
              </div>
            </motion.div>
          ) : (
            <motion.div key="actions" {...swap} className="fp-actions">
              {isHost && (
                <Button variant="secondary" block size="sm" onClick={() => setPicking(true)}>
                  Change game
                </Button>
              )}
              <Button variant="ghost" block size="sm" onClick={leaveMatch}>
                {isHost ? "Cancel room" : "Leave room"}
              </Button>
            </motion.div>
          )}
        </AnimatePresence>
      </>
    );
  } else if (mode === "enter") {
    key = "enter";
    body = (
      <>
        <p className="fp-sub">Type the 6-digit code your friend shared.</p>
        <CodeInput
          value={code}
          onChange={(v) => { setCode(v); resetFriendJoinError(); }}
          onComplete={submitCode}
          disabled={joining}
          hasError={!!mp.friendJoinError}
        />
        {mp.friendJoinError && <p className="fp-err" role="alert">{mp.friendJoinError}</p>}
        <div className="fp-actions">
          <Button block size="md" disabled={code.length < 6 || joining} onClick={() => submitCode()}>
            {joining ? "Joining…" : "Join room"}
          </Button>
          <button className="fp-link" onClick={() => { setMode("menu"); setCode(""); resetFriendJoinError(); }}>
            Back
          </button>
        </div>
      </>
    );
  } else {
    key = "menu";
    body = (
      <>
        <p className="fp-sub">Private room for 3 players. Generate a code, or join with one.</p>
        <div className="fp-actions">
          <Button block size="md" disabled={blocked || searching || creating} onClick={() => createFriendRoom(game)}>
            {creating ? "Creating room…" : "Generate code"}
          </Button>
          <Button variant="secondary" block size="md" disabled={blocked || searching || creating} onClick={() => setMode("enter")}>
            Enter code
          </Button>
        </div>
        {(blocked || searching) && (
          <p className="fp-sub" style={{ fontSize: 12 }}>
            {searching ? "Cancel matchmaking to open a room." : "Finish your current game first."}
          </p>
        )}
      </>
    );
  }

  return (
    <div className="fp">
      <AnimatePresence mode="wait">
        <motion.div key={key} {...swap} className="fp-body">
          {body}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
