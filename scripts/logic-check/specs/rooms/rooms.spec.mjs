// Logic Check — rooms suite (spec §5 rooms row): the relay's socket protocol end to end, two socket.io clients in node
// (lib/socket.mjs), no browser. logic.actor (testuser4) hosts, logic.peer (testuser5) joins; LC-ROOMS-09's three-player
// case seats logic.admin (testuser6) as the third (memberLeft needs 3+ players). Never UI check's testuser1/2 (Review
// Focus 3). Protocol truth: multiplayer_server/src/index.js of the checkout under test (event names, payloads and messages
// quoted below come from it); games from the catalogue (online, visible, dealt from the data host:
// gameData.js ROUND_GAMES). Every test closes its sockets in `finally` with leaveMatch + cancelFind first, so no room
// or queue outlives it. The tests run in file order in the suite's single worker.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from '../../lib/fixtures.mjs';
import { connect } from '../../lib/socket.mjs';
import { visibleGames } from '../../../ui-check/lib/games-catalog.mjs';
import { appRepo, readStack } from '../../../ui-check/lib/stack.mjs';
import { activePorts } from '../../../check-core/lib/ports.mjs';
import { ROLES, mintTokens } from '../../../check-core/lib/accounts.mjs';

test.describe.configure({ mode: 'default' });

const HOST = ROLES['logic.actor'];
const PEER = ROLES['logic.peer'];
const THIRD = ROLES['logic.admin'];
const readApp = (rel) => { try { return readFileSync(path.join(appRepo(), rel), 'utf8'); } catch { return ''; } };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const short = (s, n = 110) => { s = String(s ?? '').replace(/\s+/g, ' ').trim(); return s.length > n ? `${s.slice(0, n)}…` : s; };
const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);

// The relay's pool games and their round sizes (multiplayer_server/src/gameData.js ROUND_GAMES: id → [pool key, rows]).
const ROUND_GAMES = Object.fromEntries([...readApp('multiplayer_server/src/gameData.js').matchAll(/"([a-z0-9-]+)":\s*\["([a-z0-9-]+)",\s*(\d+)\]/g)].map((m) => [m[1], { key: m[2], n: Number(m[3]) }]));
// Online, visible games the relay deals as a shared round (no turn game): the room's game and the one it switches to.
const ROUND = visibleGames().filter((g) => g.online && ROUND_GAMES[g.id]);
const [GAME, OTHER] = ROUND;
const wire = (g) => ({ id: g.id, name: g.name, urlPath: g.path }); // MultiplayerContext serializeGame (functions stripped)
// Messages the relay sends (index.js).
const MSG = {
  signedOutCreate: 'You need to be signed in to create a room.',
  noRoom: 'No room found for that code.',
  inThisRoom: "You're already in this room.",
  inARoom: "You're already in a room.",
  needPlayers: (min) => `Need at least ${min} players to start.`,
  hostClosed: 'The host closed the room.',
  away: 'You were away too long and left the room.',
  opponentLeft: 'Your opponent left the match.',
  noMatch: 'This match is no longer running.',
};
const ID_KEYS = ['qid', 'id', 'person_id', 'match_id', 'game_id', 'team_id', 'season'];

/** Keys every row of the bundled pool carries (backend/trivia/data/<key>.json): what the renderers read. */
function poolKeys(key) {
  try {
    const d = JSON.parse(readApp(`backend/trivia/data/${key}.json`));
    const rows = Array.isArray(d) ? d : d.pool;
    return rows.reduce((acc, r) => acc.filter((k) => k in r), Object.keys(rows[0]));
  } catch { return []; }
}

/** The relay and Django share MULTIPLAYER_SHARED_SECRET: only a stack the helper started records its key (a reused
 *  Django gets `relayKey: null` in stack.json, stackMeta), so null = unkeyed / unknown. */
const relayKeyed = () => !!readStack()?.relayKey;
const socketUrl = () => (readStack()?.socket || `http://localhost:${activePorts().socket}`).replace(/\/+$/, '');

/**
 * Fresh tokens and connected, identified clients for `names` (default host + peer), plus helpers bound to `lc`:
 *   s.c[name]                    the client
 *   s.user[name]                 the minted /me/ payload ({ id: public id, username, points, … })
 *   await s.expect(name, event, { since, filter, timeout, what })   → payload, or null after a violation
 *   await s.absent(name, event, { since, within, filter, what })    → true, or false after a violation
 *   await s.close()              every client: leaveMatch + cancelFind, then disconnect
 */
