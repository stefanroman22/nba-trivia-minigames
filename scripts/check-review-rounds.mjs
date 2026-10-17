// Node test for src/utils/reviewRounds.ts ("Report a problem": which questions a finished game dealt):
//   npm run check:review-rounds      (also run by `npm run lint`, so CI covers it on Node 20)
//
// Same harness as check-seen.mjs: reviewRounds.ts has only type imports, so it is transpiled with the
// project's own TypeScript and imported from a data: URL. One case per AnswerReview member; the
// question_id must be the id the game logs and the roll-ups count (GuessLog.question_id).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";

const source = readFileSync(new URL("../src/utils/reviewRounds.ts", import.meta.url), "utf8");
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
});
const { reviewRounds } = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString("base64")}`);

const reviewTypes = readFileSync(new URL("../src/types/review.ts", import.meta.url), "utf8");
const unionMembers = [...reviewTypes.matchAll(/game: "([a-z-]+)"/g)].map((m) => m[1]);

const cases = {
  "series-winner": [
    {
      game: "series-winner",
      rounds: [
        { matchId: "1981-east-r1-chi-nyk", label: "First Round · 1980-81", teams: [{ name: "Bulls", logo: "", wins: 2 }, { name: "Knicks", logo: "", wins: 0 }], winner: "Bulls", pick: "Bulls" },
        { matchId: "2016-finals", label: "Finals · 2015-16", teams: [{ name: "Cavaliers", logo: "", wins: 4 }, { name: "Warriors", logo: "", wins: 3 }], winner: "Cavaliers", pick: null },
      ],
    },
    [
      { question_id: "1981-east-r1-chi-nyk", label: "Bulls vs Knicks 1980-81" },
      { question_id: "2016-finals", label: "Cavaliers vs Warriors 2015-16" },
    ],
  ],
  "name-logo": [
    { game: "name-logo", rounds: [{ team: "Lakers", teamId: 1610612747, logo: null, pick: "Lakers", correct: true }] },
    [{ question_id: "1610612747", label: "Lakers logo" }],
  ],
  "guess-mvps": [
    { game: "guess-mvps", rounds: [
      { season: "1955-56", mvp: "Bob Pettit", pick: null, correct: false },
      { season: "1994-95", award: "Rookie of the Year", mvp: "Grant Hill & Jason Kidd", pick: "Jason Kidd", correct: true },
    ] },
    [
      { question_id: "1955-56", label: "1955-56 MVP" },
      { question_id: "1994-95:Rookie of the Year", label: "1994-95 Rookie of the Year" },
    ],
  ],
  "starting-five": [
    {
      game: "starting-five",
      matchup: { gameId: "0021000999", teamA: "Warriors", teamB: "Grizzlies", logoA: "", logoB: "", winner: "Warriors", score: "110-100", date: "2011-03-30" },
      slots: [],
    },
    [{ question_id: "0021000999", label: "Warriors vs Grizzlies 2011-03-30" }],
  ],
  wordle: [
    { game: "wordle", solution: "curry", guesses: ["james"], won: false },
    [{ question_id: "CURRY", label: "CURRY" }],
  ],
  "fan-favorites": [
    { game: "fan-favorites", qid: "ff-0012", prompt: "Name a player who wore 23", asked: "", answers: [] },
    [{ question_id: "ff-0012", label: "Name a player who wore 23" }],
  ],
  heatmap: [{ game: "heatmap", rows: [] }, []],
  connections: [{ game: "connections", groups: [] }, []],
  "career-path": [
    { game: "career-path", player: { person_id: 2544, full_name: "LeBron James" }, teams: [], draft: "", guesses: [], won: true },
    [{ question_id: "2544", label: "LeBron James" }],
  ],
  "nba-grid": [{ game: "nba-grid", rows: [], cols: [], cells: [] }, []],
  "who-are-ya": [
    { game: "who-are-ya", mystery: { person_id: 201939, full_name: "Stephen Curry", sub: "" }, rows: [], won: false },
    [{ question_id: "201939", label: "Stephen Curry" }],
  ],
  tictactoe: [
    { game: "tictactoe", qid: "ttt-0044", rows: [], cols: [], cells: [], result: "win" },
    [{ question_id: "ttt-0044", label: "Board ttt-0044" }],
  ],
  "who-would-win": [
    {
      game: "who-would-win",
      rounds: [
        { qid: "www-0001", a: "1996 Bulls", b: "2017 Warriors", pick: "a" },
        { qid: "www-0002", a: "Prime Shaq", b: "Prime Hakeem", pick: null },
      ],
    },
    [
      { question_id: "www-0001", label: "1996 Bulls vs 2017 Warriors" },
      { question_id: "www-0002", label: "Prime Shaq vs Prime Hakeem" },
    ],
  ],
  bingo: [{ game: "bingo", cells: [] }, []],
  contexto: [
    { game: "contexto", secret: { person_id: 893, full_name: "Michael Jordan" }, rows: [], poolSize: 500, won: true },
    [{ question_id: "893", label: "Michael Jordan" }],
  ],
  "pack-five": [{ game: "pack-five", turns: [] }, []],
  superdraft: [{ game: "superdraft", objective: "", aggLabel: "", aggregate: "", percentile: 0, slots: [] }, []],
  imposter: [{ game: "imposter", mystery: "", imposterName: "", imposterGuess: null, guessCorrect: null, seats: [] }, []],
};

test("every AnswerReview member has a case", () => {
  assert.ok(unionMembers.length >= 18, `parsed ${unionMembers.length} union members from review.ts`);
  assert.deepEqual([...unionMembers].sort(), Object.keys(cases).sort());
});

for (const [game, [review, expected]] of Object.entries(cases)) {
  test(`${game}: question ids and labels`, () => {
    assert.deepEqual(reviewRounds(review), expected);
  });
}

test("tictactoe without a qid (an online duel) has nothing to report", () => {
  assert.deepEqual(reviewRounds({ game: "tictactoe", rows: [], cols: [], cells: [], result: "draw" }), []);
});

test("no review, nothing to report", () => {
  assert.deepEqual(reviewRounds(undefined), []);
  assert.deepEqual(reviewRounds(null), []);
});

test("rounds without an id are left out", () => {
  const review = { game: "guess-mvps", rounds: [{ season: "", mvp: "x", pick: null, correct: false }, { season: "1999-00", mvp: "Shaquille O'Neal", pick: null, correct: false }] };
  assert.deepEqual(reviewRounds(review), [{ question_id: "1999-00", label: "1999-00 MVP" }]);
});
