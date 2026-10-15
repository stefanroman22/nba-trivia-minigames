# Player photos

`node scripts/player-photos/build.mjs` (about 10 minutes, all reads) writes:

| File | What | Used by |
|---|---|---|
| `public/photos/player-photos.json` | Players with no cdn.nba.com headshot: their Wikimedia Commons file, or `none` | `src/utils/playerPhotos.ts` → `<PlayerPhoto>` in every game |
| `public/photos/player-ids.json` | Name and alias → `person_id` (latest player wins a shared name) | Starting Five, whose data has names only |
| `src/data/photo-credits.json` | Author and license of every Commons photo used | `/credits` |

Run it after a data sync adds many players, and commit the three files. New players don't need it:
an id the map doesn't list uses cdn.nba.com, and every active player has an NBA headshot.

How it decides:

- **cdn.nba.com** never 404s. A missing id gets a generic silhouette with ETag
  `7475ba9619305909d7998dd9dba02481`, which is how a real photo is told apart (HEAD requests). The CDN
  stalls requests with a bot-style User-Agent, so the probe sends a browser one.
- **Wikimedia Commons**: the Wikidata image (P18) of the item with that NBA.com player id (P3647), only a
  JPEG or PNG, only when the file name mentions the player and no other player uses the same file (team
  photos and game shots of someone else are skipped; a wrong face is worse than the silhouette).
- Otherwise the player gets the silhouette.

Commons photos are public domain or CC. The CC licenses need the author, the license and a link,
which `/credits` lists.