async function session(lc, names = [HOST, PEER]) {
  const tokens = await mintTokens(names);
  const url = socketUrl();
  const c = {};
  const s = {
    url, c, tokens,
    user: Object.fromEntries(names.map((n) => [n, tokens[n].user])),
    async connect(name, { identify = true } = {}) {
      c[name] = await connect(name, { url, token: identify ? tokens[name].access : null });
      return c[name];
    },
    async expect(name, event, { since = 0, filter, timeout = 8000, what = '' } = {}) {
      try { return await c[name].waitFor(event, { since, filter, timeout }); } catch (e) {
        lc.violation('protocol', { route: '/socket.io/', selector: `${name} ← ${event}${what ? ` (${what})` : ''}`, measured: short(e.message, 160), expected: `${event} within ${timeout} ms` });
        return null;
      }
    },
    async absent(name, event, { since = 0, within = 800, filter, what = '' } = {}) {
      const got = await c[name].quiet(event, { since, within, filter });
      if (got === null) return true;
      lc.violation('protocol', { route: '/socket.io/', selector: `${name} ← ${event}${what ? ` (${what})` : ''}`, measured: short(JSON.stringify(got)), expected: `no ${event}` });
      return false;
    },
    check(ok, selector, measured, expected) {
      if (!ok) lc.violation('protocol', { route: '/socket.io/', selector, measured: short(typeof measured === 'string' ? measured : JSON.stringify(measured), 160), expected });
      return !!ok;
    },
    async close() { await Promise.all(Object.values(c).map((x) => x.close().catch(() => {}))); },
  };
  // The minted ids are the relay's ids: stack-setup proved the running Django serves the minter's sqlite.
  try { for (const n of names) await s.connect(n); } catch (e) { await s.close(); throw e; }
  return s;
}

/** Host creates a room for `game` of `size` → the creation snapshot, or null. */
async function create(s, game = GAME, size = 2, host = HOST) {
  const m = s.c[host].mark();
  s.c[host].emit('createFriendRoom', { game: wire(game), size });
  return s.expect(host, 'friendRoomCreated', { since: m, what: `create ${game.id}` });
}

/** `who` joins `code` (as the site does: the typed string) → the joiner's snapshot, or null. */
async function join(s, code, who = PEER) {
  const m = s.c[who].mark();
  const mh = s.c[HOST].mark();
  s.c[who].emit('joinFriendRoom', { code: String(code) });
  const snap = await s.expect(who, 'friendRoomJoined', { since: m, what: `join ${code}` });
  // The host's matching friendLobbyUpdate, so a later step's mark starts after it.
  if (snap && who !== HOST) await s.expect(HOST, 'friendLobbyUpdate', { since: mh, filter: (d) => (d.members || []).some((x) => x.id === s.user[who].id), what: `${who} joined` });
  return snap;
}

/** The host starts the room; every seat gets matchFound and the same roundData → { found: {name: payload}, rounds }. */
async function start(s, code, names = [HOST, PEER]) {
  const marks = Object.fromEntries(names.map((n) => [n, s.c[n].mark()]));
  s.c[HOST].emit('startRoomNow', { code });
  const found = {}, rounds = {};
  for (const n of names) found[n] = await s.expect(n, 'matchFound', { since: marks[n], what: 'start' });
  for (const n of names) rounds[n] = await s.expect(n, 'roundData', { since: marks[n], timeout: 20_000, what: 'start' });
  return { found, rounds };
}

/** roundData's shape for `gameId`: { gameData: N rows with the pool's keys, each id once, game: that game }. */
function checkRound(s, who, rd, gameId) {
  if (!s.check(isObj(rd) && Array.isArray(rd.gameData), `${who} ← roundData`, rd, '{ gameData: [...], game }')) return;
  const spec = ROUND_GAMES[gameId];
  s.check(isObj(rd.game) && rd.game.id === gameId, `${who} ← roundData.game.id`, rd.game && rd.game.id, gameId);
  s.check(rd.gameData.length === spec.n, `${who} ← roundData.gameData`, `${rd.gameData.length} rows`, `${spec.n} rows (gameData.js ROUND_GAMES ${gameId})`);
  const keys = poolKeys(spec.key);
  const bad = rd.gameData.find((r) => !isObj(r) || keys.some((k) => !(k in r)));
  s.check(!bad, `${who} ← roundData row`, bad ? `missing ${keys.filter((k) => !isObj(bad) || !(k in bad)).join(', ')}` : '', `every row carries ${keys.join(', ')} (the ${spec.key} pool's shape)`);
  const idKey = ID_KEYS.find((k) => rd.gameData.every((r) => isObj(r) && r[k] != null));
  if (idKey) s.check(new Set(rd.gameData.map((r) => JSON.stringify(r[idKey]))).size === rd.gameData.length, `${who} ← roundData ${idKey}`, 'a duplicate', 'each row once');
}

/** The name a stranger sees in a random 1v1: "Player" for a teen or an account of unknown age (index.js maskedForStrangers). */
const shown = (s, name) => (s.user[name].is_teen ? 'Player' : name);

/** /me/ points of a persona (api fixture), or null. */
async function points(api, persona) {
  const r = await api.call(persona, 'GET', '/me/');
  return r.status === 200 && r.json && r.json.user ? r.json.user.points : null;
}

test.beforeAll(() => {
  if (!GAME || !OTHER) throw new Error(`rooms: need two online round games in the catalogue (found ${ROUND.map((g) => g.id).join(', ') || 'none'}; ROUND_GAMES ${Object.keys(ROUND_GAMES).join(', ') || 'unparsed'})`);
});

