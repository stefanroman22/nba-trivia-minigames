import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useSelector } from "react-redux";
import { useModal } from "../../context/ModalContext";
import { useMultiplayer } from "../../context/MultiplayerContext";
import { Button } from "../ui";
import FriendPlay from "./FriendPlay";
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

  return (
    <div className="aside-card mp-panel">
      <div className="aside-card-head">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--brand)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M9 7a4 4 0 1 0 0 .01M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" /></svg>
        <h3 className="font-display" style={{ fontSize: 15 }}>Multiplayer</h3>
        <button className="info-btn" aria-label="How multiplayer works" style={{ marginLeft: "auto" }} onClick={() => open("multiplayerInfo")}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><path d="M12 16v-4M12 8h.01" /></svg>
        </button>
      </div>

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
                {mp.phase === "searching" ? (
                  <Button variant="ghost" size="sm" onClick={leaveMatch}>Cancel</Button>
                ) : (
                  <Button size="sm" disabled={online} onClick={() => game && findMatch(game)}>
                    {online ? "In a match" : "Play 1v1"}
                  </Button>
                )}
                <Button variant="secondary" size="sm" onClick={() => setFriendMode(true)}>
                  Play with a friend
                </Button>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
