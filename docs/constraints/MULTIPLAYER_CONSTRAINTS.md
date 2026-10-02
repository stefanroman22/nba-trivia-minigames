# Multiplayer Constraints (Socket.IO realtime layer)

**Scope:** the realtime "Play 1v1" / "Play with a friend" stack: the Node/Socket.IO relay
(`multiplayer_server/`), the frontend's socket connection and multiplayer state
(`src/socket.ts`, `src/context/MultiplayerContext.tsx`), and the multiplayer-facing UI
(`src/components/MultiPlayer/*.tsx`). Renderer *content* rules (idle/loading/feedback/end-of-game
shell) are `docs/GAME_DESIGN_CONSTRAINTS.md` territory; the Django round endpoints the relay
fetches from are `docs/constraints/BACKEND_CONSTRAINTS.md` territory. This doc states the
boundary between "single-player" and "multiplayer-ready" and how the realtime layer is built.

**Deployment status:** the relay is **not deployed in production** (`docs/DEPLOYMENT.md`: the old
Railway host is gone). Code in this stack is exercised locally and by the two offline sims only.
Do not treat a green production smoke test as evidence about multiplayer.

**Reference implementations** (read before touching multiplayer code):

| Concern | Reference |
|---|---|
| Relay: rooms, matchmaking, lobbies, proposals, reconnection | `multiplayer_server/src/index.js` |
| Relay: turn-game state machines (tictactoe, imposter) | `multiplayer_server/src/turnGames.js` |
| Relay: pre-generated question dealing (Supabase Storage) | `multiplayer_server/src/questions.js` |
| Relay: game id to Django round URL | `multiplayer_server/src/gameEndpoints.js` |
| Relay: shared answer normaliser (mirrors `src/utils/answerMatch.ts`) | `multiplayer_server/src/answerMatch.js` |
| Offline sims (no network) | `multiplayer_server/scripts/sim_turngames.js`, `multiplayer_server/scripts/sim_round_fanout.js` |
| Client: socket connection | `src/socket.ts` |
| Client: all event wiring + the `phase` state machine | `src/context/MultiplayerContext.tsx` |
| Client: panel, lobby, match stage, results | `src/components/MultiPlayer/MultiplayerPanel.tsx`, `FriendPlay.tsx`, `OnlineMatch.tsx`, `PlayerCard.tsx`, `CodeInput.tsx` |
| Client: how a renderer plugs into online play | `src/Game Renderers/RenderGame.tsx` |
| Client: where the panel / online stage mounts | `src/views/Trivia/MiniGame.tsx` |
| Docs (may drift; code is the arbiter) | `docs/ARCHITECTURE.md` section 3, `docs/DEPLOYMENT.md` |

Everything below is measured from the working tree. Where the code is inconsistent the DOMINANT
pattern is documented and the exception is called out. Known doc drift: `docs/ARCHITECTURE.md`
section 3 still says the relay fetches every round from Django, that friend rooms hold "exactly 2
players", and that production is `nba-multiplayer-production.up.railway.app`. The code says: four
round games plus both turn games are dealt from the questions store (MP-10), Imposter seats 3-5
(MP-9), and nothing is deployed.

Each rule's ❌ is labelled **real** (exists in the repo today, cited) or **hypothetical**.

---

## Rule MP-1: Players are keyed by a stable `uid`, never `socket.id`, and the relay trusts it unverified

`multiplayer_server/src/index.js` keys the `players` Map (`uid -> { socketId, user, roomCode }`)
and every room's `members` array by `uid = user?.id || user?.username` (the `identify` handler),
because socket ids change on every reconnect. The client re-announces with
`socket.emit("identify", { user })` on every `connect` (`MultiplayerContext.tsx`). The relay does
**not** verify that payload against the Django JWT: there is no `jwt`/`verify`/`Authorization`
handling anywhere in `multiplayer_server/src/` (Acceptance check 8). Do not assume the relay
enforces anything the JWT-authenticated backend guarantees.

