# Name the Logo (`name-logo`) — record-based, not written

One round = one current franchise's scrambled logo (`public/logos/scrambled/<team_id>.webp`); the player
types the team.

## Can the writer add questions? No.

The pool is the 30 current franchises, and it is full (30 of 30). Tell Stefan at step 0 and stop.

## Answers

`matchAnswer` against the full name plus `teamAnswerAliases` (`src/constants/nbaTeams.ts`): the nickname,
the city unless two teams share it (not "Los Angeles"), the abbreviation and common short forms (Sixers,
Cavs, Mavs, Wolves, Blazers, LA Clippers, OKC, ...). Former names (SuperSonics, Bobcats, New Jersey Nets)
stay wrong: the logo shown is the current one.
