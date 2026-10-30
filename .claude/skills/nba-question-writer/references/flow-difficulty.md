# Difficulty: from Stefan's examples to labels on every question

Use this to give a game Easy / Medium / Hard, to add examples to a level, or to (re)label existing
questions. The output is a written guide, `references/difficulty/<slug>.md`, and a label with a reason on
every question. Once a label is applied it is done: no further check.

Stefan gives **examples**; you write the **guideline** and decide every **label**. You never ask him to
label a question, and you never fill a level's meaning with your own taste.

## D0. Scope

1. Which game? Read `references/games/<slug>.md` ("Difficulty") and `references/difficulty/<slug>.md` if
   it exists.
2. Does the game **serve** difficulty to players today? (Only Tic-Tac-Toe does, 2026-10-30.) If not, tell
   Stefan: labels can be stored now, but players see a level switch only after a code change (the
   checklist at the end). Ask whether that code change is part of this job.
3. Which level does he want to start with? He does not have to give all three at once.

## D1. Examples for one level

Ask for examples of that one level:

> For <game>, could you give me at least 5 example questions you'd call **<level>**, from another app or
> made up, and 2 or 3 that are close but *not* <level> (too easy or too hard)? For each, a few words on
> why, if you can. The more different they are from each other, the better I can find the pattern.

Enough means: at least 5 clear examples of the level, at least 2 counter-examples, and examples that differ
on the game's main axes (for a player game: era, fame, position; for a grid: the kind of column; for a
survey: the category and the size of the answer set). If they cluster on one axis, ask for 2 or 3 more
that differ on the axis they did not cover. Ask a targeted pair question when two examples pull apart.

## D2. The guideline

Write or extend `references/difficulty/<slug>.md` (template: `references/difficulty/_template.md`). For
the level:

- **In Stefan's words:** what he said makes these questions this level.
- **Signals:** the measurable facts that separate this level, in the game's own data fields (fame band,
  last season, number of answers, how many well-known answers, column kind, decade, ...). Each signal
  cites which of his examples shows it.
- **Clear examples:** his examples, plus questions you checked against the signals that fit them
  without doubt.
- **Not this level:** his counter-examples and why.
- **Boundary:** how to decide a question that is near another level.

Show Stefan the guideline section and ask one thing: "Does this capture what you mean by <level>?" If he
corrects it, the correction is a new example: update the section. This is the only confirmation you ask
for; labels are never shown for approval one by one.

## D3. Label pass for that level

1. Export the game (`references/production.md`). Work only on active questions.
2. **Turn the signals into a script** in your scratchpad that reads the export and the dataset and gives
   each question a score per signal. Run it on Stefan's examples first: every example must land in its
   level and every counter-example outside it. If not, the script (or the guideline) is wrong: fix it
   before labeling anything.
3. Label a question with this level only when the signals put it there with **strong reasons** (it meets
   the level's signals clearly, not at the edge). Write the reason: the guideline rules it meets.
4. Read the borderline ones yourself (near a threshold, signals that disagree) and decide each with the
   boundary rule. Leave a question unlabeled when the guideline does not decide it yet.
5. Read a random 20 of the labeled ones as a spot check. A wrong one means the script is wrong: fix and
   rerun.

## D4. The next level, and relabeling

Repeat D1 to D3 for the next level Stefan wants. The scan covers the **unlabeled** questions and the
**already labeled** ones:

- Change an existing label only when the new level's guideline claims the question with strong reasons
  **and** its current label's reason is weaker (it met its rule at the edge, or the new guideline names
  exactly this kind of question). Write both reasons in the new label.
- Labels with source `owner` (set by Stefan in the admin panel) are never changed; `apply` keeps them.

## D5. Questions no guideline claims

When every level Stefan wants has a guideline, some questions may still be unlabeled. Decide each from the
guidelines' boundary rules; if a game convention exists (Tic-Tac-Toe: no label means hard), say you
applied it. Do not ask Stefan.

## D6. Apply

1. A labels payload (`references/production.md`), dry run on production, read the report.
2. Show Stefan the counts per level, five clear examples of each, and how many labels changed from what
   they were. Ask for the go.
3. Apply, publish, confirm the live index carries the levels (Tic-Tac-Toe items are `[qid, level]`).

## Serving difficulty in a game that does not have it (code change)

This is a code change, so it follows the repo rules (a branch, a PR to dev, Stefan's promote). It copies
Tic-Tac-Toe's wiring (PR #147):

- backend `trivia/questions/games/<module>.py`: an `index_label(row, item)` that returns the index item
  with the label (no label = hard); check how `runner._kept` calls it for Tic-Tac-Toe.
- backend `trivia/admin_questions.py`: add the slug to `LABEL_GAMES` (the admin labeler).
- frontend `src/utils/GameUtils.tsx`: the game's `difficulties` list; the fetch passes `opts.difficulty`
  (`src/utils/gameData.ts` `pickQuestion` already narrows by `item[1]` and falls back to all).
- multiplayer: the relay reads `item[0]` only; leave it random unless Stefan asks.
- tests for the label in the index; the game's ui-check on all viewports (it is a UI change).