```js
❌ hypothetical: a handler keyed by socket.id (breaks on reconnect)
const scores = new Map(); // socket.id -> score
socket.on("submitScore", ({ score }) => scores.set(socket.id, score));

✅ multiplayer_server/src/index.js: every handler resolves uid first, then checks membership
socket.on("submitScore", ({ code, score, elapsedMs } = {}) => {
  const room = rooms.get(code);
  const uid = uidOf(socket);
  if (!room || !uid || !room.members.includes(uid)) return;
  ...
```

## Rule MP-2: State ownership: the relay owns rooms, deals, turn state and ranking; the client owns only its own score and its renderer's in-round state

Relay-authoritative: room membership/phase, the dealt round (`dealRound()` deals once and emits
the same `gameData` to every member), all turn-game state (`turnGames.js` validates each
`turnAction`, mutates `room.turn.state`, re-broadcasts via `broadcastTurnState`), standings
(`rankRoom`, MP-8), proposals, lobby snapshots. Client-authoritative (and trusted unverified):
each member's final `score`/`elapsedMs` for round games (`submitScore`), and the `game` object
sent with `findMatch`/`createFriendRoom`/`changeFriendGame`/`proposeSwitch`. The client mirrors
server state in `MpState` and never derives a room fact locally. The relay emits
`turnReject` (`{ message }`) for illegal turn moves (`turnHelpers.reject` in `index.js`); the
client's `turnReject` handler in `MultiplayerContext.tsx` dispatches a transient `warn` `NOTICE`,
shown by `OnlineMatch.tsx`'s `NoticeBar` (Acceptance check 4).

```tsx
❌ hypothetical: a renderer mutating turn state locally as if final
setBoard((b) => applyMove(b, move)); // no server round-trip, diverges from the other player

✅ multiplayer_server/src/turnGames.js: validate, apply, rebroadcast
function handleTTT(room, uid, action, helpers) {
  if (uid !== s.turnUid) return helpers.reject(uid, "It isn't your turn.");
  ...
  s.board[cell] = { ownerUid: uid, playerName: displayName };
  ...
  broadcastTurnState(room, helpers);
```

## Rule MP-3: Two engines gated by `TURN_GAMES`: everyone-plays-then-submits is the default

`TURN_GAMES = new Set(["tictactoe", "imposter"])` (`index.js`) makes `dealRound()` call
`turnGames.init()` (server-driven state machine, `turnState` broadcasts) instead of fetching one
shared round. A new turn game must be added to `TURN_GAMES` **and** to every public dispatch in
`turnGames.js` (`roomConfigFor`, `init`, `handleAction`, `onDisconnect`, `resumeFor`, per its
header comment) **and** get a renderer that takes `turn`/`onTurnAction` from `RenderGame.tsx`.
Adding it to only one side makes `dealRound` fall through to `fetchRound`.

```js
❌ hypothetical: "wordduel" logic added to turnGames.js init() but not to TURN_GAMES
// dealRound() then calls fetchRound("wordduel") and throws "No endpoint configured..."

✅ the existing pair, kept in sync (index.js + turnGames.js)
const TURN_GAMES = new Set(["tictactoe", "imposter"]);
if (room.gameId === "tictactoe") return initTTT(room, helpers);
if (room.gameId === "imposter") return initImposter(room, helpers);
```

## Rule MP-4: Event names are camelCase; client emits are action verbs, server emits pair a success event with a feature-scoped error event