test('[LC-ROOMS-01] identify: a valid access token makes the socket a player; a missing or bad token gets identifyError and no gated action', async ({ lc }) => {
  const s = await session(lc, [HOST]);
  let bad = null, none = null;
  try {
    await test.step('valid token → no identifyError; the relay treats the socket as a player', async () => {
      const m = s.c[HOST].mark();
      await s.absent(HOST, 'identifyError', { within: 1500, what: 'valid token' });
      // A score for a room that does not exist: an identified player is told the match is gone, a stranger is ignored.
      s.c[HOST].emit('submitScore', { code: 1, score: 0, elapsedMs: 0 });
      const left = await s.expect(HOST, 'opponentLeft', { since: m, what: 'score for no room' });
      if (left) s.check(left.message === MSG.noMatch, `${HOST} ← opponentLeft.message`, left.message, MSG.noMatch);
    });
    await test.step('junk token → identifyError invalid_token; createFriendRoom refused', async () => {
      bad = await connect('junk', { url: s.url, token: 'lc-not-a-jwt' });
      let err;
      try { err = await bad.waitFor('identifyError', { timeout: 8000 }); } catch (x) { lc.violation('protocol', { route: '/socket.io/', selector: 'junk ← identifyError', measured: short(x.message), expected: 'identifyError { code: "invalid_token" }' }); }
      if (err) s.check(err.code === 'invalid_token' && typeof err.message === 'string' && err.message, 'junk ← identifyError', err, '{ code: "invalid_token", message }');
      const m = bad.mark();
      bad.emit('createFriendRoom', { game: wire(GAME), size: 2 });
      try {
        const f = await bad.waitFor('friendError', { since: m, timeout: 8000 });
        s.check(f.message === MSG.signedOutCreate, 'junk ← friendError.message', f.message, MSG.signedOutCreate);
      } catch (x) { lc.violation('protocol', { route: '/socket.io/', selector: 'junk ← friendError', measured: short(x.message), expected: `friendError "${MSG.signedOutCreate}"` }); }
      if (bad.events().some((e) => e.event === 'friendRoomCreated')) lc.violation('protocol', { route: '/socket.io/', selector: 'junk ← friendRoomCreated', measured: 'a room was created', expected: 'no room for an unidentified socket' });
    });
    await test.step('no token → identifyError invalid_token', async () => {
      none = await connect('no-token', { url: s.url });
      none.emit('identify', {});
      try {
        const err = await none.waitFor('identifyError', { timeout: 8000 });
        s.check(err.code === 'invalid_token', 'no-token ← identifyError.code', err.code, 'invalid_token');
      } catch (x) { lc.violation('protocol', { route: '/socket.io/', selector: 'no-token ← identifyError', measured: short(x.message), expected: 'identifyError { code: "invalid_token" }' }); }
    });
  } finally {
    await Promise.all([bad, none].filter(Boolean).map((x) => x.close()));
    await s.close();
  }
  await lc.done();
});

test('[LC-ROOMS-02] createFriendRoom → a 6-digit code and a lobby with the host as its only, online member', async ({ lc }) => {
  const s = await session(lc, [HOST]);
  try {
    const snap = await create(s);
    if (snap) {
      const me = s.user[HOST];
      s.check(Number.isInteger(snap.code) && snap.code >= 100000 && snap.code <= 999999, 'friendRoomCreated.code', String(snap.code), 'an integer 100000–999999 (allocateRoomCode)');
      s.check(snap.hostUid === me.id, 'friendRoomCreated.hostUid', snap.hostUid, `${me.id} (the account's public id from /api/me/, not a client claim)`);
      s.check(Array.isArray(snap.members) && snap.members.length === 1, 'friendRoomCreated.members', snap.members, 'one member');
      const m0 = (snap.members || [])[0] || {};
      s.check(m0.id === me.id && m0.username === me.username && m0.isHost === true && m0.online === true, 'friendRoomCreated.members[0]', m0, `{ id: ${me.id}, username: ${me.username}, isHost: true, online: true }`);
      s.check(isObj(snap.game) && snap.game.id === GAME.id && snap.game.urlPath === `/${GAME.id}`, 'friendRoomCreated.game', snap.game, `{ id: ${GAME.id}, urlPath: /${GAME.id} } (rebuilt by the relay)`);
      s.check(snap.capacity === 2, 'friendRoomCreated.capacity', snap.capacity, '2 (the size asked for)');
      // The site's stepper mirrors the relay's bounds (src/utils/roomSizes.ts ← turnGames.js ROOM_CONFIGS).
      const max = Number((/MAX_ROOM_SIZE\s*=\s*(\d+)/.exec(readApp('src/utils/roomSizes.ts')) || [])[1]);
      s.check(snap.min === 2 && snap.max === max, 'friendRoomCreated.min/max', `${snap.min}/${snap.max}`, `2/${max} (src/utils/roomSizes.ts default bounds)`);
      const m = s.c[HOST].mark();
      s.c[HOST].emit('createFriendRoom', { game: wire(GAME), size: 2 });
      const again = await s.expect(HOST, 'friendError', { since: m, what: 'second room' });
      if (again) s.check(again.message === MSG.inARoom, 'friendError.message (second room)', again.message, MSG.inARoom);
    }
  } finally { await s.close(); }
  await lc.done();
});

