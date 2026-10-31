// Node test for the "a correct answer is never judged wrong" rules: the namesake pick (Who Are Ya, Contexto),
// Name the Logo's team spellings, Starting Five's slot decision, Guess the MVP by player id and Career Path via
// the shared name lookup.
//   npm run test:answer-accept      (node --experimental-strip-types; Node >= 22.6)
import { test } from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";

// The sources import their siblings without extensions (bundler style): add ".ts", as test-name-lookup.mjs does.
register("data:text/javascript," + encodeURIComponent(`
  export async function resolve(spec, ctx, next) {
    if (/^\\.\\.?\\//.test(spec) && !/\\.[cm]?[jt]s$/.test(spec) && ctx.parentURL?.includes("/src/")) return next(spec + ".ts", ctx);
    return next(spec, ctx);
  }`));
const { buildNameLookup, pickGuessId } = await import("../src/utils/questions.ts");
const { matchAnswer, nameKey, sameName } = await import("../src/utils/answerMatch.ts");
const { nbaTeams, teamAnswerAliases } = await import("../src/constants/nbaTeams.ts");
const { lineupSlots, placeGuess, starterMatcher } = await import("../src/utils/startingFive.ts");
const { acceptedAnswers, idsHitWinner } = await import("../src/utils/awardSeasons.ts");

const NAMES = [
  { id: 698, full_name: "Eddie Johnson", aliases: [] },
  { id: 77144, full_name: "Eddie Johnson", aliases: [] },
  { id: 76, full_name: "Kareem Abdul-Jabbar", aliases: ["Lew Alcindor"] },
  { id: 977, full_name: "Kobe Bryant", aliases: [] },
  { id: 255, full_name: "Grant Hill", aliases: [] },
  { id: 467, full_name: "Jason Kidd", aliases: [] },
  { id: 896, full_name: "Tim Hardaway", aliases: [] },
  { id: 203501, full_name: "Tim Hardaway Jr.", aliases: [] },
  { id: 1626164, full_name: "Karl-Anthony Towns", aliases: [] },
  { id: 920, full_name: "A.C. Green", aliases: [] },
  { id: 56, full_name: "Gary Payton", aliases: [] },
  { id: 1627780, full_name: "Gary Payton II", aliases: [] },
  { id: 1192, full_name: "Jaren Jackson", aliases: [] },
  { id: 1628991, full_name: "Jaren Jackson Jr.", aliases: [] },
  { id: 1626171, full_name: "Bobby Portis Jr.", aliases: [] },
  { id: 201144, full_name: "Mike Conley", aliases: [] },
];
const lookup = buildNameLookup(NAMES);

test("resolveIds: an exact name wins outright, then the suffix-less match, then a suffix the name lacks", () => {
  assert.deepEqual(lookup.resolveIds("Gary Payton"), [56], "the father's exact name is only the father");
  assert.deepEqual(lookup.resolveIds("Gary Payton II"), [1627780]);
  assert.deepEqual(lookup.resolveIds("Jaren Jackson"), [1192]);
  assert.deepEqual(lookup.resolveIds("Tim Hardaway"), [896]);
  assert.deepEqual(lookup.resolveIds("Bobby Portis"), [1626171], "no father: the suffix-less name finds him");
  assert.deepEqual(lookup.resolveIds("Mike Conley Jr"), [201144]);
  assert.deepEqual(lookup.resolveIds("Eddie Johnson"), [698, 77144], "namesakes stay together");
  assert.deepEqual(lookup.resolveIds("Nobody Here"), []);
  assert.deepEqual(lookup.toIds("Gary Payton"), [56, 1627780], "toIds keeps its wider behaviour (Tic-Tac-Toe)");
});

test("pickGuessId: the target when he shares the typed name, else the first accepted namesake", () => {
  const ids = lookup.resolveIds("Eddie Johnson");
  assert.equal(pickGuessId(ids, 77144), 77144, "mystery is the second Eddie Johnson");
  assert.equal(pickGuessId(ids, 698), 698);
  assert.equal(pickGuessId(ids, 977), 698, "another mystery: the first namesake");
  assert.equal(pickGuessId(ids, null), 698);
  assert.equal(pickGuessId(ids, 977, (id) => id === 77144), 77144, "Contexto: the first one with a rank");
  assert.equal(pickGuessId(ids, 977, () => false), null);
  assert.equal(pickGuessId([], 698), null);
});