Client to server: `identify`, `findMatch`, `cancelFind`, `createFriendRoom`, `joinFriendRoom`,
`changeFriendGame`, `startRoomNow`, `turnAction`, `submitScore`, `reportProgress`, `proposeAgain`,
`proposeSwitch`, `respondProposal`, `cancelProposal`, `leaveMatch`. Server to client pairs are
feature-scoped, not a mechanical `<stem>Error`: `matchFound`/`matchError`, `roundData`/
`roundDataError`, `friendRoomCreated`+`friendRoomJoined`/`friendError`+`friendJoinError`,
`turnState`/`turnReject`; multi-step flows share a stem (`proposalPending|Received|Progress|
Declined|Cancelled|Timeout`). Payload conventions (dominant): every room-scoped emit is
`{ code, ... }` with `code` a **number** (client sends `codeRef.current`; server `rooms` Map is
keyed by integer); any `Game` sent over the wire goes through `serializeGame()` in
`MultiplayerContext.tsx` (functions like `fetchData` are not serializable). Exception: server
handlers are inconsistent about coercing `code` (`changeFriendGame`/`startRoomNow`/`turnAction`
use `Number(code)`; `submitScore`/`reportProgress`/proposals/`leaveMatch` use `rooms.get(code)`
raw), so always send a number. Every client emit has a server handler; a new emit must add one (Acceptance check 5).

```ts
❌ hypothetical: an emit with no relay handler (the old `leaveMultiplayer` / `setUserInfo` were removed)
socket.emit("leaveMultiplayer");            // relay handles "leaveMatch"
socket.emit("setUserInfo", null);           // no such handler in index.js

✅ src/context/MultiplayerContext.tsx: real event, numeric code, serialized game
socket.emit("leaveMatch", { code: codeRef.current });
socket.emit("proposeSwitch", { code: codeRef.current, game: serializeGame(game) });
```

## Rule MP-5: `MpState.phase` is the single client-side source of truth and only the reducer sets it

`MultiplayerContext.tsx`'s `Phase` union (`idle | searching | lobby | intro | playing | waiting |
results | ended`) drives every screen (`MiniGame.tsx`'s `online`/`inLobby`, `OnlineMatch.tsx`'s
stage switch, `FriendPlay.tsx`'s `inMatch`/`lobby`, `MultiplayerPanel.tsx`). It changes only in
`reducer()`, dispatched from socket handlers and the provider's own callbacks. Components may keep
UI-only state (`FriendPlay`'s `mode`/`picking`/`collapsed`) but no parallel "am I in a match".

```tsx
❌ hypothetical: a component tracking its own room flag
const [inRoom, setInRoom] = useState(false);
socket.on("friendRoomCreated", () => setInRoom(true));

✅ src/views/Trivia/MiniGame.tsx: derive from the one state machine
const inLobby = mp.phase === "lobby";
const online = mp.phase !== "idle" && !inLobby;
```

## Rule MP-6: `room.members[0]` is the host; host-gated actions check that index live

There is no `hostUid` field on a room. `lobbySnapshot()` derives `hostUid: room.members[0]`,
`snapshotFor()` derives `role`, and `changeFriendGame`/`startRoomNow` guard inline with
`room.members[0] !== uid`. `FriendPlay.tsx` compares `lobby.hostUid` to the user's public id
(username fallback) instead of a stored flag. Room destruction on any leave means the host never
changes mid-room.

```js
❌ hypothetical: a separately stored host that can drift from members[]
room.hostUid = uid; // set at creation, never reconciled