test('[LC-ROOMS-03] joinFriendRoom with the code → the joiner gets friendRoomJoined, the host friendLobbyUpdate, both listing both players', async ({ lc }) => {
  const s = await session(lc);
  try {
    const snap = await create(s);
    if (snap) {
      const mh = s.c[HOST].mark();
      const joined = await join(s, snap.code);
      const upd = await s.expect(HOST, 'friendLobbyUpdate', { since: mh, filter: (d) => d.members && d.members.length === 2, what: 'peer joined' });
      const ids = [s.user[HOST].id, s.user[PEER].id];
      for (const [who, d] of [[PEER, joined], [HOST, upd]]) {
        if (!d) continue;
        s.check(d.code === snap.code, `${who} snapshot.code`, String(d.code), String(snap.code));
        s.check(JSON.stringify((d.members || []).map((x) => x.id)) === JSON.stringify(ids), `${who} snapshot.members`, (d.members || []).map((x) => `${x.username}#${x.id}`).join(', '), `${HOST}#${ids[0]} (host first), ${PEER}#${ids[1]}`);
        s.check((d.members || []).every((x, i) => x.isHost === (i === 0) && x.online === true), `${who} snapshot.members flags`, d.members, 'host first with isHost, both online');
        s.check(d.hostUid === ids[0], `${who} snapshot.hostUid`, d.hostUid, ids[0]);
      }
    }
  } finally { await s.close(); }
  await lc.done();
});

test('[LC-ROOMS-04] a wrong code → friendJoinError "No room found for that code."; the host joining its own room → "You\'re already in this room."', async ({ lc }) => {
  const s = await session(lc);
  try {
    const snap = await create(s);
    if (snap) {
      const wrong = snap.code === 999999 ? 100000 : snap.code + 1;
      for (const code of [String(wrong), 'abcdef']) {
        const m = s.c[PEER].mark();
        s.c[PEER].emit('joinFriendRoom', { code });
        const e = await s.expect(PEER, 'friendJoinError', { since: m, what: `code ${code}` });
        if (e) s.check(e.message === MSG.noRoom, `friendJoinError.message (code ${code})`, e.message, MSG.noRoom);
        await s.absent(PEER, 'friendRoomJoined', { since: m, within: 300, what: `code ${code}` });
      }
      const m = s.c[HOST].mark();
      s.c[HOST].emit('joinFriendRoom', { code: String(snap.code) });
      const e = await s.expect(HOST, 'friendJoinError', { since: m, what: 'own room' });
      if (e) s.check(e.message === MSG.inThisRoom, 'friendJoinError.message (own room)', e.message, MSG.inThisRoom);
    }
  } finally { await s.close(); }
  await lc.done();
});

test('[LC-ROOMS-05] setRoomSize (host) → both see the new capacity, clamped to the game\'s bounds and the seated players; a guest cannot resize', async ({ lc }) => {
  const s = await session(lc);
  try {
    const snap = await create(s);
    if (snap && await join(s, snap.code)) {
      for (const [size, want] of [[3, 3], [9, snap.max], [1, 2]]) {
        await test.step(`size ${size} → capacity ${want}`, async () => {
          const marks = { [HOST]: s.c[HOST].mark(), [PEER]: s.c[PEER].mark() };
          s.c[HOST].emit('setRoomSize', { code: snap.code, size });
          for (const who of [HOST, PEER]) {
            const d = await s.expect(who, 'friendLobbyUpdate', { since: marks[who], what: `size ${size}` });
            if (d) s.check(d.capacity === want, `${who} ← friendLobbyUpdate.capacity (size ${size})`, String(d.capacity), `${want}`);
          }
        });
      }
      await test.step('the guest asks for 4 → ignored', async () => {
        const m = s.c[HOST].mark();
        s.c[PEER].emit('setRoomSize', { code: snap.code, size: 4 });
        await s.absent(HOST, 'friendLobbyUpdate', { since: m, what: 'guest resize' });
      });
    }
  } finally { await s.close(); }
  await lc.done();
});

