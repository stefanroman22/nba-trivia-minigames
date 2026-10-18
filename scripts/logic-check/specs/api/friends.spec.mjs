// Logic Check — friends suite, API, logic.actor (testuser4) ↔ logic.peer (testuser5) (spec §5 friends row): requests
// arrive, lists are symmetric, decline / cancel / remove / block / unblock do what they say, search finds the peer.
// Every action goes through the API (UI check's AC-SURF-02 only renders states seeded this way).
// Each check starts and ends with both users clean: no request either way, no friendship, no block (`reset`, verified
// in `finally` as a `cleanup` violation); the teardown sweep (logic scope) clears testuser4 ↔ testuser5 rows as well.
// Budget (authenticated throttles key by account): friend-action 60/h counts send + block → testuser4 ~9, testuser5 ~2
// per run; user-search 120/h counts search-users + search-friends → ≤ 8 per user per run; account-data 10/h → one
// `POST /account/age/` by testuser5 in -08. Accept / decline / cancel / remove / unblock / overview are unthrottled.
import { test } from '../../lib/fixtures.mjs';
import { ROLES, forgetAge, mintTokens } from '../../../check-core/lib/accounts.mjs';
import { attempt, get, post, said } from '../../lib/auth.mjs';

const ACTOR = ROLES['logic.actor'];
const PEER = ROLES['logic.peer'];
const CANT_REQUEST = "You can't send a request to this player."; // users/friends.py send_friend_request (block either way)
const errorOf = (r) => (r && r.json && typeof r.json.error === 'string' ? r.json.error : null);

/** Fresh tokens and public ids of both users. → { a, p } each { name, access, id } */
async function pair() {
  const t = await mintTokens([ACTOR, PEER]);
  const one = (name) => ({ name, access: t[name].access, id: t[name].user.id });
  return { a: one(ACTOR), p: one(PEER) };
}

const as = (api, who) => ({
  post: (path, body) => attempt(post(api, path, body, { token: who.access })),
  get: (path) => attempt(get(api, path, { token: who.access })),
});

/** friends-overview of `who` reduced to the rows about `other`: { incoming, outgoing, blocked, raw } */
async function overview(api, who, other) {
  const r = await as(api, who).get('/friends-overview/');
  const j = r.json || {};
  const pick = (k) => (Array.isArray(j[k]) ? j[k].filter((x) => x.id === other.id) : null);
  return { incoming: pick('incoming_requests'), outgoing: pick('outgoing_requests'), blocked: pick('blocked_users'), raw: r };
}

/** Is `other` in `who`'s friend list (search-friends, first 100)? → true | false | null (no answer) */
async function isFriend(api, who, other) {
  const r = await as(api, who).get('/search-friends/?limit=100&offset=0');
  if (r.status !== 200 || !r.json || !Array.isArray(r.json.results)) return null;
  return r.json.results.some((f) => f.id === other.id);
}

/** search-users as `who` → the results array, or null */
async function search(api, who, q) {
  const r = await as(api, who).get(`/search-users/?q=${encodeURIComponent(q)}`);
  return r.status === 200 && r.json && Array.isArray(r.json.results) ? r.json.results : null;
}

/** Clear every row between the two from both sides (unthrottled endpoints only). → a list of what is still there */
async function reset(api, { a, p }) {
  for (const [me, other] of [[a, p], [p, a]]) {
    const o = await overview(api, me, other);
    for (const r of o.outgoing || []) await as(api, me).post('/cancel-friend-request/', { request_id: r.request_id });
    for (const r of o.incoming || []) await as(api, me).post('/decline-friend-request/', { request_id: r.request_id });
    if ((o.blocked || []).length) await as(api, me).post('/unblock-user/', { public_id: other.id });
  }
  await as(api, a).post('/remove-friend/', { public_id: p.id }); // 200 or 404: either way no friendship is left
  const left = [];
  for (const [me, other] of [[a, p], [p, a]]) {
    const o = await overview(api, me, other);
    if (o.raw.status !== 200) { left.push(`${me.name}: overview ${said(o.raw)}`); continue; }
    if (o.outgoing.length || o.incoming.length) left.push(`${me.name}: a request with ${other.name}`);
    if (o.blocked.length) left.push(`${me.name} blocks ${other.name}`);
  }
  const again = await as(api, a).post('/remove-friend/', { public_id: p.id });
  if (again.status !== 404) left.push(`friendship: remove-friend answered ${said(again)} (404 = none)`);
  return left;
}

