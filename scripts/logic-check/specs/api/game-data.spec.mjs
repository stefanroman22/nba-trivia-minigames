// Logic Check — game-data suite, API (spec §5 game-data row): every visible game's data loads with its shape (the sources
// derived from the catalogue's `fetchData`, ui-check lib/games-catalog.mjs), `log-session` credits exactly the score it
// reports, the logged-in leaderboard rank agrees with the points (LC-LIVE-04's local equivalent), and the Wordle daily gate.
// Plays as logic.actor (testuser4, minted tokens); Wordle as its own lgc throwaway with a fresh device id. Guest requests
// go out as fresh simulated clients (lib/auth.mjs clientIp → X-Forwarded-For). Budgets: score-submit 60/h is keyed per
// account for logic.actor (6 log-session POSTs a run); wordle-play 20/h per throwaway account (3) and per simulated guest (1).
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test, expect } from '../../lib/fixtures.mjs';
import { backendOrigin, poolGames, prodEnv } from '../../lib/app.mjs';
import { attempt, clientIp, deleteAccount, said, throwawayName } from '../../lib/auth.mjs';
import { visibleGames } from '../../../ui-check/lib/games-catalog.mjs';
import { appRepo, djangoEnv, venvPython } from '../../../ui-check/lib/stack.mjs';
import { ROLES, credentials, mintTokens } from '../../../check-core/lib/accounts.mjs';

const ACTOR = ROLES['logic.actor'];
const env = prodEnv();
const DATA_BASE = env.VITE_DATA_BASE; // the v3 data host the build bakes in (the local build reads it too)
const QUESTIONS_BASE = env.VITE_QUESTIONS_BASE;
const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const short = (s, n = 100) => { s = String(s ?? '').replace(/\s+/g, ' ').trim(); return s.length > n ? `${s.slice(0, n)}…` : s; };
// A row's identity: the first of these keys every row of the pool carries (playoff match_id, name-logo team_id, mvps
// season, starting-five game_id, fan-favorites / who-would-win qid, players-index person_id).
const ID_KEYS = ['qid', 'id', 'person_id', 'match_id', 'game_id', 'team_id', 'season'];

const readApp = (rel) => { try { return readFileSync(path.join(appRepo(), rel), 'utf8'); } catch { return ''; } };

/** Rows' shape problems: not a non-empty array of objects, or a duplicate id. → { problems: [], idKey } */
function rowProblems(rows) {
  if (!Array.isArray(rows)) return { problems: [`${typeof rows}, not an array`] };
  if (!rows.length) return { problems: ['an empty pool'] };
  if (!rows.every(isObj)) return { problems: ['a row is not an object'] };
  const idKey = ID_KEYS.find((k) => rows.every((r) => r[k] !== undefined && r[k] !== null));
  if (!idKey) return { problems: [] };
  const seen = new Set();
  const dups = [];
  for (const r of rows) { const k = JSON.stringify(r[idKey]); if (seen.has(k)) dups.push(k); seen.add(k); }
  return { problems: dups.length ? [`${dups.length} duplicate ${idKey}(s), e.g. ${short(dups[0], 40)}`] : [], idKey };
}