test('[LC-ROOMS-06] changeFriendGame (host) → both see the new game; a turn game clamps the size; a guest or an unknown game changes nothing', async ({ lc }) => {
  const s = await session(lc);
  try {
    const snap = await create(s, GAME, 3);
    if (snap && await join(s, snap.code)) {
      const change = async (game, label) => {
        const marks = { [HOST]: s.c[HOST].mark(), [PEER]: s.c[PEER].mark() };
        s.c[HOST].emit('changeFriendGame', { code: snap.code, game });
        const out = {};
        for (const who of [HOST, PEER]) out[who] = await s.expect(who, 'friendLobbyUpdate', { since: marks[who], what: label });
        return out;
      };
      await test.step(`→ ${OTHER.id}`, async () => {
        const out = await change(wire(OTHER), OTHER.id);
        for (const who of [HOST, PEER]) if (out[who]) s.check(out[who].game && out[who].game.id === OTHER.id, `${who} ← friendLobbyUpdate.game.id`, out[who].game && out[who].game.id, OTHER.id);
      });
      const ttt = visibleGames().find((g) => g.id === 'tictactoe' && g.online);
      if (ttt) {
        await test.step('→ tictactoe (2 players max): capacity 3 → 2', async () => {
          const out = await change(wire(ttt), 'tictactoe');
          for (const who of [HOST, PEER]) if (out[who]) s.check(out[who].game.id === 'tictactoe' && out[who].capacity === 2 && out[who].max === 2, `${who} ← friendLobbyUpdate (tictactoe)`, { game: out[who].game.id, capacity: out[who].capacity, max: out[who].max }, '{ game: tictactoe, capacity: 2, max: 2 }');
        });
      }
      await test.step('the guest changes the game → ignored', async () => {
        const m = s.c[HOST].mark();
        s.c[PEER].emit('changeFriendGame', { code: snap.code, game: wire(GAME) });
        await s.absent(HOST, 'friendLobbyUpdate', { since: m, what: 'guest change' });
      });
      await test.step('an unknown game id → ignored', async () => {
        const m = s.c[HOST].mark();
        s.c[HOST].emit('changeFriendGame', { code: snap.code, game: { id: 'lc-no-such-game', urlPath: 'https://example.com' } });
        await s.absent(HOST, 'friendLobbyUpdate', { since: m, what: 'unknown game' });
      });
    }
  } finally { await s.close(); }
  await lc.done();
});

test('[LC-ROOMS-07] startRoomNow → both get matchFound (friend room) and the same roundData for the room\'s game with the expected shape; alone → "Need at least 2 players"', async ({ lc }) => {
  const s = await session(lc);
  try {
    const snap = await create(s);
    if (snap) {
      await test.step('alone → friendError', async () => {
        const m = s.c[HOST].mark();
        s.c[HOST].emit('startRoomNow', { code: snap.code });
        const e = await s.expect(HOST, 'friendError', { since: m, what: 'start alone' });
        if (e) s.check(e.message === MSG.needPlayers(snap.min), 'friendError.message (start alone)', e.message, MSG.needPlayers(snap.min));
      });
      if (await join(s, snap.code)) {
        const { found, rounds } = await start(s, snap.code);
        for (const [who, role] of [[HOST, 'host'], [PEER, 'guest']]) {
          const f = found[who];
          if (f) s.check(f.code === snap.code && f.role === role && f.roomType === 'friend' && f.roomSize === 2 && f.game && f.game.id === GAME.id, `${who} ← matchFound`, { code: f.code, role: f.role, roomType: f.roomType, roomSize: f.roomSize, game: f.game && f.game.id }, `{ code: ${snap.code}, role: ${role}, roomType: friend, roomSize: 2, game: ${GAME.id} }`);
          const other = who === HOST ? s.user[PEER] : s.user[HOST];
          if (f) s.check(f.opponent && f.opponent.id === other.id, `${who} ← matchFound.opponent.id`, f.opponent && f.opponent.id, other.id);
          if (rounds[who]) checkRound(s, who, rounds[who], GAME.id);
        }
        if (rounds[HOST] && rounds[PEER]) s.check(JSON.stringify(rounds[HOST].gameData) === JSON.stringify(rounds[PEER].gameData), 'roundData host vs guest', 'different rounds', 'one shared round (the same gameData to every seat)');
      }
    }
  } finally { await s.close(); }
  await lc.done();
});

