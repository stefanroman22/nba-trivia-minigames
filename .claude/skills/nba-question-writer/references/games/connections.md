# Connections (`connections`) — hidden game

Hidden (`HIDDEN_GAMES`): not playable on the site, and `publish_game_data_v3` does not know it, so a new
board cannot reach players. Write Connections boards only when Stefan asks for this game by name, and tell
him first that they will not be live.

## At a glance

| | |
|---|---|
| One question | one board: 4 groups of 4 players, each group a label and a difficulty 1-4 |
| Categories | the groups' kinds (draft class, college, country, roster, award) |
| Difficulty | per group (1-4), shown to players as the tier colour |
| Code | `backend/trivia/questions/games/connections.py`, `connections_validate.py`, seed `connections_seed.json` |

## Rules the code enforces

- 4 groups, 4 members each, 16 distinct players, difficulties exactly 1, 2, 3, 4.
- A group with a rule: every member playable and matching it, and no member of another group matching it.
- Every label is checked against its own members (draft year, jersey, "Born in X", "No. 1 overall pick",
  positions, colleges) and against the other groups' members (traps).

## Every valid answer accepted

Players pick tiles, no typing. The risk is a member who also fits another group's label: check every
member against every label, not only his own.

## Duplicates

The sixteen members, folded and sorted. A repeated group (the same four players) is also a duplicate for
us, though code only checks it over the whole seed.
