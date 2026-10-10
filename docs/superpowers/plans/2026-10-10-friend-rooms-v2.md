# Friend Rooms v2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Private rooms hold 2–4 players chosen by the host, never auto-start, are run by the host (start, stop, change game), and every way of leaving a room or match is guarded consistently for hosts and guests, with a smooth, overflow-free UI.

**Architecture:** The relay (`multiplayer_server/src/index.js`) stays the single owner of room state (MP-2): rooms get a host-chosen `capacity` within per-game `{min,max}` bounds, a lobby only becomes a match on the host's `startRoomNow`, and new host-only events `setRoomSize`, `stopMatch`, `restartRoom` plus new leave semantics (`removeMember`/`backToLobby`) drive everything. The client reducer in `MultiplayerContext.tsx` mirrors those events; three UI pieces change: `FriendPlay` (size stepper, host-started lobby), `OnlineMatch` (host/guest controls), and a new `GamePickerModal` behind the existing `ModalHost`. A `useRoomGuard` hook gives the rail, strip, nav links and logo one confirm-then-leave behaviour.

**Tech Stack:** Node 22 + Socket.IO 4 (relay), Next.js 16 / React 19 / framer-motion (site), sweetalert2 (confirm dialog), `node --test` integration tests with a real relay process (pattern: `multiplayer_server/test/hardening.integration.test.js`), Playwright MCP for browser QA against the local stack (site :5173, Django :8000, relay :4000).

**Spec:** `docs/superpowers/specs/2026-10-10-friend-rooms-v2-design.md`

## Global Constraints

- Room size bounds: default `{ min: 2, max: 4 }`, `tictactoe { min: 2, max: 2 }`, `imposter { min: 3, max: 4 }`; `MAX_ROOM_SIZE = 4`. Size never drops below seated players.
- Only the host (`room.members[0]`, MP-6) may `setRoomSize`, `changeFriendGame`, `startRoomNow`, `stopMatch`, `restartRoom`. Guests' attempts are ignored (no event back) except where this plan says `friendError`.
- Event names: camelCase, client emits are action verbs, server success/error pairs (MP-4). New client→server: `setRoomSize`, `stopMatch`, `restartRoom`. New server→client: `matchStopped`, `memberLeft`.
- UI rules UI-21/22/23 (`docs/constraints/UI_SHELL_CONSTRAINTS.md`): text that changes with state goes through `SwapText` in one element; containers resize via `AutoHeight`; same component keeps the same bottom spacing in every state; no new durations/easings — reuse `src/motion/variants.ts` (`fadeIn`, `swap`, `popIn`) and `src/motion/tokens.ts`.
- Overlays only through `ModalHost` (UI-8). Navigation only through `useNavigate` (UI-17).
- Copy: "Start game", "Stop match", "Back to lobby", "Close room", "Leave room", "Leave match", "Change game", "Play again", "Waiting for the host to start", "Waiting for the host…". The exact leave-confirm copy is in Task 6.
- Brand: the product is Swish Quest only; never mention any earlier name.
- Commits: one line, plain, no AI attribution trailer. Branch: `feat/friend-rooms-v2` off `dev`. Merge to `dev` via PR; never promote.
- Lint/typecheck before each commit: `npx eslint <files>` and `npx tsc --noEmit`. Relay: `cd multiplayer_server && npm test`.
- Local QA stack (already running on this PC; restart if a `curl -s localhost:4000/health` or `:5173` fails): Django `cd backend && MULTIPLAYER_SHARED_SECRET=local-dev-relay-key venv/Scripts/python.exe manage.py runserver 8000`; relay `PORT=4000 CORS_ORIGINS=http://localhost:5173 API_BASE_URL=http://localhost:8000 MULTIPLAYER_SHARED_SECRET=local-dev-relay-key node multiplayer_server/src/index.js`; site `NBA_DEV_ENV_SKIP= npm run dev` (it starts its own relay if :4000 is free). **The relay must be restarted after every relay code change** (kill the `node multiplayer_server/src/index.js` process, start it again).

## Review Focus

1. **Host drops while in the lobby** (tab closed): after the 10 s lobby grace, guests must get `friendRoomCancelled` ("The host closed the room.") and land back on the Multiplayer choice view, not sit in a dead lobby. Test: Task 3 "host disconnect in the lobby closes it after the grace".
2. **Game changed to a 2-player game with 3 seated**: `changeFriendGame` to `tictactoe` must be refused (friendError "Tic-Tac-Toe is for 2 players; 3 are seated.") rather than silently trapping a seated player. Test: Task 2 "a game whose max is below the seated count is refused".
3. **Host presses Start while a seated guest is reconnecting**: refused with "Wait for everyone to reconnect before starting." Test: Task 1.
4. **A guest leaves a 3-player match after the other two already submitted**: the round must settle immediately for the remaining two (no "Waiting for X…" forever). Test: Task 3.
5. **Host spams Play again / Change game**: `restartRoom` within 3 s of the last restart is refused with a `friendError`, never a double deal. Test: Task 4.

---

### Task 1: Relay — size bounds, sized rooms, no auto-start, host starts

**Files:**
- Modify: `multiplayer_server/src/turnGames.js:58-66` (ROOM_CONFIGS / roomConfigFor)
- Modify: `multiplayer_server/src/index.js` (header comment lines 4-6, line 74 `FRIEND_ROOM_SIZE`, `makeRoom` ~147, `lobbySnapshot` ~400, `startFriendMatch` ~602, `createFriendRoom` ~800, `joinFriendRoom` ~872, `startRoomNow` ~900)
- Create: `multiplayer_server/test/rooms.integration.test.js`

**Interfaces:**
- Produces: `turnGames.roomConfigFor(gameId) -> { min: number, max: number }` (no more `capacity`); `clampRoomSize(gameId, size, seated) -> number` in index.js; `makeRoom(code, gameId, game, members, type = "match", size = 2)`; lobby snapshot `{ code, game, capacity, min, max, hostUid, members }`; client emit `createFriendRoom { game, size }`.

- [ ] **Step 1: Write the failing tests**

Create `multiplayer_server/test/rooms.integration.test.js`:

```js
// End to end: a real relay process, real socket.io clients and a fake Django — friend rooms v2
// (host-chosen size, host-started games, host controls, leave semantics).
const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { io } = require(path.join(__dirname, "..", "..", "node_modules", "socket.io-client"));

const NAMES = ["Ann", "Bob", "Cat", "Dan", "Eve", "Fay", "Gus", "Hank", "Ivy", "Jay", "Kim", "Lee", "Mo", "Ned", "Oli", "Pat"];
const tok = (name) => `tok-${name}-`.padEnd(40, "x");
const USERS = Object.fromEntries(NAMES.map((n, i) => [tok(n), {
  id: n.toUpperCase().padEnd(6, "0"), username: n, email: `${n}@example.com`, points: 10 + i,
}]));

let backend, server, backendPort, serverPort;
const sockets = [];

const freePort = () => new Promise((resolve) => {
  const s = http.createServer().listen(0, () => { const p = s.address().port; s.close(() => resolve(p)); });
});
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

test.before(async () => {
  backend = http.createServer((req, res) => {
    res.setHeader("Content-Type", "application/json");
    if (req.url.startsWith("/trivia/multiplayer-result/")) {
      let raw = "";
      req.on("data", (c) => { raw += c; });
      req.on("end", () => {
        const body = JSON.parse(raw);
        res.end(JSON.stringify({ ok: true, results: body.results.map((r) => ({ public_id: r.public_id, awarded: r.score, points: 1000, rank: "Rookie" })) }));
      });
      return;
    }
    if (req.url.startsWith("/trivia/")) { res.end(JSON.stringify({ series: [{ q: 1 }, { q: 2 }] })); return; }
    const user = USERS[(req.headers.authorization || "").replace("Bearer ", "")];
    res.statusCode = user ? 200 : 401;
    res.end(JSON.stringify(user ? { user } : { detail: "bad token" }));
  });
  await new Promise((r) => backend.listen(0, r));
  backendPort = backend.address().port;
  serverPort = await freePort();
  server = spawn(process.execPath, [path.join(__dirname, "..", "src", "index.js")], {
    env: {
      ...process.env, PORT: String(serverPort), API_BASE_URL: `http://127.0.0.1:${backendPort}`,
      CORS_ORIGINS: "http://localhost:5173", DATA_PUBLIC_BASE: "", QUESTIONS_PUBLIC_BASE: "",
      MULTIPLAYER_SHARED_SECRET: "relay-key", LOBBY_GRACE_MS: "300", GRACE_MS: "300",
    },
    stdio: ["ignore", "pipe", "inherit"],
  });
  await new Promise((resolve, reject) => {
    server.stdout.on("data", (d) => String(d).includes("Multiplayer server on") && resolve());
    server.once("exit", () => reject(new Error("server exited early")));
  });
});

test.after(() => {
  sockets.forEach((s) => s.close());
  server?.kill();
  backend?.close();
});

const connect = () => new Promise((resolve, reject) => {
  const s = io(`http://127.0.0.1:${serverPort}`, { transports: ["websocket"], reconnection: false, timeout: 4000 });
  sockets.push(s);
  s.on("connect", () => resolve(s));
  s.on("connect_error", (e) => reject(new Error(`connect failed: ${e.message}`)));
});
const next = (s, event, ms = 4000) => new Promise((resolve, reject) => {
  const t = setTimeout(() => reject(new Error(`timed out waiting for ${event}`)), ms);
  s.once(event, (d) => { clearTimeout(t); resolve(d); });
});
/** Resolves true if `event` arrives within `ms`, false otherwise (for "must NOT happen" checks). */
const arrives = (s, event, ms = 400) => new Promise((resolve) => {
  const t = setTimeout(() => { s.off(event, on); resolve(false); }, ms);
  const on = () => { clearTimeout(t); resolve(true); };
  s.once(event, on);
});
const player = async (name) => { const s = await connect(); s.emit("identify", { token: tok(name) }); await wait(150); return s; };