✅ multiplayer_server/src/index.js
if (!uid || room.members[0] !== uid || !game?.id) return;
```

## Rule MP-7: Reconnection is a uid-keyed grace timer; resume replays the live-state helpers

`disconnect` (only when the dropping socket is still the player's active socket) starts
`room.graceTimers[uid]`: `GRACE_MS` (30 s) in a live match, `LOBBY_GRACE_MS` (10 s) in a lobby.
On the next `identify` with the same uid the relay clears the timer, rejoins the Socket.IO room,
emits `resumeMatch` built by `snapshotFor(room, uid)` (which reuses `rankRoom` and derives
per-player `playing` vs `waiting`), re-pushes `turnState` via `turnGames.resumeFor` for turn games,
and tells the others (`opponentReconnected` / `friendLobbyUpdate`). Turn games auto-pass a dropped
player's step (`turnGames.onDisconnect`). Client side, `RESUME` in the reducer rebuilds `MpState`
from the snapshot. Limits as implemented: resume restores the room's round and scores, not the
renderer's in-round progress (the renderer remounts on the same `gameData`; turn games have no
`gameData`, so they enter intro-to-play and resume from `turnState`, which `TURN_STATE`/
`INTRO_ELAPSED` and `OnlineMatch.tsx` treat as the round-ready signal); the client re-emits
`identify` only if a user is in Redux; `FriendPlay`/`OnlineMatch` show reconnecting state from
`oppStatus`. The sim proves resume re-serves the same round (Acceptance check 2).

```js
❌ hypothetical: grace keyed by socket.id (only survives a resume by luck)
room.graceTimers[socket.id] = setTimeout(() => destroyRoom(room, "timeout"), GRACE_MS);

✅ multiplayer_server/src/index.js disconnect handler
room.graceTimers[uid] = setTimeout(() => {
  ...
  destroyRoom(room, `${uid} grace timeout`);
  players.delete(uid);
}, GRACE_MS);
```

## Rule MP-8: All ranking and tie-break logic lives in `rankRoom()`

Score DESC, then elapsed time ASC (null counts as slowest); a tie needs equal score **and** time.
`settleMatch()` (live `matchResult`, including the `standings` array) and `snapshotFor()` (resume
`standings`) both call `rankRoom(room)`, per its own comment. Client results views consume
`standings`/`outcome`. Turn games feed `room.scores` and call `helpers.settleMatch(room)` so they
share the path. Exception: the reducer's `RESUME` recomputes `outcome` from `yourScore` vs
`opponentScore` (first opponent only), which is correct for 1v1 but not for 3+ rooms; prefer
`standings` there.

```js
❌ hypothetical: a results view re-sorting scores itself (ignores the time tiebreak)
Object.entries(room.scores).sort((a, b) => b[1] - a[1])[0];

✅ multiplayer_server/src/index.js
.sort((a, b) => b.score - a.score || timeKey(a.uid) - timeKey(b.uid))
```

## Rule MP-9: Friend-room capacity and min-to-start come from `turnGames.roomConfigFor(gameId)`

`DEFAULT_ROOM_CONFIG = { capacity: 2, min: 2 }`, `ROOM_CONFIGS = { imposter: { capacity: 5,
min: 3 } }` in `turnGames.js`. `makeRoom()`, `changeFriendGame` (`Math.max(room.members.length,
capacity)`, never shrinks below seated players) and `startRoomNow` (`min`) all call it. Matchmaking
rooms are always capacity 2. The auto-start fires when `members.length === capacity`;
`startRoomNow` lets the host launch earlier at `>= min`. `FRIEND_ROOM_SIZE = 2` in `index.js` is a
leftover that is only mentioned in comments; do not read it.

```js
❌ real: multiplayer_server/src/index.js, stale constant (unused; header comments still cite it)
const FRIEND_ROOM_SIZE = 2;