test("Who Are Ya / Contexto pick: the father's exact name never resolves to the son", () => {
  assert.equal(pickGuessId(lookup.resolveIds("Gary Payton"), 1627780), 56, "a wrong guess (Gary Payton), not the mystery");
  assert.equal(pickGuessId(lookup.resolveIds("Gary Payton"), 1627780, (id) => id === 1627780), null, "Contexto: the father has no rank");
  assert.equal(pickGuessId(lookup.resolveIds("Gary Payton II"), 1627780), 1627780);
  assert.equal(pickGuessId(lookup.resolveIds("Bobby Portis"), 1626171), 1626171);
});

const logoRight = (typed, team) => matchAnswer(typed, [{ answer: team, aliases: teamAnswerAliases(team) }]) === 0;

test("Name the Logo: nicknames, unshared cities, abbreviations and short forms", () => {
  for (const typed of ["Lakers", "lakers", "LA Lakers", "LAL", "Los Angeles Lakers"]) assert.ok(logoRight(typed, "Los Angeles Lakers"), typed);
  for (const typed of ["Sixers", "76ers", "Philly", "Philadelphia", "PHI"]) assert.ok(logoRight(typed, "Philadelphia 76ers"), typed);
  for (const typed of ["Boston", "Celtics", "BOS"]) assert.ok(logoRight(typed, "Boston Celtics"), typed);
  for (const typed of ["LA Clippers", "Clippers", "Clips", "Los Angeles Clippers"]) {
    assert.ok(logoRight(typed, "Los Angeles Clippers"), typed);
    assert.ok(logoRight(typed, "LA Clippers"), `${typed} (data spells it LA Clippers)`);
  }
  for (const typed of ["Blazers", "Trail Blazers", "Trailblazers", "Portland"]) assert.ok(logoRight(typed, "Portland Trail Blazers"), typed);
  for (const typed of ["OKC", "Thunder", "Oklahoma City"]) assert.ok(logoRight(typed, "Oklahoma City Thunder"), typed);
  for (const typed of ["Wolves", "T-Wolves", "Timberwolves"]) assert.ok(logoRight(typed, "Minnesota Timberwolves"), typed);
  for (const typed of ["Dubs", "GSW", "Golden State", "Warriors"]) assert.ok(logoRight(typed, "Golden State Warriors"), typed);
  for (const typed of ["Pels", "Nola", "New Orleans"]) assert.ok(logoRight(typed, "New Orleans Pelicans"), typed);
  for (const typed of ["NY Knicks", "Knicks", "New York"]) assert.ok(logoRight(typed, "New York Knicks"), typed);
  assert.ok(logoRight("Cavs", "Cleveland Cavaliers"));
  assert.ok(logoRight("Mavs", "Dallas Mavericks"));
});

test("Name the Logo: a shared city, a former name or another team is not accepted", () => {
  for (const typed of ["Los Angeles", "LA"]) {
    assert.ok(!logoRight(typed, "Los Angeles Lakers"), typed);
    assert.ok(!logoRight(typed, "Los Angeles Clippers"), typed);
  }
  assert.ok(!logoRight("SuperSonics", "Oklahoma City Thunder"));
  assert.ok(!logoRight("Seattle", "Oklahoma City Thunder"));
  assert.ok(!logoRight("Bobcats", "Charlotte Hornets"));
  assert.ok(!logoRight("New Jersey Nets", "Brooklyn Nets"));
  assert.ok(!logoRight("Clippers", "Los Angeles Lakers"));
  assert.ok(!logoRight("Lakers", "Los Angeles Clippers"));
});

test("Name the Logo: every one of the 30 teams accepts its full name and nickname, and no spelling names two teams", () => {
  assert.equal(nbaTeams.length, 30);
  const owner = new Map();
  for (const team of nbaTeams) {
    const nickname = team.endsWith("Trail Blazers") ? "Trail Blazers" : team.split(" ").pop();
    assert.ok(logoRight(team, team), team);
    assert.ok(logoRight(nickname, team), `${team}: ${nickname}`);
    for (const spelling of teamAnswerAliases(team)) {
      const key = spelling.toLowerCase();
      assert.ok(!owner.has(key) || owner.get(key) === team, `"${spelling}" accepted for ${owner.get(key)} and ${team}`);
      owner.set(key, team);
    }
  }
});

// A 2-2-1 lineup whose box-score slots differ from the cards a fan would pick: Butler started at F.
const LINEUP = [
  { name: "Kyle Lowry", position: "G" },
  { name: "Tyler Herro", position: "G" },
  { name: "Jimmy Butler", position: "F" },
  { name: "Tim Hardaway Jr.", position: "F" },
  { name: "Bam Adebayo", position: "C" },
];