/** Host creates a room of `size` for `gameId`; resolves the lobby snapshot. */
async function createRoom(host, gameId, size) {
  const created = next(host, "friendRoomCreated");
  host.emit("createFriendRoom", { game: { id: gameId }, size });
  return created;
}
/** Guest joins `code`; resolves the guest's lobby snapshot. */
async function join(guest, code) {
  const joined = next(guest, "friendRoomJoined");
  guest.emit("joinFriendRoom", { code });
  return joined;
}

test("a room takes the host's size, clamped to the game's bounds", async () => {
  const ann = await player("Ann");
  const snap = await createRoom(ann, "name-logo", 3);
  assert.equal(snap.capacity, 3);
  assert.equal(snap.min, 2);
  assert.equal(snap.max, 4);
  ann.emit("leaveMatch", { code: snap.code });
  await wait(200);

  const bob = await player("Bob");
  assert.equal((await createRoom(bob, "name-logo", 9)).capacity, 4);
  bob.emit("leaveMatch", {});
  await wait(200);

  const cat = await player("Cat");
  const ttt = await createRoom(cat, "tictactoe", 3);
  assert.equal(ttt.capacity, 2);
  assert.equal(ttt.max, 2);
  cat.emit("leaveMatch", {});
});

test("a full room does not start by itself; only the host starts it", async () => {
  const dan = await player("Dan");
  const eve = await player("Eve");
  const snap = await createRoom(dan, "name-logo", 2);
  const hostUpdate = next(dan, "friendLobbyUpdate");
  const joined = await join(eve, snap.code);
  assert.equal(joined.members.length, 2);
  assert.equal((await hostUpdate).members.length, 2);
  assert.equal(await arrives(dan, "matchFound"), false, "the full room started on its own");

  eve.emit("startRoomNow", { code: snap.code });
  assert.equal(await arrives(eve, "matchFound"), false, "a guest started the room");

  const foundA = next(dan, "matchFound");
  const foundB = next(eve, "matchFound");
  dan.emit("startRoomNow", { code: snap.code });
  const [a, b] = await Promise.all([foundA, foundB]);
  assert.equal(a.roomSize, 2);
  assert.equal(b.role, "guest");
  dan.emit("leaveMatch", { code: snap.code });
});

test("the host cannot start alone", async () => {
  const fay = await player("Fay");
  const snap = await createRoom(fay, "name-logo", 3);
  const err = next(fay, "friendError");
  fay.emit("startRoomNow", { code: snap.code });
  assert.match((await err).message, /at least 2/);
  fay.emit("leaveMatch", {});
});

