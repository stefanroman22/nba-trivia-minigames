# Who Would Win (`who-would-win`)

A vote between two great teams: "'96 Bulls" vs "'17 Warriors", each with a sub line (record, stars). No
right answer: 10 points when your side has at least as many votes, 5 when fewer.

## At a glance

| | |
|---|---|
| One question | one matchup: `{"a": side, "b": side}`, side = `{"season", "franchise", "sub"}` |
| Written by | the question writer only |
| Categories | none |
| Difficulty | not served (a vote) |
| Capacity | any two real playoff team-seasons (990 across 80 seasons) or decades; interest favours deep runs |
| Minimum live | 30 |
| Code | `backend/trivia/questions/games/who_would_win.py`; seed votes `seed_who_would_win_votes` |

## Definition

```json
{"a": {"season": "1995-96", "franchise": "Chicago Bulls", "sub": "72-10 · Jordan, Pippen, Rodman"},
 "b": {"season": "2016-17", "franchise": "Golden State Warriors", "sub": "67-15 · Curry, Durant, Klay, Draymond"}}
```

`season` is "1995-96" or a decade ("1960s"); `franchise` is spelled as playoff.json spells it **that
season**. The label ("'96 Bulls", "'60s Celtics") is generated (nicknames: Sixers, Mavs, Cavs, Wolves,
Sonics).

## Rules the code enforces

- Both sides are real playoff team-seasons and differ; `sub` not empty, at most 90 characters; label at
  most 60.
- Interest (pedigree: title 1, lost Finals 0.75, conference finals 0.5, semifinals 0.25; mean of both) at
  least 0.3: two early exits fail.
- One team-season appears in at most max(3, 5% of matchups).

## Patterns

- Matchups fans argue about: champions across eras, dynasties, great teams that lost.
- Every fact in `sub` is true for that season (record, each named player was on that team that season).

## Ask before writing

1. How many matchups. 2. A theme (an era, a franchise, "teams that never won")? If not a plain filter, ask
   for examples.

## Duplicates

The two "season franchise" strings, sorted: a swapped pair is the same matchup.

## Make it live

Payload `add`: `{"definition": {...}}`; publish `games=who-would-win`. New matchups start with no votes
unless seeded (`seed_who_would_win_votes`, ask Stefan).
