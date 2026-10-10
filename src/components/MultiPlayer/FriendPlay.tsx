import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { fadeIn } from "../../motion/variants";
import CopyIcon from "../motion/CopyIcon";
import { GAME_IN_PROGRESS } from "../../constants/messages";
import { useSelector } from "react-redux";
import copy from "copy-to-clipboard";
import { useMultiplayer } from "../../context/MultiplayerContext";
import { useModal } from "../../context/ModalContext";
import { roomBounds } from "../../utils/roomSizes";
import { Button } from "../ui";
import SwapText from "../motion/SwapText";
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
 * the live lobby (seats, share code, host controls). The host picks the room
 * size and starts the match from the lobby; the match then takes over the stage.
 */
export default function FriendPlay({ game, blocked = false, onBack }: { game: Game; blocked?: boolean; onBack?: () => void }) {
  const {
    mp, createFriendRoom, joinFriendRoom, changeFriendGame, setRoomSize, startRoom, leaveMatch, resetFriendJoinError,
  } = useMultiplayer();
  const { user, isLoggedIn } = useSelector((state: RootState) => state.user);
  const { open } = useModal();

  const [mode, setMode] = useState<"menu" | "enter">("menu");
  const [code, setCode] = useState("");
  const [copied, setCopied] = useState(false);
  // How many players the host wants, chosen before generating the code; follows the game's bounds.
  const bounds = roomBounds(game.id);
  const [size, setSize] = useState(bounds.min);
  useEffect(() => { setSize((s) => Math.min(bounds.max, Math.max(bounds.min, s))); }, [bounds.min, bounds.max]);
  // Mobile: the open room can collapse to a slim overview so the game stage
  // stays in view (the toggle is hidden on desktop widths via CSS).
  const [collapsed, setCollapsed] = useState(false);
  const copyTimer = useRef<number | null>(null);

  const lobby = mp.phase === "lobby" ? mp.lobby : null;
  const searching = mp.phase === "searching";
  const inMatch = mp.phase !== "idle" && mp.phase !== "lobby" && !searching;
  // Host is identified by public id (usernames may repeat).
  const isHost = !!lobby && (user?.id ? lobby.hostUid === user.id : lobby.hostUid === user?.username);
  const creating = mp.friendPending === "create";
  const joining = mp.friendPending === "join";

  // Leaving the flow (room closed, match started…) resets the card's local state.
  useEffect(() => {
    if (mp.phase !== "idle") { setMode("menu"); setCode(""); }
    if (mp.phase !== "lobby") { setCopied(false); setCollapsed(false); }
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
        <Button variant="secondary" size="lg" onClick={() => open("login")}>
          Log in to play with friends
        </Button>
      </>
    );
  } else if (inMatch) {
    key = "inmatch";
    body = (
      <p className="fp-sub">
        {mp.roomType === "friend" ? "Private match in progress." : "You're in a match."}
      </p>
    );
  } else if (lobby && collapsed) {
    // Slim overview: the code (copyable right here) and how full the room is; tap the rest to expand.
    key = "lobby-mini";
    body = (
      <div className="fp-mini">
        <span className="fp-mini-code tnum">#{lobby.code}</span>
        <button
          className={`fp-mini-copy${copied ? " is-copied" : ""}`}
          onClick={doCopy}
          aria-label={copied ? "Code copied" : "Copy room code"}
          title="Copy code"
        >
          <CopyIcon copied={copied} className="fp-copy-icon" />
        </button>
        <button className="fp-mini-expand" onClick={() => setCollapsed(false)} aria-label="Expand room details">
          <span className="fp-mini-meta tnum"><SwapText>{`${lobby.members.length}/${lobby.capacity}`}</SwapText></span>
          <span className={`fp-dot${lobby.members.every((m) => m.online) ? "" : " is-off"}`} />
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M6 9l6 6 6-6" /></svg>
        </button>
      </div>
    );
  } else if (lobby) {
    const empties = Math.max(0, lobby.capacity - lobby.members.length);
    const seated = lobby.members.length;
    const offline = lobby.members.filter((m) => !m.online);
    const canStart = seated >= lobby.min && offline.length === 0;
    const startReason = seated < lobby.min
      ? `Waiting for ${lobby.min - seated} more player${lobby.min - seated === 1 ? "" : "s"}`
      : offline.length ? `Waiting for ${offline[0].username} to reconnect` : "";
    const shareHint = lobby.capacity === 2
      ? "Send this code to your friend."
      : `Share this code with up to ${lobby.capacity - 1} friends.`;
    key = "lobby";
    body = (
      <>
        <button className="fp-toggle" onClick={() => setCollapsed(true)} aria-label="Collapse room details">
          Hide
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M18 15l-6-6-6 6" /></svg>
        </button>
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
            <CopyIcon copied={copied} className="fp-copy-icon" />
          </button>
        </div>
        <p className="fp-sub" style={{ textAlign: "center" }}>
          {/* Reserves the hint's box, so a two-line hint doesn't collapse to one line on "Copied." */}
          <SwapText swapKey={copied ? "copied" : "hint"} reserveWidth={["Copied.", shareHint]}>
            {copied ? "Copied." : shareHint}
          </SwapText>
        </p>

        <div className="fp-seats">
          <AnimatePresence initial={false} mode="popLayout">
          {lobby.members.map((m) => {
            const isMe = user?.id ? m.id === user.id : m.username === user?.username;
            return (
              <motion.div key={m.id || m.username} className="fp-seat" layout variants={fadeIn} initial="hidden" animate="visible" exit="exit">
                <img
                  className="fp-seat-av"
                  src={m.profile_photo || defaultAvatar.src}
                  alt=""
                  onError={(e) => { (e.currentTarget as HTMLImageElement).src = defaultAvatar.src; }}
                />
                <span className="fp-seat-col">
                  <span className="fp-seat-name" title={`${m.username} #${m.id}`}>
                    {m.username}{isMe ? " (you)" : ""}
                  </span>
                  <span className="fp-seat-id tnum">#{m.id}</span>
                </span>
                {m.isHost && <span className="fp-host-chip">HOST</span>}
                <span className={`fp-dot${m.online ? "" : " is-off"}`} aria-label={m.online ? "Online" : "Reconnecting"} />
              </motion.div>
            );
          })}
          {Array.from({ length: empties }).map((_, i) => (
            <motion.div key={`empty-${i}`} className="fp-seat is-empty" layout variants={fadeIn} initial="hidden" animate="visible" exit="exit">
              <span className="fp-seat-hole" aria-hidden="true">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" /></svg>
              </span>
              <span className="fp-seat-wait">Waiting for a friend<span className="om-dots"><i /><i /><i /></span></span>
            </motion.div>
          ))}
          </AnimatePresence>
        </div>

        <div className="fp-meta">
          <span>Playing: <strong><SwapText>{mp.game?.name}</SwapText></strong></span>
          {isHost ? (
            <SizeStepper value={lobby.capacity} min={Math.max(lobby.min, seated)} max={lobby.max} onChange={setRoomSize} />
          ) : (
            <span className="tnum">Room for <strong><SwapText>{String(lobby.capacity)}</SwapText></strong></span>
          )}
        </div>

        {isHost ? (
          <>
            <div className="fp-actions fp-actions--row">
              <Button size="sm" blocked={!canStart} onClick={() => { if (canStart) startRoom(); }}>
                Start game
              </Button>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => open("gamePicker", { currentId: mp.game?.id, seated, onPick: changeFriendGame })}
              >
                Change game
              </Button>
            </div>
            {/* Why Start is blocked, or that it's ready. One always-filled line whose text swaps
                (UI-21), so Close room below never jumps when Start unblocks (UI-23). */}
            <p className="fp-sub fp-start-reason" role="status">
              <SwapText>{canStart ? "Ready to start" : startReason}</SwapText>
            </p>
            <Button variant="ghost" size="sm" onClick={leaveMatch}>Close room</Button>
          </>
        ) : (
          <>
            <p className="fp-sub fp-start-reason" role="status">
              <SwapText>{canStart ? "Waiting for the host to start" : startReason}</SwapText>
            </p>
            <Button variant="ghost" size="sm" onClick={leaveMatch}>Leave room</Button>
          </>
        )}
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
          disabled={joining}
          hasError={!!mp.friendJoinError}
        />
        {mp.friendJoinError && <p className="fp-err" role="alert">{mp.friendJoinError}</p>}
        {/* Same size and type as Generate code / Enter code (fp-actions--row), centred alone. */}
        <div className="fp-actions fp-actions--row fp-actions--single">
          <Button size="sm" disabled={code.length < 6 || joining} onClick={() => submitCode()}>
            <SwapText>{joining ? "Joining…" : "Join room"}</SwapText>
          </Button>
        </div>
      </>
    );
  } else {
    key = "menu";
    body = (
      <>
        <SizeStepper value={size} min={bounds.min} max={bounds.max} onChange={setSize} disabled={blocked || searching || creating} />
        <div className="fp-actions fp-actions--row">
          <Button size="sm" disabled={blocked || searching || creating} onClick={() => createFriendRoom(game, size)}>
            <SwapText>{creating ? "Creating…" : "Generate code"}</SwapText>
          </Button>
          <Button variant="secondary" size="sm" disabled={blocked || searching || creating} onClick={() => setMode("enter")}>
            Enter code
          </Button>
        </div>
        {/* Only when there's something to say: an always-mounted blank line (plus the flex gap)
            left this view with more empty space at the bottom than the other Multiplayer views.
            The Multiplayer card's AutoHeight glides the size change (UI-23). */}
        <AnimatePresence initial={false}>
          {(searching || blocked) && (
            <motion.p key="fp-hint" className="fp-sub" style={{ fontSize: 12 }} role="status" variants={fadeIn} initial="hidden" animate="visible" exit="exit">
              {GAME_IN_PROGRESS}
            </motion.p>
          )}
        </AnimatePresence>
      </>
    );
  }

  // One back control for the whole flow, stepping back a single screen at a
  // time: the code entry returns to the menu, the menu leaves the friend flow.
  // A live lobby has no "previous screen" — you leave it, you don't go back.
  const goBack = mode === "enter"
    ? () => { setMode("menu"); setCode(""); resetFriendJoinError(); }
    : onBack;

  return (
    <div className="fp">
      {goBack && !lobby && (
        <button className="mp-back" aria-label="Back" onClick={goBack}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6" /></svg>
        </button>
      )}
      <AnimatePresence mode="wait">
        <motion.div key={key} {...swap} className="fp-body">
          {body}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}

/** "Players  − 3 +" — the room size, bounded. The number swaps (UI-21); the buttons go blocked at the bounds. */
function SizeStepper({ value, min, max, onChange, disabled = false }: { value: number; min: number; max: number; onChange: (n: number) => void; disabled?: boolean }) {
  // Drawn minus/plus in the card's icon stroke rather than text glyphs, so both sit optically centred.
  return (
    <div className="fp-size" role="group" aria-label="Players">
      <span className="fp-size-lbl">Players</span>
      <button type="button" className="fp-size-btn" aria-label="Fewer players" disabled={disabled || value <= min} onClick={() => onChange(value - 1)}>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" aria-hidden="true"><path d="M5 12h14" /></svg>
      </button>
      <span className="fp-size-num tnum" aria-live="polite"><SwapText>{String(value)}</SwapText></span>
      <button type="button" className="fp-size-btn" aria-label="More players" disabled={disabled || value >= max} onClick={() => onChange(value + 1)}>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
      </button>
    </div>
  );
}