test("Starting Five: the reveal puts each starter in his family's first free card, found ones where they were found", () => {
  assert.deepEqual(lineupSlots(LINEUP), { PG: "Kyle Lowry", SG: "Tyler Herro", PF: "Jimmy Butler", SF: "Tim Hardaway Jr.", C: "Bam Adebayo" });
  assert.deepEqual(lineupSlots(LINEUP, { PG: "Tyler Herro" }), { PG: "Tyler Herro", SG: "Kyle Lowry", PF: "Jimmy Butler", SF: "Tim Hardaway Jr.", C: "Bam Adebayo" });
  const left = [];
  lineupSlots([...LINEUP, { name: "Extra Guard", position: "G" }], {}, (p) => left.push(p.name));
  assert.deepEqual(left, ["Extra Guard"], "a lineup that is not 2-2-1 leaves the extra player out");
});

test("Starting Five: a starter on his own family's card fills that card", () => {
  assert.deepEqual(placeGuess(LINEUP, "SG", "Kyle Lowry", {}), { slot: "SG", name: "Kyle Lowry" });
  assert.deepEqual(placeGuess(LINEUP, "C", "bam adebayo", {}), { slot: "C", name: "Bam Adebayo" });
});

test("Starting Five: a starter typed on another family's card goes to his own card at the reveal", () => {
  assert.deepEqual(placeGuess(LINEUP, "SG", "Jimmy Butler", {}), { slot: "PF", name: "Jimmy Butler" });
  assert.deepEqual(placeGuess(LINEUP, "PG", "Jimmy Butler", { PF: "Tim Hardaway Jr." }), { slot: "SF", name: "Jimmy Butler" });
  assert.deepEqual(placeGuess(LINEUP, "C", "Kyle Lowry", { PG: "Tyler Herro" }), { slot: "SG", name: "Kyle Lowry" });
});

// Starting Five's autocomplete list (/trivia/all-players/), as the keys the game builds from it.
const KNOWN = new Set([...NAMES.map((n) => n.full_name), "Marvin Bagley III", "Kyle Lowry", "Tyler Herro",
  "Jimmy Butler", "Bam Adebayo"].map(nameKey));
// The matcher before the shared names list loads: sameName with the player list only.
const BY_KEYS = starterMatcher(KNOWN);

test("Starting Five: spaces and a one-sided suffix are forgiven; found starters and outsiders are not right", () => {
  assert.deepEqual(placeGuess(LINEUP, "SF", "Tim Hardaway Jr", {}, BY_KEYS), { slot: "SF", name: "Tim Hardaway Jr." });
  assert.equal(placeGuess(LINEUP, "PG", "Kyle Lowry", { SG: "Kyle Lowry" }, BY_KEYS), null);
  assert.equal(placeGuess(LINEUP, "PG", "Dwyane Wade", {}, BY_KEYS), null);
  assert.ok(sameName("Karl Anthony Towns", "Karl-Anthony Towns", KNOWN));
  assert.ok(sameName("A C Green", "A.C. Green", KNOWN));
  assert.ok(sameName("Karl Anthony Towns", "Karl-Anthony Towns"), "the same key needs no player list");
  assert.ok(sameName("Bobby Portis", "Bobby Portis Jr.", KNOWN), "no father in the list");
  assert.ok(sameName("Mike Conley Jr", "Mike Conley", KNOWN), "a suffix the starter's name lacks");
  assert.ok(!sameName("Tim Hardaway", "Penny Hardaway", KNOWN));
  assert.ok(!sameName("", "Tim Hardaway", KNOWN));
});

test("Starting Five: a real player's name never fills another player's card", () => {
  assert.equal(placeGuess(LINEUP, "SF", "Tim Hardaway", {}, BY_KEYS), null, "the father is a real player");
  assert.ok(!sameName("Gary Payton II", "Gary Payton", KNOWN), "the son never fills the father's card");
  assert.ok(!sameName("Gary Payton", "Gary Payton II", KNOWN), "the father never fills the son's card");
  assert.ok(!sameName("Tim Hardaway Jr.", "Tim Hardaway", KNOWN), "the son never fills a 1997 Tim Hardaway");
  assert.ok(!sameName("Marvin Bagley II", "Marvin Bagley III", KNOWN), "two different suffixes");
  assert.ok(!sameName("Bobby Portis", "Bobby Portis Jr."), "without the player list only the same key counts");
  const bagley = [{ name: "Marvin Bagley III", position: "F" }, { name: "Gary Payton", position: "G" }];
  assert.equal(placeGuess(bagley, "PF", "Marvin Bagley II", {}, BY_KEYS), null);
  assert.equal(placeGuess(bagley, "PG", "Gary Payton II", {}, BY_KEYS), null);
});