/** Run `body` between a reset (precondition) and a verified reset (cleanup). */
async function clean(api, lc, users, body) {
  const before = await reset(api, users);
  if (before.length) lc.violation('setup', { route: '/api/friends-overview/', selector: `${ACTOR} ↔ ${PEER} before the check`, measured: before.join('; '), expected: 'no request, friendship or block' });
  try {
    await body();
  } finally {
    const after = await reset(api, users);
    if (after.length) lc.violation('cleanup', { route: '/api/friends-overview/', selector: `${ACTOR} ↔ ${PEER} after the check`, measured: after.join('; '), expected: 'no request, friendship or block (else the sweep clears them)' });
  }
}

/** POST as `who`, expecting `status` (+ `{status: ok}` or an exact error). → the response */
async function act(api, lc, who, path, body, { status, ok, error, label }) {
  const r = await as(api, who).post(path, body);
  const route = `/api${path}`;
  const selector = `${who.name}: POST ${route} ${label || ''}`.trim();
  const expected = `HTTP ${status}${ok ? ` {"status": "${ok}"}` : ''}${error ? ` "${error}"` : ''}`;
  if (r.status !== status) lc.violation(r.status >= 500 ? 'server-error' : 'friends', { route, selector, measured: said(r), expected });
  else if (ok && (!r.json || r.json.status !== ok)) lc.violation('friends', { route, selector, measured: said(r), expected });
  else if (error && errorOf(r) !== error) lc.violation('friends', { route, selector, measured: said(r), expected });
  return r;
}

/** A sends P a request → P's incoming row (request_id), or null. */
async function sendAtoP(api, lc, { a, p }) {
  const r = await act(api, lc, a, '/send-friend-request/', { public_id: p.id }, { status: 201, ok: 'sent' });
  if (r.status !== 201) return null;
  const o = await overview(api, p, a);
  return (o.incoming || [])[0] || null;
}

/** Both sides of the friendship as the friend lists show it. */
async function expectFriends(api, lc, { a, p }, want, when) {
  for (const [me, other] of [[a, p], [p, a]]) {
    const f = await isFriend(api, me, other);
    if (f !== want) lc.violation('friends-symmetry', { route: '/api/search-friends/', selector: `${me.name}'s friends ${when}`, measured: f === null ? 'no answer' : (f ? `lists ${other.name}` : `no ${other.name}`), expected: want ? `lists ${other.name}` : `no ${other.name}` });
  }
}

/** Neither side has a pending request with the other. */
async function expectNoRequests(api, lc, { a, p }, when) {
  for (const [me, other] of [[a, p], [p, a]]) {
    const o = await overview(api, me, other);
    const n = (o.incoming || []).length + (o.outgoing || []).length;
    if (o.raw.status !== 200 || n) lc.violation('friends', { route: '/api/friends-overview/', selector: `${me.name}'s requests with ${other.name} ${when}`, measured: o.raw.status !== 200 ? said(o.raw) : `${n} row(s)`, expected: 'none' });
  }
}