✅ multiplayer_server/src/turnGames.js: add a row, let makeRoom()/changeFriendGame read it
const ROOM_CONFIGS = { imposter: { capacity: 5, min: 3 } };
```

## Rule MP-10: Every online game id resolves through exactly one of three deal paths, and a miss throws

`fetchRound(gameId)` in `index.js`: (1) `TURN_GAMES` never reach it (`turnGames.init`); (2)
`QUESTION_GAMES = new Set(["career-path", "who-are-ya", "contexto", "superdraft"])` returns
`[await questions.deal(gameId)]` (`multiplayer_server/src/questions.js`, no Django call: from
the manifest-v3 data host via `gameData.fetchQuestion` when its manifest publishes the game,
else the Supabase-Storage questions store, logged once); (3) everything else looks up
`gameEndpoints[gameId]` in `multiplayer_server/src/gameEndpoints.js` and throws
`No endpoint configured for game id: ...` if absent. Within (3), the five pool games
(`gameData.ROUND_GAMES`: series-winner, name-logo, guess-mvps, starting-five, fan-favorites) are
first dealt from the published manifest-v3 files (`multiplayer_server/src/gameData.js`,
`DATA_PUBLIC_BASE`); their `gameEndpoints.js` entries stay as the fallback. A game must appear in exactly one path, with
an id identical to `src/utils/GameUtils.tsx`'s `Game.id`. A game that moves to the questions store
(as career-path/who-are-ya/contexto/superdraft did) must be **removed** from `gameEndpoints.js`
and added to `QUESTION_GAMES`, with a matching entry in `src/utils/questions.ts`'s `PICKERS` if it
needs a non-random pick (server `PICKERS` in `questions.js` mirrors it). See `BACKEND_CONSTRAINTS.md`
BE-2 for the Django-side slug registration.

```js
❌ hypothetical: a new questions-store game added to GameUtils.tsx only
// { id: "new-game", fetchData: () => fetchQuestion("new-game") } but not in QUESTION_GAMES
// -> fetchRound looks in gameEndpoints -> "No endpoint configured for game id: new-game"

✅ multiplayer_server/src/index.js
if (QUESTION_GAMES.has(gameId)) return [await questions.deal(gameId)];
const endpoint = gameEndpoints[gameId];
if (!endpoint) throw new Error(`No endpoint configured for game id: ${gameId}`);
```

## Rule MP-11: Three network boundaries plus the questions store, each with its own env var; never hardcode a non-localhost URL

| Boundary | Var | Default | Read in |
|---|---|---|---|
| Browser to relay | `VITE_SOCKET_URL` | `http://localhost:4000` | `src/socket.ts` (`process.env`, inlined by `next.config.ts` `env`) |
| Relay listen port | `PORT` | `4000` (binds `0.0.0.0`) | `multiplayer_server/src/index.js` |
| Relay to Django | `API_BASE_URL` | `http://localhost:8000` | `multiplayer_server/src/gameEndpoints.js` (only; `turnGames.js` no longer fetches Django) |
| Relay to questions store (hidden games + fallback for the published question games) | `QUESTIONS_PUBLIC_BASE` | `""` | `multiplayer_server/src/questions.js` |
| Relay to game-data host (manifest v3: five pool games + published question games; unset = Django endpoints / questions store) | `DATA_PUBLIC_BASE` | `""` | `multiplayer_server/src/gameData.js` (also via `questions.js`) |
| Browser to game-data host (same host; unset or failing = bundled `/data` / questions store) | `VITE_DATA_BASE` | `""` | `src/utils/gameData.ts` via `src/utils/pool.ts` and `src/utils/questions.ts`, inlined via `next.config.ts` |
| Browser to questions store (fallback) | `VITE_QUESTIONS_BASE` | `""` | `src/utils/questions.ts`, inlined via `next.config.ts` |
| Relay CORS allowlist | `CORS_ORIGINS` | `http://localhost:5173,https://nba-trivia-minigames.online` | `index.js` (Next dev runs on 3000, so set it for local dev) |

`VITE_*` names are kept on purpose post-Next-migration; a new browser var must be added to
`next.config.ts` `env` or it is `undefined`. `scripts/dev-env.mjs` writes `VITE_SOCKET_URL` for
local dev (no remote socket exists). `multiplayer_server/.env.example` documents `API_BASE_URL`,
`CORS_ORIGINS`, `PORT`, `REDIS_URL`, `QUESTIONS_PUBLIC_BASE`; the relay needs the last one to
deal any question game, so set it wherever the relay runs.