// The names list with nicknames, as the shared lookup carries them.
const ALIAS_LOOKUP = buildNameLookup([
  ...NAMES,
  { id: 358, full_name: "Penny Hardaway", aliases: ["Anfernee Hardaway"] },
  { id: 1897, full_name: "Metta World Peace", aliases: ["Ron Artest", "Metta Sandiford-Artest"] },
  { id: 406, full_name: "Shaquille O'Neal", aliases: ["Shaq"] },
  { id: 2546, full_name: "Carmelo Anthony", aliases: ["Melo"] },
]);
const WITH_NAMES = starterMatcher(KNOWN, ALIAS_LOOKUP);
const MAGIC_96 = [
  { name: "Anfernee Hardaway", position: "G" },
  { name: "Gary Payton II", position: "G" },
  { name: "Metta World Peace", position: "F" },
  { name: "Tim Hardaway", position: "F" },
  { name: "Shaquille O'Neal", position: "C" },
];

test("Starting Five: aliases and nicknames name a starter through the shared lookup", () => {
  assert.deepEqual(placeGuess(MAGIC_96, "PG", "Penny Hardaway", {}, WITH_NAMES), { slot: "PG", name: "Anfernee Hardaway" });
  assert.deepEqual(placeGuess(MAGIC_96, "SF", "Ron Artest", {}, WITH_NAMES), { slot: "SF", name: "Metta World Peace" });
  assert.deepEqual(placeGuess(MAGIC_96, "C", "Shaq", {}, WITH_NAMES), { slot: "C", name: "Shaquille O'Neal" });
  assert.deepEqual(placeGuess(MAGIC_96, "C", "Shaquille O Neal", {}, WITH_NAMES), { slot: "C", name: "Shaquille O'Neal" });
  assert.deepEqual(placeGuess(MAGIC_96, "SG", "Shaq", {}, WITH_NAMES), { slot: "C", name: "Shaquille O'Neal" }, "own reveal card");
  assert.equal(placeGuess(MAGIC_96, "C", "Shaq", {}, BY_KEYS), null, "before the names load, only the name itself counts");
  assert.deepEqual(placeGuess(MAGIC_96, "C", "Shaquille O'Neal", {}, BY_KEYS), { slot: "C", name: "Shaquille O'Neal" });
  const knicks = [{ name: "Carmelo Anthony", position: "F" }, { name: "Tim Hardaway Jr.", position: "F" }];
  assert.deepEqual(placeGuess(knicks, "SF", "Melo", {}, WITH_NAMES), { slot: "SF", name: "Carmelo Anthony" });
  assert.equal(placeGuess(knicks, "SF", "Melo", {}, BY_KEYS), null, "the nickname counts only through the lookup");
  assert.equal(placeGuess(knicks, "SF", "Shaq", {}, WITH_NAMES), null, "a nickname of a player not in this lineup");
});

test("starterMatcher: a starter whose name is also another player's alias keeps only the player named so", () => {
  const lookup2 = buildNameLookup([
    { id: 1, full_name: "Mike James", aliases: [] },
    { id: 2, full_name: "Michael James", aliases: ["Mike James"] },
  ]);
  const m = starterMatcher(null, lookup2);
  assert.ok(m("Mike James", "Mike James"));
  assert.ok(!m("Michael James", "Mike James"), "Michael James's full name never names the starter Mike James");
  assert.ok(m("Michael James", "Michael James"));
  const lineup = [{ name: "Mike James", position: "G" }];
  assert.equal(placeGuess(lineup, "PG", "Michael James", {}, m), null);
  assert.deepEqual(placeGuess(lineup, "PG", "Mike James", {}, m), { slot: "PG", name: "Mike James" });
});

test("Starting Five: the lookup never crosses father and son", () => {
  assert.equal(placeGuess(MAGIC_96, "SG", "Gary Payton", {}, WITH_NAMES), null, "the father is not Gary Payton II");
  assert.deepEqual(placeGuess(MAGIC_96, "SG", "Gary Payton II", {}, WITH_NAMES), { slot: "SG", name: "Gary Payton II" });
  assert.equal(placeGuess(MAGIC_96, "PF", "Tim Hardaway Jr.", {}, WITH_NAMES), null, "the son is not the 1997 Tim Hardaway");
  assert.equal(placeGuess(MAGIC_96, "PF", "Penny Hardaway", { PG: "Anfernee Hardaway" }, WITH_NAMES), null, "found already");
  assert.deepEqual(placeGuess(LINEUP, "SF", "Tim Hardaway Jr", {}, WITH_NAMES), { slot: "SF", name: "Tim Hardaway Jr." });
  assert.equal(placeGuess(LINEUP, "SF", "Tim Hardaway", {}, WITH_NAMES), null, "the father's exact name");
  assert.deepEqual(placeGuess([{ name: "Bobby Portis Jr.", position: "F" }], "PF", "Bobby Portis", {}, WITH_NAMES),
    { slot: "PF", name: "Bobby Portis Jr." });
});

