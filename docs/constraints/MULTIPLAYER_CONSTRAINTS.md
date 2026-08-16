# Multiplayer Constraints (Socket.IO realtime layer)

**Scope:** the realtime "Play Online" / "Play with a friend" stack — the Node/Socket.IO server
(`multiplayer_server/`), the frontend's socket connection and multiplayer state
(`src/socket.ts`, `src/context/MultiplayerContext.tsx`), and the multiplayer-facing UI
(`src/components/MultiPlayer/*.tsx`). Game-renderer *content* rules (idle/loading/feedback/
end-of-game shell) are `docs/GAME_DESIGN_CONSTRAINTS.md` territory; the Django round-data
endpoints the server fetches from are `docs/constraints/BACKEND_CONSTRAINTS.md` territory —
this doc only states the boundary between "single-player" and "multiplayer-ready" and how the
realtime layer itself is built, not how a round's questions are generated.

**Reference implementations** (read these before touching multiplayer code):

| Concern | Reference |
|---|---|
| Server: rooms, matchmaking, lobbies, reconnection | `multiplayer_server/src/index.js` |
| Server: turn-based game state machines (tictactoe/imposter) | `multiplayer_server/src/turnGames.js` |
| Server: game id → Django round-fetch URL | `multiplayer_server/src/gameEndpoints.js` |
| Offline simulation of both turn games (no network) | `multiplayer_server/scripts/sim_turngames.js` |
| Client: socket connection | `src/socket.ts` |
| Client: all socket event wiring + the `phase` state machine | `src/context/MultiplayerContext.tsx` |
| Client: matchmaking/lobby UI, results, proposals | `src/components/MultiPlayer/OnlineMatch.tsx`, `FriendPlay.tsx` |
| Client: how a game renderer plugs into online play | `src/Game Renderers/RenderGame.tsx` |
| Docs overview (may drift — code below is the arbiter) | `docs/ARCHITECTURE.md` §3 |

Everything below is measured from the live codebase (working tree, not just the last commit).
Where the code is inconsistent, the DOMINANT pattern is documented and the exception is called
out explicitly — nothing here is an aspirational convention the code doesn't actually show.
Note: `docs/ARCHITECTURE.md`'s frontend section calls friend rooms "private 3-player rooms" in
one place and "exactly 2 players" in its own §3 — the code (below, MP-9) is the arbiter: 2 is the
default for every game, and Imposter (3-5 players) is the one documented exception.

---

## Rule MP-1: Players are keyed by a stable `uid`, never `socket.id` — and the server trusts it unverified

`multiplayer_server/src/index.js`'s own top-of-file comment states the reason: socket ids change
on every reconnect, so the `players` Map (`uid -> { socketId, user, roomCode }`) and every room's
`members` array are keyed by `uid = user?.id || user?.username` (the `uidOf`/`identify` handler,
`players.set(uid, { socketId: socket.id, user, roomCode: ... })`). The client re-announces itself
with `socket.emit("identify", { user })` on every connect (`MultiplayerContext.tsx`). The server
does **not** verify this payload against the Django-issued JWT — there is no `jwt`/`verify`/
`Authorization` handling anywhere in `multiplayer_server/src/*.js` (see Acceptance checks). A
task must not assume the Node server can enforce anything the JWT-authenticated Django backend
guarantees.

```js
❌ WRONG — a new handler keying state by socket.id (breaks on reconnect)
const scores = new Map(); // socket.id -> score
socket.on("submitScore", ({ score }) => scores.set(socket.id, score));

✅ RIGHT — index.js, every handler resolves uid first
socket.on("submitScore", ({ code, score, elapsedMs } = {}) => {
  const room = rooms.get(code);
  const uid = uidOf(socket);
  if (!room || !uid || !room.members.includes(uid)) return;
  room.scores[uid] = Number(score) || 0;
  ...
});
```

## Rule MP-2: The server is authoritative for round data and turn-game state; the client only renders and emits actions

`dealRound()` fetches the round **once** from the Django backend and broadcasts the identical
`gameData` to every member (`room.members.forEach((uid) => toUid(uid, "roundData", { gameData, game: room.game }))`)
— the client never generates or requests its own round while in a room. For the two turn-based
games, `turnGames.js` owns a `state` object per room and re-broadcasts it after every validated
action (`broadcastTurnState`); the client's `turnAction` emit is a proposed move the server may
reject (`helpers.reject`), not a state mutation.