test('[LC-ROOMS-08] both submitScore (host 50, joiner 10) → matchResult names the host the winner on both sockets; a friend room credits no points', async ({ api, lc }) => {
  const s = await session(lc);
  try {
    const before = { [HOST]: await points(api, 'logic.actor'), [PEER]: await points(api, 'logic.peer') };
    const snap = await create(s);
    if (snap && await join(s, snap.code)) {
      const { rounds } = await start(s, snap.code);
      if (rounds[HOST] && rounds[PEER]) {
        const marks = { [HOST]: s.c[HOST].mark(), [PEER]: s.c[PEER].mark() };
        s.c[HOST].emit('submitScore', { code: snap.code, score: 50, elapsedMs: 30_000 });
        const waiting = await s.expect(HOST, 'waitingForOpponent', { since: marks[HOST], what: 'host scored first' });
        const fin = await s.expect(PEER, 'opponentFinished', { since: marks[PEER], what: 'host scored first' });
        if (waiting && fin) s.check(fin.id === s.user[HOST].id, `${PEER} ← opponentFinished.id`, fin.id, s.user[HOST].id);
        s.c[PEER].emit('submitScore', { code: snap.code, score: 10, elapsedMs: 20_000 });
        const res = {};
        for (const who of [HOST, PEER]) res[who] = await s.expect(who, 'matchResult', { since: marks[who] });
        const want = { [HOST]: { yourScore: 50, opponentScore: 10, outcome: 'win' }, [PEER]: { yourScore: 10, opponentScore: 50, outcome: 'loss' } };
        for (const who of [HOST, PEER]) {
          const r = res[who];
          if (!r) continue;
          s.check(r.yourScore === want[who].yourScore && r.opponentScore === want[who].opponentScore && r.outcome === want[who].outcome, `${who} ← matchResult`, { yourScore: r.yourScore, opponentScore: r.opponentScore, outcome: r.outcome }, JSON.stringify(want[who]));
          const st = Array.isArray(r.standings) ? r.standings : [];
          s.check(st.length === 2 && st[0].id === s.user[HOST].id && st[0].outcome === 'win' && st[0].score === 50 && st[1].id === s.user[PEER].id && st[1].outcome === 'loss', `${who} ← matchResult.standings`, st.map((x) => ({ id: x.id, score: x.score, outcome: x.outcome })), `[${HOST} 50 win, ${PEER} 10 loss]`);
        }
        if (relayKeyed()) {
          await s.absent(HOST, 'pointsAwarded', { since: marks[HOST], within: 1500, what: 'friend room' });
          const after = { [HOST]: await points(api, 'logic.actor'), [PEER]: await points(api, 'logic.peer') };
          for (const who of [HOST, PEER]) s.check(after[who] === before[who], `${who} /me/ points`, `${before[who]} → ${after[who]}`, 'unchanged: friend rooms never add points (index.js creditRoom)');
        } else {
          // An unkeyed relay credits nothing at all, so "no points" would prove nothing about friend rooms.
          lc.warn('credit', { route: '/trivia/multiplayer-result/', selector: 'friend room credit', measured: 'not evaluated: stack.json has no relay key for this stack (reused, not started by the helper)', expected: 'a keyed stack (relay and Django share MULTIPLAYER_SHARED_SECRET)' });
        }
      }
    }
  } finally { await s.close(); }
  await lc.done();
});

test('[LC-ROOMS-09] leaving: guest leaves the lobby / mid-round / drops; the host leaves mid-round / the lobby; a third player leaves a live round → the others get the protocol\'s event', async ({ lc }) => {
  test.setTimeout(120_000);
  const s = await session(lc, [HOST, PEER, THIRD]);
  try { await (async () => { // an early `return` ends the cases, never skips lc.done()
    const snap = await create(s, GAME, 3);
    if (!snap) return;
    const code = snap.code;
    const one = (d) => d.members && d.members.length === 1;
    await test.step('guest leaveMatch in the lobby → host friendLobbyUpdate with the host alone; the guest can join again', async () => {
      if (!await join(s, code)) return;
      const m = s.c[HOST].mark();
      s.c[PEER].emit('leaveMatch', { code });
      await s.expect(HOST, 'friendLobbyUpdate', { since: m, filter: one, what: 'guest left the lobby' });
      await join(s, code);
    });
    await test.step('guest leaveMatch mid-round (2 seated) → host matchStopped "<guest> left, so the match ended." + the lobby', async () => {
      const { rounds } = await start(s, code);
      if (!rounds[HOST]) return;
      const m = s.c[HOST].mark();
      s.c[PEER].emit('leaveMatch', { code });
      const stop = await s.expect(HOST, 'matchStopped', { since: m, what: 'guest left mid-round' });
      if (stop) s.check(stop.message === `${PEER} left, so the match ended.`, 'matchStopped.message', stop.message, `${PEER} left, so the match ended.`);
      await s.expect(HOST, 'friendLobbyUpdate', { since: m, filter: one, what: 'back to the lobby' });
    });
    await test.step('a third player leaves a live 3-player round → memberLeft to the other two; the round goes on', async () => {
      if (!await join(s, code)) return;
      if (!await join(s, code, THIRD)) return;
      await wait(3200); // RESTART_MIN_MS since the last deal
      const { rounds } = await start(s, code, [HOST, PEER, THIRD]);
      if (!rounds[HOST]) return;
      const marks = { [HOST]: s.c[HOST].mark(), [PEER]: s.c[PEER].mark() };
      s.c[THIRD].emit('leaveMatch', { code });
      for (const who of [HOST, PEER]) {
        const d = await s.expect(who, 'memberLeft', { since: marks[who], what: 'third left' });
        if (d) s.check(d.id === s.user[THIRD].id && d.username === THIRD && d.message === `${THIRD} left the match.`, `${who} ← memberLeft`, d, `{ id: ${s.user[THIRD].id}, username: ${THIRD}, message: "${THIRD} left the match." }`);
      }
      await s.absent(HOST, 'matchStopped', { since: marks[HOST], within: 500, what: 'two still seated' });
      const m = s.c[HOST].mark();
      s.c[HOST].emit('stopMatch', { code }); // back to the lobby for the next case
      await s.expect(HOST, 'friendLobbyUpdate', { since: m, what: 'stopMatch' });
    });
    await test.step('guest drops (disconnect) in the lobby → host sees it offline, then removed after the grace; on return the guest gets roomLeft', async () => {
      const m = s.c[HOST].mark();
      s.c[PEER].drop();
      try {
        const off = await s.expect(HOST, 'friendLobbyUpdate', { since: m, filter: (d) => (d.members || []).some((x) => x.id === s.user[PEER].id && x.online === false), what: 'guest offline' });
        if (!off) return;
        await s.expect(HOST, 'friendLobbyUpdate', { since: m, filter: one, timeout: 20_000, what: 'guest removed after LOBBY_GRACE_MS' });
        await s.connect(PEER);
        const left = await s.expect(PEER, 'roomLeft', { since: 0, what: 'return after the grace' });
        if (left) s.check(left.message === MSG.away, `${PEER} ← roomLeft.message`, left.message, MSG.away);
      } finally {
        if (!s.c[PEER].connected) await s.connect(PEER);
      }
    });
    await test.step('host leaveMatch mid-round → guest opponentLeft "The host closed the room."; the code is gone', async () => {
      if (!await join(s, code)) return;
      await wait(3200);
      const { rounds } = await start(s, code);
      if (!rounds[PEER]) return;
      const m = s.c[PEER].mark();
      s.c[HOST].emit('leaveMatch', { code });
      const d = await s.expect(PEER, 'opponentLeft', { since: m, what: 'host left mid-round' });
      if (d) s.check(d.message === MSG.hostClosed, 'opponentLeft.message', d.message, MSG.hostClosed);
      const m2 = s.c[PEER].mark();
      s.c[PEER].emit('joinFriendRoom', { code: String(code) });
      const e = await s.expect(PEER, 'friendJoinError', { since: m2, what: 'join the closed room' });
      if (e) s.check(e.message === MSG.noRoom, 'friendJoinError.message (closed room)', e.message, MSG.noRoom);
    });
    await test.step('host leaveMatch in the lobby → guest friendRoomCancelled "The host closed the room."', async () => {
      await Promise.all([s.c[HOST].leave(), s.c[PEER].leave()]); // whatever an earlier case left behind
      const snap2 = await create(s);
      if (!snap2 || !await join(s, snap2.code)) return;
      const m = s.c[PEER].mark();
      s.c[HOST].emit('leaveMatch', { code: snap2.code });
      const d = await s.expect(PEER, 'friendRoomCancelled', { since: m, what: 'host left the lobby' });
      if (d) s.check(d.message === MSG.hostClosed, 'friendRoomCancelled.message', d.message, MSG.hostClosed);
    });
  })(); } finally { await s.close(); }
  await lc.done();
});

