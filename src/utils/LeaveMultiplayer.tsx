import type { Dispatch, SetStateAction } from "react";
import type { Socket } from "socket.io-client";
import type { RoomState, User } from "../types/types";

interface LeaveMultiplayerArgs {
  socket: Socket;
  user: User | null;
  setRoomState: Dispatch<SetStateAction<RoomState>>;
}

export function leaveMultiplayer({ socket, user, setRoomState }: LeaveMultiplayerArgs) {
  socket.emit("leaveMultiplayer");

  console.log(`${user?.username ?? "Player"} is leaving multiplayer mode.`);

  // Reset to the canonical idle RoomState shape
  setRoomState({
    status: "idle",
    code: null,
    game: null,
    opponent: null,
    gameData: null,
    selfSocketId: null,
    role: null,
  });
}