```ts
❌ hypothetical: production socket URL as a second literal in source
const SOCKET_URL = process.env.VITE_SOCKET_URL || "https://nba-multiplayer-production.up.railway.app";

✅ src/socket.ts: localhost dev fallback only
const SOCKET_URL = process.env.VITE_SOCKET_URL || "http://localhost:4000";
```

## Rule MP-12: SP-first, MP-ready: every game works single-player with no socket server, and only four renderers take multiplayer props

**Gameplay:** single-player (`MiniGame.tsx`) loads data with `game.fetchData()` (static pools or
`fetchQuestion` from the questions store) and calls `renderGame()`; online (`OnlineMatch.tsx`)
calls the same `renderGame()` with `mp.gameData`, `turn`, `onTurnAction`, `multiplayer: true`, and
`onGameEnd` wired to `submitScore(score, Date.now() - startRef.current)`. No renderer's
`gameData`/`onGameEnd` path may depend on `socket` or the relay. `RenderGame.tsx` (18 `case`
branches, 17 games plus `"coming-soon"`) forwards `multiplayer` to exactly four: `ConnectionsGame`
(hides Shuffle), `TicTacToe` and `ImposterGame` (server-authoritative turns, MP-2/MP-3), and
`SuperDraft` (hides the re-roll, picks the objective, MP-14). Five renderers (`BingoGame`,
`CareerPath`, `NbaGrid`, `PackFive`, `WhoAreYa`) declare a `multiplayer?: boolean` that
`RenderGame.tsx` never passes: dead scaffolding, not a template. `Contexto` needs none (same
question both modes).

**Transport caveat:** `MultiplayerProvider` is mounted for every route in `src/app/providers.tsx`;
`src/socket.ts` calls `io(...)` at module load (autoConnect default) but only in the browser
(`typeof window === "undefined"` yields `null`, so touch `socket` only in effects/handlers); the
identify effect emits on every `connect` for any logged-in user. So a solo player still opens a
socket; "works single-player" means the game keeps working with the relay down. Multiplayer entry
points fail soft: `guardOnline()` refuses without a user or `socket.connected` and raises a
notice, never a throw.

```tsx
❌ real: src/Game Renderers/BingoGame.tsx (also CareerPath, NbaGrid, PackFive, WhoAreYa)
multiplayer?: boolean; // declared, never passed by RenderGame.tsx

✅ src/Game Renderers/RenderGame.tsx: an SP/MP-agnostic game takes no MP props
case "bingo":
  return <BingoGame gameInfo={gameData as BingoCard[]} onGameEnd={onGameEnd} />;
```

## Rule MP-13: Renderers never import the socket; the one renderer reading `useMultiplayer()` uses it for roster display only

No file under `src/Game Renderers/` imports `../socket`. `ImposterGame.tsx` alone imports
`useMultiplayer`/`playerKey`, reading `mp.opponents` to map uids in `turn` state to name/avatar
(`seatByUid`); every game-state decision comes from the `turn` prop. Socket plumbing lives in
`MultiplayerContext.tsx` only: it is the sole file under `src/` that imports `../socket`
(`OnlineMatch.tsx`/`FriendPlay.tsx` go through `useMultiplayer()`); do not add another importer.

```tsx
❌ hypothetical: a renderer emitting directly
import socket from "../socket";
socket.emit("turnAction", { code, action: { type: "clue", text } });

✅ src/Game Renderers/ImposterGame.tsx: actions go through the prop OnlineMatch wired to the context
onTurnAction?.({ type: "clue", text });
```

## Rule MP-14: A room deals one question; anything a renderer derives beyond the payload must be a pure function of it