test('[LC-ROOMS-10] matchmaking: cancelFind leaves no queue; findMatch ×2 → matchFound + roundData on both; scores credit points; play-again accept → matchRestart + a new round; decline → proposalDeclined', async ({ api, lc }) => {
  test.setTimeout(90_000);
  const s = await session(lc);
  try { await (async () => { // an early `return` ends the cases, never skips lc.done()
    await test.step('findMatch → searching; cancelFind → the next searcher is not paired with it', async () => {
      const m = s.c[HOST].mark();
      s.c[HOST].emit('findMatch', { game: wire(GAME) });
      const q = await s.expect(HOST, 'searching', { since: m, what: 'alone in the queue' });
      if (q) s.check(q.inQueue === 1 && q.position === 1, 'searching', q, '{ inQueue: 1, position: 1 }');
      s.c[HOST].emit('cancelFind');
      await wait(200);
    });
    const marks = { [HOST]: s.c[HOST].mark(), [PEER]: s.c[PEER].mark() };
    s.c[PEER].emit('findMatch', { game: wire(GAME) });
    const q = await s.expect(PEER, 'searching', { since: marks[PEER], what: 'after the cancel' });
    if (q) s.check(q.inQueue === 1, `${PEER} ← searching.inQueue`, String(q.inQueue), '1 (the cancelled searcher left the queue)');
    await s.absent(PEER, 'matchFound', { since: marks[PEER], within: 600, what: 'nobody else queued' });
    s.c[HOST].emit('findMatch', { game: wire(GAME) });
    const found = {};
    for (const who of [HOST, PEER]) found[who] = await s.expect(who, 'matchFound', { since: marks[who], what: 'findMatch ×2' });
    if (!found[HOST] || !found[PEER]) return;
    const code = found[HOST].code;
    // The waiting player becomes the room's host (index.js createMatchRoom(game, candidate, me)).
    s.check(found[PEER].role === 'host' && found[HOST].role === 'guest', 'matchFound.role', `${PEER} ${found[PEER].role}, ${HOST} ${found[HOST].role}`, `${PEER} host (it waited), ${HOST} guest`);
    for (const who of [HOST, PEER]) s.check(found[who].code === code && found[who].roomType === 'match' && found[who].roomSize === 2 && found[who].game && found[who].game.id === GAME.id, `${who} ← matchFound`, { code: found[who].code, roomType: found[who].roomType, game: found[who].game && found[who].game.id }, `{ code: ${code}, roomType: match, roomSize: 2, game: ${GAME.id} }`);
    const rounds = {};
    for (const who of [HOST, PEER]) { rounds[who] = await s.expect(who, 'roundData', { since: marks[who], timeout: 20_000 }); if (rounds[who]) checkRound(s, who, rounds[who], GAME.id); }
    if (!rounds[HOST] || !rounds[PEER]) return;

    await test.step('scores (waiting host 50, guest 10) → matchResult; a random match credits each score (pointsAwarded, /me/)', async () => {
      const before = { [HOST]: await points(api, 'logic.actor'), [PEER]: await points(api, 'logic.peer') };
      const score = { [PEER]: 50, [HOST]: 10 };
      const m = { [HOST]: s.c[HOST].mark(), [PEER]: s.c[PEER].mark() };
      for (const who of [PEER, HOST]) s.c[who].emit('submitScore', { code, score: score[who], elapsedMs: 25_000 });
      for (const who of [HOST, PEER]) {
        const r = await s.expect(who, 'matchResult', { since: m[who] });
        if (r) s.check(r.yourScore === score[who] && r.outcome === (who === PEER ? 'win' : 'loss'), `${who} ← matchResult`, { yourScore: r.yourScore, outcome: r.outcome }, `{ yourScore: ${score[who]}, outcome: ${who === PEER ? 'win' : 'loss'} }`);
      }
      const keyed = relayKeyed();
      for (const who of [HOST, PEER]) {
        const pa = await s.c[who].quiet('pointsAwarded', { since: m[who], within: 8000 });
        if (!pa) { (keyed ? lc.violation : lc.warn)('credit', { route: '/trivia/multiplayer-result/', selector: `${who} ← pointsAwarded`, measured: 'none within 8 s', expected: `{ awarded: ${score[who]} } (creditRoom → Django)${keyed ? '' : ' — this stack has no shared relay key'}` }); continue; }
        s.check(pa.awarded === score[who], `${who} ← pointsAwarded.awarded`, String(pa.awarded), String(score[who]));
      }
      const after = { [HOST]: await points(api, 'logic.actor'), [PEER]: await points(api, 'logic.peer') };
      if (keyed) for (const who of [HOST, PEER]) s.check(after[who] - before[who] === score[who], `${who} /me/ points`, `${before[who]} → ${after[who]}`, `+${score[who]} (the match score, credited once)`);
    });
    await test.step('proposeAgain → proposalPending / proposalReceived; accept → matchRestart + a new roundData on both', async () => {
      const m = { [HOST]: s.c[HOST].mark(), [PEER]: s.c[PEER].mark() };
      s.c[HOST].emit('proposeAgain', { code });
      const pend = await s.expect(HOST, 'proposalPending', { since: m[HOST] });
      const rec = await s.expect(PEER, 'proposalReceived', { since: m[PEER] });
      if (pend) s.check(pend.type === 'again' && pend.gameId === GAME.id, 'proposalPending', pend, `{ type: again, gameId: ${GAME.id} }`);
      if (!rec) return;
      s.check(rec.type === 'again' && rec.gameId === GAME.id && rec.fromName === shown(s, HOST), 'proposalReceived', rec, `{ type: again, gameId: ${GAME.id}, fromName: ${shown(s, HOST)} }`);
      s.c[PEER].emit('respondProposal', { code, accept: true });
      for (const who of [HOST, PEER]) {
        const r = await s.expect(who, 'matchRestart', { since: m[who] });
        if (r) s.check(r.game && r.game.id === GAME.id, `${who} ← matchRestart.game.id`, r.game && r.game.id, GAME.id);
        const rd = await s.expect(who, 'roundData', { since: m[who], timeout: 20_000, what: 'after the restart' });
        if (rd) checkRound(s, who, rd, GAME.id);
      }
    });
    await test.step('proposeAgain → decline → proposalDeclined to the proposer; no restart', async () => {
      await wait(3200); // RESTART_MIN_MS since the restart
      const m = { [HOST]: s.c[HOST].mark(), [PEER]: s.c[PEER].mark() };
      s.c[HOST].emit('proposeAgain', { code });
      if (!await s.expect(PEER, 'proposalReceived', { since: m[PEER], what: 'second proposal' })) return;
      s.c[PEER].emit('respondProposal', { code, accept: false });
      const d = await s.expect(HOST, 'proposalDeclined', { since: m[HOST] });
      if (d) s.check(d.id === s.user[PEER].id && d.username === shown(s, PEER), 'proposalDeclined', d, `{ id: ${s.user[PEER].id}, username: ${shown(s, PEER)} }`);
      await s.absent(HOST, 'matchRestart', { since: m[HOST], within: 600, what: 'declined' });
    });
    await test.step('a player leaves → the other gets opponentLeft "Your opponent left the match."', async () => {
      const m = s.c[PEER].mark();
      s.c[HOST].emit('leaveMatch', { code });
      const d = await s.expect(PEER, 'opponentLeft', { since: m });
      if (d) s.check(d.message === MSG.opponentLeft, 'opponentLeft.message', d.message, MSG.opponentLeft);
    });
  })(); } finally { await s.close(); }
  await lc.done();
});
