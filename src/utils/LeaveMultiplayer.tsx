

export function leaveMultiplayer({ socket, user, setRoomState}) {
  socket.emit("leaveMultiplayer");

  console.log(`${user} is leaving multiplayer mode.`);

  // Reset local state
  setRoomState({ status: "idle", code: null, isHost: false });

}