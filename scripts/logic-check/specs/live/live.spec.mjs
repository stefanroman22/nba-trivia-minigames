// Logic Check — live suite (L1, spec §5): the live site and its origins, guest only, GET/HEAD only (the api fixture's
// guard refuses anything else before it leaves the machine). Every request is a plain HTTP GET from node; no browser.
// Origins come from the app's .env.production (lib/app.mjs prodEnv), the routes and games from its catalogue.
// Each check collects every problem it sees (lc.violation) and fails once at lc.done(), so one run lists them all.
import { test, expect } from '../../lib/fixtures.mjs';
import { NOT_FOUND_ROUTE, backendOrigin, googleClientId, poolGames, prodEnv, publicRoutes } from '../../lib/app.mjs';
import { visibleGames } from '../../../ui-check/lib/games-catalog.mjs';

const TTFB_BUDGET = 800;
const GIS_SCRIPT = 'https://accounts.google.com/gsi/client';
// Google answers 403 to non-browser user agents (node's fetch); the two Google requests identify as the browser they
// stand in for.
const BROWSER_UA = { 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36' };
const env = prodEnv();
const DATA_BASE = env.VITE_DATA_BASE;
const QUESTIONS_BASE = env.VITE_QUESTIONS_BASE;
const SOCKET_URL = env.VITE_SOCKET_URL;

const abs = (baseURL, route) => new URL(route, baseURL).href;
const short = (s, n = 120) => { s = String(s ?? '').replace(/\s+/g, ' ').trim(); return s.length > n ? `${s.slice(0, n)}…` : s; };
const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
/** LC-LIVE-03's per-game violation note: the service a failing game maps to (Task 6 blocks `games.<id>` from it). */
const gameNote = (game) => `service games.${game.id}`;

/** The app shell in a server-rendered HTML document: no Next error page, a <title>, the Next client scripts. */
function shellProblems(text) {
  const out = [];
  if (/<html[^>]*id="__next_error__"/.test(text)) out.push('Next error page (__next_error__)');
  if (!/<title>[^<]+<\/title>/.test(text)) out.push('no <title>');
  if (!/<script[^>]+src="[^"]*\/_next\/static\//.test(text)) out.push('no /_next/static/ script');
  return out;
}

/** GET a JSON document; a non-200 or non-JSON body is a violation (→ null). */
async function getJson(api, lc, url, { route, what, note }) {
  let r;
  try { r = await api.get(url); } catch (e) { lc.violation('unreachable', { route, note, selector: `GET ${url.split('?')[0]}`, measured: short(e.message), expected: `${what} answers` }); return null; }
  if (r.status !== 200 || r.json === null) {
    lc.violation('http', { route, note, selector: `GET ${url.split('?')[0]}`, measured: `HTTP ${r.status}${r.json === null ? ', not JSON' : ''}`, expected: `200 JSON (${what})` });
    return null;
  }
  return r.json;
}

test('[LC-LIVE-01] every public route answers 200 with the app shell; an unknown route answers 404', async ({ api, lc, baseURL }) => {
  const want = [...publicRoutes().map((route) => ({ route, status: 200 })), { route: NOT_FOUND_ROUTE, status: 404 }];
  for (const { route, status } of want) {
    await test.step(`${route} → ${status}`, async () => {
      let r;
      try { r = await api.get(abs(baseURL, route), { headers: { accept: 'text/html' } }); } catch (e) {
        lc.violation('unreachable', { route, selector: `GET ${route}`, measured: short(e.message), expected: `HTTP ${status}` });
        return;
      }
      if (r.status !== status) lc.violation('http-status', { route, selector: `GET ${route}`, measured: `HTTP ${r.status}`, expected: `HTTP ${status}` });
      if (!/text\/html/.test(r.headers['content-type'] || '')) lc.violation('shell', { route, selector: `GET ${route}`, measured: `content-type ${r.headers['content-type'] || '(none)'}`, expected: 'text/html' });
      for (const p of shellProblems(r.text)) lc.violation('shell', { route, selector: 'document', measured: p, expected: 'the server-rendered app shell' });
    });
  }
  await lc.done();
});

test('[LC-LIVE-02] the API health endpoint answers ok', async ({ api, lc }) => {
  const url = `${api.base}/health/`;
  const r = await api.get(url).catch((e) => ({ error: e }));
  if (r.error) lc.violation('unreachable', { route: '/api/health/', selector: `GET ${url}`, measured: short(r.error.message), expected: '200 {"ok": true}' });
  else {
    lc.metric('health', r.ms, { route: '/api/health/' });
    if (r.status !== 200 || !r.json || r.json.ok !== true) lc.violation('health', { route: '/api/health/', selector: `GET ${url}`, measured: `HTTP ${r.status} ${short(r.text, 80)}`, expected: '200 {"ok": true}' });
  }
  await lc.done();
});

test('[LC-LIVE-03] every visible game\'s data source loads with its shape and a non-empty pool', async ({ api, lc, baseURL }) => {
  const pools = poolGames();
  let v3 = null, bundled = null, store = null; // manifests, fetched once
  const v3Manifest = async () => (v3 ??= await getJson(api, lc, `${DATA_BASE}/manifest.json`, { route: '/', what: 'the v3 data manifest' }) || false);
  const bundledManifest = async () => (bundled ??= await getJson(api, lc, abs(baseURL, '/data/manifest.json'), { route: '/data/', what: 'the bundled data manifest' }) || false);
  const storeManifest = async () => (store ??= await getJson(api, lc, `${QUESTIONS_BASE}/questions/manifest.json`, { route: '/', what: 'the questions store manifest' }) || false);
  const bad = (game, selector, measured, expected) => lc.violation('game-data', { route: game.path, note: gameNote(game), selector, measured, expected });

  /** v3 pool game: manifest entry → its rows file (single, or the first chunk) and lookups; rows expand. */
  async function v3Pool(game, key) {
    const m = await v3Manifest();
    if (!m) return;
    const entry = m.games && m.games[key];
    if (!isObj(entry)) return bad(game, `v3 manifest games.${key}`, 'missing', `a published "${key}" entry (POOL_GAMES)`);
    const file = entry.kind === 'single' ? entry.file : entry.kind === 'chunked' ? (entry.chunks || [])[0] : null;
    if (!file) return bad(game, `v3 manifest games.${key}`, `kind ${entry.kind}, no file/chunks`, 'kind single with a file or chunked with chunks');
    const rows = await getJson(api, lc, `${DATA_BASE}/${file}`, { route: game.path, note: gameNote(game), what: `${key} rows` });
    if (!rows) return;
    if (!Array.isArray(rows) || !rows.length) return bad(game, `GET ${file}`, Array.isArray(rows) ? 'empty array' : typeof rows, 'a non-empty JSON array');
    if (!rows.every(isObj)) bad(game, `GET ${file}`, 'a row is not an object', 'rows of objects');
    const lookups = {};
    for (const [name, p] of Object.entries(entry.lookups || {})) {
      const l = await getJson(api, lc, `${DATA_BASE}/${p}`, { route: game.path, note: gameNote(game), what: `${key} lookup ${name}` });
      if (l && !Array.isArray(l)) bad(game, `GET ${p}`, typeof l, 'a JSON array');
      lookups[name] = Array.isArray(l) ? l : [];
    }
    for (const row of rows.slice(0, 20)) {
      for (const [k, v] of Object.entries(row)) {
        const at = k.indexOf('@');
        if (at < 0) continue;
        const name = k.slice(at + 1);
        if (!isObj((lookups[name] || [])[v])) { bad(game, `${file} ${k}`, `lookup ${name}[${v}] missing`, 'every encoded key resolves (gameData.ts expand)'); return; }
      }
    }
    lc.metric(`rows ${key}`, rows.length, { unit: '', route: game.path, kind: 'data' });
  }

  /** A pool only the bundled /data copy serves: /data/manifest.json lists it, /data/<key>.json holds that many rows. */
  async function bundledPool(game, key) {
    const m = await bundledManifest();
    if (!m) return;
    const entry = m.games && m.games[key];
    if (!isObj(entry)) return bad(game, `/data/manifest.json games.${key}`, 'missing', `a "${key}" entry`);
    const body = await getJson(api, lc, abs(baseURL, `/data/${entry.file || `${key}.json`}`), { route: game.path, note: gameNote(game), what: `${key} pool` });
    if (!body) return;
    const pool = Array.isArray(body) ? body : body.pool;
    if (!Array.isArray(pool) || !pool.length) return bad(game, `GET /data/${key}.json`, 'no rows', 'a non-empty pool');
    if (Number.isInteger(entry.count) && entry.count !== pool.length) bad(game, `GET /data/${key}.json`, `${pool.length} rows`, `${entry.count} rows (manifest count)`);
  }

  /** A question game: v3 index → one question file when the data host publishes it, else the questions store. */
  async function question(game, key) {
    const m = await v3Manifest();
    const entry = m && m.games && m.games[key];
    if (isObj(entry) && entry.kind === 'questions' && entry.index) {
      const index = await getJson(api, lc, `${DATA_BASE}/${entry.index}`, { route: game.path, note: gameNote(game), what: `${key} question index` });
      if (!index) return;
      if (!Array.isArray(index.items) || !index.items.length || !isObj(index.files)) return bad(game, `GET ${entry.index}`, 'no items / files', 'items[] non-empty and a files map');
      const qid = String(index.items[0][0]);
      const sha = index.files[qid];
      if (!sha) return bad(game, `GET ${entry.index}`, `item ${qid} has no file`, 'every item listed in files');
      const q = await getJson(api, lc, `${DATA_BASE}/${key}/${qid}.${sha}.json`, { route: game.path, note: gameNote(game), what: `${key} question ${qid}` });
      if (q && (!isObj(q) || q.qid !== qid)) bad(game, `GET ${key}/${qid}.${sha}.json`, `qid ${isObj(q) ? q.qid : typeof q}`, `a question object with qid ${qid}`);
      return;
    }
    const s = await storeManifest();
    if (!s) return;
    const g = s.games && s.games[key];
    if (!isObj(g) || !g.index) return bad(game, `questions store manifest games.${key}`, 'missing', `"${key}" published on the data host or in the questions store`);
    const index = await getJson(api, lc, g.index, { route: game.path, note: gameNote(game), what: `${key} question index` });
    if (!index) return;
    if (!Array.isArray(index.items) || !index.items.length) return bad(game, `GET ${key}/index.json`, 'no items', 'items[] non-empty');
    const qid = String(index.items[0][0]);
    const q = await getJson(api, lc, g.index.replace(/index\.json$/, `${qid}.json`), { route: game.path, note: gameNote(game), what: `${key} question ${qid}` });
    if (q && (!isObj(q) || String(q.qid) !== qid)) bad(game, `GET ${key}/${qid}.json`, 'wrong question', `a question object with qid ${qid}`);
  }

  /** Wordle: the daily-play POST is not allowed live; its read-only status endpoint answers. */
  async function wordle(game) {
    const url = `${backendOrigin(api.base)}/trivia/wordle/daily-status/?device_id=logic-check-live-probe`;
    const j = await getJson(api, lc, url, { route: game.path, note: gameNote(game), what: 'the Wordle daily status' });
    if (j && (typeof j.locked !== 'boolean' || Number.isNaN(Date.parse(j.next_reset_at)))) bad(game, 'GET /trivia/wordle/daily-status/', short(JSON.stringify(j), 80), '{ locked: boolean, next_reset_at: ISO date }');
  }

  const games = visibleGames();
  expect(games.length, 'visible games in the catalogue').toBeGreaterThan(0);
  for (const game of games) {
    await test.step(`${game.id} (${game.data ? `${game.data.fn}(${game.data.key ?? ''})` : 'no fetchData'})`, async () => {
      const d = game.data;
      if (!d || (d.fn === 'fetchGameData' && !d.key)) return; // coming-soon: no data
      if (d.fn === 'fetchGamePool' || d.fn === 'fetchWholePool') {
        if (pools.has(d.key) && DATA_BASE) await v3Pool(game, d.key); else await bundledPool(game, d.key);
      } else if (d.fn === 'fetchQuestion') await question(game, d.key);
      else if (d.fn === 'playWordleDaily') await wordle(game);
      else if (d.fn === 'playContextoDaily') await question(game, 'contexto'); // the daily gate names the day; the data is the contexto questions
      else bad(game, `fetchData ${d.fn}`, 'unknown data source', 'a source LC-LIVE-03 knows (pool, question, wordle) — teach it the new one');
    });
  }
  await lc.done();
});

test('[LC-LIVE-04] the public leaderboard is consistent: unique players, points non-increasing with rank, total ≥ rows', async ({ api, lc }) => {
  const route = '/api/get-users/';
  const j = await getJson(api, lc, `${api.base}/get-users/`, { route, what: 'the public leaderboard' });
  if (j) {
    const rows = j.top_100_users;
    const v = (selector, measured, expected) => lc.violation('leaderboard', { route, selector, measured, expected });
    if (!Array.isArray(rows)) v('top_100_users', typeof rows, 'an array');
    else {
      if (rows.length > 100) v('top_100_users', `${rows.length} rows`, '≤ 100 rows');
      const ids = new Set();
      rows.forEach((r, i) => {
        const rank = i + 1; // the endpoint has no rank field: a row's rank is its position
        if (!isObj(r) || typeof r.id !== 'string' || !r.id || typeof r.username !== 'string' || !Number.isInteger(r.points) || r.points < 0) {
          v(`top_100_users[${i}]`, short(JSON.stringify(r), 80), '{ id: string, username: string, points: integer ≥ 0 }');
          return;
        }
        if (ids.has(r.id)) v(`top_100_users[${i}].id`, `player ${r.id} listed twice (rank ${rank})`, 'each player once, ranks unique');
        ids.add(r.id);
        if (i && Number.isInteger(rows[i - 1].points) && r.points > rows[i - 1].points) v(`top_100_users[${i}].points`, `rank ${rank} has ${r.points} > rank ${rank - 1}'s ${rows[i - 1].points}`, 'points non-increasing as the rank grows');
      });
      if (!Number.isInteger(j.number_users) || j.number_users < rows.length) v('number_users', String(j.number_users), `an integer ≥ ${rows.length} (the rows shown)`);
      lc.metric('leaderboard rows', rows.length, { unit: '', route, kind: 'data' });
    }
    if (j.user_rank !== null && j.user_rank !== undefined) v('user_rank', String(j.user_rank), 'null for a guest (no "your rank" without a session)');
  }
  await lc.done();
});

test('[LC-LIVE-05] Google sign-in: the GIS script loads, the shipped client id is the app\'s and Google accepts it', async ({ api, lc, baseURL }) => {
  const route = '/';
  const gis = await api.get(GIS_SCRIPT, { headers: { ...BROWSER_UA, accept: '*/*' } }).catch((e) => ({ error: e }));
  if (gis.error || gis.status !== 200 || !/javascript/.test(gis.headers['content-type'] || '') || gis.text.length < 10_000) {
    lc.violation('google', { route, selector: `GET ${GIS_SCRIPT}`, measured: gis.error ? short(gis.error.message) : `HTTP ${gis.status}, ${gis.headers['content-type']}, ${gis.text.length} bytes`, expected: '200 JavaScript (the Google Identity Services client)' });
  }
  const clientId = googleClientId();
  if (!clientId) lc.violation('google', { route, selector: 'src/components/LogInSignUp.tsx GoogleOAuthProvider clientId', measured: 'no client id found', expected: 'a <digits>-<id>.apps.googleusercontent.com client id' });
  else {
    // Shipped: the landing page's own JS chunks carry the id (GoogleOAuthProvider is in the landing bundle).
    const home = await api.get(abs(baseURL, '/'), { headers: { accept: 'text/html' } }).catch(() => null);
    const chunks = home ? [...new Set([...home.text.matchAll(/<script[^>]+src="([^"]*\/_next\/static\/[^"]+\.js)"/g)].map((m) => m[1]))].slice(0, 40) : [];
    let shipped = false;
    for (const c of chunks) {
      const r = await api.get(abs(baseURL, c)).catch(() => null);
      if (r && r.text.includes(clientId)) { shipped = true; break; }
    }
    if (!shipped) lc.violation('google', { route, selector: `landing JS (${chunks.length} chunks)`, measured: `client id ${clientId} not found`, expected: 'the client id from the source shipped in the landing bundle' });
    // Google knows the client and the site origin: a valid one redirects to sign-in, an unknown one to /signin/oauth/error.
    const q = new URLSearchParams({ client_id: clientId, response_type: 'code', scope: 'openid email', redirect_uri: 'postmessage', origin: new URL(baseURL).origin, prompt: 'select_account' });
    const auth = await api.get(`https://accounts.google.com/o/oauth2/v2/auth?${q}`, { redirect: 'manual', headers: { ...BROWSER_UA, accept: 'text/html' } }).catch((e) => ({ error: e }));
    const loc = auth.headers ? auth.headers.location || '' : '';
    if (auth.error || (auth.status === 302 && /\/signin\/oauth\/error/.test(loc))) {
      lc.violation('google', { route, selector: 'GET accounts.google.com/o/oauth2/v2/auth', measured: auth.error ? short(auth.error.message) : `redirect to ${short(loc.split('&')[0], 90)}`, expected: 'Google accepts the client id for this origin (redirect to sign-in)' });
    } else if (auth.status !== 302) {
      lc.warn('google-probe', { route, selector: 'GET accounts.google.com/o/oauth2/v2/auth', measured: `HTTP ${auth.status}`, expected: '302 (inconclusive: Google answered something else)' });
    }
  }
  await lc.done();
});

test('[LC-LIVE-06] the relay answers a socket.io handshake', async ({ api, lc }) => {
  const route = '/socket.io/';
  if (!SOCKET_URL) lc.violation('relay', { route, selector: '.env.production VITE_SOCKET_URL', measured: 'unset', expected: 'the relay origin' });
  else {
    const url = `${SOCKET_URL}/socket.io/?EIO=4&transport=polling`;
    const r = await api.get(url, { headers: { accept: '*/*' } }).catch((e) => ({ error: e }));
    let open = null;
    try { open = r.text && r.text.startsWith('0') ? JSON.parse(r.text.slice(1)) : null; } catch { /* not an open packet */ }
    if (r.error || r.status !== 200 || !isObj(open) || typeof open.sid !== 'string' || !Number.isFinite(open.pingInterval)) {
      lc.violation('relay', { route, selector: `GET ${url}`, measured: r.error ? short(r.error.message) : `HTTP ${r.status} ${short(r.text, 80)}`, expected: '200 with an Engine.IO open packet 0{"sid",…,"pingInterval"}' });
    } else lc.metric('relay handshake', r.ms, { route });
  }
  await lc.done();
});

test('[LC-LIVE-07] every public route\'s TTFB is within budget', async ({ api, lc, baseURL }) => {
  await api.get(abs(baseURL, '/'), { headers: { accept: 'text/html' } }).catch(() => null); // warm the connection
  for (const route of [...publicRoutes(), NOT_FOUND_ROUTE]) {
    await test.step(route, async () => {
      const once = () => api.get(abs(baseURL, route), { headers: { accept: 'text/html' } }).then((r) => r.ms, () => null);
      let ms = await once();
      if (ms === null || ms > TTFB_BUDGET) { const again = await once(); if (again !== null && (ms === null || again < ms)) ms = again; } // one retry: a jitter is not a regression
      if (ms === null) { lc.violation('unreachable', { route, selector: `GET ${route}`, measured: 'no response', expected: 'an answer' }); return; }
      lc.metric(`ttfb ${route}`, ms, { route, budget: TTFB_BUDGET, kind: 'perf' });
      if (ms > TTFB_BUDGET) lc.violation('ttfb', { route, selector: `GET ${route}`, measured: `TTFB ${ms}ms (best of 2)`, expected: `≤ ${TTFB_BUDGET}ms` });
    });
  }
  await lc.done();
});