```js
❌ WRONG — a renderer trusting a locally-computed board state as final in a room
setBoard((b) => applyMove(b, move)); // no server round-trip

✅ RIGHT — turnGames.js validates, applies, and rebroadcasts
function handleTTT(room, uid, action, helpers) {
  if (uid !== s.turnUid) return helpers.reject(uid, "It isn't your turn.");
  ...
  s.board[cell] = { ownerUid: uid, playerName: displayName };
  broadcastTurnState(room, helpers);
}
```

## Rule MP-3: Two multiplayer engines, gated by the `TURN_GAMES` set — everyone-plays-then-submits is the default

`TURN_GAMES = new Set(["tictactoe", "imposter"])` (`index.js`) decides, inside `dealRound()`,
whether a room runs the default flow (fetch one shared round, every member plays it
independently, `submitScore` ends their turn, `settleMatch` fires once everyone's score is in) or
hands off to `turnGames.init()`'s server-driven state machine. A new turn-based game must be
added to `TURN_GAMES` in `index.js` **and** wired into every one of `turnGames.js`'s public
dispatch points (`init`, `handleAction`, `onDisconnect`, `resumeFor` — see its own header comment
for the full contract) — adding it to one and not the other leaves `dealRound`/`handleAction`
silently falling through to the wrong branch.

```js
❌ WRONG — a new turn-based game only added to turnGames.js's init(), not index.js's set
// turnGames.js gets "wordduel" logic, but index.js's TURN_GAMES never lists it
// -> dealRound() fetches a "round" for it via fetchRound() instead of calling turnGames.init()

✅ RIGHT — both sides updated together (the existing pair)
const TURN_GAMES = new Set(["tictactoe", "imposter"]); // index.js
if (room.gameId === "tictactoe") return initTTT(room, helpers);   // turnGames.js
if (room.gameId === "imposter") return initImposter(room, helpers);
```

## Rule MP-4: Socket event names are camelCase verbs (client→server) paired with a `<stem><Result|Error>` pair (server→client)

Client emits are bare action verbs: `identify`, `findMatch`, `cancelFind`, `createFriendRoom`,
`joinFriendRoom`, `changeFriendGame`, `startRoomNow`, `turnAction`, `submitScore`,
`reportProgress`, `proposeAgain`, `proposeSwitch`, `respondProposal`, `cancelProposal`,
`leaveMatch`. Server emits pair a success event with an `*Error` sibling sharing the same stem:
`matchFound`/`matchError`, `friendRoomCreated`/`friendError`, `friendRoomJoined`/`friendJoinError`,
`roundData`/`roundDataError`, `turnState`/`turnReject`. Multi-step flows use one shared stem with
a suffix per step: `proposalPending` (mine) / `proposalReceived` (theirs) / `proposalProgress` /
`proposalDeclined` / `proposalCancelled` / `proposalTimeout`.

```js
❌ WRONG — a new feature inventing its own error-naming shape
socket.emit("spectateFailed", { message: "..." }); // no "spectate" success event to pair with

✅ RIGHT — index.js, matching the friend-room pair
socket.emit("friendRoomCreated", lobbySnapshot(room));   // success
socket.emit("friendError", { message: "..." });          // paired error
```

## Rule MP-5: `MpState.phase` is the single client-side source of truth, and only the reducer sets it

`src/context/MultiplayerContext.tsx`'s `Phase` union (`idle | searching | lobby | intro |
playing | waiting | results | ended`) drives every screen (`MiniGame.tsx`'s `online`/`inLobby`
booleans, `OnlineMatch.tsx`'s stage switch, `FriendPlay.tsx`'s card body). It only changes inside
`reducer()`, dispatched from socket event handlers — no component calls `dispatch` with a
hand-picked phase, and no component keeps its own parallel "am I in a match" boolean.

```tsx
❌ WRONG — a component inventing its own local phase instead of reading mp.phase
const [inRoom, setInRoom] = useState(false);
socket.on("friendRoomCreated", () => setInRoom(true));

✅ RIGHT — every screen reads the one state machine
const { mp } = useMultiplayer();
const inLobby = mp.phase === "lobby";
```

## Rule MP-6: `room.members[0]` is always the host — host-gated actions check that index directly

Nothing stores a separate `hostUid` field on a room; `lobbySnapshot()`'s `hostUid: room.members[0]`
and `snapshotFor()`'s `role: room.members[0] === uid ? "host" : "guest"` both derive from the same
index. Host-only actions guard on it inline: `changeFriendGame` (`if (room.members[0] !== uid)
return`) and `startRoomNow`. `FriendPlay.tsx` mirrors this on the client (`isHost = lobby.hostUid
=== user?.id`) rather than trusting a locally-tracked "am I the host" flag.

```js
❌ WRONG — tracking host separately from members[0], so it can drift after a rejoin
room.hostUid = uid; // set once at creation, never reconciled with members[]

✅ RIGHT — index.js, every host check reads members[0] live
socket.on("changeFriendGame", ({ code, game } = {}) => {
  const room = rooms.get(Number(code));
  const uid = uidOf(socket);
  if (!room || room.type !== "friend" || room.phase !== "lobby") return;
  if (!uid || room.members[0] !== uid || !game?.id) return;
  ...
});
```

## Rule MP-7: Reconnection is a uid-keyed grace timer, and resume replays the exact live-state helpers

A drop starts a `setTimeout` stored on `room.graceTimers[uid]` — `GRACE_MS` (30s) for a live
match, the shorter `LOBBY_GRACE_MS` (10s) for an unfilled lobby (cheaper to just close). A
reconnecting socket re-emits `identify`; the handler looks up `players.get(uid).roomCode`, clears
the pending grace timer, rejoins the Socket.IO room, and pushes `resumeMatch` built by
`snapshotFor(room, uid)` — the **same** function whose `rankRoom`/phase-derivation logic backs
live broadcasts (see MP-8), so a resumed client can never see a different state than a connected
one would have.

```js
❌ WRONG — a new grace-window feature keyed by socket.id (survives a resume by luck, not design)
room.graceTimers[socket.id] = setTimeout(() => destroyRoom(room, "timeout"), GRACE_MS);

✅ RIGHT — index.js's disconnect handler, keyed by uid like everything else
room.graceTimers[uid] = setTimeout(() => {
  ...
  destroyRoom(room, `${uid} grace timeout`);
  players.delete(uid);
}, GRACE_MS);
```

## Rule MP-8: All score ranking/tie-break logic lives in one function, `rankRoom()`

Score DESC, then elapsed time ASC (a null time counts as slowest) is implemented exactly once;
both the live `settleMatch()` broadcast and the reconnect `snapshotFor()`'s `standings` field call
`rankRoom(room)` — the function's own comment states this is deliberate ("Shared by settleMatch
AND snapshotFor so live results and resumes can never disagree"). A new results view must consume
`standings`/`rankRoom`'s output, not re-sort `room.scores` itself.

```js
❌ WRONG — a new results panel re-deriving winner order from room.scores directly
const winner = Object.entries(room.scores).sort((a, b) => b[1] - a[1])[0]; // ignores the time tiebreak

✅ RIGHT — index.js, the one ranking function both call sites share
function rankRoom(room) {
  const timeKey = (uid) => (room.times[uid] == null ? Infinity : room.times[uid]);
  return room.members
    .map((uid) => ({ uid, score: room.scores[uid] ?? 0, elapsedMs: room.times[uid] ?? null }))
    .sort((a, b) => b.score - a.score || timeKey(a.uid) - timeKey(b.uid))
    /* ...outcome derivation... */;
}
```

## Rule MP-9: Friend-room capacity/min-to-start come from `turnGames.roomConfigFor(gameId)` — 2 is the default, Imposter is the one exception

`DEFAULT_ROOM_CONFIG = { capacity: 2, min: 2 }`; `ROOM_CONFIGS = { imposter: { capacity: 5, min:
3 } }` (`turnGames.js`). `makeRoom()` and `changeFriendGame`'s capacity recompute both call
`roomConfigFor()` rather than hardcoding a number — `changeFriendGame` explicitly takes
`Math.max(room.members.length, roomConfigFor(game.id).capacity)` so switching games never shrinks
below who's already seated. The unused `FRIEND_ROOM_SIZE = 2` constant at the top of `index.js` is
a leftover of an earlier design (its own comment now says "default friend-room size; turn games
override via turnGames.roomConfigFor") — it is not read anywhere; don't wire new code to it.

```js
❌ WRONG — a new 4-player game hardcoding its capacity where rooms are created
const room = makeRoom(code, game.id, game, [uid], "friend");
room.capacity = 4; // bypasses roomConfigFor entirely

✅ RIGHT — turnGames.js, add an entry and let makeRoom()/changeFriendGame read it
const ROOM_CONFIGS = { imposter: { capacity: 5, min: 3 }, newgame: { capacity: 4, min: 2 } };
```

## Rule MP-10: `gameEndpoints.js` is the single game-id → Django round-URL map; a missing entry throws, it doesn't silently no-op

`fetchRound()` looks up `gameEndpoints[gameId]` and throws `` `No endpoint configured for game
id: ${gameId}` `` if it's missing — there is no fallback or default URL pattern. Every game
playable online must have an entry here keyed identically to `src/utils/GameUtils.tsx`'s
`Game.id` and the matching Django slug in `trivia/urls.py`/`trivia/games/__init__.py` (see
`BACKEND_CONSTRAINTS.md` BE-2 for how that slug is registered on the Django side — not restated
here).

```js
❌ WRONG — a new game added to GameUtils.tsx but forgotten in gameEndpoints.js
// src/utils/GameUtils.tsx has { id: "new-game", ... }
// multiplayer_server/src/gameEndpoints.js has no "new-game" key
// -> every multiplayer round for it throws "No endpoint configured for game id: new-game"

✅ RIGHT — gameEndpoints.js, id matches GameUtils.tsx and trivia/urls.py exactly
"nba-grid": `${API_BASE_URL}/trivia/nba-grid/`,
```

## Rule MP-11: Three network boundaries, three independent env vars — never hardcode a non-localhost URL

Frontend → socket server: `VITE_SOCKET_URL` (`src/socket.ts`, defaults `http://localhost:4000`).
Socket server's own listen port: `PORT` (`multiplayer_server/src/index.js`, defaults `4000`).
Socket server → Django: `API_BASE_URL` (`multiplayer_server/src/gameEndpoints.js` **and**
`turnGames.js` each read it independently, defaulting `http://localhost:8000`). All three are
documented together in `multiplayer_server/.env.example`, `README.md`, and `docs/DEPLOYMENT.md`.
A production value only ever lives in real env vars — never a second hardcoded literal alongside
the dev fallback (see `BACKEND_CONSTRAINTS.md` BE-14 for the general env-var pattern on the
Django side).

```ts
❌ WRONG — a new file hardcoding the production socket URL as a fallback
const SOCKET_URL = import.meta.env.VITE_SOCKET_URL || "https://nba-multiplayer-production.up.railway.app";

✅ RIGHT — src/socket.ts, only a localhost dev fallback
const SOCKET_URL = import.meta.env.VITE_SOCKET_URL || "http://localhost:4000";
```

## Rule MP-12: SP-first-but-MP-ready — a game needs zero multiplayer code to be playable online; only 3 of 18 renderers actually branch on it

Every game renderer is driven purely by its `gameData`/`onGameEnd` props; single-player
(`MiniGame.tsx`) and multiplayer (`OnlineMatch.tsx`) both call the same `renderGame()` switch —
the server deals the room the identical round and `submitScore` on end works exactly like solo
scoring. `RenderGame.tsx` only forwards the extra `turn`/`onTurnAction`/`multiplayer` props to
the 3 cases whose behavior actually changes in a room: `ConnectionsGame` (hides the Shuffle
control), `TicTacToe` and `ImposterGame` (full server-authoritative turn engine, MP-2/MP-3). Seven
other renderers (`BingoGame`, `CareerPath`, `Contexto`, `NbaGrid`, `PackFive`, `SuperDraft`,
`WhoAreYa`) declare an unused `multiplayer?: boolean` prop in their own TypeScript interface that
`RenderGame.tsx` never actually passes — that's dead scaffolding, not a wiring template; a game
that plays identically solo or online needs no such prop at all.

```tsx
❌ WRONG — a new renderer adding `multiplayer?: boolean` "just in case", copying the unwired 7
export interface NewGameProps {
  gameInfo: GameData[];
  onGameEnd: OnGameEnd;
  multiplayer?: boolean; // RenderGame.tsx will never pass this — dead prop
}

✅ RIGHT — RenderGame.tsx, a plain SP/MP-agnostic game (Bingo)
case "bingo":
  return <BingoGame gameInfo={gameData as BingoCard[]} onGameEnd={onGameEnd} />;
```

## Rule MP-13: Game renderers never import the socket directly; the one renderer that reads `useMultiplayer()` (ImposterGame) uses it only for roster display, not game logic

No file under `src/Game Renderers/*.tsx` imports `../socket`. `ImposterGame.tsx` is the sole
renderer importing `useMultiplayer` — it reads `mp.opponents` only to resolve display
name/avatar for uids the server's `turn` state references (`seatByUid`); every actual game-state
decision (whose turn, phase, scores) still comes from the `turn` prop the parent passed in, per
MP-2. All socket plumbing stays inside `MultiplayerContext.tsx` + `OnlineMatch.tsx`/`FriendPlay.tsx`.

```tsx
❌ WRONG — a renderer emitting a socket event directly instead of using onTurnAction
import socket from "../socket";
const submitClue = (text: string) => socket.emit("turnAction", { code, action: { type: "clue", text } });

✅ RIGHT — ImposterGame.tsx, actions flow through the prop the parent wired to the context
onTurnAction?.({ type: "clue", text });
```

---

## Acceptance checks

Concrete commands (run from the repo root unless noted) an automated reviewer can run against a
diff. All outputs below were captured directly against the current working tree.

**1. The three server source files are syntactically valid (no partial edits left broken).**
```bash
node --check multiplayer_server/src/index.js
node --check multiplayer_server/src/turnGames.js
node --check multiplayer_server/src/gameEndpoints.js
```
Observed: all three exit 0 with no output (valid).

**2. The offline turn-game simulation reaches a win and a full reveal (Rule MP-2/MP-3).**
```bash
cd multiplayer_server && node scripts/sim_turngames.js
```
Observed (tail):
```
================ RESULT ================
Tic-Tac-Toe reached a win : PASS
Imposter reached reveal   : PASS
```

**3. Server→client events pair a success stem with an `*Error`/status sibling (Rule MP-4).**
```bash
grep -oE '\btoUid\([a-zA-Z0-9_.]+, "[a-zA-Z]+"' multiplayer_server/src/index.js multiplayer_server/src/turnGames.js | sed -E 's/.*"([a-zA-Z]+)"/\1/' | sort -u
```
Observed: `friendLobbyUpdate friendRoomCancelled matchError matchFound matchRestart matchResult
noOpponent opponentDisconnected opponentFinished opponentLeft opponentProgress
opponentReconnected proposalCancelled proposalDeclined proposalProgress proposalReceived
proposalTimeout roundData roundDataError searching turnReject turnState` — every `propose*`/
`friend*`/`match*`/`round*` stem has its documented pairing.

**4. Only 3 of 18 game renderers are wired for multiplayer props (Rule MP-12).**
```bash
grep -c 'multiplayer={multiplayer}' "src/Game Renderers/RenderGame.tsx"
grep -rl 'multiplayer?: boolean' "src/Game Renderers" | grep -v -E "RenderGame|ConnectionsGame|TicTacToe|ImposterGame"
```
Observed: first command → `3`. Second command lists exactly 7 files: `BingoGame.tsx`,
`CareerPath.tsx`, `Contexto.tsx`, `NbaGrid.tsx`, `PackFive.tsx`, `SuperDraft.tsx`,
`WhoAreYa.tsx` — the documented unwired-prop exception, no more and no fewer.

**5. No game renderer imports the socket directly; `useMultiplayer` appears in exactly one (Rule MP-13).**
```bash
grep -rl 'from "../socket"' "src/Game Renderers"
grep -rl "useMultiplayer" "src/Game Renderers"
```
Observed: first command → no output (no matches). Second command → `src/Game
Renderers/ImposterGame.tsx` only.

**6. `TURN_GAMES` and `ROOM_CONFIGS` are the only places turn-engine membership / non-default room
sizing are declared (Rule MP-3, MP-9).**
```bash
grep -n "TURN_GAMES = new Set" multiplayer_server/src/index.js
grep -n "ROOM_CONFIGS = " multiplayer_server/src/turnGames.js
```
Observed:
```
62:const TURN_GAMES = new Set(["tictactoe", "imposter"]);
46:const ROOM_CONFIGS = { imposter: { capacity: 5, min: 3 } };
```