const mvpRight = (guess, row) => idsHitWinner(row, lookup.resolveIds(guess)) || matchAnswer(guess, acceptedAnswers(row)) >= 0;
const mvp1971 = {
  season: "1970-71", mvp: "Kareem Abdul-Jabbar", award: "MVP", prompt: "Who was the MVP in 1970-71?",
  winners: [{ name: "Kareem Abdul-Jabbar", person_id: 76, team: "Milwaukee Bucks", team_logo_url: null }],
};
const roy1995 = {
  season: "1994-95", mvp: "Grant Hill", award: "Rookie of the Year", prompt: "Who was the Rookie of the Year in 1994-95?",
  winners: [
    { name: "Grant Hill", person_id: 255, team: "Detroit Pistons", team_logo_url: null },
    { name: "Jason Kidd", person_id: 467, team: "Dallas Mavericks", team_logo_url: null },
  ],
};

test("Guess the MVP: an alias, a spacing variant and any co-winner are right", () => {
  assert.ok(mvpRight("Lew Alcindor", mvp1971));
  assert.ok(mvpRight("Kareem Abdul Jabbar", mvp1971));
  assert.ok(mvpRight("Jason Kidd", roy1995));
  assert.ok(mvpRight("grant hill", roy1995));
  assert.ok(!mvpRight("Kobe Bryant", mvp1971));
  assert.ok(!mvpRight("Lew Alcindor", roy1995));
});

test("Guess the MVP: the father's exact name is not the son's award", () => {
  const dpoy2023 = {
    season: "2022-23", mvp: "Jaren Jackson Jr.", award: "Defensive Player of the Year",
    prompt: "Who was the Defensive Player of the Year in 2022-23?",
    winners: [{ name: "Jaren Jackson Jr.", person_id: 1628991, team: "Memphis Grizzlies", team_logo_url: null }],
  };
  assert.ok(!mvpRight("Jaren Jackson", dpoy2023));
  assert.ok(mvpRight("Jaren Jackson Jr", dpoy2023));
  assert.ok(mvpRight("jaren jackson jr.", dpoy2023));
});

test("Guess the MVP: an old row without person_id still accepts the exact name", () => {
  const legacy = { season: "1999-00", mvp: "Kobe Bryant" };
  assert.equal(idsHitWinner(legacy, [977]), false);
  assert.ok(mvpRight("Kobe Bryant", legacy));
});

const careerRight = (raw, player) =>
  lookup.resolveIds(raw).includes(player.person_id) || matchAnswer(raw, [{ answer: player.full_name, aliases: player.aliases }]) === 0;

test("Career Path: the shared lookup accepts suffix-less, hyphen-less and dot-less names", () => {
  assert.ok(careerRight("Karl Anthony Towns", { person_id: 1626164, full_name: "Karl-Anthony Towns", aliases: [] }));
  assert.ok(careerRight("A C Green", { person_id: 920, full_name: "A.C. Green", aliases: [] }));
  assert.ok(careerRight("Bobby Portis", { person_id: 1626171, full_name: "Bobby Portis Jr.", aliases: [] }), "no father");
  assert.ok(careerRight("Mike Conley Jr", { person_id: 201144, full_name: "Mike Conley", aliases: [] }));
  assert.ok(careerRight("Tim Hardaway Jr", { person_id: 203501, full_name: "Tim Hardaway Jr.", aliases: [] }));
  assert.ok(!careerRight("Kobe Bryant", { person_id: 203501, full_name: "Tim Hardaway Jr.", aliases: [] }));
});

test("Career Path: the father's exact name is not the son", () => {
  assert.ok(!careerRight("Gary Payton", { person_id: 1627780, full_name: "Gary Payton II", aliases: [] }));
  assert.ok(!careerRight("Tim Hardaway", { person_id: 203501, full_name: "Tim Hardaway Jr.", aliases: [] }));
  assert.ok(!careerRight("Jaren Jackson", { person_id: 1628991, full_name: "Jaren Jackson Jr.", aliases: [] }));
  assert.ok(careerRight("Gary Payton", { person_id: 56, full_name: "Gary Payton", aliases: [] }));
});
