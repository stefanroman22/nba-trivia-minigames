# Career Path (`career-path`)

The player sees one mystery player's career as cards, one per team stint (franchise, years, games, points
per game), the draft line on the last card, and types who it is.

## At a glance

| | |
|---|---|
| One question | one player: `{"person_id": N}` |
| Written by | the question writer picks the player; the cards come from the dataset |
| Categories | none |
| Difficulty | not served (internal score only). Adding levels: `references/flow-difficulty.md` |
| Capacity | eligible players (685 on the 2026-10 dataset) minus any already used in any status: `capacity` lists the best-known unused ones |
| Minimum live | 50 (spec) |
| Code | `backend/trivia/questions/games/career_path.py`, spec `specs/career-path.json`, renderer `src/Game Renderers/CareerPath.tsx` |

## Rules the code enforces

- The player is playable, has 3 to 7 stints, and fame band DEEP or better.
- Interest (`memorable` stints / 2) at least 0.3: at least one memorable stop (a ring, an All-Star-level
  stint, or a marquee team).

## Patterns

- A career that tells a story through its stops (Chris Webber, Vince Carter, Chauncey Billups). A one-team
  star is not eligible; a journeyman with no memorable stop fails interest.
- Check the cards: stints in order, years, GP and PPG per stint (fact-checking guide, "Career Path").

## Ask before writing

1. How many players.
2. Any era, team, position or fame preference ("90s stars", "journeymen"): if it is not a plain filter on
   the data, ask for example players he'd count.

## Every valid answer accepted

Career Path matches **exactly** after normalizing (no space removal, no suffix fallback): "Karl Anthony
Towns", "Tim Hardaway" (for Jr.), "A C Green" fail unless they are aliases. `check` replays them: fix
each with a player alias (payload `aliases`). Add nicknames (`typed_forms`) for famous players.

## Duplicates

One player is one question, ever (any status counts: `capacity` already leaves used players out).

## Make it live

Payload `add`: `{"definition": {"person_id": 1503}}` (+ `aliases` if the check asked for them); publish
`games=career-path`.
