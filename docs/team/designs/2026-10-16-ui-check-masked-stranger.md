# Design — Masked stranger "Player" must not carry a permanent player ID (ui-check-masked-stranger)

Card `3fa2cfb1-c595-8138-be07-fc895477bb2b` · P0 · hard · findings `UIC-20261014-1153-001` (VS intro,
`.om-matchup .om-pc-tag`) and `UIC-20261014-1153-002` (results, `.om-stage--results .om-pc-tag`).
Attachments: `.team/attachments/3fa2cfb1-c595-8138-be07-fc895477bb2b/{0.jpg,1.jpg,2.bin}` (2.bin = findings.json).

## 1. Decision summary
The relay stops putting a masked stranger's permanent `public_id` on the wire at all; the client only
adds a belt-and-braces guard. Today `publicUser()` masks name and photo but still sends `id`, and
three builders (`rankRoom`, `snapshotFor`, `lobbySnapshot`) plus seven presence/proposal emits send the
raw uid again. Hiding the chip client-side alone would leave the id readable in DevTools, which is the
exact "find and friend-request a masked teen" hole the finding names, so the fix is relay-first.

- Masking becomes **viewer-relative**: `publicUser(user, viewerUid)` masks when `maskedForStrangers(user)`
  AND `user.id !== viewerUid`. A player is never masked from themselves (their own standings row keeps
  its id so `rowOf(user)` / "YOU" / own time keep working).
- A masked user is sent as `{ id: null, masked: true, username: "Player", profile_photo: null, rank, points }`.
- The relay keeps the uid internally: `rankRoom()` rows carry `uid`; a new `standingsFor(room, viewerUid)`
  produces the wire rows. `settleMatch` still routes with the uid.
- Client: `PlayerInfo.masked?: boolean`; `OnlineMatch` passes `tag={o.masked ? null : o.id}`; the
  `RESUME` reducer branch carries `masked`. `PlayerCard` is unchanged (a null tag already renders no chip).
- No username heuristic ("Player" ⇒ hide) in the client: a real user may be called "Player", and the
  heuristic would hide a symptom while the id still travels.
- `maskedForStrangers` semantics are untouched: a teen in a friend room (joined by a code they shared)
  still shows name, photo and id.

Engine: **mixed** — relay masking/standings steps `[opus]`, mechanical emit edits, client props and
tests `[sonnet]`.

Invariant the plan relies on: `masked ⇒ room.type === "match" ⇒ exactly two members`
(`createMatchRoom` seats two queue entries; friend rooms are never masked). So the client's
`playerKey()` fallback to `username` ("Player") can never collide inside one room.

## 2. Interfaces

### Relay (`multiplayer_server/src/index.js`)
```js
/** Wire view of a player as seen by `viewerUid` (null = a stranger). Never masks a player from themselves. */
publicUser(user, viewerUid = null) => {
  id: string | null,        // null when masked
  masked: boolean,          // NEW — true when name/photo/id are hidden from this viewer
  username: string,         // "Player" when masked
  profile_photo: string | null,
  rank, points,             // unchanged (not identifying)
}
// absent user → { id: null, masked: false, username: "Player" } (unchanged fallback, plus masked:false)

/** uid as the viewer may see it: the uid, or null when that player is masked for the viewer. */
publicIdOf(uid, viewerUid = null) => string | null

/** Internal ranking rows (no user fields): [{ uid, score, elapsedMs, outcome }] */
rankRoom(room)

/** Wire standings for one recipient: rankRoom rows mapped through publicUser/publicIdOf. */
standingsFor(room, viewerUid) => [{ id, masked, username, profile_photo, rank, points, score, elapsedMs, outcome }]
```
Wire events whose player fields change (shape otherwise identical):
- `matchFound` (both `createMatchRoom` and `startFriendMatch`): `you` = `publicUser(self, self.uid)` (unmasked),
  `opponent`/`opponents[]` = `publicUser(other, recipientUid)`.
- `matchResult`: `standings` = `standingsFor(room, recipientUid)`; `yourScore`/`opponentScore`/`outcome` unchanged.
- `resumeMatch` (`snapshotFor`): `opponents[].id` = `publicIdOf(m, uid)`, `opponents[].masked`, `opponent`,
  `standings` = `standingsFor(room, uid)`.
