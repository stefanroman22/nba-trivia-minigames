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

## Sites and how to use them

Prefer these four sites (the only ones the retired automations were allowed to fetch).

| Site | Use for | How to get the page |
|---|---|---|
| `www.basketball-reference.com` | stints, draft, awards, height, birth year, positions, jerseys | `https://www.basketball-reference.com/search/search.fcgi?search=First+Last` (redirects to the player page when the name is unique) |
| `www.nba.com` | official bio, draft | `https://www.nba.com/player/<id>/<first-last>` when you already know the id (the `/stats/` pages render nothing useful); otherwise skip |
| `en.wikipedia.org` | cross-checks, franchise names and moves | `https://en.wikipedia.org/wiki/First_Last` or `https://en.wikipedia.org/wiki/Special:Search?search=First+Last+basketball` |
| `www.espn.com` | second source for recent seasons and transactions | only when a page above is ambiguous |

Rules: fetch only pages a claim needs, never crawl, never fetch the same page twice
(reuse what you read), at most 20 fetches a minute per site. Copy nothing from these pages into
a question.

## What each field and criterion means

The dataset's fields come from NBA.com's own data: a fact is right when it holds in the meaning below, not a stricter one.

**Player facts** (the fields a view contains; `who-are-ya` shows player, position, birth year,
jersey, draft and teams; `contexto` player, position, draft and teams):

| Field | Means | Counts as confirmed when |
|---|---|---|
| `player` | the player's name | the page is clearly this player (match on stints and years, not the name alone; there are namesakes) |
| `teams` | `"<franchise name> <first season start>-<last season end or present>"` per stint, in order | he played for that franchise in those seasons; years may differ by 1 at either end (season-boundary conventions); the franchise may appear under its name of that era (Seattle SuperSonics = Oklahoma City Thunder) |
| `position` | G, F, C, G-F or F-C | one of his listed positions falls in it |
| `height_in` | listed height in inches | within 1 inch of a listed height |
| `birth_year` | year of birth | exact |
| `country` | NBA.com's country field | birthplace or national team; both are used by NBA.com |
| `jersey` | his listed number | he wore it in the NBA at some point |
| `draft` | `"<year> round <r> pick <p> by <abbr>"` or `"undrafted"` | year, round and pick exact; the team is the team **that made the pick** (a draft-night trade is a mismatch: contradicted) in its modern abbreviation |

**Career Path** (`kind: career-path`): every card is a claim: `"<franchise> <years>, GP <n>, PPG <x>"`,
in order, plus the `draft` line shown on the last card. A missing or extra stint is a
contradiction. GP is regular-season games for that franchise in that stint (within 2 of the
source); PPG is points per game in that stint (within 0.3). Use Basketball-Reference's per-team
season rows, adding up the seasons of the stint.

**Contexto** (`kind: contexto`): the secret player's facts as above; the ranking is computed by code
and is not yours to check.

**Tic-Tac-Toe** (`kind: tictactoe`): the sample is each cell's first three answers, which include the
one the game reveals when time runs out. For every cell, each sampled player must have played for the
row's team **and** meet the column's criterion: the award won at least once in the NBA (MVP, Finals
MVP, Defensive Player of the Year, Rookie of the Year, Sixth Man), NBA champion (any team), All-NBA
(any team, any year), Undrafted (never picked in an NBA draft), Lottery pick (picked 1-14 in his
draft, in any era, including before the lottery existed), Guard / Forward / Center (his listed position; a
guard-forward counts as both, a forward-center as both), From USA / International (the country the NBA lists
for him, not his birthplace: Kyrie Irving, born in Australia, is From USA), Played
in the 1990s / 2000s / 2010s / 2020s (at least one season WITH THE ROW'S TEAM in that decade; a season belongs to the
decade it starts in, so 2009-10 is the 2000s and the 2010s begin with 2010-11), All-Star (selected at
least once), 5x All-Star, No. 1 pick (first overall in his draft), Top-5 pick, Played w/ <star> (at least one
season on the same team as that star, on any team; the star himself does not count), and the career-stat columns
(20+ PPG / 10+ RPG / 8+ APG career average, 20K career points, 15+ seasons; NBA regular season only, and a rebound
average counts only the seasons that recorded rebounds, from 1950-51). Also check that each row and column
label is a real, unambiguous team or criterion. Every sampled player is one claim.

**Fan Favorites** (`kind: fan-favorites`): a survey board: the `prompt`, its `category` (player, team
or coach) and `answers`, every answer the game accepts. Each answer is a claim: it fits the prompt
exactly as worded (dates, "or more", "current franchise", award years are the season's end year).
The list must also be **complete**: a player, team or coach who fits the prompt but is missing is a
contradiction (name him in `found`), because a fan who types him loses a heart. Add one claim "the
list is complete" and confirm it on a page that lists the whole set (an award's winners, a draft's
first picks, a franchise's titles). A franchise counts under its current name with its history
(Seattle SuperSonics titles are the Oklahoma City Thunder's). Counts and order are not facts: skip them.

**Who Would Win** (`kind: who-would-win`): a vote, so there is no right answer to check. Each side
is `team_season` (`"1995-96 Chicago Bulls"`, or a decade such as `"1960s Boston Celtics"`) and the
`sub` line shown under it. Claims: the team-season is real (that franchise, under that name, played
that season; for a decade, in that decade) and every fact in `sub` is true for it: the record, the
players named (each played for that team in that season, or in that decade), titles. Two claims per
side at least. A player who joined after that season, or a wrong record, is a contradiction.

**Connections** (`kind: connections`): four groups, each a `label` and four `members`. Every member
must fit **his own group's label** exactly as worded (a draft class, a college, a country of birth,
a championship roster, an award): one claim per member, sixteen in all. A member who does not fit
his label is a contradiction. You do not have to prove that a member does not also fit another
group; code checks that where it can.