test('[LC-FRIENDS-01] send: 201 sent; the request is in the peer\'s incoming and the actor\'s outgoing (same request id); a second send → 409', async ({ api, lc }) => {
  const users = await pair();
  const { a, p } = users;
  await clean(api, lc, users, async () => {
    let inc = null;
    await test.step(`${ACTOR} sends ${PEER} a request → 201`, async () => { inc = await sendAtoP(api, lc, users); });
    await test.step('peer incoming + actor outgoing, same request id', async () => {
      const po = await overview(api, p, a);
      const ao = await overview(api, a, p);
      if (!inc || inc.username !== ACTOR) lc.violation('friends', { route: '/api/friends-overview/', selector: `${PEER}'s incoming_requests`, measured: JSON.stringify(po.incoming).slice(0, 120), expected: `one row { id: ${a.id}, username: ${ACTOR}, request_id }` });
      const out = (ao.outgoing || [])[0];
      if (!out || out.username !== PEER) lc.violation('friends', { route: '/api/friends-overview/', selector: `${ACTOR}'s outgoing_requests`, measured: JSON.stringify(ao.outgoing).slice(0, 120), expected: `one row { id: ${p.id}, username: ${PEER} }` });
      if (inc && out && inc.request_id !== out.request_id) lc.violation('friends', { route: '/api/friends-overview/', selector: 'request_id', measured: `incoming ${inc.request_id}, outgoing ${out.request_id}`, expected: 'the same request on both sides' });
      if ((ao.incoming || []).length || (po.outgoing || []).length) lc.violation('friends', { route: '/api/friends-overview/', selector: 'the reverse direction', measured: `${ACTOR} incoming ${(ao.incoming || []).length}, ${PEER} outgoing ${(po.outgoing || []).length}`, expected: '0 and 0' });
      await expectFriends(api, lc, users, false, 'while pending');
    });
    await test.step('a second send → 409 "Request already sent."', async () => {
      await act(api, lc, a, '/send-friend-request/', { public_id: p.id }, { status: 409, error: 'Request already sent.', label: '(again)' });
    });
  });
  await lc.done();
});

test('[LC-FRIENDS-02] accept: the receiver accepts → 200 accepted; both friend lists list each other; no request is left', async ({ api, lc }) => {
  const users = await pair();
  await clean(api, lc, users, async () => {
    const inc = await sendAtoP(api, lc, users);
    if (!inc) return;
    await test.step(`${PEER} accepts → 200`, async () => {
      await act(api, lc, users.p, '/accept-friend-request/', { request_id: inc.request_id }, { status: 200, ok: 'accepted' });
    });
    await test.step('both lists symmetric, no pending request', async () => {
      await expectFriends(api, lc, users, true, 'after accept');
      await expectNoRequests(api, lc, users, 'after accept');
    });
  });
  await lc.done();
});

test('[LC-FRIENDS-03] decline: only the receiver can decline (sender → 404); decline → 200 declined; the request is gone from both, no friendship', async ({ api, lc }) => {
  const users = await pair();
  await clean(api, lc, users, async () => {
    const inc = await sendAtoP(api, lc, users);
    if (!inc) return;
    await test.step('the sender cannot decline it → 404', async () => {
      await act(api, lc, users.a, '/decline-friend-request/', { request_id: inc.request_id }, { status: 404, error: 'Request not found.', label: '(as sender)' });
    });
    await test.step(`${PEER} declines → 200; gone from both`, async () => {
      await act(api, lc, users.p, '/decline-friend-request/', { request_id: inc.request_id }, { status: 200, ok: 'declined' });
      await expectNoRequests(api, lc, users, 'after decline');
      await expectFriends(api, lc, users, false, 'after decline');
    });
  });
  await lc.done();
});

test('[LC-FRIENDS-04] cancel: only the sender can cancel (receiver → 404); cancel → 200 cancelled; the request is gone from both', async ({ api, lc }) => {
  const users = await pair();
  await clean(api, lc, users, async () => {
    const inc = await sendAtoP(api, lc, users);
    if (!inc) return;
    await test.step('the receiver cannot cancel it → 404', async () => {
      await act(api, lc, users.p, '/cancel-friend-request/', { request_id: inc.request_id }, { status: 404, error: 'Request not found.', label: '(as receiver)' });
    });
    await test.step(`${ACTOR} cancels → 200; gone from both`, async () => {
      await act(api, lc, users.a, '/cancel-friend-request/', { request_id: inc.request_id }, { status: 200, ok: 'cancelled' });
      await expectNoRequests(api, lc, users, 'after cancel');
    });
  });
  await lc.done();
});

