// node --test scripts/check-core/logic-awarding.test.mjs — logic-check/lib/awarding.mjs: the points rules parsed from
// this repo's backend/trivia/awarding.py, and receiptProblems rejecting receipts that add up but pay the wrong bonus.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { awardRules, receiptProblems } from '../logic-check/lib/awarding.mjs';

const SRC = readFileSync(fileURLToPath(new URL('../../backend/trivia/awarding.py', import.meta.url)), 'utf8');
const rules = awardRules(SRC);
const r = (base, first, streak, awarded = base + first + streak) => ({ base, first_game_bonus: first, streak_bonus: streak, awarded });
const me = (active_days, streak_days) => ({ active_days, streak_days });
const parts = (p) => p.map((x) => x.part);

test('awardRules parses the caps, the first-game bonus and the streak milestones', () => {
  assert.ok(rules);
  assert.equal(rules.firstBonus, 100);
  assert.equal(rules.perGame['name-logo'], 50);
  assert.equal(rules.max, 300);
  assert.equal(rules.milestones[10], 500);
  assert.equal(awardRules('nothing here'), null);
});

test('the day\'s first scoring game: exactly the first-game bonus and the new streak length\'s milestone', () => {
  assert.deepEqual(receiptProblems(r(37, 100, 0), me(3, 2), me(4, 3), rules), []);
  assert.deepEqual(receiptProblems(r(37, 100, 500), me(9, 9), me(10, 10), rules), []);
  assert.deepEqual(parts(receiptProblems(r(37, 0, 0), me(3, 2), me(4, 3), rules)), ['first_game_bonus']); // bonus never paid
  assert.deepEqual(parts(receiptProblems(r(37, 100, 0), me(9, 9), me(10, 10), rules)), ['streak_bonus']); // milestone missed
  assert.deepEqual(parts(receiptProblems(r(37, 100, 500), me(3, 2), me(4, 3), rules)), ['streak_bonus']); // milestone off day
});

test('a later scoring game the same day pays no bonus; nothing scored pays nothing and counts no day', () => {
  assert.deepEqual(receiptProblems(r(37, 0, 0), me(4, 3), me(4, 3), rules), []);
  assert.deepEqual(parts(receiptProblems(r(37, 100, 0), me(4, 3), me(4, 3), rules)), ['bonuses']); // bonus twice a day
  assert.deepEqual(parts(receiptProblems(r(37, 0, 500), me(4, 3), me(4, 3), rules)), ['bonuses']); // streak every game
  assert.deepEqual(receiptProblems(r(0, 0, 0), me(4, 3), me(4, 3), rules), []);
  assert.deepEqual(parts(receiptProblems(r(0, 100, 0), me(4, 3), me(5, 4), rules)), ['nothing scored']);
});

test('a receipt that does not add up, or a day counted twice, is named', () => {
  assert.deepEqual(parts(receiptProblems(r(37, 100, 0, 237), me(3, 2), me(4, 3), rules)), ['awarded']);
  assert.deepEqual(parts(receiptProblems(r(37, 100, 0), me(3, 2), me(5, 4), rules)), ['active_days']);
});
