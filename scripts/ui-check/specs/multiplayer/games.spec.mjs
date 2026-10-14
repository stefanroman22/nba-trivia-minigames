// Multiplayer: one full online match per online-capable visible game (catalogue `online`: utils/roomSizes.ts
// NOT_ONLINE excludes who-would-win and coming-soon), pair A only (playwright config). A friend room on the game's
// page → Start → the host plays the whole round right (`perfect`), then the joiner wrong (`wrong`, or `giveup` where
// that is the game's only loss), both with the single-player adapters (games/<id>.mjs) driven online by
// lib/mp-play.mjs: ctx.online, answers from the round the relay sent over the socket (lib/mp-pool.mjs). Tic-Tac-Toe is
// a turn duel (the adapter's `online` section). Asserted on both sides: layout of the playing screen, snap / CLS
// while playing, feedback after every answer, the waiting screen, results (headline, scores from the answers given,
// mirrored), no points (friend rooms never credit), the answer review.
import { test, expect } from '../../lib/fixtures.mjs';
import { realUserAgent } from '../../lib/game-driver.mjs';
import { playableGames } from '../../lib/guest.mjs';
import { adapterFor } from '../../games/index.mjs';
import { checkResults, finishBoth, layoutBoth, openPair, releasePair, reviewRoundTrip, roomWithBoth, shotBoth, startRoom } from '../../lib/mp.mjs';
import { TTT_SCORES, lossScenario, playBoth, playDuel } from '../../lib/mp-play.mjs';

test.use({ userAgent: realUserAgent });
test.afterEach(async () => { await releasePair(); });

const ONLINE = playableGames().filter((g) => g.online);

/**
 * Stage snaps while playing online that are the same renderer resize the games suite already reports in single player
 * (notes/games.md "REAL findings"): the violation gets a note naming that check, so the judges merge them. Tic-Tac-Toe's
 * jump (final board → results) is online-only and gets no note.
 */
const GM_SAME = {
  'starting-five': 'same as GM-starting-five-perfect / -partial (the stage grows ~79 px in one frame as the EndSequence mounts)',
  'who-are-ya': 'same as GM-who-are-ya-* (the feedback feed adds a row per guess and grows the stage)',
  contexto: 'same as GM-contexto-* (the guess list grows the stage per guess)',
  'fan-favorites': 'same as GM-fan-favorites-perfect (a revealed long answer wraps and grows the stage)',
};
function markSameAsGames(game, p) {
  if (!GM_SAME[game]) return;
  for (const v of p.audit.violations) {
    if (v.rule === 'snap' && /stage-shell/.test(v.selector) && !/same as GM-/.test(v.note || '')) v.note = [v.note, GM_SAME[game]].filter(Boolean).join(' · ');
  }
}

for (const g of ONLINE) {
  const adapter = adapterFor(g.id);
  const turnBased = !!(adapter && adapter.online && adapter.online.turnBased);
  const joinerScenario = adapter && (turnBased ? 'wrong' : lossScenario(adapter));
  const reason = !adapter ? 'no adapter for this game'
    : adapter.scenarios.perfect !== true ? `the adapter cannot play it right: ${adapter.scenarios.perfect}`
      : !joinerScenario ? 'the adapter has no losing scenario (wrong / giveup) for the joiner'
        : null;
  test.describe(() => {
    test.skip(!!reason, reason || '');
    // @catalog-family MP-GAME-<game>
    test(`[MP-GAME-${g.id}] ${g.name}: one full online match in a friend room (host all right, joiner ${turnBased ? 'only misses' : joinerScenario === 'giveup' ? 'gives up' : 'all wrong'}), results on both`, async ({ mp }) => {
      test.setTimeout(turnBased ? 300_000 : 420_000);
      const pair = await openPair(mp, g.path);
      const { host, joiner } = pair;
      await roomWithBoth(pair);
      await shotBoth(pair, 'lobby');
      await startRoom(pair);

      let want;
      if (turnBased) {
        const duel = await playDuel(pair, adapter);
        host.audit.metrics.push({ kind: 'note', label: 'duel moves', value: duel.moves.map((m) => `${m.who}:${m.kind}@${m.cell + 1}`).join(' '), unit: '', route: host.audit.route });
        duel.passes.forEach((ms, i) => joiner.audit.metrics.push({ kind: 'timing', label: `turn ${i + 1} passed after`, value: ms, unit: 'ms', budget: 25_000 + 8000, route: joiner.audit.route }));
        want = { host: { outcome: 'win', score: TTT_SCORES.win }, joiner: { outcome: 'loss', score: TTT_SCORES.loss }, times: false };
      } else {
        const { h, j } = await playBoth(pair, adapter, { host: 'perfect', joiner: joinerScenario });
        expect(h.expected, 'the host\'s perfect round must outscore the joiner\'s').toBeGreaterThan(j.expected);
        want = { host: { outcome: 'win', score: h.expected }, joiner: { outcome: 'loss', score: j.expected } };
      }
      await checkResults(pair, want);
      for (const p of [host, joiner]) markSameAsGames(g.id, p);
      for (const p of [host, joiner]) {
        const credited = p.cap.frames('pointsAwarded', { dir: 'in' });
        if (credited.length) p.audit.violation('points', { selector: 'pointsAwarded', measured: JSON.stringify(credited), expected: 'a friend room never adds points to profiles (MP-6)' });
      }
      await layoutBoth(pair);
      await shotBoth(pair, 'results');
      await reviewRoundTrip(host, want.host.score);
      await reviewRoundTrip(joiner, want.joiner.score);
      await finishBoth(pair);
    });
  });
}
