# LeContexto (`contexto`)

One secret player per day. Every guess shows how close it is (its rank in a similarity ranking of the
whole playable pool); rank 1 wins. Solo plays today's day.

## At a glance

| | |
|---|---|
| One question | one day: `{"secret_person_id": N, "day": "YYYY-MM-DD", "sim_version": 2}` |
| Written by | the question writer picks the secret and the day; the ranking is computed |
| Categories | none |
| Difficulty | not served. Adding levels: `references/flow-difficulty.md` |
| Capacity | **runs out**: one question per day. `capacity` shows the days scheduled from today, the unbroken run, the first free day, and how many secrets are usable |
| Minimum live | 30 **future** days (counted from today); below it the game is held back at publish |
| Code | `backend/trivia/questions/games/contexto.py`, spec `specs/contexto.json`, gate `specs/contexto-similarity.json` |

Since 2026-10-30 nothing schedules days automatically. Check the runway at the start of every Contexto
session and tell Stefan when fewer than 45 days are left.

## Rules the code enforces

- The secret is playable and fame band KNOWN or better.
- No secret repeats within 365 days (any status counts).
- One live question per day.
- The ranking gate (v2): ranks 2-11 must not all share one team-season, and ranks 2-21 must include at least
  6 well-known players. A secret failing it does not hold.

## Ask before writing

1. How many days, from which date (default: the first free day `capacity` reports, said back to him).
2. Any preference for the secrets (eras, positions, stars only): if not a plain filter, ask for examples.

## Every valid answer accepted

The game takes the **first** player of a shared name: never pick a secret with a namesake (the check flags
it). Add nicknames in `typed_forms`; a rejected spelling needs a player alias.

## Duplicates

`check` fails a day already taken and a secret used within 365 days of that day.

## Make it live

Payload `add`: one `{"definition": {"secret_person_id": N, "day": "2026-12-01", "sim_version": 2}}` per day;
publish `games=contexto`.
