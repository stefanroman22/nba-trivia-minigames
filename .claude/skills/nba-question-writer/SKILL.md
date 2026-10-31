---
name: nba-question-writer
description: Use when Stefan asks to write, add, generate, expand, replace or fix questions, boards, puzzles or answers for a Swish Quest game (Tic-Tac-Toe, Career Path, Who Are Ya, Contexto, Fan Favorites, Who Would Win, Connections, Guess the MVP, Series Winner, Starting Five, Name the Logo, Wordle), asks how many more a game can take, or asks to add Easy / Medium / Hard difficulty to a game or to label existing questions by difficulty.
---

# NBA question writer

You write questions for Swish Quest with Stefan, in a chat he started. Two things decide whether a
question is good, in this order: **every correct answer a player can type is accepted**, and **it is
exactly the kind of question Stefan asked for** (game, category, difficulty). A fan who types a correct
answer and loses a heart stops trusting the game. A question you guessed the meaning of is wrong even
when its facts are right.

There is no Checker and no automation (owner, 2026-10-30). Nothing reviews your work after you. So you
ask until you understand, you prove every answer with the tools, and Stefan says "go" before anything
is live.

## The two jobs

| Stefan wants | Do |
|---|---|
| New questions for a game (one or many), or a question fixed | the **write flow** below |
| Easy / Medium / Hard for a game that has none, new examples for a level, or existing questions labeled | `references/flow-difficulty.md` |
| "How many more can we make?" | step 0 of the write flow, then stop |

## Rules that hold in every step

1. **Stefan is in this session.** If you are running unattended (a pipeline card, CI, `claude -p`, a
   routine, a subagent with no human to answer), stop and report that the question writer needs Stefan.
2. **Ask, then write.** Every question you need answered is asked and answered before you write
   anything (step 4). An unanswered question is not a yes. You never write "unless you say otherwise",
   "I'll assume", or "if I don't hear back".
3. **You never define a category or a difficulty yourself.** Its meaning comes from the game guide
   (`references/games/<slug>.md`), the difficulty guide (`references/difficulty/<slug>.md`) or Stefan's
   examples. When those don't settle it, you ask Stefan for examples.
4. **Every valid answer accepted.** A question is not finished until `question_writer check` passes for
   it with zero rejected spellings (`references/answers.md`).
5. **Facts come from sources, never memory** (`references/fact-checking.md`).
6. **Labels are yours.** Once a difficulty guide exists you label questions yourself, with a reason
   from the guide. You never ask Stefan which level a question is.
7. **Live only on Stefan's go,** given in this session after he saw the final questions
   (`references/production.md`). No pending queue, no Checker, nothing scheduled.

## The write flow

Each step is a gate: finish it before the next.

**0. Read and count.** Read `references/games/<slug>.md`. For the five record-based games (Guess the
MVP, Series Winner, Starting Five, Name the Logo, Wordle) the guide gives the numbers: they take no written
questions. For the others, get the production state (`references/production.md`: export) and run
`question_writer capacity --game <slug> --existing <export>`.
- The game cannot take new questions (a record-based game, or nothing left to pick from): tell Stefan
  now, with the numbers and the reason, before asking anything else. Stop there.
- Fewer left than he asked for: tell him how many are left and ask how many to make.

**1. Game.** Name the game back to him. If the request could mean two games ("a player guessing game"),
ask which.

**2. Category and difficulty.** The game guide's "Categories" and "Difficulty" sections say what exists.
- The game has categories and he named none: ask which, listing them.
- The game serves difficulty and he named no level: ask which.
- He named a level for a game with no difficulty guide yet: tell him the game has no Easy / Medium / Hard
  and ask whether to set it up first (`references/flow-difficulty.md`), or write without a level.
- **What he asked for is not exactly a category or level the guides define** ("90s Bulls", "tricky ones",
  "about big men", "hard" with no guide): ask for examples. Use the template below, then write back the
  pattern you took from them in two or three lines and ask him to confirm it before going on.

**3. The brief.** Ask everything the game guide lists under "Ask before writing" that he has not
answered (how many, theme, era, which day, ...). Then play the whole brief back in one short paragraph
and wait for his yes. Starting before the yes is a red flag.

**4. Write.** Build each question strictly from the game guide's rules and patterns and the difficulty
guide, facts from sources. Put them in a proposals file (shape in `references/production.md`). For
each answer you know fans type differently (nicknames, former names, short forms), add it to
`typed_forms` so the check proves it is accepted.

**5. Duplicates and rules.** Run `question_writer check --game <slug> --file <proposals> --existing <export>`.
- A **duplicate** (of a live question, a retired one, or another proposal): drop that question and go
  back to step 4 **for that question only** with a new idea, not a reworded copy. Run the check again.
- **Does not hold** (a game rule fails, interest too low, wrong level by the game's rules): fix it within
  the brief or replace it, and check again.

**6. Every valid answer accepted.** Read the check's accepted-answer list for every question.
- **Complete:** for a "name a ..." set or a grid cell, list the full set from a source and compare. A
  missing valid answer is a failure even when the check passes.
- **Every spelling:** zero rejected spellings. Fix each one as `references/answers.md` says (an alias on
  the board, or an alias for the player) and check again until it passes.

**7. Show and go.** Show Stefan each final question: what the player sees, the accepted answers (count
and the best-known ones), the level and its reason, and anything you fixed or left out. Ask for the go to
put them live. On his go, follow `references/production.md`, then confirm they load on the live site.

## How to ask

- One message, numbered questions, each answerable in a line, each saying why it matters.
- Ask only what the guides do not settle. Don't ask about things the rules decide, and never ask for a
  label.
- Examples, when a category or level is not exact:

  > I don't have a rule for "<what he said>" yet, and I don't want to guess what it means. Could you give
  > me 3 to 5 example questions you'd count as "<it>", from another app or made up, and one or two you
  > would *not* count? A line each is enough.

- If his examples leave the boundary open (two of them pull in different directions), ask one targeted
  follow-up with a concrete pair: "Would you count A? And B?"

## Red flags: stop and go back

| You catch yourself... | Instead |
|---|---|
| writing what "hard" or a theme means from your own sense of the game | ask for examples (rule 3) |
| "unless you say otherwise I'll ...", "if I don't hear back ..." | ask and wait (rule 2) |
| starting to write before he said yes to the brief | step 3 |
| offering a Checker run, a pending queue, or "a check before it goes live" by another agent | there is none: you prove it with `check` |
| shipping with "the rule computes the answers, so it's complete" | compare against a source (step 6) |
| rewording a duplicate until the check stops flagging it | new idea for that question (step 5) |
| asking Stefan which level a question is | label it from the guide (rule 6) |
| "the game can probably take more" | step 0: count it |

## Tools (backend, `venv/Scripts/python.exe manage.py question_writer ...`; set `PYTHONIOENCODING=utf-8` on Windows)

| Action | What it does |
|---|---|
| `export --game G` | production state: every question, its status and label, and the active data corrections (runs on prod) |
| `capacity --game G --existing X` | how many more the game can take and what is left to pick from |
| `check --game G --file P --existing X [--report R]` | holds? duplicate? accepted answers, every typed spelling replayed through the game's own matching |
| `apply --file A [--dry-run]` | the only write: player spellings, new questions (live at once, with label), labels (runs on prod) |

Details and the production steps: `references/production.md`. Game guides: `references/games/<slug>.md`.
Style: `references/writing-style.md`, `references/what-players-want.md`.

The `author.md`, `doctor.md` and `reviewer.md` references belong to retired, disabled automations; the
writer does not use them.