- `opponentProgress`, `opponentFinished`, `opponentDisconnected`, `opponentReconnected`, `memberLeft`,
  `proposalProgress`, `proposalDeclined`: `id` = `publicIdOf(actorUid, recipientUid)` (null when masked),
  `username` unchanged (`nameOf`, already masked).
- `friendLobbyUpdate` (`lobbySnapshot`): unchanged — lobbies are friend rooms, never masked.

### Client
- `src/types/types.tsx` `PlayerInfo`: add `masked?: boolean` (doc: "true when the relay hid this stranger's
  name, photo and id (teen masking); never render an id for a masked player").
- `src/components/MultiPlayer/OnlineMatch.tsx` `Matchup`: opponent cards get `tag={o.masked ? null : o.id}`
  (1v1 site and the 3+ `is-trio` site). The `You` card is unchanged (Redux user).
- `src/context/MultiplayerContext.tsx` `RESUME`: the `opponents` map adds `masked: o.masked`.
  `MATCH_FOUND` passes the relay objects through untouched (already carries `masked`).
- `PlayerCard.tsx`: no change (finding lists it; the chip is conditional on `tag` already).

## 3. File plan
- `multiplayer_server/src/index.js` — `publicUser(user, viewerUid)` + `masked`; `publicIdOf`; `rankRoom` → internal
  rows; `standingsFor`; `settleMatch`, `snapshotFor`, both `matchFound` sites, seven `{ id: uid }` emits.
- `multiplayer_server/test/hardening.integration.test.js` — extend the teen-masking test with id/masked/standings/
  resume/presence assertions.
- `src/types/types.tsx` — `PlayerInfo.masked`.
- `src/components/MultiPlayer/OnlineMatch.tsx` — two `tag=` guards.
- `src/context/MultiplayerContext.tsx` — `RESUME` carries `masked`.
- `.team/run/ui-check-masked-stranger/build-report.json` — engine output (not product code).

## 4. Risks
| Risk | Prevention |
|---|---|
| Nulling `id` everywhere breaks the self row: a teen's own standings row would lose its id, so `rowOf(user)` (own time on results) and `isYou` fail. | Viewer-relative masking: `publicUser(user, viewerUid)` never masks the recipient's own row; `standingsFor` is built per recipient. Test asserts Tina's own row keeps `TINA00`. |
| `settleMatch` routes with `toUid(row.id)` and `bestOther` filters by `id`; a null id would send nothing. | `rankRoom` keeps the internal `uid`; only `standingsFor` produces wire rows. Existing rooms tests (`standings.length`, `.username`, `.score`) still pass unchanged. |
| Client presence keyed by id: `freshStatus`/`patchStatus` fall back to `username` ("Player"). Two masked players would collide. | Invariant: masked only in random rooms, which are strictly 1v1 (`createMatchRoom`). `patchStatus` already falls back to `opponents[0]`. Stated in a code comment next to `publicIdOf`. |
| Production relay is deployed only by the owner (Railway). The frontend lands first; an old relay still sends `id`. | The client guard uses `masked` (inert against an old relay) — no heuristic. Gate 2 verifies against the worktree's own relay, so the card passes; the build report must say the prod finding stays open until the relay deploys. |
| `lobbySnapshot` touched by mistake would mask friends in a lobby (`LobbyMember.id: string` is non-null). | Explicitly out of the file plan; a comment says why. |
| Turn games (`turnGames.js` board cells `ownerUid`, `clues[].uid`) still carry raw uids in `turnState` for 1v1 TicTacToe/Imposter. | Out of scope: not a `.om-pc-tag` surface and needs a seat-key refactor. Record as a follow-up in the build report (`assumed`). |
| `nameOf` and `maskedForStrangers` behaviour changes would alter friend-room names. | Both untouched. |

## 5. Test plan
Gate 1 (unchanged from the brief, plus the relay suite):
- `npm run lint`, `npx next typegen && npx tsc --noEmit`, `npm run build`
- `DATABASE_URL="" python manage.py check && python manage.py test users trivia`
- `cd multiplayer_server && npm test` (node --test: identity, origin, hardening, rooms, sims)

New relay tests (step 6) in `multiplayer_server/test/hardening.integration.test.js`, extending
"teens show as Player to strangers in random matches, by name in friend rooms" (fixture: Tina is `is_teen`,
id `TINA00`; Hank `HANK00`):
1. `foundB.opponent.id === null`, `foundB.opponent.masked === true`, `foundB.opponents[0].id === null` (Hank's view of Tina).
2. `foundA.opponent.id === "HANK00"`, `foundA.opponent.masked === false`; `foundA.you.id === "TINA00"`, `foundA.you.username === "Tina"` (Tina sees herself).
3. After both `submitScore` in that room: Hank's `matchResult.standings` row with `username === "Player"` has `id === null`; Tina's `matchResult.standings` contains a row `id === "TINA00"` and a row `id === "HANK00"`.
4. Hank's `opponentFinished` (or `opponentProgress`) for Tina has `id === null`.
5. Hank reconnects (`identify` again with the same token, as the existing resume tests do): `resumeMatch.opponents[0].id === null` and `.masked === true`.
6. Friend room (existing tail of the test): `found.opponent.id === "TINA00"` and `.masked === false`.

Gate 2 QA assertions (the brief's block):
```json
[
  { "flow": "node scripts/ui-check/verify.mjs --from /home/user/nba-trivia-minigames/.team/attachments/3fa2cfb1-c595-8138-be07-fc895477bb2b/2.bin UIC-20261014-1153-001 --mode dev --repo <worktree> --ports django=<lane>,socket=<lane>,web=<lane> --keep-stack — PASS (MP-MATCH-01 @ mp@pairA: no teen-masking digest line for .om-matchup .om-pc-tag)" },
  { "flow": "node scripts/ui-check/verify.mjs --from /home/user/nba-trivia-minigames/.team/attachments/3fa2cfb1-c595-8138-be07-fc895477bb2b/2.bin UIC-20261014-1153-002 --mode dev --repo <worktree> --ports django=<lane>,socket=<lane>,web=<lane> --keep-stack — PASS (MP-RESULT-01, MP-PROP-01, MP-PROP-02 @ mp@pairA: no teen-masking digest line for .om-stage--results .om-pc-tag)" },
  { "flow": "1v1 random match between two test accounts of unknown age (both masked): on the VS intro and on results each side's own card still shows its own #ID and name, the opponent card shows \"Player\" with no #ID chip, and the results time under each card is present (own row still resolves)" }
]
```

## Implementation plan
1. `[opus]` `multiplayer_server/src/index.js` — rewrite `publicUser` as `publicUser(user, viewerUid = null)`:
   `const masked = !!user && maskedForStrangers(user) && user.id !== viewerUid;` returning
   `{ id: masked ? null : user.id ?? null, masked, username: masked ? "Player" : user.username, profile_photo: masked ? null : user.profile_photo ?? null, rank, points }`;
   the no-user fallback adds `masked: false`. Add `publicIdOf(uid, viewerUid = null)` next to it
   (`players.get(uid)?.user` masked for the viewer → `null`, else `uid`) with the comment: "masked players
   exist only in random 1v1 rooms, so the client's username fallback key cannot collide".
   Done: `cd multiplayer_server && npm test` still green (no caller yet passes a viewer, behaviour identical
   except the new `masked` field).
2. `[opus]` `multiplayer_server/src/index.js` — `rankRoom(room)` returns internal rows
   `{ uid, score, elapsedMs, outcome }` (drop the `...publicUser` spread and `id`). Add
   `standingsFor(room, viewerUid)` = `rankRoom(room).map(r => ({ ...publicUser(players.get(r.uid)?.user, viewerUid), id: publicIdOf(r.uid, viewerUid), score: r.score, elapsedMs: r.elapsedMs, outcome: r.outcome }))`.
   `settleMatch`: iterate the internal rows, `bestOther` by `o.uid !== row.uid`, `toUid(row.uid, "matchResult", { ..., standings: standingsFor(room, row.uid) })`.
   `snapshotFor`: `standings = phase === "results" ? standingsFor(room, uid) : null`. Update the rankRoom doc comment.
   Done: `npm test` green — `rooms.integration.test.js` lines ~278/351/505/536/750 (`standings.length`, `.username`, `.score`) unchanged.
3. `[sonnet]` `multiplayer_server/src/index.js` — thread the viewer through the snapshot/matchFound sites:
   `createMatchRoom` host/guest emits: `you: publicUser(selfUser, selfUid)`, `opponent`/`opponents` with the
   recipient's uid; `startFriendMatch` likewise (`publicUser(players.get(m)?.user, uid)`);
   `snapshotFor`: `opponents` entries `{ ...publicUser(players.get(m)?.user, uid), id: publicIdOf(m, uid), online, finished }`,
   `opponent: publicUser(players.get(opps[0])?.user, uid)`. `lobbySnapshot` stays as is; add a one-line comment
   ("friend lobbies are never masked, ids stay").
   Done: grep `publicUser(` shows every call outside `nameOf`/`standingsFor`/`lobbySnapshot` passes a viewer; `npm test` green.
4. `[sonnet]` `multiplayer_server/src/index.js` — the seven raw-id emits send `id: publicIdOf(actorUid, m)` with
   `m` the recipient of that `toUid`: `memberLeft` (~l.498), `opponentReconnected` (~l.853), `opponentFinished`
   (~l.1154), `opponentProgress` (~l.1164), `proposalProgress` (~l.1220), `proposalDeclined` (~l.1240),
   `opponentDisconnected` (~l.1303). `proposalReceived` carries only `fromName` (already `nameOf`) — no change.
   Done: `grep -n "id: uid\|id: byUid\|id: decliner" multiplayer_server/src/index.js` returns only
   `lobbySnapshot`'s `id: uid`; `npm test` green.
5. `[sonnet]` Client — `src/types/types.tsx`: add `masked?: boolean` to `PlayerInfo` with the doc line from §2.
   `src/components/MultiPlayer/OnlineMatch.tsx` `Matchup`: `tag={opp0?.masked ? null : opp0?.id}` (1v1) and
   `tag={o.masked ? null : o.id}` (trio). `src/context/MultiplayerContext.tsx` `RESUME`: the `opponents` map
   adds `masked: o.masked`. Nothing else in the client changes (`playerKey`, `patchStatus`, `Standings` already
   tolerate a null id).
   Done: `npx next typegen && npx tsc --noEmit` passes; `grep -n "tag={" src/components/MultiPlayer/OnlineMatch.tsx`
   shows the two guarded opponent sites and the two unguarded `You` sites.
6. `[sonnet]` `multiplayer_server/test/hardening.integration.test.js` — extend the teen test with assertions 1–6 of
   §5 (reuse the file's `player`, `matchUp`, `next`, `wait` helpers; for the settled match submit a score from each
   socket on the match code the way `rooms.integration.test.js` ~l.270 does; for the resume step re-`identify` Hank's
   socket as the existing reconnect tests do — if the file has no reconnect helper, open a second socket for Hank with
   the same token and await `resumeMatch`).
   Done: `cd multiplayer_server && npm test` green, the test fails when step 1's `masked` branch is reverted (spot-check once).
7. `[sonnet]` Write `.team/run/ui-check-masked-stranger/build-report.json`: `did` (relay drops the id for masked
   strangers, viewer-relative; client guards on `masked`), `assumed` ("prod finding stays open until the owner
   deploys the relay; turn-game `turnState` still carries raw uids — follow-up card"), `touched` (the five product
   files + the test), `testsAdded` (the hardening test name).
   Done: file exists and parses.

Self-review: every spec line maps to a step (relay id → 1–4; client hide → 5; reuse `maskedForStrangers` → 1;
rules `docs/legal/README.md` "unknown age is treated as teen" → unchanged predicate; acceptance → §5 QA flows).
No placeholders; names (`publicUser`, `publicIdOf`, `standingsFor`, `masked`) consistent across sections; scope
excludes lobbies, `nameOf`, turn-state uids and any "Player"-name heuristic; the one ambiguity ("masked:true, or
the id only in friend rooms") is resolved as both: `masked` flag AND id only when the viewer may see it.
