// Round data of an online match, for the game adapters (spec §7: "Multiplayer reuses the same adapters (round data
// arrives over the socket)"). Single player reads a game's rows from captured HTTP JSON (games/helpers.mjs capPool);
// online, the relay deals ONE round per room and sends it to every member as the socket.io event
//   roundData { gameData: [...rows | one question payload], game }        (pool and question games)
//   turnState { code, game, state: { board, criteria: { rows, cols }, turnUid, deadlineTs, stealsLeft, … } }  (turn games)
// which the `cap` fixture records per page (lib/capture.mjs frames()).
//
//   framePool(cap) → (key, ctx) => rows       pass as newCtx(fx, scenario, { online: true, pool: framePool(cap) })
//     • a round game's pool key (playoff, name-logo, mvps, starting-five, fan-favorites, career-path, who-are-ya,
//       contexto, wordle) → the newest roundData's gameData (the rows of THIS round, already expanded by the relay:
//       multiplayer_server/src/gameData.js deal / questions.js deal / the Django endpoint);
//     • 'tictactoe' → [the question payload] whose criteria labels equal the newest turnState's: the relay keeps
//       `valid[cell]` server-side (turnGames.js), so it is read from the same public data host the relay deals from
//       (DATA_PUBLIC_BASE = the build's VITE_DATA_BASE, lib/stack.mjs relayDataEnv), fetched once per worker;
//     • anything else (fan-favorites' `all-players` list) → what the page fetched itself over HTTP (capPool).
import { capPool } from '../games/helpers.mjs';
import { relayDataEnv } from './stack.mjs';

const ROUND_KEYS = new Set(['playoff', 'name-logo', 'mvps', 'starting-five', 'fan-favorites', 'career-path', 'who-are-ya', 'contexto', 'wordle']);

/** The rows of the newest `roundData` this page received ([] before the first). */
export function roundRows(cap) {
  const f = cap.frames('roundData', { dir: 'in' });
  const last = f[f.length - 1];
  return last && Array.isArray(last.gameData) ? last.gameData : [];
}

/** The newest turn-game state this page received, or null. */
export function lastTurnState(cap) {
  const f = cap.frames('turnState', { dir: 'in' });
  const last = f[f.length - 1];
  return last && last.state ? last.state : null;
}

let tttCache = null; // Promise<question[]>

/** Every published Tic-Tac-Toe question (manifest v3 index → question files), once per worker. */
function tttQuestions() {
  if (tttCache) return tttCache;
  const base = (relayDataEnv().DATA_PUBLIC_BASE || '').replace(/\/+$/, '');
  const get = async (u) => { const r = await fetch(u, { signal: AbortSignal.timeout(15_000) }); if (!r.ok) throw new Error(`${u} ${r.status}`); return r.json(); };
  tttCache = (async () => {
    if (!base) return [];
    const m = await get(`${base}/manifest.json`);
    const entry = m.games && m.games.tictactoe;
    if (!entry || !entry.index) return [];
    const index = await get(`${base}/${entry.index}`);
    const ids = Object.entries(index.files || {});
    const out = [];
    for (let i = 0; i < ids.length; i += 12) {
      const batch = await Promise.all(ids.slice(i, i + 12).map(([qid, sha]) => get(`${base}/tictactoe/${qid}.${sha}.json`).catch(() => null)));
      out.push(...batch.filter(Boolean));
    }
    return out;
  })().catch((e) => { tttCache = null; throw e; });
  return tttCache;
}

const labels = (list) => (list || []).map((c) => (c && typeof c === 'object' ? c.label : c)).join('|');

/** The published question whose row and column criteria equal the board's (turnState.criteria). */
export async function tttQuestionFor(criteria) {
  if (!criteria) return null;
  const qs = await tttQuestions();
  return qs.find((q) => labels(q.rows) === labels(criteria.rows) && labels(q.cols) === labels(criteria.cols)) || null;
}

/** ctx.pool for an online match (see the header). */
export function framePool(cap) {
  return async (key, ctx) => {
    if (key === 'tictactoe') {
      const s = lastTurnState(cap);
      const q = s ? await tttQuestionFor(s.criteria) : null;
      return q ? [{ game: 'tictactoe', ...q }] : [];
    }
    if (ROUND_KEYS.has(key)) return roundRows(cap);
    return capPool(ctx, key);
  };
}
