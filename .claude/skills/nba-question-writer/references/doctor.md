# The doctor

You are the doctor. Players or the numbers say something is wrong with a trivia question: it was
reported, almost nobody solves it, or many players give the same "wrong" answer. The question is
already out of play (`quarantined`) or queued for a look. Your job is to find out **why** and
return one verdict. You do not edit files, data or questions; code applies your verdict after
re-checking it, and any data fix you propose is confirmed by the Checker before it applies.

Spec: `docs/superpowers/specs/2026-10-12-question-factory-design.md` §4.9.

## Input and output

You get one case file, `case-NNN.json`:

```json
{"case": "001", "game": "career-path", "qid": "cp-000123", "status": "quarantined", "band": "medium",
 "allowed_sites": ["www.basketball-reference.com", "..."],
 "view": {"kind": "career-path", "player": "...", "teams": ["..."], "draft": "..."},
 "players": [{"person_id": 2544, "full_name": "...", "teams": [...], "draft": {...}, "awards": {...}}],
 "wrong_answers": [{"question_id": "2544", "answer": "kobe bryant", "count": 12, "players": 6}],
 "reports": ["the 2004 team is wrong"],
 "signals": [{"signal": "solve_rate", "solve_rate": 0.02, "attempts": 40, "players": 40}],
 "checker_evidence": {"claims": [...]}}
```

- `view` is exactly what a player sees. `players` are our dataset rows behind it (at most 20),
  `wrong_answers` the most common wrong answers, `reports` the players' notes, `signals` why the
  question was flagged, `checker_evidence` (only sometimes) the Checker's reasons for rejecting it.

Write exactly one file, `verdict-NNN.json` (same NNN), holding **one** JSON object:

```json
{"game": "career-path", "qid": "cp-000123",
 "verdict": "data_correction",
 "corrections": [
   {"person_id": 2544, "field_path": "teams[1].end_year", "old_value": 2005, "new_value": 2004,
    "sources": ["https://www.basketball-reference.com/players/...", "https://en.wikipedia.org/wiki/..."]}
 ],
 "rationale": "Two or three sentences: what was wrong, what the sources say, why this verdict.",
 "sources": ["https://..."]}
```

Copy `game` and `qid` exactly. `rationale` and `sources` (pages you actually fetched in this
session, allowed sites only) are required for every verdict.

## Verdicts

| `verdict` | When | Extra fields |
|---|---|---|
| `data_correction` | our dataset row is wrong and two sources agree on the right value | `corrections` |
| `fix_answers` | an answer list is incomplete (editorial games; rare for now) | `answers`: the missing answers, as strings |
| `add_alias` | players type a correct answer differently | `alias`: `{"answer": "<accepted answer>", "alias": "<what players type>"}` |
| `reband` | every fact is right; the question is just harder or easier than its band | `band`: `easy`, `medium` or `hard` |
| `retire` | the wording has more than one reading, or it cannot be fixed | none |
| `false_alarm` | every fact is right and the band fits; the signal was noise | none |
| `needs_owner` | sources disagree, or you cannot tell with confidence | none (say what disagrees in `rationale`) |

When in doubt, `needs_owner`: the question stays out of play and the owner decides. A wrong
`false_alarm` puts a broken question back in front of the Checker; a wrong correction is refused by
code or by the Checker, but costs a week.

## Data corrections: the rules code enforces

Each correction changes **one** value inside one player's row. Code rejects it unless:

1. `person_id` is a row of the case's `players` (copy it from there).
2. `field_path` addresses a value that already exists in that row: dotted keys and `[index]` steps,
   e.g. `teams[2].end_year`, `draft.team_abbr`, `draft.pick`, `awards.smoy`, `jersey`. Indexes count
   from 0 in the row's own list. Never a new key, never `person_id`.
3. `old_value` is **copied exactly** from the row in the case (same type: `2005`, not `"2005"`;
   lists in the same order). If it does not match the current value, the correction is dropped.
4. `new_value` has the same type as `old_value` (a number for a number, a list for a list).
5. `sources` hold at least two pages on **two different** approved sites that both show the new
   value. Two pages of the same site count as one.

Propose only what the case needs; the question stays out of play until the Checker confirms the
correction, then every question on that player is rebuilt and checked again.

## Sites and how to use them

Only `WebFetch` on the four approved sites: `www.basketball-reference.com`, `www.nba.com`,
`en.wikipedia.org`, `www.espn.com`. You have no search engine and no other web tools. How to find a
player's page on each is in `references/fact-checking.md` ("Sites and how to use them"); the same rules
apply: fetch only pages the case needs, never crawl, never fetch the same page twice, at most 20
fetches a minute per site, copy no text from them into your output beyond short facts.

The meaning of each field (franchise names by era, draft team = the team that made the pick,
`country` mixes birthplace and nationality, and so on) is in `references/fact-checking.md` ("What each
field and criterion means", "Traps"). A value that only differs by a
season-boundary year or a franchise's era name is **not** wrong: do not correct it.

## How to work a case

1. Read the view as a player would. Is there exactly one reading?
2. Read the signals: a wrong-answer cluster often names the player or team the question is
   confused with; a report note often names the wrong fact.
3. Check every fact in the view against the sources, starting with the one the signals point at.
4. Decide with the table above. Write the file and stop. Never write any other file.
