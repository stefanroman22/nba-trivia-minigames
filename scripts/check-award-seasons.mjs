// Node test for src/utils/awardSeasons.ts (Guess the MVP's award seasons: prompt, accepted
// answers, question id, revealed answer), with the game's own matchAnswer (src/utils/answerMatch.ts):
//   npm run check:award-seasons      (also run by `npm run lint`)
//
// Both files have type imports only, so each is transpiled here with the project's own TypeScript
// and imported from a data: URL.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";

const load = (path) => {
  const source = readFileSync(new URL(path, import.meta.url), "utf8");
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  });
  return import(`data:text/javascript;base64,${Buffer.from(outputText).toString("base64")}`);
};
const { acceptedAnswers, awardPrompt, awardQuestionId, promptReserve, winnersText, LEGACY_PROMPT } = await load("../src/utils/awardSeasons.ts");
const { matchAnswer } = await load("../src/utils/answerMatch.ts");
const { reviewRounds } = await load("../src/utils/reviewRounds.ts");

const roy1995 = {
  season: "1994-95", mvp: "Grant Hill", team: "Detroit Pistons", team_logo_url: null,
  award: "Rookie of the Year", prompt: "Who was the Rookie of the Year in 1994-95?",
  winners: [
    { name: "Grant Hill", person_id: 255, team: "Detroit Pistons", team_logo_url: null },
    { name: "Jason Kidd", person_id: 467, team: "Dallas Mavericks", team_logo_url: null },
  ],
};
const smoy1989 = {
  season: "1988-89", mvp: "Eddie Johnson", team: "Phoenix Suns", team_logo_url: null,
  award: "Sixth Man of the Year", prompt: "Who was the Sixth Man of the Year in 1988-89?",
  winners: [{ name: "Eddie Johnson", person_id: 698, team: "Phoenix Suns", team_logo_url: null }],
};
const legacy = { season: "1999-00", mvp: "Shaquille O'Neal", team: "Los Angeles Lakers", team_logo_url: "" };

const correct = (guess, row) => matchAnswer(guess, acceptedAnswers(row)) >= 0;

test("the prompt comes from the row, the old title when it has none", () => {
  assert.equal(awardPrompt(smoy1989), "Who was the Sixth Man of the Year in 1988-89?");
  assert.equal(awardPrompt(legacy), LEGACY_PROMPT);
  assert.equal(LEGACY_PROMPT, "Who won MVP?");
});

test("the reserved title is at least as long as any award's prompt for the season", () => {
  const awards = ["MVP", "Finals MVP", "Defensive Player of the Year", "Rookie of the Year", "Sixth Man of the Year"];
  const reserve = promptReserve(roy1995);
  for (const award of awards) assert.ok(reserve.length >= `Who was the ${award} in ${roy1995.season}?`.length, award);
  assert.equal(promptReserve(legacy), LEGACY_PROMPT);
});

test("any co-winner is a right answer, accents and case aside", () => {
  assert.ok(correct("Grant Hill", roy1995));
  assert.ok(correct("jason kidd", roy1995));
  assert.ok(!correct("Glenn Robinson", roy1995));
  assert.ok(correct("Eddie Johnson", smoy1989));
});

test("a row without winners accepts its mvp", () => {
  assert.deepEqual(acceptedAnswers(legacy), [{ answer: "Shaquille O'Neal" }]);
  assert.ok(correct("shaquille oneal", legacy));
  assert.ok(!correct("Kobe Bryant", legacy));
  assert.deepEqual(acceptedAnswers({ ...legacy, winners: [] }), [{ answer: "Shaquille O'Neal" }]);
});

test("the question id is season:award, the season on an old row", () => {
  assert.equal(awardQuestionId(roy1995), "1994-95:Rookie of the Year");
  assert.equal(awardQuestionId({ ...roy1995, award: "MVP" }), "1994-95:MVP");
  assert.equal(awardQuestionId(legacy), "1999-00");
  assert.ok(awardQuestionId({ season: "1988-89", award: "Defensive Player of the Year" }).length <= 60, "fits GuessLog.question_id");
});

test("reviewRounds' inline copy of the question id matches awardQuestionId", () => {
  for (const row of [legacy, { ...roy1995, award: "MVP" }, roy1995, smoy1989]) {
    const review = { game: "guess-mvps", rounds: [{ season: row.season, award: row.award, mvp: winnersText(row), pick: null, correct: false }] };
    assert.equal(reviewRounds(review)[0].question_id, awardQuestionId(row), row.award ?? "old row");
  }
});

test("the reveal names every co-winner", () => {
  assert.equal(winnersText(roy1995), "Grant Hill & Jason Kidd");
  assert.equal(winnersText(smoy1989), "Eddie Johnson");
  assert.equal(winnersText(legacy), "Shaquille O'Neal");
});