`questions.deal(gameId)` picks one question (weighted for career-path, `pickDaily` for contexto,
first item for imposter, random otherwise) and `dealRound` emits that same object to every member;
resume re-serves `room.gameData`. `multiplayer_server/scripts/sim_round_fanout.js` proves it for
superdraft and contexto (one deal per room, identical payloads, identical after resume, zero
Django fetches) and that a round-game -> turn-game switch resumes with `gameData: null` and a
re-pushed `turnState` (`dealRound` clears the previous round's payload). Renderers must therefore
not roll per-client dice in a room. SuperDraft's online
objective is `OBJECTIVES[hashStr(question.qid) % OBJECTIVES.length]` (`objectiveForQid`), using the
same FNV-1a as `multiplayer_server/src/gameData.js`'s `hashStr` (used by `questions.js`) and
`src/utils/gameData.ts` (re-exported by `src/utils/questions.ts`); solo
uses `dailyObjective()`. Contexto is a single daily secret: every room on a given UTC day gets the
same word.

```tsx
❌ hypothetical: each client rolling its own objective in a room
const objective = OBJECTIVES[Math.floor(Math.random() * OBJECTIVES.length)];

✅ src/Game Renderers/SuperDraft.tsx
() => (multiplayer && question ? objectiveForQid(question.qid) : dailyObjective()),
```

## Rule MP-15: Game pickers list `visibleGames`, never raw `games`

`src/utils/GameUtils.tsx` flags games `hidden: true` (currently heatmap, connections, nba-grid,
bingo, pack-five, superdraft, imposter) and exports `visibleGames = games.filter((g) => !g.hidden)`.
The friend-room "Change game" picker (`FriendPlay.tsx`), the results "Switch game" picker
(`OnlineMatch.tsx`) and the `MiniGame.tsx` rail/strip all import `visibleGames`; pickers also
drop `"coming-soon"` and the current game. `games` stays correct for route resolution
(`MiniGame.tsx` finds the game by `urlPath` so deep links to hidden games still resolve). The relay
does not validate game ids against visibility, so the picker is the only gate.

```tsx
❌ hypothetical: a new picker importing the full list
import { games } from "../../utils/GameUtils";

✅ src/components/MultiPlayer/FriendPlay.tsx
import { visibleGames as games } from "../../utils/GameUtils";
{games.filter((g) => g.id !== "coming-soon" && g.id !== mp.game?.id).map((g) => (
```

---

## Acceptance checks

Run from the repo root (`nba-minigames/`) unless noted. "Observed" values were captured against
the working tree when this doc was written.

**1. Relay sources parse (all rules).**
```bash
cd multiplayer_server && for f in src/index.js src/turnGames.js src/questions.js src/gameEndpoints.js src/answerMatch.js; do node --check $f && echo "ok $f"; done
```
Observed: all five exit 0.

**2. Both sims pass (MP-2, MP-3, MP-7, MP-14).**
```bash
cd multiplayer_server && node scripts/sim_turngames.js && node scripts/sim_round_fanout.js
```
Observed: `sim_turngames.js` ends with `Tic-Tac-Toe reached a win : PASS`, `Id-lookup validation (all 3) : PASS`,
`Imposter reached reveal : PASS`; `sim_round_fanout.js` ends `All round fan-out checks passed.` (exit 0).

**3. Every server-emitted event has a client handler (MP-4).**
```bash
grep -ohE '(toUid\([^,]+, |socket\.emit\()"[a-zA-Z]+"' multiplayer_server/src/index.js multiplayer_server/src/turnGames.js | grep -oE '"[a-zA-Z]+"' | sort -u
grep -n "helpers.toUid(uid, \"turnState\"" multiplayer_server/src/turnGames.js
```
Observed: 28 distinct names from `index.js` (including `turnReject`, sent via `turnHelpers.reject`)
plus `turnState` from `turnGames.js` = 29 server events. The client `on` map in
`MultiplayerContext.tsx` registers 29 handlers, including `turnReject`. Any diff adding a server
emit must add the matching key in that `on` map.

**4. `turnReject` has a client listener (MP-2).**
```bash
grep -rn "turnReject" src
```
Observed: the `turnReject:` handler line in `MultiplayerContext.tsx` (dispatches a `warn` `NOTICE`).

**5. Client emits map to real server handlers (MP-4).**
```bash
grep -rhoE 'socket\.emit\("[a-zA-Z]+"' src | sort -u
grep -oE 'socket\.on\("[a-zA-Z]+"' multiplayer_server/src/index.js | sort -u
```
Observed: every emitted name has a handler. No new diff may add an emit without one.

**6. Engine sets and sizing live in one place each (MP-3, MP-9, MP-10).**
```bash
grep -n "TURN_GAMES = new Set\|QUESTION_GAMES = new Set" multiplayer_server/src/index.js
grep -n "ROOM_CONFIGS = " multiplayer_server/src/turnGames.js
```
Observed: `63:const TURN_GAMES = new Set(["tictactoe", "imposter"]);`,
`164:const QUESTION_GAMES = new Set(["career-path", "who-are-ya", "contexto", "superdraft"]);`,
`46:const ROOM_CONFIGS = { imposter: { capacity: 5, min: 3 } };`. No id may be in both
`QUESTION_GAMES` and `gameEndpoints.js`:
```bash
node -e 'const g=Object.keys(require("./multiplayer_server/src/gameEndpoints"));for(const q of ["career-path","who-are-ya","contexto","superdraft","tictactoe","imposter"])if(g.includes(q))console.log("DUP",q)'
```
Observed: no output.

**7. Only four renderers are wired for multiplayer; five declare a dead prop (MP-12).**
```bash
grep -c 'multiplayer={multiplayer}' "src/Game Renderers/RenderGame.tsx"
grep -rl 'multiplayer?: boolean' "src/Game Renderers" | grep -v -E "RenderGame|ConnectionsGame|TicTacToe|ImposterGame|SuperDraft"
```
Observed: `4`; then exactly `BingoGame.tsx`, `CareerPath.tsx`, `NbaGrid.tsx`, `PackFive.tsx`, `WhoAreYa.tsx`.

**8. No JWT handling in the relay (MP-1).**
```bash
grep -rniE "jwt|verify|authorization" multiplayer_server/src
```
Observed: no output.

**9. Renderers do not import the socket; `useMultiplayer` only in ImposterGame (MP-13).**
```bash
grep -rl 'from "\.\./socket"' "src/Game Renderers"
grep -rl "useMultiplayer" "src/Game Renderers"
```
Observed: first no output; second `src/Game Renderers/ImposterGame.tsx` only.

**10. Pickers use `visibleGames` (MP-15).**
```bash
grep -n "GameUtils" src/components/MultiPlayer/FriendPlay.tsx src/components/MultiPlayer/OnlineMatch.tsx
```
Observed: both lines import `{ visibleGames as games }`. Any multiplayer component importing bare
`games` fails.

**11. No hardcoded non-localhost socket URL in source (MP-11).**
```bash
grep -rn "up.railway.app\|https\?://[a-z0-9.-]*\(railway\|onrender\|fly\)" src multiplayer_server/src
```
Observed: no output. Every new browser env var appears in `next.config.ts` `env`:
```bash
grep -n "VITE_SOCKET_URL\|VITE_QUESTIONS_BASE" next.config.ts
```

**12. Provider stays global and socket stays SSR-safe (MP-12).**
```bash
grep -n "MultiplayerProvider" src/app/providers.tsx
grep -n 'typeof window === "undefined"' src/socket.ts
```
Observed: provider wraps `ModalProvider` at the app root; `socket.ts` returns `null` on the server.

**13. SuperDraft online objective stays a function of qid (MP-14).**
```bash
grep -n "objectiveForQid\|hashStr" "src/Game Renderers/SuperDraft.tsx" src/utils/gameData.ts multiplayer_server/src/gameData.js
```
Observed: `objectiveForQid(qid)` uses `hashStr(qid) % OBJECTIVES.length` in `SuperDraft.tsx`.
