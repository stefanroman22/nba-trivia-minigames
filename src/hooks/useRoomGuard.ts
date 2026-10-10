import { useCallback } from "react";
import { useSelector } from "react-redux";
import type { RootState } from "../store";
import { useMultiplayer } from "../context/MultiplayerContext";
import { showConfirm } from "../utils/Alerts";

/** What leaving means for this player right now (title, message, confirm label). */
function leaveCopy(phase: string, roomType: string | null, isHost: boolean) {
  if (roomType === "friend" && isHost) {
    return phase === "lobby"
      ? { title: "Close your room?", message: "You're hosting this room. Leaving closes it for everyone in it.", confirm: "Close room" }
      : { title: "End the match?", message: "You're hosting this match. Leaving ends it for everyone.", confirm: "End match" };
  }
  if (roomType === "friend") {
    return phase === "lobby"
      ? { title: "Leave the room?", message: "Your seat frees up. You can join again with the code.", confirm: "Leave room" }
      : { title: "Leave the match?", message: "The others keep playing without you.", confirm: "Leave match" };
  }
  return { title: "Leave the match?", message: "Your opponent's match ends too.", confirm: "Leave match" };
}

/**
 * One rule for every control that would take the player away from a live room or match (game rail,
 * phone game strip, Games link, the logo, Play 1v1): ask first, with copy that fits their role, and
 * leave only on "yes". Searching and the "Match ended" screen just leave, no question.
 */
export function useRoomGuard() {
  const { mp, leaveMatch } = useMultiplayer();
  const { user } = useSelector((state: RootState) => state.user);
  const inRoom = mp.phase !== "idle" && mp.phase !== "searching" && mp.phase !== "ended";
  const isHost = mp.roomType === "friend" && (mp.phase === "lobby"
    ? (user?.id ? mp.lobby?.hostUid === user.id : mp.lobby?.hostUid === user?.username)
    : mp.role === "host");

  const confirmLeave = useCallback(async (): Promise<boolean> => {
    if (mp.phase === "idle") return true;
    if (mp.phase === "searching" || mp.phase === "ended") { leaveMatch(); return true; }
    const copy = leaveCopy(mp.phase, mp.roomType, isHost);
    const ok = await showConfirm(copy.message, copy.title, copy.confirm);
    if (ok) leaveMatch();
    return ok;
  }, [mp.phase, mp.roomType, isHost, leaveMatch]);

  return { inRoom, isHost, confirmLeave };
}
