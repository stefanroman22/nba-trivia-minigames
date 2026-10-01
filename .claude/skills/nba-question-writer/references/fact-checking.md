# Fact-checking

## Where facts come from

In order of preference:
1. The project's own fetched data: the `Player`, `Mvp`, `PlayoffSeries`, `StartingFiveGame` and
   `Team` tables and the files built from them (`backend/trivia/data/*.json`). These came from
   nba_api, not memory.
2. Basketball-Reference (basketball-reference.com) for awards, draft, career totals and team stints.
3. NBA.com for official records and current rosters.
4. Wikipedia only to find a fact you then confirm in 1-3.

`players_curated.json` is partly hand-authored and has known errors (rounded career totals,
wrong draft team for draft-night trades, inconsistent franchise names). Treat it as a draft, not
a source. Never hand-edit player facts there; `docs/games/DATA_REQUIREMENTS.md` says to regenerate
them (`generate_players_curated --rewrite-all-players`).

If you have no web access and no project data covers the fact, leave the item out and say so in
your report. A smaller correct set beats a bigger one with a guess in it.

## Traps that have bitten this project or similar games

- **Draft-night trades.** "Drafted by" is the team that made the pick, not where he played
  (Dončić: Atlanta picked, traded to Dallas; Gilgeous-Alexander: Charlotte picked, traded to the Clippers).
- **Franchise renames and moves.** Seattle/Oklahoma City, New Jersey/Brooklyn, Charlotte
  Bobcats/Hornets, New Orleans Hornets/Pelicans, Vancouver/Memphis. Use the name in force that
  season: Durant was drafted by the Seattle SuperSonics, not "Oklahoma City".
- **ABA.** NBA career lists exclude ABA stats. Erving's 30,026 is NBA+ABA combined. Say which.
- **Untracked eras.** Blocks and steals start in 1973-74; the three-point line in 1979-80.
  "All-time" claims silently skip earlier players.
- **Regular season vs playoffs.** Default records are regular season; say so.
- **Records that move.** Scoring lists, active-player counts, "most ever" and recent champions.
  Re-check before every edit, and date the item.
- **Group labels must fit their own members.** The connections validator only checked that other
  groups did not fit, so "2003 Draft" shipped with Chris Paul (2005). Check every member against
  its own label, not only against the others.
- **Duplicate and look-alike names.** Bojan Bogdanović vs Bogdan Bogdanović; DuVal vs Duval; two
  "Patrick Ewing" and two "Larry Johnson" rows in `players_curated.json`. Look players up by `person_id`.
- **Fields that do not mean what they say.** `country` mixes birthplace and nationality (Kyrie
  Irving shows Australia); `height_in` is the listed height (Durant 6'11"). Do not build a label
  on a field a fan can dispute.
- **Undrafted and missing college** are real values, not missing data.

## Completeness checks for "name a ..." sets

When the set is closed and finite (MVPs, #1 picks, champions), list it from a source end to end,
then compare against your draft. The first audit found boards missing John Wall, Kevin Durant,
Kareem Abdul-Jabbar and Dennis Rodman because they were built from recall.
