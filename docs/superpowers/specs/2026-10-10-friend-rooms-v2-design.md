# Friend rooms v2: sized rooms, host-started games, host controls, leave guards

Owner brief (2026-10-10): a private room must not start the moment it fills. The host picks how many
players the room is for (2 to 4), everyone joins, and the host starts the game. The host can stop the
match, change the game and run the room. Every way of leaving a room or match (to solo play, to the
home page, to a 1v1 search) is handled consistently for hosts and guests. The UI must be smooth, must
never overflow and must stay short on phones. The game switcher lives inside the game UI, not in the
left rail, and the rail is locked while you are in a room.

## Rules

1. **Room size.** The host chooses 2–4 players when generating the code and can change it in the
   lobby. Per-game bounds, server-authoritative (`turnGames.roomConfigFor(gameId) -> { min, max }`):
   default `{ min: 2, max: 4 }`, `tictactoe { min: 2, max: 2 }`, `imposter { min: 3, max: 4 }`
   (hidden game; was 3–5). The size can never go below the number of players already seated. A join
   into a full room is refused ("That room is already full.").
2. **No auto-start.** A full lobby stays a lobby. The host presses **Start game**, allowed once at
   least `min` players are seated and everyone seated is online. Guests see "Waiting for the host to
   start".
3. **Host controls.** Lobby: size, change game (picker), start, close room. During a match: **Stop
   match** returns everyone to the lobby (room kept, scores finished so far credited). Results: **Play
   again** (same game, immediate), **Change game** (picker, immediate restart with the new game), **Back
   to lobby**, close room. Guests only ever see "Waiting for the host…" plus **Leave room**. Random 1v1
   matches keep the existing propose/accept handshake for rematch and switch, using the same picker.
4. **Leaving.** A guest leaving a lobby frees the seat; the room lives on. A guest leaving a match is
   removed: the others continue if at least 2 remain (their round settles without the leaver), else
   everyone returns to the lobby. The host leaving anywhere closes the room for everyone. A dropped
   connection follows the same rules after the existing grace windows (10 s lobby, 30 s match).
5. **Leave guards.** While in a lobby or a match, the left game rail, the phone game strip, the Games
   link and the home logo stay visible but locked: pressing one opens a confirm dialog whose copy
   depends on role and phase (host: "closes it for everyone"; guest lobby: "your seat frees up"; match:
   "leave the match"). Confirm = leave then navigate; cancel = stay. Explicit Close room / Leave room
   buttons never ask. The "Match ended" screen (opponent left) never asks.
6. **Game picker.** One modal (`ModalKind "gamePicker"`, sheet on phones, scrolls inside) used by the
   lobby's Change game, the results' Change game (host in friend rooms; proposal in 1v1). Games whose
   max is below the seated count are shown disabled with "2 players only". The old in-card list and
   the rail-as-switcher are removed.
7. **Smoothness.** Every state change in the Multiplayer card glides (AutoHeight), labels swap in one
   element (SwapText), seats fade in/out, the Start button uses the `blocked` look with an inline
   reason, and no card ever overflows at 375 px wide.