/** The account rank names by points, parsed from backend/users/models.py update_rank (highest threshold first). */
function rankTiers() {
  const src = readApp('backend/users/models.py');
  const body = /def update_rank\(self\):([\s\S]*?)\n\s*else:\s*\n\s*self\.rank = "([^"]+)"/.exec(src);
  if (!body) return null;
  const tiers = [...body[1].matchAll(/self\.points >= (\d+):\s*\n\s*self\.rank = "([^"]+)"/g)].map((m) => ({ min: Number(m[1]), name: m[2] }));
  return { tiers, base: body[2] };
}
/** log-session's score caps from backend/trivia/views.py → { max, perGame: { id: cap } } or null. */
function sessionCaps() {
  const src = readApp('backend/trivia/views.py');
  const max = /^MAX_SESSION_POINTS\s*=\s*(\d+)/m.exec(src);
  const per = /^PER_GAME_MAX_POINTS\s*=\s*\{([^}]*)\}/m.exec(src);
  if (!max || !per) return null;
  return { max: Number(max[1]), perGame: Object.fromEntries([...per[1].matchAll(/"([^"]+)"\s*:\s*(\d+)/g)].map((m) => [m[1], Number(m[2])])) };
}
const tierOf = (t, points) => (t ? (t.tiers.find((x) => points >= x.min)?.name ?? t.base) : null);

test('[LC-GAMEDATA-01] every visible game\'s data sources load: JSON, expected shape, non-empty pool, no duplicate ids', async ({ api, lc, baseURL }) => {
  const origin = backendOrigin(api.base);
  const pools = poolGames();
  const cache = new Map();
  /** GET JSON once per URL; a non-200 / non-JSON answer is a violation for `game` (→ null). */
  const json = async (game, url, what) => {
    if (cache.has(url)) return cache.get(url);
    let r;
    try { r = await api.get(url); } catch (e) { r = { status: 0, json: null, text: e.message }; }
    const ok = r.status === 200 && r.json !== null;
    if (!ok) lc.violation(r.status >= 500 ? 'server-error' : 'game-data', { route: game.path, note: `service games.${game.id}`, selector: `GET ${url.split('?')[0]}`, measured: `HTTP ${r.status}${r.json === null ? `, not JSON ${short(r.text, 60)}` : ''}`, expected: `200 JSON (${what})` });
    cache.set(url, ok ? r.json : null);
    return ok ? r.json : null;
  };
  const bad = (game, selector, measured, expected) => lc.violation('game-data', { route: game.path, note: `service games.${game.id}`, selector, measured, expected });
  const rowsOk = (game, selector, rows) => {
    const { problems } = rowProblems(rows);
    for (const p of problems) bad(game, selector, p, 'a non-empty array of objects, each id once');
    return !problems.length;
  };

  /** A pool: the site's bundled copy (/data, the fallback and the only source of non-v3 pools), Django's pool endpoint,
   *  and the v3 data host when the build reads it there (POOL_GAMES with VITE_DATA_BASE set). */
  async function pool(game, key) {
    const m = await json(game, `${baseURL}/data/manifest.json`, 'the bundled data manifest');
    const entry = m && isObj(m.games) ? m.games[key] : null;
    let count = null;
    if (m && !isObj(entry)) bad(game, `/data/manifest.json games.${key}`, 'missing', `a "${key}" entry`);
    else if (entry) {
      const body = await json(game, `${baseURL}/data/${entry.file || `${key}.json`}`, `${key} pool`);
      const rows = Array.isArray(body) ? body : body && body.pool;
      if (body && rowsOk(game, `GET /data/${entry.file || `${key}.json`}`, rows)) {
        count = rows.length;
        if (Number.isInteger(entry.count) && entry.count !== rows.length) bad(game, `GET /data/${key}.json`, `${rows.length} rows`, `${entry.count} rows (the manifest's count)`);
        lc.metric(`rows ${key}`, rows.length, { unit: '', route: game.path, kind: 'data' });
      }
    }
    const dm = await json(game, `${origin}/trivia/manifest/`, 'Django\'s pool manifest');
    if (dm && !(isObj(dm.games) && isObj(dm.games[key]))) bad(game, `GET /trivia/manifest/ games.${key}`, 'missing', `"${key}" listed (not a hidden game)`);
    const dp = await json(game, `${origin}/trivia/pool/${key}/`, `Django's ${key} pool`);
    if (dp) {
      if (!isObj(dp) || !Array.isArray(dp.pool)) bad(game, `GET /trivia/pool/${key}/`, short(JSON.stringify(dp), 60), '{ pool: [...], count }');
      else if (rowsOk(game, `GET /trivia/pool/${key}/`, dp.pool)) {
        if (dp.count !== dp.pool.length) bad(game, `GET /trivia/pool/${key}/ count`, String(dp.count), `${dp.pool.length} (the pool's length)`);
        if (count !== null && dp.pool.length !== count) bad(game, `GET /trivia/pool/${key}/`, `${dp.pool.length} rows`, `${count} rows (the bundled /data copy)`);
      }
    }
    if (pools.has(key) && DATA_BASE) {
      const v3 = await json(game, `${DATA_BASE}/manifest.json`, 'the v3 data manifest');
      const e = v3 && isObj(v3.games) ? v3.games[key] : null;
      if (v3 && !isObj(e)) return bad(game, `v3 manifest games.${key}`, 'missing', `a published "${key}" entry (POOL_GAMES)`);
      if (!e) return;
      const file = e.kind === 'single' ? e.file : e.kind === 'chunked' ? (e.chunks || [])[0] : null;
      if (!file) return bad(game, `v3 manifest games.${key}`, `kind ${e.kind}, no file/chunks`, 'kind single with a file or chunked with chunks');
      const rows = await json(game, `${DATA_BASE}/${file}`, `${key} rows (v3)`);
      if (rows) rowsOk(game, `GET <data host>/${file}`, rows);
      if (rows && Number.isInteger(e.rows) && e.kind === 'single' && Array.isArray(rows) && rows.length !== e.rows) bad(game, `GET <data host>/${file}`, `${rows.length} rows`, `${e.rows} rows (the v3 manifest's count)`);
    }
  }

  /** A question game: the data host's question index (when it publishes the game), else the questions store's; every
   *  qid once and listed in `files`; one question file loads with that qid. */
  async function question(game, key) {
    const v3 = DATA_BASE ? await json(game, `${DATA_BASE}/manifest.json`, 'the v3 data manifest') : null;
    const e = v3 && isObj(v3.games) ? v3.games[key] : null;
    let index, qUrl;
    if (isObj(e) && e.kind === 'questions' && e.index) {
      index = await json(game, `${DATA_BASE}/${e.index}`, `${key} question index`);
      if (!index) return;
      if (!isObj(index.files)) return bad(game, `GET <data host>/${e.index}`, 'no files map', 'a files map (qid → sha)');
      qUrl = (qid) => `${DATA_BASE}/${key}/${qid}.${index.files[qid]}.json`;
    } else {
      const s = await json(game, `${QUESTIONS_BASE}/questions/manifest.json`, 'the questions store manifest');
      const g = s && isObj(s.games) ? s.games[key] : null;
      if (s && !(isObj(g) && g.index)) return bad(game, `questions store manifest games.${key}`, 'missing', `"${key}" on the data host or in the questions store`);
      if (!g) return;
      index = await json(game, g.index, `${key} question index`);
      if (!index) return;
      qUrl = (qid) => g.index.replace(/index\.json$/, `${qid}.json`);
    }
    if (!Array.isArray(index.items) || !index.items.length || !index.items.every(Array.isArray)) return bad(game, `${key} question index`, 'no items', 'items[] non-empty, each [qid, …]');
    const qids = index.items.map((it) => String(it[0]));
    const dup = qids.find((q, i) => qids.indexOf(q) !== i);
    if (dup) bad(game, `${key} question index items`, `qid ${dup} listed twice`, 'each question once');
    if (index.files) { const missing = qids.filter((q) => !index.files[q]); if (missing.length) bad(game, `${key} question index files`, `${missing.length} item(s) without a file, e.g. ${missing[0]}`, 'every item listed in files'); }
    lc.metric(`questions ${key}`, qids.length, { unit: '', route: game.path, kind: 'data' });
    const qid = qids.find((q) => !index.files || index.files[q]);
    const q = qid ? await json(game, qUrl(qid), `${key} question ${qid}`) : null;
    if (q && (!isObj(q) || String(q.qid) !== qid)) bad(game, `${key} question ${qid}`, `qid ${isObj(q) ? q.qid : typeof q}`, `a question object with qid ${qid}`);
  }

  /** Wordle: the read-only daily status for a device that never played (the play itself is LC-GAMEDATA-04). */
  async function wordle(game) {
    const url = `${origin}/trivia/wordle/daily-status/?device_id=lc-${Date.now()}`;
    const j = await json(game, url, 'the Wordle daily status');
    if (j && (j.locked !== false || !(Date.parse(j.next_reset_at) > Date.now()))) bad(game, 'GET /trivia/wordle/daily-status/ (a new device)', short(JSON.stringify(j), 80), '{ locked: false, next_reset_at: a future ISO date }');
  }

  const games = visibleGames();
  expect(games.length, 'visible games in the catalogue').toBeGreaterThan(0);
  for (const game of games) {
    const d = game.data;
    await test.step(`${game.id} (${d ? `${d.fn}(${d.key ?? ''})` : 'no fetchData'})`, async () => {
      if (!d || (d.fn === 'fetchGameData' && !d.key)) return; // coming-soon: no data
      if (d.fn === 'fetchGamePool' || d.fn === 'fetchWholePool') await pool(game, d.key);
      else if (d.fn === 'fetchQuestion') await question(game, d.key);
      else if (d.fn === 'playWordleDaily') await wordle(game);
      else bad(game, `fetchData ${d.fn}`, 'unknown data source', 'a source LC-GAMEDATA-01 knows (pool, question, wordle) — teach it the new one');
    });
  }
  await lc.done();
});

/** /me/ of a persona → { points, rank, id } or null (a violation recorded). */
async function me(api, lc, persona, label) {
  const r = await api.call(persona, 'GET', '/me/');
  const u = r.json && r.json.user;
  if (r.status !== 200 || !u || !Number.isInteger(u.points)) { lc.violation('me', { route: '/api/me/', selector: `GET /api/me/ (${label})`, measured: said(r), expected: '200 { user: { points } }' }); return null; }
  return u;
}

test('[LC-GAMEDATA-02] log-session credits exactly the reported score: /me/ points move by `awarded`, online and guest plays credit nothing', async ({ api, lc }) => {
  const route = '/trivia/log-session/';
  const origin = backendOrigin(api.base);
  const tiers = rankTiers();
  if (!tiers) lc.violation('setup', { route, selector: 'backend/users/models.py update_rank', measured: 'not parsed', expected: 'the points → rank tiers' });
  const game = visibleGames().find((g) => g.data && g.data.fn === 'fetchGamePool');
  const SCORE = 37;
  const log = (body, token) => attempt(api.fetch(`${origin}${route}`, { method: 'POST', body, token, headers: { 'x-forwarded-for': clientIp() } }));
  const { access } = (await mintTokens([ACTOR]))[ACTOR];

  /** One authenticated POST: the answer's `awarded` and `points` agree with /me/ before and after. */
  async function play(label, body, { awarded: want }) {
    await test.step(`${label} → awarded ${Array.isArray(want) ? want.join(' or ') : want}`, async () => {
      const before = await me(api, lc, 'logic.actor', `before ${label}`);
      if (!before) return;
      const r = await log(body, access);
      const selector = `POST ${route} ${label}`;
      if (r.status !== 200 || !r.json || r.json.ok !== true) { lc.violation(r.status >= 500 ? 'server-error' : 'log-session', { route, selector, measured: said(r), expected: '200 { ok: true, awarded, points, rank }' }); return; }
      const got = r.json.awarded;
      const allowed = Array.isArray(want) ? want : [want];
      if (!allowed.includes(got)) lc.violation('log-session', { route, selector: `${selector} awarded`, measured: String(got), expected: allowed.join(' or ') });
      const after = await me(api, lc, 'logic.actor', `after ${label}`);
      if (!after) return;
      lc.metric(`${label}: awarded`, got, { unit: 'pts', route, kind: 'data' });
      if (after.points - before.points !== got) lc.violation('points', { route: '/api/me/', selector: `/me/ points after ${label}`, measured: `${before.points} → ${after.points} (Δ ${after.points - before.points})`, expected: `Δ ${got} (exactly what log-session reported, once)` });
      if (r.json.points !== after.points) lc.violation('points', { route, selector: `${selector} points`, measured: String(r.json.points), expected: `${after.points} (/me/)` });
      if (tiers && after.rank !== tierOf(tiers, after.points)) lc.violation('rank-tier', { route: '/api/me/', selector: '/me/ rank', measured: `${after.rank} at ${after.points} points`, expected: `${tierOf(tiers, after.points)} (users.models update_rank)` });
      if (r.json.rank !== after.rank) lc.violation('rank-tier', { route, selector: `${selector} rank`, measured: String(r.json.rank), expected: `${after.rank} (/me/)` });
    });
  }

  const body = { game: game.id, mode: 'single', score: SCORE, duration_ms: 60_000 };
  await play(`single ${game.id} score ${SCORE}`, body, { awarded: SCORE });
  // The backend keeps no per-play key: every POST is one finished game (a GameSession row) and is credited; the site's
  // MiniGame awardedRef sends it once per game, and score-submit 60/h bounds a replay. Asserted: whatever it reports as
  // awarded (37 today, 0 if a dedupe lands) is exactly what /me/ gains — never a hidden double count.
  await play('the identical POST again', body, { awarded: [SCORE, 0] });
  await play('mode match (online results are the relay\'s to credit, AUTH-7)', { ...body, mode: 'match' }, { awarded: 0 });
  await play('score 0', { ...body, score: 0 }, { awarded: 0 });
  // The clamp: a forged score is awarded exactly the game's cap (views.py PER_GAME_MAX_POINTS, else MAX_SESSION_POINTS).
  // The visible game with the smallest cap keeps what the actor gains per run small.
  const caps = sessionCaps();
  if (!caps) lc.violation('setup', { route, selector: 'backend/trivia/views.py MAX_SESSION_POINTS / PER_GAME_MAX_POINTS', measured: 'not parsed', expected: 'the score caps' });
  else {
    const capOf = (id) => caps.perGame[id] ?? caps.max;
    const capped = visibleGames().filter((g) => g.data && g.data.fn !== 'fetchGameData').sort((a, b) => capOf(a.id) - capOf(b.id))[0];
    await play(`score 1e6 on ${capped.id} (cap ${capOf(capped.id)})`, { ...body, game: capped.id, score: 1e6 }, { awarded: capOf(capped.id) });
  }
  await test.step('a guest → 200, awarded 0, no account', async () => {
    const r = await log(body, null);
    if (r.status !== 200 || !r.json || r.json.awarded !== 0 || r.json.points !== 0 || r.json.rank !== null) lc.violation('log-session', { route, selector: `POST ${route} as a guest`, measured: `${said(r)} ${short(JSON.stringify(r.json), 80)}`, expected: '200 { ok: true, awarded: 0, points: 0, rank: null }' });
  });
  await test.step('no game → 400 "game is required"', async () => {
    const r = await log({ score: SCORE }, access);
    if (r.status !== 400 || !r.json || r.json.error !== 'game is required') lc.violation('log-session', { route, selector: `POST ${route} without game`, measured: said(r), expected: 'HTTP 400 "game is required"' });
  });
  await lc.done();
});

test('[LC-GAMEDATA-03] the logged-in leaderboard agrees with the points: user_rank = players with more points + 1, totals cover the rows', async ({ api, lc }) => {
  const route = '/api/get-users/';
  const u = await me(api, lc, 'logic.actor', 'the actor');
  if (u) {
    const v = (selector, measured, expected) => lc.violation('leaderboard', { route, selector, measured, expected });
    await test.step('global board (rank_of)', async () => {
      const r = await api.call('logic.actor', 'GET', '/get-users/');
      const j = r.json;
      if (r.status !== 200 || !isObj(j) || !Array.isArray(j.top_100_users)) { v('GET /api/get-users/ as logic.actor', said(r), '200 { top_100_users, user_rank, number_users }'); return; }
      const rows = j.top_100_users;
      for (let i = 1; i < rows.length; i++) if (rows[i].points > rows[i - 1].points) { v(`top_100_users[${i}].points`, `${rows[i].points} > ${rows[i - 1].points}`, 'points non-increasing'); break; }
      if (!Number.isInteger(j.number_users) || j.number_users < rows.length) v('number_users', String(j.number_users), `an integer ≥ ${rows.length} (the rows shown)`);
      if (!Number.isInteger(j.user_rank) || j.user_rank < 1) { v('user_rank', String(j.user_rank), 'an integer ≥ 1 for a signed-in player'); return; }
      const above = rows.filter((x) => x.points > u.points).length;
      const complete = rows.length < 100 || rows[rows.length - 1].points <= u.points; // every player above me is on the page
      if (complete && j.user_rank !== above + 1) v('user_rank', `${j.user_rank} with ${u.points} points`, `${above + 1} (${above} listed player(s) with more points, + 1: leaderboard.rank_of)`);
      if (!complete && j.user_rank <= rows.length) v('user_rank', String(j.user_rank), `> ${rows.length}: ${u.points} points is below the 100th row (${rows[rows.length - 1].points})`);
      const mine = rows.find((x) => x.id === u.id);
      if (u.is_teen && mine) v(`top_100_users row ${u.id}`, 'listed', 'not listed: a teen / age-unknown account is hidden from the public board (leaderboard._ranked)');
      if (!u.is_teen) {
        if (mine && mine.points !== u.points) v(`top_100_users row ${u.id}`, `${mine.points} points`, `${u.points} (/me/)`);
        if (!mine && complete && rows.length < 100) v(`top_100_users`, `${u.username} (${u.id}) missing`, 'an adult player with fewer than 100 players above is listed');
        if (j.number_users < j.user_rank) v('number_users', String(j.number_users), `≥ user_rank ${j.user_rank} (the player is counted)`);
      }
      lc.metric('global rank', j.user_rank, { unit: '', route, kind: 'data' });
      lc.metric('ranked players', j.number_users, { unit: '', route, kind: 'data' });
    });
    await test.step('friends board (?scope=friends)', async () => {
      const r = await api.call('logic.actor', 'GET', '/get-users/?scope=friends');
      const j = r.json;
      if (r.status !== 200 || !isObj(j) || !Array.isArray(j.top_100_users)) { v('GET /api/get-users/?scope=friends', said(r), '200 { top_100_users, user_rank, number_users }'); return; }
      const at = j.top_100_users.findIndex((x) => x.id === u.id);
      if (at < 0) v('friends board', `${u.id} missing`, 'the player is on their own friends board');
      else {
        if (j.user_rank !== at + 1) v('friends user_rank', String(j.user_rank), `${at + 1} (the player's position on the board)`);
        if (j.top_100_users[at].points !== u.points) v('friends board row', `${j.top_100_users[at].points} points`, `${u.points} (/me/)`);
      }
      if (j.number_users !== j.top_100_users.length) v('friends number_users', String(j.number_users), `${j.top_100_users.length} (the board's rows)`);
    });
  }
  await lc.done();
});

/**
 * The daily word for today on the LOCAL sqlite stack. Django picks it from the synced Player table (wordle_daily._pick_word),
 * which a fresh checkout's sqlite does not have, so the first play would 500 "no wordle words available" for a reason that
 * is the environment's, not the app's. When no word exists and no player can supply one, today's word is stored from the
 * bundled backend/trivia/data/wordle.json (the same surnames) — sqlite only (djangoEnv clears DATABASE_URL; asserted again).
 * → 'exists' | 'players' | 'seeded:<word>' | 'error:<msg>'
 */
function ensureWordleWord() {
  const code = [
    'import json, os',
    'from django.conf import settings',
    'assert settings.DATABASES["default"]["ENGINE"].endswith("sqlite3"), "not sqlite"',
    'from trivia import wordle_daily as w',
    'from trivia.models import WordleDailyWord',
    'from trivia.utils.text_utils import wordle_word',
    'day = w.cet_today()',
    'if WordleDailyWord.objects.filter(date=day).exists(): print("LC:exists")',
    'elif w.candidate_words(): print("LC:players")',
    'else:',
    '    words = [x for x in (wordle_word(s) for s in json.load(open(os.path.join(settings.BASE_DIR, "trivia", "data", "wordle.json"), encoding="utf-8"))) if x]',
    '    word = words[day.toordinal() % len(words)]',
    '    WordleDailyWord.objects.get_or_create(date=day, defaults={"word": word})',
    '    print("LC:seeded:" + word)',
  ].join('\n');
  const r = spawnSync(venvPython(appRepo()), ['manage.py', 'shell', '-c', code], { cwd: path.join(appRepo(), 'backend'), env: djangoEnv(), encoding: 'utf8', windowsHide: true, timeout: 60_000 });
  const m = /LC:(\S+)/.exec(r.stdout || '');
  return m ? m[1] : `error:${short((r.stderr || r.stdout || `exit ${r.status}`).split('\n').filter(Boolean).pop(), 120)}`;
}

test('[LC-GAMEDATA-04] Wordle daily gate: status unlocked → the first play returns the word → status locked → a second play is 423 (by account and by device)', async ({ api, lc }) => {
  const route = '/trivia/wordle/daily-play/';
  const origin = backendOrigin(api.base);
  const name = throwawayName(41);
  const { password } = credentials(name);
  const t = (await mintTokens([name]))[name]; // a fresh lgc account: its own wordle-play bucket and no play today
  const device = `lc-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const status = (dev, token) => attempt(api.fetch(`${origin}/trivia/wordle/daily-status/?device_id=${encodeURIComponent(dev)}`, { token, headers: { 'x-forwarded-for': clientIp() } }));
  const play = (dev, token) => attempt(api.fetch(`${origin}${route}`, { method: 'POST', body: { device_id: dev }, token, headers: { 'x-forwarded-for': clientIp() } }));
  const locked = (r, label) => {
    const j = r.json || {};
    if (r.status !== 423 || j.locked !== true || j.error !== "You already played today's word." || !(Date.parse(j.next_reset_at) > Date.now())) {
      lc.violation(r.status >= 500 ? 'server-error' : 'wordle-gate', { route, selector: `POST ${route} ${label}`, measured: said(r), expected: '423 { error: "You already played today\'s word.", locked: true, next_reset_at }' });
    }
  };
  try {
    const seeded = ensureWordleWord();
    if (seeded.startsWith('error:')) lc.violation('setup', { route, selector: 'the local daily word', measured: seeded, expected: 'today\'s word present or seedable on the local sqlite' });
    if (seeded.startsWith('seeded:')) lc.metric('daily word seeded (local sqlite has no players)', 1, { unit: '', route, kind: 'data' });
    let word = null;
    await test.step('status before → unlocked', async () => {
      const r = await status(device, t.access);
      if (r.status !== 200 || !r.json || r.json.locked !== false || !(Date.parse(r.json.next_reset_at) > Date.now())) lc.violation('wordle-gate', { route: '/trivia/wordle/daily-status/', selector: 'GET daily-status (new account, new device)', measured: `${said(r)} ${short(JSON.stringify(r.json), 80)}`, expected: '200 { locked: false, next_reset_at: future }' });
    });
    await test.step('first play → 200 with the word of the day', async () => {
      const r = await play(device, t.access);
      const s = r.json && r.json.series;
      if (r.status !== 200 || !Array.isArray(s) || s.length !== 1 || !/^[A-Za-z]{5}$/.test(String(s[0])) || !(Date.parse(r.json.next_reset_at) > Date.now())) lc.violation(r.status >= 500 ? 'server-error' : 'wordle-gate', { route, selector: `POST ${route} (first play)`, measured: `${said(r)} ${short(JSON.stringify(r.json), 60)}`, expected: '200 { series: [a five-letter word], next_reset_at }' });
      else word = s[0];
    });
    if (word) {
      await test.step('status after → locked', async () => {
        const r = await status(device, t.access);
        if (r.status !== 200 || !r.json || r.json.locked !== true) lc.violation('wordle-gate', { route: '/trivia/wordle/daily-status/', selector: 'GET daily-status after the play', measured: `${said(r)} ${short(JSON.stringify(r.json), 60)}`, expected: '200 { locked: true }' });
      });
      await test.step('second play, same account and device → 423', async () => locked(await play(device, t.access), '(again)'));
      await test.step('same account, another device → 423 (the account played)', async () => locked(await play(`${device}-b`, t.access), '(another device)'));
      await test.step('a guest on the same device → 423 (the device played)', async () => locked(await play(device, null), '(guest, same device)'));
      await test.step('a guest on a new device → unlocked (status only)', async () => {
        const r = await status(`${device}-guest`, null);
        if (r.status !== 200 || !r.json || r.json.locked !== false) lc.violation('wordle-gate', { route: '/trivia/wordle/daily-status/', selector: 'GET daily-status (guest, new device)', measured: `${said(r)} ${short(JSON.stringify(r.json), 60)}`, expected: '200 { locked: false }' });
      });
    }
  } finally {
    const d = await attempt(deleteAccount(api, { access: t.access, password }));
    if (d.status !== 200) lc.warn('cleanup', { route: '/api/account/delete/', selector: `delete ${name}`, measured: said(d), expected: 'HTTP 200 (the teardown sweep removes lgc accounts otherwise)' });
  }
  await lc.done();
});
