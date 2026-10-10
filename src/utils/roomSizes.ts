/** Friend-room player bounds per game. Mirrors multiplayer_server/src/turnGames.js ROOM_CONFIGS,
 *  which is the truth (the relay clamps and the lobby snapshot carries min/max); this copy only
 *  drives the stepper before a room exists and the picker's "N players only" labels. */
export const MAX_ROOM_SIZE = 4;
const BOUNDS: Record<string, { min: number; max: number }> = {
  tictactoe: { min: 2, max: 2 },
  imposter: { min: 3, max: 4 },
};
export function roomBounds(gameId: string | undefined): { min: number; max: number } {
  return (gameId && BOUNDS[gameId]) || { min: 2, max: MAX_ROOM_SIZE };
}
/** Games that have no online mode yet (no shared round or turn logic). */
export const NOT_ONLINE = new Set(["coming-soon", "who-would-win"]);
