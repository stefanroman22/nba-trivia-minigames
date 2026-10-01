---
name: nba-question-writer
description: Write, expand, audit or fix NBA trivia content for the nba-minigames games: Fan Favorites survey boards, Tic-Tac-Toe criteria, Career Path and Who Are Ya player picks, Contexto secrets, MVP/series/starting-five/logo/wordle pools. Use this whenever a task adds or edits questions, answers, aliases, criteria labels, player facts or question pools, reviews trivia data for errors, or asks to "expand question pools", "add questions", "fix a wrong answer" or "make the questions better", even if the word "skill" is never mentioned.
---

# NBA question writer

This project's trivia has shipped wrong facts before, because content was written from memory
("from careful knowledge"): Chris Paul in a 2003 draft group, Serge Ibaka "born in Spain", career
totals rounded to the nearest 1,000. Players notice, lose a heart for a correct answer, and stop
trusting the game. Your job is content a basketball fan would call fair, correct and fun.

## Three kinds of content

Each live game gets its content one way. Read the matching game file before touching anything.

| Kind | Games | What you actually edit |
|---|---|---|
| Hand-written text | fan-favorites | `backend/trivia/data_static/fan_favorites_seed.json` |
| Code-generated from player data | career-path, who-are-ya, tictactoe, contexto | generator rules in `backend/trivia/questions/games/<slug>.py`, and the player rows they draw from |
| Data pools from real records | guess-mvps, series-winner, starting-five, name-logo, wordle | source data and builders, never hand-typed rows |

Game files, one per live game: `references/games/<slug>.md`.
Hidden games (`HIDDEN_GAMES` in `backend/trivia/games/__init__.py`) are out of scope unless asked.

## Workflow

1. **Scope.** Name the game(s) and read their file in `references/games/`.
2. **Source every fact.** Read `references/fact-checking.md`. A fact you cannot point to a source
   for does not ship. Memory is for suggesting what to look up, never for the answer itself.
3. **Draft** using `references/writing-style.md`, and pick topics and difficulty with
   `references/what-players-want.md`.
4. **Self-review each item** against the checklist below.
5. **Validate** with the commands in the game file, then the backend tests.
6. **Report** in the format below.

## Checklist for every item

- One defensible answer set, and it is complete. On survey boards a missing valid answer costs a
  heart, so completeness is a correctness rule, not a nice-to-have.
- Every fact checked against a named source, with "as of" for anything that can still change.
- Stat scope stated: NBA or NBA/ABA, regular season or playoffs.
- Player names match `all-players.json` spelling; accented and plain forms both accepted.
- Reads like a person wrote it (see writing style).
- Not a duplicate or near-duplicate of an existing item.

## Report

End with: what changed (ids/files), the source used for each new fact, anything you could not
verify and left out, and the validation commands you ran with their results. Flag existing items
you found wrong instead of silently rewriting unrelated ones.
