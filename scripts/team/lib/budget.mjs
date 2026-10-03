// Per-tier time budgets and the lane picker (design §11): a card starts only if its budget fits
// the time left, two cards share a run tick only when their areas are disjoint, a hard card runs
// alone.
const BUDGET_MIN = { trivial: 10, standard: 25, hard: 45 };

const GAME_WORDS = [
  ["career path", "career-path"], ["careerpath", "career-path"],
  ["who are ya", "who-are-ya"], ["whoareya", "who-are-ya"],
  ["who would win", "who-would-win"],
  ["starting 5", "starting-five"], ["starting five", "starting-five"],
  ["fan favorite", "fan-favorites"],
  ["tic-tac-toe", "tictactoe"], ["tictactoe", "tictactoe"], ["tic tac toe", "tictactoe"],
  ["contexto", "contexto"], ["lecontexto", "contexto"],
  ["bingo", "bingo"], ["heatmap", "heatmap"], ["connections", "connections"],
  ["series winner", "series-winner"], ["playoff", "series-winner"],
  ["name the logo", "name-logo"], ["name-logo", "name-logo"],
  ["mvp", "guess-mvps"], ["nba grid", "nba-grid"], ["pack five", "pack-five"], ["pack 5", "pack-five"],
  ["superdraft", "superdraft"], ["imposter", "imposter"], ["wordle", "wordle"],
];

const CATEGORY_AREAS = {
  frontend: ["frontend"], docs: ["docs"],
  backend: ["backend"], "CI/CD": ["backend"], AI: ["backend"], pipeline: ["backend"],
  fullstack: ["frontend", "backend"],
};

export function tierBudget(tier) {
  return BUDGET_MIN[tier] || BUDGET_MIN.standard;
}

/** @returns {Set<string>} areas a card will touch, derived from Category and game names in the title */
export function areasOf(card) {
  const areas = new Set(CATEGORY_AREAS[card.category] || ["backend"]);
  const title = String(card.title || "").toLowerCase();
  for (const [word, id] of GAME_WORDS) if (title.includes(word)) areas.add(id);
  return areas;
}

const GAME_IDS = new Set(GAME_WORDS.map(([, id]) => id));

/**
 * Lane keys decide whether two cards may run side by side. A game card is keyed by its game(s)
 * instead of the generic `frontend` — two different games touch different renderers. A frontend
 * card with no game is keyed `frontend`, which conflicts with every other frontend card AND every
 * game card (it may touch shared components). Non-frontend areas (backend, docs) always stay.
 */
export function laneKeys(card) {
  const areas = [...areasOf(card)];
  const games = areas.filter((a) => GAME_IDS.has(a));
  const rest = areas.filter((a) => !GAME_IDS.has(a) && !(games.length && a === "frontend"));
  return new Set([...games, ...rest]);
}

const disjoint = (a, b) => {
  if ([...a].some((x) => b.has(x))) return false;
  const aGames = [...a].some((x) => GAME_IDS.has(x));
  const bGames = [...b].some((x) => GAME_IDS.has(x));
  if (a.has("frontend") && bGames) return false;
  if (b.has("frontend") && aGames) return false;
  return true;
};

/**
 * @param {Array} queue sorted (P0 first, oldest first), each with difficulty/category/title
 * @param {number} remainingMin
 * @param {{ lanes?: number, running?: Array<{ laneKeys?: string[], areas?: string[], tier?: string }> }} opts
 * @returns {Array} cards to start now. Empty when nothing fits, when a hard card is running, or when
 *   the first card that fits is hard but another lane is busy (it waits for a free run tick rather
 *   than being skipped — otherwise a P0 hard card would starve behind standard cards all run).
 */
export function pickNext(queue, remainingMin, { lanes = 2, running = [] } = {}) {
  const free = Math.max(0, lanes - running.length);
  if (!free) return [];
  if (running.some((r) => (r.tier || "standard") === "hard")) return [];
  const busy = running.map((r) => new Set(r.laneKeys || r.areas || []));
  const fits = (c) => tierBudget(c.difficulty || "standard") <= remainingMin;
  const clear = (c, others) => others.every((o) => disjoint(laneKeys(c), o));
  const picks = [];
  for (const c of queue) {
    if (picks.length >= free) break;
    if (!fits(c)) continue;
    const taken = [...busy, ...picks.map(laneKeys)];
    if ((c.difficulty || "standard") === "hard") {
      if (busy.length || picks.length) break; // hard runs alone: wait for an empty tick, don't skip it
      picks.push(c);
      break;
    }
    if (!clear(c, taken)) continue;
    picks.push(c);
  }
  return picks;
}