test('[LC-FRIENDS-05] remove friend: 200 removed; gone from both friend lists; removing again → 404', async ({ api, lc }) => {
  const users = await pair();
  await clean(api, lc, users, async () => {
    const inc = await sendAtoP(api, lc, users);
    if (!inc) return;
    const acc = await act(api, lc, users.p, '/accept-friend-request/', { request_id: inc.request_id }, { status: 200, ok: 'accepted', label: '(setup)' });
    if (acc.status !== 200) return;
    await test.step(`${ACTOR} removes ${PEER} → 200; both lists without each other`, async () => {
      await act(api, lc, users.a, '/remove-friend/', { public_id: users.p.id }, { status: 200, ok: 'removed' });
      await expectFriends(api, lc, users, false, 'after remove');
    });
    await test.step('remove again → 404', async () => {
      await act(api, lc, users.p, '/remove-friend/', { public_id: users.a.id }, { status: 404, error: "You're not friends with this player.", label: '(again, other side)' });
    });
  });
  await lc.done();
});

test('[LC-FRIENDS-06] block: ends the friendship; the blocked player\'s request → 403 (and the blocker\'s); search hides each from the other; the block is listed', async ({ api, lc }) => {
  const users = await pair();
  const { a, p } = users;
  await clean(api, lc, users, async () => {
    await test.step('setup: friends', async () => {
      const inc = await sendAtoP(api, lc, users);
      if (inc) await act(api, lc, p, '/accept-friend-request/', { request_id: inc.request_id }, { status: 200, ok: 'accepted', label: '(setup)' });
    });
    await test.step(`${ACTOR} blocks ${PEER} → 200 blocked; friendship gone; listed in blocked_users`, async () => {
      await act(api, lc, a, '/block-user/', { public_id: p.id }, { status: 200, ok: 'blocked' });
      await expectFriends(api, lc, users, false, 'after block');
      const o = await overview(api, a, p);
      if (!o.blocked || o.blocked.length !== 1) lc.violation('block', { route: '/api/friends-overview/', selector: `${ACTOR}'s blocked_users`, measured: JSON.stringify(o.blocked).slice(0, 120), expected: `one row { id: ${p.id} }` });
      const po = await overview(api, p, a);
      if ((po.blocked || []).length) lc.violation('block', { route: '/api/friends-overview/', selector: `${PEER}'s blocked_users`, measured: `lists ${ACTOR}`, expected: 'empty (the block is one-way)' });
    });
    await test.step('the blocked player sends → 403; the blocker sends → 403', async () => {
      await act(api, lc, p, '/send-friend-request/', { public_id: a.id }, { status: 403, error: CANT_REQUEST, label: '(blocked side)' });
      await act(api, lc, a, '/send-friend-request/', { public_id: p.id }, { status: 403, error: CANT_REQUEST, label: '(blocker side)' });
      await expectNoRequests(api, lc, users, 'after the refused sends');
    });
    await test.step('search by player id hides each from the other (both directions)', async () => {
      const fromA = await search(api, a, p.id);
      const fromP = await search(api, p, a.id);
      if (fromA === null || fromA.some((x) => x.id === p.id)) lc.violation('block', { route: '/api/search-users/', selector: `${ACTOR} searches ${PEER}'s id`, measured: fromA === null ? 'no answer' : `${PEER} listed`, expected: `${PEER} hidden (users/friends.py: blocked either way is omitted)` });
      if (fromP === null || fromP.some((x) => x.id === a.id)) lc.violation('block', { route: '/api/search-users/', selector: `${PEER} searches ${ACTOR}'s id`, measured: fromP === null ? 'no answer' : `${ACTOR} listed`, expected: `${ACTOR} hidden` });
    });
  });
  await lc.done();
});