test("the host cannot start while a seated player is reconnecting", async () => {
  const gus = await player("Gus");
  const hank = await player("Hank");
  const snap = await createRoom(gus, "name-logo", 2);
  await join(hank, snap.code);
  const offline = next(gus, "friendLobbyUpdate");
  hank.close();
  assert.equal((await offline).members.find((m) => m.username === "Hank").online, false);
  const err = next(gus, "friendError");
  gus.emit("startRoomNow", { code: snap.code });
  assert.match((await err).message, /reconnect/);
  gus.emit("leaveMatch", {});
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd multiplayer_server && node --test test/rooms.integration.test.js`
Expected: FAIL — `snap.capacity` is 2 not 3 (first test), and "the full room started on its own" (second test).

- [ ] **Step 3: Size bounds in turnGames.js**

Replace lines 58-66 of `multiplayer_server/src/turnGames.js`:

```js
// Friend-room sizing per game: how many players a room may hold. The host picks a size within these
// bounds (index.js createFriendRoom / setRoomSize); the default lets 2-4 friends in. Turn games have
// fixed casts. The site mirrors this table in src/utils/roomSizes.ts for its stepper; this is the truth.
const MAX_ROOM_SIZE = 4;
const ROOM_CONFIGS = { tictactoe: { min: 2, max: 2 }, imposter: { min: 3, max: 4 } };
const DEFAULT_ROOM_CONFIG = { min: 2, max: MAX_ROOM_SIZE };

/** Friend-room { min, max } player bounds for a game id. */
function roomConfigFor(gameId) {
  return ROOM_CONFIGS[gameId] || DEFAULT_ROOM_CONFIG;
}
```

- [ ] **Step 4: Sized rooms and the host start in index.js**

Header comment (lines 4-6): replace `(share-code lobbies for FRIEND_ROOM_SIZE\n// players). Rooms are N-player throughout — matchmaking rooms hold 2 members,\n// friend rooms hold exactly FRIEND_ROOM_SIZE.` with `(share-code lobbies for 2-4 players, the host\n// picks the size). Rooms are N-player throughout — matchmaking rooms hold 2 members,\n// friend rooms hold what the host chose, within the game's bounds (turnGames.roomConfigFor).`

Delete line 74: `const FRIEND_ROOM_SIZE = 2;        // default friend-room size; turn games override via turnGames.roomConfigFor`.

`makeRoom`: change the signature and capacity line:

```js
function makeRoom(code, gameId, game, members, type = "match", size = 2) {
  return {
    code,
    type,                                    // "match" (random 1v1) | "friend" (code lobby)
    gameId,
    game,                                    // full Game object (carries pointsPerCorrect, name…)
    capacity: type === "friend" ? clampRoomSize(gameId, size, members.length) : 2,
```

Add right after `makeRoom`:

```js
/** A friend room's player count within its game's bounds, never below who is already seated. */
function clampRoomSize(gameId, size, seated) {
  const { min, max } = turnGames.roomConfigFor(gameId);
  const n = Number.isInteger(Number(size)) ? Number(size) : min;
  return Math.min(max, Math.max(min, seated, n));
}
```

`lobbySnapshot`: return `min`/`max` too:

```js
function lobbySnapshot(room) {
  const { min, max } = turnGames.roomConfigFor(room.gameId);
  return {
    code: room.code,
    game: room.game,
    capacity: room.capacity,
    min,                                     // the game's player bounds, for the host's size stepper
    max,
    hostUid: room.members[0],
```

`startFriendMatch` doc comment: `/** The host started the room — flip it into a live match (same flow as matchmaking). */`.

`createFriendRoom`: `socket.on("createFriendRoom", async ({ game: sent, size } = {}) => {` and `const room = makeRoom(code, game.id, game, [uid], "friend", size);`. Update the section comment above it to `// --- Friend rooms (private share-code lobbies for 2-4 players; the host starts the game) ---`.

`joinFriendRoom`: replace

```js
    if (room.members.length === room.capacity) {
      startFriendMatch(room);
    } else {
      const snap = lobbySnapshot(room);
      socket.emit("friendRoomJoined", snap);
      othersOf(room, uid).forEach((m) => toUid(m, "friendLobbyUpdate", snap));
    }
```

with

```js
    // A full room waits for the host to start it (startRoomNow); nothing starts by itself.
    const snap = lobbySnapshot(room);
    socket.emit("friendRoomJoined", snap);
    othersOf(room, uid).forEach((m) => toUid(m, "friendLobbyUpdate", snap));
```

`startRoomNow`: replace the comment and body:

```js
  // Host-only: start the room once at least `min` players are seated and everyone is online.
  socket.on("startRoomNow", ({ code } = {}) => {
    const room = rooms.get(Number(code));
    const uid = uidOf(socket);
    if (!room || room.type !== "friend" || room.phase !== "lobby") return;
    if (!uid || room.members[0] !== uid) return;
    const { min } = turnGames.roomConfigFor(room.gameId);
    if (room.members.length < min) {
      socket.emit("friendError", { message: `Need at least ${min} players to start.` });
      return;
    }
    if (!room.members.every((m) => socketIdOf(m))) {
      socket.emit("friendError", { message: "Wait for everyone to reconnect before starting." });
      return;
    }
    startFriendMatch(room);
  });
```

`changeFriendGame` still references `.capacity` from `roomConfigFor`; make it compile for now (Task 2 finishes it): replace `room.capacity = Math.max(room.members.length, turnGames.roomConfigFor(game.id).capacity);` with `room.capacity = clampRoomSize(game.id, room.capacity, room.members.length);`.

Make the grace windows overridable for tests: `const GRACE_MS = Number(process.env.GRACE_MS) || 30000;` and `const LOBBY_GRACE_MS = Number(process.env.LOBBY_GRACE_MS) || 10000;` (keep the existing comments).

Pre-existing bug this task fixes: the `disconnect` handler never clears the player's `socketId`, so `socketIdOf(uid)` keeps returning the dead socket and every "online" check (`lobbySnapshot`, `snapshotFor`, `turnHelpers.isOnline`) stays true — a dropped guest never shows as reconnecting and the host could start with them missing. In the `disconnect` handler, right after `const p = players.get(uid);` add:

```js
    // The socket is gone: until a new one identifies as this uid, the player is offline
    // (socketIdOf -> null: toUid no-ops, snapshots show "Reconnecting", startRoomNow refuses).
    p.socketId = null;
```

(`uidOf(socket)` was already evaluated above for this dead socket, and `onIdentified` resumes when `prev.socketId !== socket.id`, which `null` satisfies.)

- [ ] **Step 5: Run the tests**

Run: `cd multiplayer_server && node --check src/index.js && node --test test/rooms.integration.test.js && npm test`
Expected: the 4 new tests PASS; the existing suite still passes (the teen-room test in `hardening.integration.test.js` joins a 2-room and expects `matchFound` — update that test: after `ivy.emit("joinFriendRoom", { code: lobby.code })` wait for `next(ivy, "friendRoomJoined")`, then `tina.emit("startRoomNow", { code: lobby.code })` and keep the `matchFound` assertion).

- [ ] **Step 6: Commit**

```bash
git checkout -b feat/friend-rooms-v2 dev
git add multiplayer_server/src/turnGames.js multiplayer_server/src/index.js multiplayer_server/test
git commit -m "Relay: host-sized friend rooms that only the host starts"
```

---

### Task 2: Relay — host sets the size; game changes respect the seated count

**Files:**
- Modify: `multiplayer_server/src/index.js` (`changeFriendGame` ~884, new `setRoomSize` handler right after it)
- Test: `multiplayer_server/test/rooms.integration.test.js`

**Interfaces:**
- Produces: client emit `setRoomSize { code, size }` → `friendLobbyUpdate` to everyone; `changeFriendGame` now refuses with `friendError` when the new game's `max` is below the seated count.

- [ ] **Step 1: Write the failing tests** (append to `rooms.integration.test.js`)

```js
test("the host resizes the room within bounds; guests cannot", async () => {
  const ivy = await player("Ivy");
  const jay = await player("Jay");
  const snap = await createRoom(ivy, "name-logo", 2);
  await join(jay, snap.code);

  const up = next(jay, "friendLobbyUpdate");
  ivy.emit("setRoomSize", { code: snap.code, size: 4 });
  assert.equal((await up).capacity, 4);

  jay.emit("setRoomSize", { code: snap.code, size: 3 });
  assert.equal(await arrives(ivy, "friendLobbyUpdate"), false, "a guest resized the room");

  const floor = next(jay, "friendLobbyUpdate");
  ivy.emit("setRoomSize", { code: snap.code, size: 1 });
  assert.equal((await floor).capacity, 2, "size dropped below the seated count");
  ivy.emit("leaveMatch", {});
});

test("a game whose max is below the seated count is refused; otherwise the size is re-clamped", async () => {
  const kim = await player("Kim");
  const lee = await player("Lee");
  const mo = await player("Mo");
  const snap = await createRoom(kim, "name-logo", 3);
  await join(lee, snap.code);
  await join(mo, snap.code);

  const err = next(kim, "friendError");
  kim.emit("changeFriendGame", { code: snap.code, game: { id: "tictactoe" } });
  assert.match((await err).message, /2 players/);

  const ned = await player("Ned");
  const refused = next(ned, "friendJoinError");
  ned.emit("joinFriendRoom", { code: snap.code });
  assert.match((await refused).message, /full/);
  kim.emit("leaveMatch", {});
});
```

- [ ] **Step 2: Run the first test to verify it fails**

Run: `cd multiplayer_server && node --test --test-name-pattern "resizes" test/rooms.integration.test.js`
Expected: FAIL — timed out waiting for `friendLobbyUpdate` (no `setRoomSize` handler).

- [ ] **Step 3: Implement**

In `index.js`, replace the `changeFriendGame` handler body after the guards:

```js
  // Host-only: swap which game the room will play (lobby phase only).
  socket.on("changeFriendGame", ({ code, game: sent } = {}) => {
    const room = rooms.get(Number(code));
    const uid = uidOf(socket);
    const game = cleanGame(sent);
    if (!room || room.type !== "friend" || room.phase !== "lobby") return;
    if (!uid || room.members[0] !== uid || !game) return;
    // A game with a smaller cast than the seated players would strand someone: refuse it.
    const { max } = turnGames.roomConfigFor(game.id);
    if (room.members.length > max) {
      socket.emit("friendError", { message: `${game.name} is for ${max} players; ${room.members.length} are seated.` });
      return;
    }
    room.gameId = game.id;
    room.game = game;
    // The size follows the new game's bounds, never shrinking below who is already seated.
    room.capacity = clampRoomSize(game.id, room.capacity, room.members.length);
    const snap = lobbySnapshot(room);
    room.members.forEach((m) => toUid(m, "friendLobbyUpdate", snap));
    console.log(`Friend room ${room.code} game -> ${game.id}`);
  });

  // Host-only (lobby): how many players the room is for, within the game's bounds and never below
  // who is already seated.
  socket.on("setRoomSize", ({ code, size } = {}) => {
    const room = rooms.get(Number(code));
    const uid = uidOf(socket);
    if (!room || room.type !== "friend" || room.phase !== "lobby") return;
    if (!uid || room.members[0] !== uid) return;
    room.capacity = clampRoomSize(room.gameId, size, room.members.length);
    const snap = lobbySnapshot(room);
    room.members.forEach((m) => toUid(m, "friendLobbyUpdate", snap));
  });
```

- [ ] **Step 4: Run tests**

Run: `cd multiplayer_server && node --test test/rooms.integration.test.js` (restart nothing; tests spawn their own relay)
Expected: both new tests PASS.

- [ ] **Step 5: Commit**

```bash
git add multiplayer_server/src/index.js multiplayer_server/test/rooms.integration.test.js
git commit -m "Relay: host-set room size; game changes respect seated players"
```

---

### Task 3: Relay — leaving and dropping: guests free their seat, hosts close the room

**Files:**
- Modify: `multiplayer_server/src/index.js` (`leaveMatch` ~1058, `disconnect` ~1080, new helpers `removeMember`/`backToLobby` next to `destroyRoom` ~370)
- Test: `multiplayer_server/test/rooms.integration.test.js`

**Interfaces:**
- Produces: `removeMember(room, uid, why)`, `backToLobby(room, message, exceptUid)`; server emits `memberLeft { id, username, message }` (match continues) and `matchStopped { message }` followed by `friendLobbyUpdate` (everyone back to the lobby).

- [ ] **Step 1: Write the failing tests** (append)

```js
test("a guest leaving the lobby frees the seat; the host leaving closes it", async () => {
  const oli = await player("Oli");
  const pat = await player("Pat");
  const snap = await createRoom(oli, "name-logo", 3);
  await join(pat, snap.code);
  const freed = next(oli, "friendLobbyUpdate");
  pat.emit("leaveMatch", { code: snap.code });
  assert.equal((await freed).members.length, 1);
  const again = await join(pat, snap.code);
  assert.equal(again.members.length, 2);

  const closed = next(pat, "friendRoomCancelled");
  oli.emit("leaveMatch", { code: snap.code });
  assert.match((await closed).message, /host closed/);
});

test("a guest leaving a 3-player match lets the other two finish; two left settles at once", async () => {
  const ann = await player("Ann");
  const bob = await player("Bob");
  const cat = await player("Cat");
  const snap = await createRoom(ann, "name-logo", 3);
  await join(bob, snap.code);
  await join(cat, snap.code);
  const rounds = [next(ann, "roundData"), next(bob, "roundData"), next(cat, "roundData")];
  ann.emit("startRoomNow", { code: snap.code });
  await Promise.all(rounds);

  ann.emit("submitScore", { code: snap.code, score: 30, elapsedMs: 9000 });
  cat.emit("submitScore", { code: snap.code, score: 10, elapsedMs: 9500 });
  await wait(200);
  const left = next(ann, "memberLeft");
  const resultA = next(ann, "matchResult");
  const resultC = next(cat, "matchResult");
  bob.emit("leaveMatch", { code: snap.code });
  assert.match((await left).message, /Bob left/);
  const [ra, rc] = await Promise.all([resultA, resultC]);
  assert.equal(ra.standings.length, 2);
  assert.equal(rc.outcome, "loss");
  ann.emit("leaveMatch", {});
});

test("a guest leaving a 2-player match sends the host back to the lobby", async () => {
  const dan = await player("Dan");
  const eve = await player("Eve");
  const snap = await createRoom(dan, "name-logo", 2);
  await join(eve, snap.code);
  const round = next(dan, "roundData");
  dan.emit("startRoomNow", { code: snap.code });
  await round;
  const stopped = next(dan, "matchStopped");
  const lobby = next(dan, "friendLobbyUpdate");
  eve.emit("leaveMatch", { code: snap.code });
  assert.match((await stopped).message, /Eve left/);
  assert.equal((await lobby).members.length, 1);
  dan.emit("leaveMatch", {});
});

test("after a guest leaves, the host can switch to a smaller-cast game and the size re-clamps", async () => {
  const kim = await player("Kim");
  const lee = await player("Lee");
  const mo = await player("Mo");
  const snap = await createRoom(kim, "name-logo", 3);
  await join(lee, snap.code);
  await join(mo, snap.code);
  mo.emit("leaveMatch", { code: snap.code });
  await wait(200);
  const upd = next(lee, "friendLobbyUpdate");
  kim.emit("changeFriendGame", { code: snap.code, game: { id: "tictactoe" } });
  const u = await upd;
  assert.equal(u.game.id, "tictactoe");
  assert.equal(u.capacity, 2);
  assert.equal(u.max, 2);
  kim.emit("leaveMatch", {});
});

test("host disconnect in the lobby closes it after the grace", async () => {
  const fay = await player("Fay");
  const gus = await player("Gus");
  const snap = await createRoom(fay, "name-logo", 2);
  await join(gus, snap.code);
  const closed = next(gus, "friendRoomCancelled", 3000);
  fay.close();
  assert.match((await closed).message, /host closed/);
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd multiplayer_server && node --test --test-name-pattern "leaving|disconnect" test/rooms.integration.test.js`
Expected: FAIL — "a guest leaving the lobby" gets `friendRoomCancelled` instead of a lobby update; `memberLeft`/`matchStopped` never arrive.

- [ ] **Step 3: Implement**

Add after `destroyRoom` in `index.js`:

```js
/** Everyone back to the lobby: the room lives on with its code and seats, the round is dropped
 *  (scores finished so far are credited). `exceptUid` gets the snapshot but not the message. */
function backToLobby(room, message, exceptUid = null) {
  if (room.phase === "playing" || room.phase === "waiting") creditRoom(room);
  if (room.turnTimer) clearTimeout(room.turnTimer);
  room.turnTimer = null;
  room.turn = null;
  room.gameData = null;
  clearProposal(room);
  room.scores = Object.fromEntries(room.members.map((m) => [m, null]));
  room.times = Object.fromEntries(room.members.map((m) => [m, null]));
  room.phase = "lobby";
  armLobbyTimer(room);
  const snap = lobbySnapshot(room);
  room.members.forEach((m) => {
    if (m !== exceptUid) toUid(m, "matchStopped", { message });
    toUid(m, "friendLobbyUpdate", snap);
  });
}

/** A player is gone (left, or didn't reconnect). 1v1 rooms and a leaving HOST end the room for
 *  everyone; a guest leaving a friend room frees the seat: the lobby carries on, a round carries on
 *  if two or more remain (and it isn't a turn game), otherwise everyone returns to the lobby. */
function removeMember(room, uid, why) {
  const name = nameOf(uid);
  if (room.type !== "friend" || room.members[0] === uid) {
    if (room.phase === "lobby") {
      othersOf(room, uid).forEach((m) => toUid(m, "friendRoomCancelled", { message: "The host closed the room." }));
    } else {
      const message = room.members.length > 2 ? `${name} left, so the match ended.` : "Your opponent left the match.";
      othersOf(room, uid).forEach((m) => toUid(m, "opponentLeft", { message }));
    }
    destroyRoom(room, why);
    return;
  }
  if (room.graceTimers[uid]) {
    clearTimeout(room.graceTimers[uid]);
    delete room.graceTimers[uid];
  }
  room.members = room.members.filter((m) => m !== uid);
  delete room.scores[uid];
  delete room.times[uid];
  const p = players.get(uid);
  if (p && p.roomCode === room.code) p.roomCode = null;
  const sid = socketIdOf(uid);
  if (sid) io.sockets.sockets.get(sid)?.leave(room.code);
  if (room.phase === "lobby") {
    const snap = lobbySnapshot(room);
    room.members.forEach((m) => toUid(m, "friendLobbyUpdate", snap));
    return;
  }
  if (room.members.length < 2 || room.turn) {
    backToLobby(room, `${name} left, so the match ended.`);
    return;
  }
  clearProposal(room);
  room.members.forEach((m) => toUid(m, "memberLeft", { id: uid, username: name, message: `${name} left the match.` }));
  // Their missing score no longer holds up the settle.
  if (room.phase !== "results" && room.members.every((m) => room.scores[m] != null)) settleMatch(room);
}
```

`leaveMatch` handler: replace everything from `const name = nameOf(uid);` down to `destroyRoom(room, "a player left");` with:

```js
    removeMember(room, uid, "a player left");
```

`disconnect` handler: replace the lobby branch and the match grace timer so both end in `removeMember`:

```js
    const name = nameOf(uid);
    if (room.phase === "lobby") {
      // Show the seat as offline; if they don't come back, treat it as leaving.
      const snap = lobbySnapshot(room);
      othersOf(room, uid).forEach((m) => toUid(m, "friendLobbyUpdate", snap));
      room.graceTimers[uid] = setTimeout(() => {
        removeMember(room, uid, "lobby grace timeout");
        players.delete(uid);
      }, LOBBY_GRACE_MS);
      return;
    }
    othersOf(room, uid).forEach((m) => toUid(m, "opponentDisconnected", { id: uid, username: name, graceMs: GRACE_MS }));
    // Turn games: don't stall the round waiting out the grace window — a dropped
    // player's turn auto-passes (they can still reconnect and resume mid-game).
    if (room.turn) turnGames.onDisconnect(room, uid, turnHelpers);
    room.graceTimers[uid] = setTimeout(() => {
      removeMember(room, uid, "grace timeout");
      players.delete(uid);
    }, GRACE_MS);
```

(`removeMember`'s destroy branch already sends the "didn't reconnect"-equivalent message; keep the wording it produces.)

In `lobbySnapshot`'s member rows `online: !!socketIdOf(uid)` already reflects a dropped guest — no change.

- [ ] **Step 4: Run all relay tests**

Run: `cd multiplayer_server && npm test`
Expected: all PASS (existing hardening test "a finished match credits both players' profiles once" still passes: `kim.emit("leaveMatch")` there is a 1v1 room → destroy path unchanged).

- [ ] **Step 5: Commit**

```bash
git add multiplayer_server/src/index.js multiplayer_server/test/rooms.integration.test.js
git commit -m "Relay: guests free their seat when leaving; hosts close the room"
```

---

### Task 4: Relay — host stops a match, host restarts or changes the game; docs

**Files:**
- Modify: `multiplayer_server/src/index.js` (`propose` ~966, `registerAccept` ~1000, new `restartRound` helper, new `stopMatch`/`restartRoom` handlers after `startRoomNow`)
- Modify: `docs/constraints/MULTIPLAYER_CONSTRAINTS.md` (MP-4 event list line 117, MP-6 ~161-176, MP-9 ~223-239)
- Test: `multiplayer_server/test/rooms.integration.test.js`

**Interfaces:**
- Produces: client emits `stopMatch { code }` (host; any non-lobby phase → `matchStopped` to guests + `friendLobbyUpdate` to all) and `restartRoom { code, game? }` (host; phase `results`; `matchRestart { game }` to all, then `roundData`/`turnState`); `friendError` on refusal. Friend rooms no longer accept `proposeAgain`/`proposeSwitch`.

- [ ] **Step 1: Write the failing tests** (append)

```js
/** Create a `size` room, seat `guests`, start it; resolves { code } once everyone has round data. */
async function startedRoom(host, guests, gameId = "name-logo") {
  const snap = await createRoom(host, gameId, guests.length + 1);
  for (const g of guests) await join(g, snap.code);
  const rounds = [host, ...guests].map((s) => next(s, "roundData"));
  host.emit("startRoomNow", { code: snap.code });
  await Promise.all(rounds);
  return { code: snap.code };
}

test("the host stops a match: everyone returns to the lobby; a guest cannot", async () => {
  const hank = await player("Hank");
  const ivy = await player("Ivy");
  const { code } = await startedRoom(hank, [ivy]);
  ivy.emit("stopMatch", { code });
  assert.equal(await arrives(hank, "matchStopped"), false, "a guest stopped the match");

  const stopped = next(ivy, "matchStopped");
  const lobbyH = next(hank, "friendLobbyUpdate");
  const lobbyI = next(ivy, "friendLobbyUpdate");
  hank.emit("stopMatch", { code });
  assert.match((await stopped).message, /host ended/);
  assert.equal((await lobbyH).members.length, 2);
  assert.equal((await lobbyI).code, code);
  hank.emit("leaveMatch", {});
});

test("after a round the host restarts or changes the game at once; guests cannot; spam is throttled", async () => {
  const jay = await player("Jay");
  const kim = await player("Kim");
  const { code } = await startedRoom(jay, [kim]);
  const results = [next(jay, "matchResult"), next(kim, "matchResult")];
  jay.emit("submitScore", { code, score: 20, elapsedMs: 5000 });
  kim.emit("submitScore", { code, score: 10, elapsedMs: 6000 });
  await Promise.all(results);

  kim.emit("restartRoom", { code, game: { id: "guess-mvps" } });
  assert.equal(await arrives(jay, "matchRestart"), false, "a guest restarted the room");
  kim.emit("proposeAgain", { code });
  assert.equal(await arrives(jay, "proposalReceived"), false, "a proposal reached a friend room");

  await wait(3100); // RESTART_MIN_MS since the deal
  const restartK = next(kim, "matchRestart");
  const roundK = next(kim, "roundData");
  jay.emit("restartRoom", { code, game: { id: "guess-mvps" } });
  assert.equal((await restartK).game.id, "guess-mvps");
  await roundK;

  const err = next(jay, "friendError");
  jay.emit("restartRoom", { code });
  assert.match((await err).message, /moment/);
  jay.emit("leaveMatch", {});
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd multiplayer_server && node --test --test-name-pattern "stops|restarts" test/rooms.integration.test.js`
Expected: FAIL — `matchStopped`/`matchRestart` never arrive.

- [ ] **Step 3: Implement**

Add a helper right before `const propose = (type, code, game) => {` inside the connection handler is wrong scope — put it at module level, after `backToLobby`:

```js
/** Deal a fresh round of `gameObj` to the whole room (play again / switch). Shared by the 1v1
 *  proposal handshake (registerAccept) and the friend-room host's restartRoom. */
function restartRound(room, gameObj, why) {
  clearProposal(room);
  room.restartedAt = Date.now();
  room.gameId = gameObj.id;
  room.game = gameObj;
  room.phase = "intro";
  room.members.forEach((u) => toUid(u, "matchRestart", { game: gameObj }));
  dealRound(room);
  console.log(`Room ${room.code} restart (${why} -> ${gameObj.id})`);
}
```

In `registerAccept`, replace from `clearProposal(room);` through `console.log(\`Room ${room.code} restart (${prop.type} -> ${prop.gameId})\`);` with `restartRound(room, prop.game, prop.type);`.

In `propose`, after `if (room.phase === "lobby") return;` add:

```js
    // Friend rooms are run by their host (restartRoom); the handshake is for random 1v1 rooms.
    if (room.type === "friend") return;
```

Add after the `startRoomNow` handler:

```js
  // Host-only: end the current match for everyone and return the room to its lobby.
  socket.on("stopMatch", ({ code } = {}) => {
    const room = rooms.get(Number(code));
    const uid = uidOf(socket);
    if (!room || room.type !== "friend" || room.phase === "lobby") return;
    if (!uid || room.members[0] !== uid) return;
    backToLobby(room, "The host ended the match.", uid);
    console.log(`Room ${room.code}: host stopped the match`);
  });

  // Host-only, after a round: play the same game again, or a different one, for everyone at once.
  socket.on("restartRoom", ({ code, game: sent } = {}) => {
    const room = rooms.get(Number(code));
    const uid = uidOf(socket);
    if (!room || room.type !== "friend" || room.phase !== "results") return;
    if (!uid || room.members[0] !== uid) return;
    if (Date.now() - Math.max(room.restartedAt || 0, room.dealtAt || 0) < RESTART_MIN_MS) {
      socket.emit("friendError", { message: "Wait a moment before starting another game." });
      return;
    }
    const gameObj = sent ? cleanGame(sent) : room.game;
    if (!gameObj) {
      socket.emit("friendError", { message: "That game can't be played online." });
      return;
    }
    const { max } = turnGames.roomConfigFor(gameObj.id);
    if (room.members.length > max) {
      socket.emit("friendError", { message: `${gameObj.name} is for ${max} players; ${room.members.length} are seated.` });
      return;
    }
    restartRound(room, gameObj, "host");
  });
```

- [ ] **Step 4: Docs**

`docs/constraints/MULTIPLAYER_CONSTRAINTS.md`:
- MP-4 client list (line 117): add `setRoomSize`, `stopMatch`, `restartRoom` after `startRoomNow`; server list: add `matchStopped`, `memberLeft`.
- MP-6: append a paragraph: "A guest leaving (or dropping past the grace) is removed by `removeMember()`; the host never changes. A leaving host closes the room. Friend rooms are host-driven: `startRoomNow`, `setRoomSize`, `changeFriendGame`, `stopMatch`, `restartRoom` all guard `room.members[0] !== uid`; the propose/accept handshake is 1v1-only (`propose` returns for `room.type === "friend"`)."
- MP-9: rewrite the rule title and body: "Friend-room player bounds come from `turnGames.roomConfigFor(gameId) -> { min, max }`: default `{2, 4}`, `tictactoe {2, 2}`, `imposter {3, 4}`, `MAX_ROOM_SIZE = 4`. The host picks `capacity` within them (`createFriendRoom { size }`, `setRoomSize`); `clampRoomSize(gameId, size, seated)` never goes below seated players. Nothing auto-starts: `startRoomNow` needs `members.length >= min` and everyone online. `changeFriendGame`/`restartRoom` refuse a game whose `max` is below the seated count." Replace the code example's `const ROOM_CONFIGS = { imposter: { capacity: 5, min: 3 } };` with `const ROOM_CONFIGS = { tictactoe: { min: 2, max: 2 }, imposter: { min: 3, max: 4 } };` and delete the `FRIEND_ROOM_SIZE` ❌ example (the constant is gone).

- [ ] **Step 5: Run all relay tests**

Run: `cd multiplayer_server && npm test`
Expected: all PASS.

- [ ] **Step 6: Commit**

```bash
git add multiplayer_server/src/index.js multiplayer_server/test/rooms.integration.test.js docs/constraints/MULTIPLAYER_CONSTRAINTS.md
git commit -m "Relay: host stops, restarts and switches friend-room games"
```

Then restart the local relay (kill the `node multiplayer_server/src/index.js` process; start it with the command in Global Constraints).

---

### Task 5: Client state — new events and actions in MultiplayerContext

**Files:**
- Modify: `src/context/MultiplayerContext.tsx` (types ~60-75 `LobbyMember`/`FriendLobby`, `LobbySnapshot` ~122, `Action` union ~128-165, reducer `FRIEND_LOBBY` ~254, new cases, event map ~489-535, context value interface ~370-390, actions ~600-660)

**Interfaces:**
- Produces (context value): `createFriendRoom(game: Game, size: number)`, `setRoomSize(size: number)`, `startRoom()`, `stopMatch()`, `restartRoom(game?: Game)`; state `mp.lobby` gains `min: number; max: number`.

- [ ] **Step 1: Types**

`FriendLobby` and `LobbySnapshot`: add `min: number; max: number;` after `capacity: number;` in both.

`Action` union: add

```ts
  | { t: "MATCH_STOPPED"; message: string }
  | { t: "MEMBER_LEFT"; id?: string; username?: string; message: string }
```

- [ ] **Step 2: Reducer**

`FRIEND_LOBBY` case: carry the bounds:

```ts
        lobby: { code: l.code, game: l.game, capacity: l.capacity, min: l.min, max: l.max, hostUid: l.hostUid, members: l.members },
```

Add after `case "FRIEND_CANCELLED":` block:

```ts
    case "MATCH_STOPPED":
      // The host ended the match (or too few players remain): a FRIEND_LOBBY follows and keeps this notice.
      return { ...state, notice: { kind: "info", text: a.message } };
    case "MEMBER_LEFT": {
      // A guest left mid-round; the rest of us keep playing.
      const key = a.id || a.username;
      const opponents = state.opponents.filter((o) => playerKey(o) !== key);
      const oppStatus = { ...state.oppStatus };
      if (key) delete oppStatus[key];
      return { ...state, opponents, oppStatus, roomSize: Math.max(2, state.roomSize - 1), notice: { kind: "warn", text: a.message } };
    }
```

- [ ] **Step 3: Socket events** (inside the `on` map, next to `friendRoomCancelled`):

```ts
      matchStopped: (d: { message?: string } = {}) =>
        dispatch({ t: "MATCH_STOPPED", message: d?.message || "The match ended." }),
      memberLeft: (d: { id?: string; username?: string; message?: string } = {}) =>
        dispatch({ t: "MEMBER_LEFT", id: d?.id, username: d?.username, message: d?.message || "A player left the match." }),
```

- [ ] **Step 4: Actions**

Interface `MultiplayerContextValue`: change `createFriendRoom: (game: Game) => void;` to `createFriendRoom: (game: Game, size: number) => void;` and add

```ts
  /** Host (lobby): how many players the room is for. */
  setRoomSize: (size: number) => void;
  /** Host (lobby): start the match for everyone seated. */
  startRoom: () => void;
  /** Host (in a match): end it and return the room to its lobby. */
  stopMatch: () => void;
  /** Host (results): play again, or switch to `game`, for everyone at once. */
  restartRoom: (game?: Game) => void;
```

Implementations: `createFriendRoom` becomes `async (game: Game, size: number)` and emits `socket.emit("createFriendRoom", { game: serializeGame(game), size })`. Add next to `changeFriendGame`:

```ts
  const setRoomSize = useCallback((size: number) => socket.emit("setRoomSize", { code: codeRef.current, size }), []);
  const startRoom = useCallback(() => socket.emit("startRoomNow", { code: codeRef.current }), []);
  const stopMatch = useCallback(() => socket.emit("stopMatch", { code: codeRef.current }), []);
  const restartRoom = useCallback((game?: Game) =>
    socket.emit("restartRoom", { code: codeRef.current, game: game ? serializeGame(game) : undefined }), []);
```

Add the four to the `useMemo` value object and its dependency array.

- [ ] **Step 5: Verify**

Run: `npx tsc --noEmit && npx eslint src/context/MultiplayerContext.tsx`
Expected: tsc reports exactly one error — `FriendPlay.tsx` calls `createFriendRoom(game)` with one argument. Fix it minimally for now: `createFriendRoom(game, 2)` (Task 8 replaces it). Re-run: clean.

- [ ] **Step 6: Commit**

```bash
git add src/context/MultiplayerContext.tsx src/components/MultiPlayer/FriendPlay.tsx
git commit -m "Client: room size, host start/stop/restart actions and events"
```

---

### Task 6: Leave guards — confirm dialog, `useRoomGuard`, rail/strip/nav/logo wiring

**Files:**
- Modify: `src/utils/Alerts.tsx` (add `showConfirm`)
- Create: `src/hooks/useRoomGuard.ts`
- Modify: `src/components/Navigation.tsx` (`goHome` ~139, `go` ~148)
- Modify: `src/views/Trivia/MiniGame.tsx` (`inProgress`/`inResults`/`switchInRoom` ~234-250, strip `onClick`/`disabled` ~357-362, rail `onClick` ~376-382)
- Modify: `src/styles/MiniGame.css` (locked look for `.rail-chip.is-locked`, `.rail-item.is-locked`)

**Interfaces:**
- Produces: `showConfirm(message, title, confirmButtonText, cancelButtonText = "Stay"): Promise<boolean>`; `useRoomGuard() -> { inRoom: boolean; isHost: boolean; confirmLeave: () => Promise<boolean> }` — `confirmLeave` resolves `true` after leaving (or when there was nothing to leave), `false` when the player chose to stay.

- [ ] **Step 1: Confirm dialog**

Append to `src/utils/Alerts.tsx`:

```ts
/** Yes/no question in the same popup style; resolves true when confirmed. Escape/Stay = false. */
export async function showConfirm(message: string, title: string, confirmButtonText: string, cancelButtonText = "Stay"): Promise<boolean> {
  const Swal = await getSwal();
  const result = await Swal.fire({
    icon: "question",
    title,
    html: `<p style="font-size: 0.95rem; margin-top: 0.5rem;">${message}</p>`,
    background: "#1c1c1e",
    color: "#f5f3ef",
    confirmButtonText,
    cancelButtonText,
    showCancelButton: true,
    reverseButtons: true,
    focusCancel: true,
    customClass: {
      popup: "swal2-custom-popup",
      confirmButton: "swal2-custom-button",
      cancelButton: "swal2-custom-button swal2-custom-button--ghost",
    },
    buttonsStyling: false,
    allowOutsideClick: false,
    allowEscapeKey: true,
    iconColor: "#ff6a1a",
  });
  return result.isConfirmed;
}
```

In `src/styles/LandPage.css`, find `.swal2-custom-button` (the existing override block) and add after it:

```css
.swal2-custom-button--ghost { background: transparent !important; color: var(--muted) !important; border: 1px solid var(--line2) !important; margin-right: 10px; }
.swal2-custom-button--ghost:hover { color: var(--text) !important; border-color: var(--line) !important; }
```

- [ ] **Step 2: The hook**

Create `src/hooks/useRoomGuard.ts`:

```ts
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
  const isHost = mp.roomType === "friend" && (mp.phase === "lobby" ? mp.lobby?.hostUid === user?.id : mp.role === "host");

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
```

- [ ] **Step 3: Navigation**

In `src/components/Navigation.tsx`: import `useRoomGuard`; inside `Navigation()` replace `const { mp, leaveMatch } = useMultiplayer();` with `const { confirmLeave } = useRoomGuard();` (remove the now-unused `useMultiplayer` import if nothing else uses it). Replace `goHome` and `go`:

```ts
  const goHome = async () => {
    if (!(await confirmLeave())) return; // asks only while in a room or match
    navigate("/");
  };

  // Scroll to a home section; from a game page, route home with the section
  // as a hash so Next.js's router scrolls to it once the page has mounted
  // (native hash-fragment scroll, honoring .games-section's scroll-margin-top)
  // instead of racing a fixed delay against the route load.
  const go = async (section: string) => {
    setDrawer(false);
    if (type === "full") {
      scrollToSection(section);
    } else {
      if (!(await confirmLeave())) return;
      navigate(`/#${section}`);
    }
  };
```

The two brand `onClick`s call `goHome()` already (`void` the promise: `void goHome();`).

- [ ] **Step 4: MiniGame rail and strip**

In `src/views/Trivia/MiniGame.tsx`: import `useRoomGuard`; add `const { inRoom, confirmLeave } = useRoomGuard();` after `const { mp, proposeAgain, proposeSwitch } = useMultiplayer();` and change that line to `const { mp } = useMultiplayer();`. Delete the `inResults`/`switchInRoom` block (the comment "After an online round the game list IS…" through the closing `};`). Add in its place:

```ts
  // Picking another game while in a room or match asks first (useRoomGuard), then goes.
  const goToGame = (g: Game) => {
    if (inRoom) { void confirmLeave().then((ok) => { if (ok) navigate(g.urlPath, { state: { id: g.id } }); }); return; }
    if (inProgress) { showErrorAlert(GAME_IN_PROGRESS, "Game in progress", "Continue playing"); return; }
    navigate(g.urlPath, { state: { id: g.id } });
  };
```

Strip button:

```tsx
                className={`rail-chip${g.id === game?.id ? " is-active" : ""}${inProgress && g.id !== game?.id ? " is-locked" : ""}`}
                disabled={g.id === "coming-soon" || (g.id === "wordle" && wordleCard.locked)}
                onClick={() => goToGame(g)}
```

Rail button: `onClick={() => goToGame(g)}` and add `${inProgress && g.id !== game?.id ? " is-locked" : ""}` to its className; keep its `disabled` as `g.id === "coming-soon" || (g.id === "wordle" && wordleCard.locked)`.

`src/styles/MiniGame.css`: next to `.rail-chip` / `.rail-item` rules add

```css
/* Locked while a game, room or match is live: still pressable (the press explains or asks), just dimmed. */
.rail-chip.is-locked, .rail-item.is-locked { opacity: 0.45; }
```

- [ ] **Step 5: Verify**

Run: `npx tsc --noEmit && npx eslint src/utils/Alerts.tsx src/hooks/useRoomGuard.ts src/components/Navigation.tsx src/views/Trivia/MiniGame.tsx`
Expected: clean (`proposeAgain`/`proposeSwitch`/`Game` imports in MiniGame: remove `Game` from the type import only if unused — it is used by `goToGame`, keep it).

Browser check (Playwright MCP, 1280×900, signed in as the local QA account; a scripted guest is not needed): on `/name-logo` click **Play with a friend → Generate code**; click another game in the left rail → the "Close your room?" dialog appears; click **Stay** → still in the lobby; click the logo → dialog; **Close room** → home page, and the Multiplayer card on the next game page shows the choice view. Repeat at 375×812 with the strip.

- [ ] **Step 6: Commit**

```bash
git add src/utils/Alerts.tsx src/styles/LandPage.css src/hooks/useRoomGuard.ts src/components/Navigation.tsx src/views/Trivia/MiniGame.tsx src/styles/MiniGame.css
git commit -m "Ask before leaving a room or match from the rail, strip, nav or logo"
```

---

### Task 7: Game picker modal and the client-side size table

**Files:**
- Create: `src/utils/roomSizes.ts`
- Create: `src/components/modals/GamePickerModal.tsx`
- Modify: `src/context/ModalContext.tsx` (ModalKind, payload types)
- Modify: `src/components/ModalHost.tsx` (branch)
- Modify: `src/styles/Modal.css` (picker styles)
- Modify: `docs/constraints/UI_SHELL_CONSTRAINTS.md` UI-8 "Current kinds" sentence (~line 215)

**Interfaces:**
- Produces: `roomBounds(gameId) -> { min, max }`, `MAX_ROOM_SIZE`; `ModalKind "gamePicker"` with `GamePickerPayload { currentId?: string; seated?: number; onPick: (game: Game) => void; title?: string }`; `GamePickerModal({ currentId, seated, onPick, onClose })`.

- [ ] **Step 1: Size table**

Create `src/utils/roomSizes.ts`:

```ts
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
```

- [ ] **Step 2: Modal kind and payload**

`src/context/ModalContext.tsx`: `export type ModalKind = "login" | "feedback" | "leaderboard" | "instructions" | "multiplayerInfo" | "gamePicker";` and add

```ts
/** The game picker (lobby "Change game", results "Change game"). */
export interface GamePickerPayload {
  /** The room's current game: listed but not pickable. */
  currentId?: string;
  /** Players seated now: games with a smaller cast are shown but disabled. */
  seated?: number;
  onPick: (game: Game) => void;
  title?: string;
}
```

and `export type ModalPayload = InstructionsPayload | LeaderboardPayload | FeedbackPayload | GamePickerPayload | undefined;`.

- [ ] **Step 3: The modal**

Create `src/components/modals/GamePickerModal.tsx`:

```tsx
import { visibleGames } from "../../utils/GameUtils";
import { NOT_ONLINE, roomBounds } from "../../utils/roomSizes";
import type { GamePickerPayload } from "../../context/ModalContext";

/** Grid of games to switch a room to. Scrolls inside the modal (a sheet on phones), never the page. */
export default function GamePickerModal({ currentId, seated = 0, onPick, onClose }: GamePickerPayload & { onClose: () => void }) {
  const games = visibleGames.filter((g) => !NOT_ONLINE.has(g.id));
  return (
    <div className="gp-scroll">
      <div className="gp-grid" role="list">
        {games.map((g) => {
          const { max } = roomBounds(g.id);
          const current = g.id === currentId;
          const tooSmall = seated > max;
          const note = current ? "Playing now" : tooSmall ? `${max} players only` : `up to ${g.maxPoints} pts`;
          return (
            <button
              key={g.id}
              type="button"
              role="listitem"
              className={`gp-item${current ? " is-current" : ""}`}
              disabled={current || tooSmall}
              onClick={() => { onClose(); onPick(g); }}
            >
              <span className="gp-thumb" style={{ backgroundImage: g.backgroundImage }} aria-hidden="true" />
              <span className="gp-name">{g.name}</span>
              <span className="gp-note">{note}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
```

`src/components/ModalHost.tsx`: import `GamePickerModal` and `GamePickerPayload`; add before the `return`:

```tsx
  } else if (kind === "gamePicker") {
    const p = payload as GamePickerPayload | undefined;
    title = p?.title ?? "Change game";
    wide = true;
    content = p ? <GamePickerModal currentId={p.currentId} seated={p.seated} onPick={p.onPick} onClose={close} /> : null;
  }
```

(attach it to the existing `if/else if` chain).

- [ ] **Step 4: Styles** (append to `src/styles/Modal.css`)

```css
/* ---- Game picker (modals/GamePickerModal): tiles in a grid that scrolls inside the panel ---- */
.gp-scroll { max-height: min(62vh, 540px); overflow-y: auto; overscroll-behavior: contain; padding: 2px; }
.gp-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(128px, 1fr)); gap: 8px; }
.gp-item {
  display: flex; flex-direction: column; align-items: stretch; gap: 6px;
  padding: 7px; border: 1px solid var(--line2); border-radius: 12px;
  background: var(--surface2); color: var(--text); font: inherit; text-align: left; cursor: pointer;
  transition: border-color 0.18s ease, background 0.18s ease, transform 0.18s ease;
}
.gp-item:hover:not(:disabled) { border-color: var(--brand); background: var(--surface3); transform: translateY(-1px); }
.gp-item:disabled { opacity: 0.45; cursor: not-allowed; }
.gp-item.is-current { border-color: var(--brand); opacity: 0.7; }
.gp-thumb { aspect-ratio: 16 / 9; border-radius: 8px; background-size: cover; background-position: center; }
.gp-name { font-size: 12.5px; font-weight: 700; line-height: 1.25; }
.gp-note { font-size: 10.5px; color: var(--muted); }
@media (max-width: 560px) { .gp-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
```

- [ ] **Step 5: Docs** — UI-8 "Current kinds" sentence: add `gamePicker`.

- [ ] **Step 6: Verify**

Run: `npx tsc --noEmit && npx eslint src/utils/roomSizes.ts src/components/modals/GamePickerModal.tsx src/context/ModalContext.tsx src/components/ModalHost.tsx`
Expected: clean. (Nothing opens the modal yet; Task 8 does.)

- [ ] **Step 7: Commit**

```bash
git add src/utils/roomSizes.ts src/components/modals/GamePickerModal.tsx src/context/ModalContext.tsx src/components/ModalHost.tsx src/styles/Modal.css docs/constraints/UI_SHELL_CONSTRAINTS.md
git commit -m "Game picker modal"
```

---

### Task 8: FriendPlay v2 — size stepper, host-started lobby, host/guest controls

**Files:**
- Modify: `src/components/MultiPlayer/FriendPlay.tsx` (imports, state ~36-48, menu branch ~237-266, lobby branch ~108-236)
- Modify: `src/styles/FriendPlay.css` (remove `.fp-picker*` block ~156-175; add stepper/start styles)

**Interfaces:**
- Consumes: `createFriendRoom(game, size)`, `setRoomSize`, `startRoom`, `mp.lobby.min/max`, `open("gamePicker", …)`, `roomBounds`, `Button blocked`.

- [ ] **Step 1: Imports and state**

In `FriendPlay.tsx`: replace `import { visibleGames as games } from "../../utils/GameUtils";` with `import { roomBounds } from "../../utils/roomSizes";`. Destructure `setRoomSize, startRoom` from `useMultiplayer()`. Remove `const [picking, setPicking] = useState(false);` and the `setPicking(false)` call in the phase effect. Add:

```ts
  // How many players the host wants, chosen before generating the code; follows the game's bounds.
  const bounds = roomBounds(game.id);
  const [size, setSize] = useState(bounds.min);
  useEffect(() => { setSize((s) => Math.min(bounds.max, Math.max(bounds.min, s))); }, [bounds.min, bounds.max]);
```

Add a small component at the bottom of the file:

```tsx
/** "Players  − 3 +" — the room size, bounded. The number swaps (UI-21); the buttons go blocked at the bounds. */
function SizeStepper({ value, min, max, onChange, disabled = false }: { value: number; min: number; max: number; onChange: (n: number) => void; disabled?: boolean }) {
  return (
    <div className="fp-size" role="group" aria-label="Players">
      <span className="fp-size-lbl">Players</span>
      <button type="button" className="fp-size-btn" aria-label="Fewer players" disabled={disabled || value <= min} onClick={() => onChange(value - 1)}>−</button>
      <span className="fp-size-num tnum" aria-live="polite"><SwapText>{String(value)}</SwapText></span>
      <button type="button" className="fp-size-btn" aria-label="More players" disabled={disabled || value >= max} onClick={() => onChange(value + 1)}>+</button>
    </div>
  );
}
```

- [ ] **Step 2: Menu branch** — replace the `fp-actions--row` block so the stepper sits above the two buttons:

```tsx
        <SizeStepper value={size} min={bounds.min} max={bounds.max} onChange={setSize} disabled={blocked || searching || creating} />
        <div className="fp-actions fp-actions--row">
          <Button size="sm" disabled={blocked || searching || creating} onClick={() => createFriendRoom(game, size)}>
            <SwapText>{creating ? "Creating…" : "Generate code"}</SwapText>
          </Button>
          <Button variant="secondary" size="sm" disabled={blocked || searching || creating} onClick={() => setMode("enter")}>
            Enter code
          </Button>
        </div>
```

- [ ] **Step 3: Lobby branch** — replace everything from `const empties = …` to the end of that branch's `body = (… );` with:

```tsx
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
            {/* Why Start is blocked, only while it is (no empty line otherwise: UI-23 same spacing). */}
            <AnimatePresence initial={false}>
              {!canStart && (
                <motion.p key="start-reason" className="fp-sub fp-start-reason" role="status" variants={fadeIn} initial="hidden" animate="visible" exit="exit">
                  <SwapText>{startReason}</SwapText>
                </motion.p>
              )}
            </AnimatePresence>
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
```

Remove the `picking` picker `AnimatePresence` block entirely (it is replaced above). Keep the "lobby-mini" collapsed branch as is.

- [ ] **Step 4: Styles** — in `src/styles/FriendPlay.css` delete the `/* ---- Compact game picker (host: change game) ---- */` block (`.fp-picker` … `.fp-picker-name`). Append:

```css
/* ---- Room size stepper and the host's start row ---- */
.fp-size { display: inline-flex; align-items: center; gap: 6px; }
.fp-size-lbl { font-size: 11.5px; color: var(--muted); margin-right: 2px; }
.fp-size-btn {
  width: 26px; height: 26px; border-radius: 8px;
  border: 1px solid var(--line2); background: var(--surface2); color: var(--text);
  font: inherit; font-size: 15px; line-height: 1; cursor: pointer;
  transition: border-color 0.18s ease, background 0.18s ease, opacity 0.18s ease;
}
.fp-size-btn:hover:not(:disabled) { border-color: var(--brand); }
.fp-size-btn:disabled { opacity: 0.35; cursor: not-allowed; }
.fp-size-num { min-width: 1.6ch; text-align: center; font-size: 14px; font-weight: 800; color: var(--text); }
.fp-start-reason { margin: -2px 0 0; text-align: center; font-size: 12px; }
.fp .fp-actions + .btn-ghost, .fp .fp-start-reason + .btn-ghost { align-self: center; }
```

The menu stepper sits centred above the row: `.fp-body > .fp-size { align-self: center; }` — add that line too.

- [ ] **Step 5: Verify**

Run: `npx tsc --noEmit && npx eslint src/components/MultiPlayer/FriendPlay.tsx`
Expected: clean (`games` import gone, `picking` gone).

Browser QA (Playwright MCP). Scripted guest: write `C:\tmp\mp-guest.js`:

```js
// Joins room CODE as the given local account token and sits in the lobby (prints events).
const { io } = require(process.argv[2]);
const [token, code] = [process.argv[3], Number(process.argv[4])];
const s = io("http://localhost:4000", { transports: ["websocket"], extraHeaders: { Origin: "http://localhost:5173" } });
s.onAny((e, d) => console.log(e, JSON.stringify(d || {}).slice(0, 120)));
s.on("connect", () => { s.emit("identify", { token }); setTimeout(() => s.emit("joinFriendRoom", { code }), 400); });
s.on("roundData", () => setTimeout(() => s.emit("submitScore", { code, score: 10, elapsedMs: 30000 }), 3000));
setTimeout(() => process.exit(0), 180000);
```

Mint a token for a second local account: `cd backend && venv/Scripts/python.exe manage.py shell -c "from django.contrib.auth import get_user_model; from users.tokens import issue_session_tokens; u=get_user_model().objects.get(email='signup-check@example.test'); print(str(issue_session_tokens(u).access_token))"` (never paste tokens into the plan or chat; pass as an argument).

Checks, signed in as the QA account at 375×812 then 1280×900:
1. `/name-logo` → Play with a friend: stepper shows "Players − 2 +", "+" to 3; Generate code → lobby shows 3 seats (1 filled, 2 empty), stepper "3", **Start game** blocked, reason "Waiting for 1 more player", Change game, Close room. Card width never exceeds the viewport (`document.querySelector('.mp-panel').scrollWidth <= innerWidth`), no horizontal page scroll (`document.documentElement.scrollWidth <= innerWidth`).
2. Run the guest script with the code → a seat fades in, reason disappears, Start becomes enabled; stepper "−" now stops at 2.
3. Change game → modal opens (sheet at 375), tiles, "Playing now" on the current one; pick Guess the MVP → lobby "Playing: Guess the MVP" swaps, page navigates to `/guess-mvps`, room still open.
4. Start game → both get the match; host plays through.
5. Reload the host tab mid-lobby → resumes into the lobby (resume path).

- [ ] **Step 6: Commit**

```bash
git add src/components/MultiPlayer/FriendPlay.tsx src/styles/FriendPlay.css
git commit -m "Friend rooms: host picks the size and starts the game"
```

---

### Task 9: OnlineMatch — host/guest controls in friend rooms; 1v1 keeps proposals via the picker; MiniGame cleanup

**Files:**
- Modify: `src/components/MultiPlayer/OnlineMatch.tsx` (destructure ~53, `ExitLink` ~74, results branch ~151-174, `ResultActions` ~330-400)
- Modify: `src/styles/Multiplayer.css` (`.om-switch-hint`/`.om-hint-*` rules → remove; `.om-result-actions` keep; add `.om-link`)
- Modify: `src/views/Trivia/MiniGame.tsx` (nothing left from Task 6 to remove; verify `GAME_IN_PROGRESS` import still used)

**Interfaces:**
- Consumes: `stopMatch`, `restartRoom`, `proposeAgain`, `proposeSwitch`, `open("gamePicker", …)`, `mp.role`, `mp.roomType`.

- [ ] **Step 1: Hooks and the leave link**

In `OnlineMatch()`: destructure `stopMatch, restartRoom, proposeSwitch` too; add `const { open } = useModal();` (import `useModal` from `../../context/ModalContext`). Add after `waitingLabel`:

```ts
  const isFriend = mp.roomType === "friend";
  const isHost = isFriend && mp.role === "host";
  // Friend rooms: the host stops the match (everyone back to the lobby); a guest leaves the room.
  const ExitLink = isHost
    ? <button className="om-exit" onClick={stopMatch}>Stop match</button>
    : <button className="om-exit" onClick={leaveMatch}>{isFriend ? "Leave room" : "Exit game"}</button>;
  const pickGame = () => open("gamePicker", {
    currentId: mp.game?.id,
    seated: mp.roomSize,
    onPick: (g) => (isFriend ? restartRoom(g) : proposeSwitch(g)),
  });
```

(replace the old `const ExitLink = (<button className="om-exit" onClick={leaveMatch}>Exit game</button>);`).

- [ ] **Step 2: Results branch** — replace the `<ResultActions … />` element and the `{ExitLink}` under it with:

```tsx
        <ResultActions
          mp={mp}
          isFriend={isFriend}
          isHost={isHost}
          onAgain={isFriend ? () => restartRoom() : proposeAgain}
          onPickGame={pickGame}
          onLobby={stopMatch}
          onRespond={respondProposal}
          onCancel={cancelProposal}
        />
        {isHost
          ? <button className="om-exit" onClick={leaveMatch}>Close room</button>
          : <button className="om-exit" onClick={leaveMatch}>{isFriend ? "Leave room" : "Exit game"}</button>}
```

- [ ] **Step 3: ResultActions** — replace the whole function:

```tsx
function ResultActions({
  mp, isFriend, isHost, onAgain, onPickGame, onLobby, onRespond, onCancel,
}: {
  mp: ReturnType<typeof useMultiplayer>["mp"];
  isFriend: boolean;
  isHost: boolean;
  onAgain: () => void;
  onPickGame: () => void;
  onLobby: () => void;
  onRespond: (accept: boolean) => void;
  onCancel: () => void;
}) {
  let key: string;
  let content: React.ReactNode;

  if (mp.proposal?.role === "theirs") {
    // Incoming request from the opponent (1v1 only).
    const label = mp.proposal.type === "switch"
      ? `wants to switch to ${mp.proposal.gameName || "another game"}`
      : "wants a rematch";
    key = "incoming";
    content = (
      <div className="om-prompt">
        <p className="om-prompt-text"><strong>{mp.proposal.fromName || "Opponent"}</strong> {label}</p>
        <div className="om-actions">
          <button className="om-btn om-btn--primary" onClick={() => onRespond(true)}>Accept</button>
          <button className="om-btn om-btn--ghost" onClick={() => onRespond(false)}>Decline</button>
        </div>
      </div>
    );
  } else if (mp.proposal?.role === "mine") {
    const label = mp.proposal.type === "switch"
      ? `Switch to ${mp.proposal.gameName || "new game"} sent`
      : "Rematch request sent";
    key = "outgoing";
    content = (
      <div className="om-prompt">
        <p className="om-prompt-text">{label}. Waiting for your opponent...</p>
        <button className="om-btn om-btn--ghost" onClick={onCancel}>Cancel request</button>
      </div>
    );
  } else if (isFriend && !isHost) {
    // Guests wait for the host's call.
    key = "guest";
    content = (
      <p className="om-prompt-text">Waiting for the host<span className="om-dots"><i /><i /><i /></span></p>
    );
  } else {
    // The host (friend room) or either player (1v1): rematch or a different game.
    key = "default";
    content = (
      <div className="om-result-actions">
        <div className="om-actions">
          <button className="om-btn om-btn--primary" onClick={onAgain}>Play again</button>
          <button className="om-btn om-btn--secondary" onClick={onPickGame}>Change game</button>
        </div>
        {isFriend && <button className="om-link" onClick={onLobby}>Back to lobby</button>}
      </div>
    );
  }

  // Crossfade between actions / prompts so rematch + switch + cancel
  // notifications fade in and out smoothly.
  return (
    <AnimatePresence mode="wait">
      <motion.div
        key={key}
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -6 }}
        transition={{ duration: 0.22, ease: EASE }}
        style={{ width: "100%", display: "flex", justifyContent: "center" }}
      >
        {content}
      </motion.div>
    </AnimatePresence>
  );
}
```

- [ ] **Step 4: Styles** — in `src/styles/Multiplayer.css` delete `.om-switch-hint`, `.om-hint-narrow`, `.om-hint-wide` and their `@media` block; add

```css
.om-link { background: none; border: 0; padding: 2px 4px; font: inherit; font-size: 12.5px; font-weight: 600; color: var(--brand); cursor: pointer; }
.om-link:hover { filter: brightness(1.2); }
```

- [ ] **Step 5: Verify**

Run: `npx tsc --noEmit && npx eslint src/components/MultiPlayer/OnlineMatch.tsx src/views/Trivia/MiniGame.tsx`
Expected: clean.

Browser QA (host in Playwright, guest script from Task 8 which auto-submits 10 pts): start a 2-room, play through →
- host results: "Play again" / "Change game" / "Back to lobby" / "Close room"; the guest (script log) gets `matchRestart` on Play again (after the 3 s throttle) and `matchStopped` + `friendLobbyUpdate` on Back to lobby.
- During play, the host's link reads "Stop match"; pressing it returns the card to the lobby (seats intact), the stage shows the idle game card.
- 1v1 (two scripted or the QA account vs `C:\tmp\bot_b.js` pattern): results show Play again / Change game; Change game opens the picker; picking sends "Switch to … sent".
- 375×812: the results screen's buttons and links fit, no horizontal scroll.

- [ ] **Step 6: Commit**

```bash
git add src/components/MultiPlayer/OnlineMatch.tsx src/styles/Multiplayer.css src/views/Trivia/MiniGame.tsx
git commit -m "Match screen: host runs friend rooms; game picker for switches"
```

---

### Task 10: Copy, catalog, full QA and PR

**Files:**
- Modify: `src/components/modals/MultiplayerInfoModal.tsx` (rules copy)
- Modify: `docs/team/CODE_MAP.md` (add the three new files next to the FriendPlay entries, lines ~30-32)
- Modify: `docs/DEPLOYMENT.md` only if a relay env var changed (none did)

- [ ] **Step 1: Info modal copy** — replace the `rules` array:

```ts
  const rules = [
    { n: "1", t: "Play 1v1 matches you against a random opponent, live, at the same time." },
    { n: "2", t: "Play with a friend opens a private room: pick how many players (2 to 4), generate a 6 digit code, or enter one a friend sent you." },
    { n: "3", t: "The host starts the game once everyone is in, and can change the game, stop the match or close the room at any time." },
  ];
```

- [ ] **Step 2: CODE_MAP** — add under the MultiPlayer entries:

```
- `src/components/modals/GamePickerModal.tsx` — Game picker modal: tiles to switch a room's game (lobby + results). [used by: 1 files]
- `src/hooks/useRoomGuard.ts` — Confirm-then-leave for every control that exits a live room/match (rail, strip, nav, logo). [used by: 2 files]
- `src/utils/roomSizes.ts` — Client copy of friend-room player bounds (relay turnGames.ROOM_CONFIGS is the truth). [used by: 2 files]
```

- [ ] **Step 3: Full verification**

Run: `cd multiplayer_server && npm test` → all pass. `npx tsc --noEmit && npx eslint src` → clean. `npm run build` → succeeds.

Browser pass at 375×812 and 1280×900 (host = Playwright QA account, guests = `C:\tmp\mp-guest.js`):
1. Generate a 3-room, two guests join, start → three roundData; one guest script exits early (`process.exit`) → host sees "X left the match." and the round still settles with two.
2. Host presses the logo mid-match → "End the match?" → Stay; → End match → home.
3. Guest-side (swap roles: QA account joins a room the script created — add `createFriendRoom {size:2}` to a second script variant): rail click → "Leave the room?" copy; Waiting for the host to start; Leave room works.
4. No `[browser] Uncaught` lines in `C:\tmp\devserver.log` during the pass.

- [ ] **Step 4: Commit and PR**

```bash
git add src/components/modals/MultiplayerInfoModal.tsx docs/team/CODE_MAP.md
git commit -m "Friend rooms v2: copy and catalog"
git push -u origin feat/friend-rooms-v2
gh pr create --base dev --title "Friend rooms v2: host-sized rooms, host-started games, leave guards" --body "Private rooms are run by their host.

- The host picks 2-4 players when generating a code (per-game bounds: Tic-Tac-Toe 2, default 2-4) and can change it in the lobby; a join into a full room is refused.
- Nothing auto-starts: the host presses Start game once at least 2 are seated and everyone is online. Guests see 'Waiting for the host to start'.
- Host controls: change game (new picker modal), start, stop match (everyone back to the lobby), play again / change game after a round (immediate, no handshake), close room. Guests only wait or leave. Random 1v1 keeps the propose/accept handshake.
- Leaving: a guest leaving frees the seat (a round carries on if 2+ remain, else back to the lobby); the host leaving closes the room. Disconnects follow the same rules after the grace windows.
- Leave guards: the rail, phone strip, Games link and logo ask before leaving a room or match, with role-aware copy.
- Fixes a pre-existing relay bug: a dropped player's socket id was never cleared, so nobody ever showed as reconnecting.
- Relay tests: new test/rooms.integration.test.js. When this is promoted, redeploy the relay too (cd multiplayer_server && railway up --detach)."
```

Then stop: merging to `dev` is this plan's end; promotion is the owner's call.
