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

/** Who Are Ya?: 250 minus 30 per wrong guess (8 guesses, so the lowest win is 40). */
export const WHO_ARE_YA_MAX = 250;
export const WHO_ARE_YA_COST = 30;
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

/** Tic-Tac-Toe solo: per claimed cell, plus a bonus for clearing the board. Online scores are fixed by
 *  the relay (turnGames.js). */
export const TTT_CELL_POINTS = 30;
export const TTT_CLEAR_BONUS = 30;
export const TTT_SOLO_MAX = 9 * TTT_CELL_POINTS + TTT_CLEAR_BONUS;

/** LeContexto: 3000 through the tenth guess, minus 75 per guess after it, floor 750. */
export const CONTEXTO_MAX = 3000;
export const CONTEXTO_FREE_GUESSES = 10;
export const CONTEXTO_COST = 75;
export const CONTEXTO_MIN = 750;
export function contextoScore(guesses: number): number {
  return Math.max(CONTEXTO_MIN, CONTEXTO_MAX - CONTEXTO_COST * Math.max(0, guesses - CONTEXTO_FREE_GUESSES));
}