test('[LC-FRIENDS-07] unblock: 200 unblocked, no longer listed; a request is possible again (201); unblocking again → 404', async ({ api, lc }) => {
  const users = await pair();
  const { a, p } = users;
  await clean(api, lc, users, async () => {
    const b = await act(api, lc, a, '/block-user/', { public_id: p.id }, { status: 200, ok: 'blocked', label: '(setup)' });
    if (b.status !== 200) return;
    await test.step(`${ACTOR} unblocks ${PEER} → 200; not listed`, async () => {
      await act(api, lc, a, '/unblock-user/', { public_id: p.id }, { status: 200, ok: 'unblocked' });
      const o = await overview(api, a, p);
      if (!o.blocked || o.blocked.length) lc.violation('block', { route: '/api/friends-overview/', selector: `${ACTOR}'s blocked_users after unblock`, measured: JSON.stringify(o.blocked).slice(0, 120), expected: 'no row for the peer' });
    });
    await test.step(`${PEER} can send again → 201, it arrives`, async () => {
      await act(api, lc, p, '/send-friend-request/', { public_id: a.id }, { status: 201, ok: 'sent', label: '(after unblock)' });
      const o = await overview(api, a, p);
      if (!o.incoming || o.incoming.length !== 1) lc.violation('friends', { route: '/api/friends-overview/', selector: `${ACTOR}'s incoming after unblock`, measured: JSON.stringify(o.incoming).slice(0, 120), expected: `one row from ${PEER}` });
    });
    await test.step('unblock again → 404', async () => {
      await act(api, lc, a, '/unblock-user/', { public_id: p.id }, { status: 404, error: "You haven't blocked this player.", label: '(again)' });
    });
  });
  await lc.done();
});

test('[LC-FRIENDS-08] search: by player id (also "#id") finds the peer with relationship none; by name too, whether the peer\'s age is unknown or adult; one character → empty', async ({ api, lc }) => {
  const users = await pair();
  const { a, p } = users;
  const route = '/api/search-users/';
  const found = (rows) => (rows || []).find((x) => x.id === p.id);
  await forgetAge([PEER]); // minted accounts start with the age unknown; make sure
  try {
    await clean(api, lc, users, async () => {
      await test.step('by player id and "#id" → the peer, relationship none', async () => {
        for (const q of [p.id, `#${p.id}`, p.id.toLowerCase()]) {
          const rows = await search(api, a, q);
          const row = found(rows);
          if (!row || row.username !== PEER || row.relationship !== 'none') lc.violation('search', { route, selector: `q=${q}`, measured: rows === null ? 'no answer' : JSON.stringify(row || rows.map((x) => x.id)).slice(0, 120), expected: `{ id: ${p.id}, username: ${PEER}, relationship: "none" }` });
        }
      });
      await test.step('by name while the peer\'s age is unknown → listed (age plays no part since 2026-10-19)', async () => {
        const rows = await search(api, a, PEER);
        const row = found(rows);
        if (!row || row.relationship !== 'none') lc.violation('search', { route, selector: `q=${PEER} (age unknown)`, measured: rows === null ? 'no answer' : `${PEER} not listed`, expected: `{ id: ${p.id}, username: ${PEER}, relationship: "none" }: every player is findable by name, whatever their age (users/friends.py search_users)` });
      });
      await test.step('the peer gives an adult age → by name → listed', async () => {
        const r = await as(api, p).post('/account/age/', { birth_month: 1, birth_year: new Date().getFullYear() - 30 });
        if (r.status !== 200) { lc.violation('setup', { route: '/api/account/age/', selector: `${PEER} adult`, measured: said(r), expected: 'HTTP 200' }); return; }
        const rows = await search(api, a, PEER);
        const row = found(rows);
        if (!row || row.relationship !== 'none') lc.violation('search', { route, selector: `q=${PEER} (adult)`, measured: rows === null ? 'no answer' : JSON.stringify(row || rows.map((x) => x.username)).slice(0, 120), expected: `{ id: ${p.id}, username: ${PEER}, relationship: "none" }` });      });
      await test.step('a one-character query → empty results', async () => {
        const rows = await search(api, a, 't');
        if (rows === null || rows.length) lc.violation('search', { route, selector: 'q=t', measured: rows === null ? 'no answer' : `${rows.length} row(s)`, expected: '[] (MIN_SEARCH_LEN 2)' });
      });
    });
  } finally {
    await forgetAge([PEER]).catch((e) => lc.violation('cleanup', { route: '/api/account/age/', selector: `forget ${PEER}'s age`, measured: String(e.message).split('\n')[0], expected: 'age unknown again (else the sweep resets it)' }));
  }
  await lc.done();
});
