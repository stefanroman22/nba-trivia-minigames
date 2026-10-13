// Game adapters (spec §7): one module per visible game, driven by lib/game-driver.mjs
// (specs/games/scenarios.spec.mjs, specs/games/latency.spec.mjs) and reused by the multiplayer suite.
//
// Contract — every adapter's default export:
//   {
//     id, path, online,                 // catalogue id, route, has an online mode
//     lives,                            // number | null   (null: no lives; `partial` then mixes right and wrong)
//     partialMisses,                    // optional: misses `partial` spends before answering right [lives - 1]
//     timerMs,                          // number | null   (a clock the `timeout` scenario runs out with page.clock)
//     scenarios: { perfect, wrong, partial, timeout, giveup, 'daily-lock' },   // true | 'reason string'
//     async answer(page, ctx, { correct }) → { over: boolean, truth?: string|null, feedback?: boolean },
//     async isOver(page) → boolean,
//     async giveUp(page, ctx)?,  async timeout(page, ctx)?,
//     // optional extensions read by the driver (defaults in brackets):
//     pointsPerCorrect,                 // number | null — "Correct! +N" copy and the expected final score [null]
//     feedback: { selector, copy },     // per-answer feedback element and whether Rule 6.0 copy applies
//                                       //   [{ selector: '.feedback-slot > *', copy: true }]
//     endsInPlace,                      // [not in scripts/game-result-allowlist.json]
//     playAgain,                        // false: the end screen legitimately has no Play again (Wordle) [true]
//     freshAccount,                     // true | ['daily-lock', …]: run those scenarios as a brand-new throwaway
//                                       //   account (per-account state such as Wordle's daily play) [none]
//     labels: { <scenario>: 'title' },  // test-title wording per scenario [the generic wording]
//     latencyPlan,                      // optional (turn) → right?  for GM-LATENCY-01 [right, wrong, right]
//     expectedScore(turns, ctx) → number|null,         // [right answers × pointsPerCorrect]
//     async endReveal(page, ctx, turns) → string[],   // problems with the answers shown at the end;
//                                       //   REQUIRED for a game that ends in place (else `answer-hidden`)
//   }
// answer() plays ONE turn: it waits until the turn is ready, finds the right answer (ctx.pool(key) first, then
// ctx.fiber — see games/helpers.mjs; neither → noTruth(): a `no-truth` violation and a thrown error), gives the right or a wrong one, and returns once the next turn is ready or
// the game is over. `truth` is the right answer as the player should see it (the driver checks wrong-answer
// feedback names it); `feedback: false` marks a turn that shows no feedback by design (Who Would Win's Skip).
// A scenario the adapter cannot drive is a reason string: the spec turns it into a skipped test (coverage gap).
//
// ctx = { cap, fiber, vp, audit, online:boolean, pool(key), scenario, turn, state, account? }
//   cap / fiber / vp / audit are the test fixtures; online is false in single player; pool(key) → the game's
//   question rows (single player: games/helpers.mjs capPool over ctx.cap; Task 8 calls
//   newCtx(fx, scenario, { online: true, pool: (key, ctx) => rowsFromSocketFrames }) instead); turn is the 0-based
//   turn index; state is the adapter's scratch object for one game run (round keys, answer-source counts in
//   state.sources); account is the throwaway username when the scenario runs on a fresh account.
import seriesWinner from './series-winner.mjs';
import whoWouldWin from './who-would-win.mjs';
import nameLogo from './name-logo.mjs';
import guessMvps from './guess-mvps.mjs';
import startingFive from './starting-five.mjs';
import fanFavorites from './fan-favorites.mjs';
import careerPath from './career-path.mjs';
import whoAreYa from './who-are-ya.mjs';

export const ADAPTERS = {
  'series-winner': seriesWinner,
  'who-would-win': whoWouldWin,
  'name-logo': nameLogo,
  'guess-mvps': guessMvps,
  'starting-five': startingFive,
  'fan-favorites': fanFavorites,
  'career-path': careerPath,
  'who-are-ya': whoAreYa,
};

/** The adapter for a catalogue id, or null when none exists yet. */
export function adapterFor(id) {
  return ADAPTERS[id] || null;
}
