# Scrambled team logos (Name the Logo)

`public/logos/scrambled/<team id>.webp` is what the Name the Logo game shows before the guess. Each file is
the team's current NBA CDN logo with its lettering removed, then recoloured (or left as is when little is
left), mirrored and rotated. After the guess the game cross-fades to the real CDN logo, which stays as is.

Rebuild (only needed when a franchise changes its logo):

```sh
mkdir -p /tmp/logos/svg && for id in $(seq 1610612737 1610612766); do
  curl -s -o /tmp/logos/svg/$id.svg "https://cdn.nba.com/logos/nba/$id/primary/L/logo.svg"; done
npm i --no-save svgpath
node scripts/scramble-logos/strip.cjs /tmp/logos/svg /tmp/logos/clean          # add --debug to see dropped parts in magenta
node scripts/scramble-logos/scramble.cjs /tmp/logos/clean public/logos/scrambled /tmp/logos/svg
```

- `rules.json` says which parts of each logo are lettering: `drop` lists shape ids (`e12` = 13th shape,
  `e5.s2` = its 3rd subpath), `regions` drop every subpath inside a box/ring (fractions of the viewBox).
  Logos whose letter *is* the mark (Cavaliers, Rockets, Pacers, Clippers, Jazz, Spurs) have no entry.
- `scramble.cjs` derives hue/mirror/rotation from the team id, so a rebuild gives the same images, and
  sizes each scrambled mark to its real logo's footprint so the reveal cross-fade never grows or shrinks.
