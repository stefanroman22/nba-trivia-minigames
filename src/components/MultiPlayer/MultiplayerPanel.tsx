import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useSelector } from "react-redux";
import { useModal } from "../../context/ModalContext";
import { useMultiplayer } from "../../context/MultiplayerContext";
import { Button } from "../ui";
import { fadeIn } from "../../motion/variants";
import { GAME_IN_PROGRESS } from "../../constants/messages";
import SwapText from "../motion/SwapText";
import FriendPlay from "./FriendPlay";
import AutoHeight from "../motion/AutoHeight";
import type { RootState } from "../../store";
import type { Game } from "../../types/types";

const EASE = [0.22, 1, 0.36, 1] as [number, number, number, number];
const swap = {
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -8 },
  transition: { duration: 0.24, ease: EASE },
};

/**
 * One "Multiplayer" card, not two. The default view is a single choice —
 * random 1v1, or a private room — and picking "Play with a friend" swaps the
 * card's content in place for FriendPlay's own flow (code, lobby, seats).
 * A live room always shows its own content regardless of the toggle, since
 * there's nothing left to choose once you're actually in one.
 */
export default function MultiplayerPanel({
  game, gameStarted, showResult,
}: { game?: Game; gameStarted: boolean; showResult: boolean }) {
  const { isLoggedIn } = useSelector((state: RootState) => state.user);
  const { open } = useModal();
  const { mp, findMatch, leaveMatch } = useMultiplayer();
  const [friendMode, setFriendMode] = useState(false);

  const inLobby = mp.phase === "lobby";
  const online = mp.phase !== "idle" && !inLobby;
  const showFriend = friendMode || inLobby;

  // Below the desktop layout the card sits under the game: when a room opens, glide just far
  // enough to show it (code, seats, start) without losing the game above it.
  const cardRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!inLobby || !cardRef.current || window.matchMedia("(min-width: 1200px)").matches) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    cardRef.current.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "nearest" });
  }, [inLobby]);
  // Online play can't start while a solo run, a search or a match is going. The buttons look
  // disabled (Button `blocked`) but a press shows GAME_IN_PROGRESS inside this card — same view, no
  // popup — and the card glides to fit it (AutoHeight); it fades out after a few seconds.
  const searching = mp.phase === "searching";
  const soloInProgress = gameStarted && !showResult;
  const busy = soloInProgress || online || searching;
  const [hintShown, setHintShown] = useState(false);
  const hintTimer = useRef<number | null>(null);
  const showHint = () => {
    setHintShown(true);
    if (hintTimer.current) window.clearTimeout(hintTimer.current);
    hintTimer.current = window.setTimeout(() => setHintShown(false), 3500);
  };
  useEffect(() => () => { if (hintTimer.current) window.clearTimeout(hintTimer.current); }, []);
  const hint = hintShown && busy;
  const message = hint ? GAME_IN_PROGRESS : !online && mp.notice ? mp.notice.text : null;

  return (
    <div ref={cardRef} className={`aside-card mp-panel${inLobby ? " is-room" : ""}`}>
      <div className="aside-card-head">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--brand)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M9 7a4 4 0 1 0 0 .01M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" /></svg>
        <h3 className="font-display" style={{ fontSize: 15 }}>Multiplayer</h3>
        <button className="info-btn" aria-label="How multiplayer works" style={{ marginLeft: "auto" }} onClick={() => open("multiplayerInfo")}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><path d="M12 16v-4M12 8h.01" /></svg>
        </button>
      </div>

      {/* Glides to each state's height (choice -> code/lobby -> match) instead of snapping. */}
      <AutoHeight>
      <AnimatePresence mode="wait">
        {showFriend ? (
          <motion.div key="friend" {...swap} className="mp-friend">
            {game && (
              <FriendPlay
                game={game}
                blocked={gameStarted && !showResult}
                onBack={() => setFriendMode(false)}
              />
            )}
          </motion.div>
        ) : (
          <motion.div key="choice" {...swap} className="mp-choice">
            {!isLoggedIn ? (
              <>
                <p className="fp-sub">Challenge a random opponent, or set up a private room with friends.</p>
                <Button variant="secondary" size="lg" onClick={() => open("login")}>Log in to play online</Button>
              </>
            ) : (
              <div className="mp-row">
                {/* One button across idle / searching / in a match: the label swaps inside a
                    reserved box, so pressing Play 1v1 never replaces or resizes the control. */}
                <Button
                  variant={searching ? "ghost" : "primary"}
                  size="sm"
                  blocked={soloInProgress || (online && !searching)}
                  onClick={() => {
                    if (searching) return leaveMatch();
                    if (soloInProgress || online) return showHint();
                    if (game) findMatch(game);
                  }}
                >
                  <SwapText reserveWidth={["Play 1v1", "Cancel", "In a match"]}>
                    {mp.phase === "searching" ? "Cancel" : online ? "In a match" : "Play 1v1"}
                  </SwapText>
                </Button>
                <Button variant="secondary" size="sm" blocked={busy} onClick={() => (busy ? showHint() : setFriendMode(true))}>
                  Play with a friend
                </Button>
              </div>
            )}

          </motion.div>
        )}
      </AnimatePresence>
      {/* One message slot under either view: the blocked-press hint, otherwise anything that went
          wrong before a match (session expired, server unreachable, already in a match). These used
          to show only inside a live match, so a failed Play 1v1 looked like nothing happened. */}
      <AnimatePresence initial={false}>
        {message && (
          <motion.p key="mp-hint" className="fp-sub mp-hint" role="status" variants={fadeIn} initial="hidden" animate="visible" exit="exit">
            <SwapText>{message}</SwapText>
          </motion.p>
        )}
      </AnimatePresence>
      </AutoHeight>
    </div>
  );
}
