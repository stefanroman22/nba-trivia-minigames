// Pure scoring rules shared by the renderers — no imports, so scripts/test-game-scoring.mjs can load it
// under `node --experimental-strip-types`. The backend caps each game at the same maxima
// (backend/trivia/awarding.py GAME_MAX_POINTS); change both together.

/** Career Path: solved = 200 minus 40 per wrong guess, floor 40; out of guesses = 0 (the renderer). */
export const CAREER_PATH_MAX = 200;
export const CAREER_PATH_COST = 40;
export const CAREER_PATH_MIN = 40;
export function careerPathScore(wrong: number): number {
  return Math.max(CAREER_PATH_MIN, CAREER_PATH_MAX - CAREER_PATH_COST * wrong);
}

/** Who Are Ya?: 200 minus 25 per wrong guess (8 guesses, so the lowest win is 25). */
export const WHO_ARE_YA_MAX = 200;
export const WHO_ARE_YA_COST = 25;
export function whoAreYaScore(wrong: number): number {
  return Math.max(0, WHO_ARE_YA_MAX - WHO_ARE_YA_COST * wrong);
}

/** Fan Favorites: the board's share of 200. */
export const FAN_FAVORITES_MAX = 200;
export function fanFavoritesScore(found: number, total: number): number {
  return total > 0 ? Math.round((FAN_FAVORITES_MAX * found) / total) : 0;
}

/** Wordle: first try = 500 solo / 200 online, one step less per used attempt. Online has no daily
 *  lock, so it can't pay the daily jackpot. */
export const WORDLE_MAX_GUESSES = 5;
export const WORDLE_SOLO_PER_GUESS = 100;
export const WORDLE_ONLINE_PER_GUESS = 40;
export function wordlePoints(attemptIndex: number, multiplayer: boolean): number {
  return (WORDLE_MAX_GUESSES - attemptIndex) * (multiplayer ? WORDLE_ONLINE_PER_GUESS : WORDLE_SOLO_PER_GUESS);
}

/** Tic-Tac-Toe solo: per claimed cell. Online scores are fixed by the relay (turnGames.js). */
export const TTT_CELL_POINTS = 20;
export const TTT_SOLO_MAX = 9 * TTT_CELL_POINTS;

/** Starting 5: a full lineup adds this to 5 × pointsPerCorrect. */
export const STARTING_FIVE_BONUS = 50;
