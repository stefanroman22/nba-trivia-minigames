# Player photos

`node scripts/player-photos/build.mjs` (about 10 minutes, all reads) writes:

| File | What | Used by |
|---|---|---|
| `public/photos/player-photos.json` | Players with no cdn.nba.com headshot: their Wikimedia Commons file (with size and face box), or `none` | `src/utils/playerPhotos.ts` → `<PlayerPhoto>` in every game |
| `public/photos/player-ids.json` | Name and alias → `person_id` (latest player wins a shared name) | Starting Five, whose data has names only |
| `src/data/photo-credits.json` | Author and license of every Commons photo used | `/credits` |

Run it after a data sync adds many players, and commit the three files. New players don't need it:
an id the map doesn't list uses cdn.nba.com, and every active player has an NBA headshot.

## Adding or changing photos

1. Edit `commons-extra.json` if needed, then `node scripts/player-photos/build.mjs`. It lists any Commons
   photo without face data.
2. `py -3.11 scripts/player-photos/detect_faces.py` (needs `pip install opencv-python numpy`): finds the
   face in each new photo, adds it to `faces.json` and writes `faces-review.png` (git-ignored). Look at
   every box. A wrong one: set `"box"` by hand and `"manual": true`. A bad photo (jersey, back view, group
   shot, tiny figure): exclude it in `commons-extra.json`.
3. `node scripts/player-photos/build.mjs` again, then `python scripts/player-photos/check_fit.py`. It must
   exit 0 (no major issue); `--list` shows every issue.

## How it decides

- **cdn.nba.com** never 404s. A missing id gets a generic silhouette with ETag
  `7475ba9619305909d7998dd9dba02481`, which is how a real photo is told apart (HEAD requests). The CDN
  stalls requests with a bot-style User-Agent (headless Chrome too), so the probe sends a browser one.
- **Wikimedia Commons**: the Wikidata image (P18) of the item with that NBA.com player id (P3647), only a
  JPEG or PNG, only when the file name mentions the player and no other player uses the same file (team
  photos and game shots of someone else are skipped; a wrong face is worse than the silhouette).
- **`commons-extra.json`** (hand-verified, wins over Wikidata):
  - `{ "<person_id>": { file, face_x, face_y } }`: a photo found by hand. 2026-10-16/17: agents searched
    Commons categories, file descriptions, other-language Wikipedia articles and "depicts" tags for the
    players without a photo (66 found); each entry was re-checked against the Commons API (license, size,
    the file naming the player, no file shared by two players).
  - `{ "<person_id>": { exclude: true, reason } }`: no photo for this player, whatever the source says.
    The 2026-10-18 review excluded 97 (jerseys and banners, back views, tiny figures, group shots where the
    player can't be told apart, faces too small to recognise in a 32px circle).
- Otherwise the player gets the silhouette. About 1,880 players (mostly role players before 2000) have no
  usable free photo; the NBA never took a CDN headshot for them.

## How a photo is fitted

- **NBA headshots** are one uniform studio crop (face centred, about 48% of the image height, every era),
  so each game's own CSS fit works for all of them.
- **Commons photos** are arbitrary. `faces.json` holds each one's face box
  (`{file, aspect, box: [x, y, w, h]}`, fractions of the image; `manual` = set by hand, never overwritten).
  `<PlayerPhoto frame=…>` measures the game's frame and `placePhoto` (utils/playerPhotos.ts) draws the photo
  on the face: `avatar` (circles, tiny squares) zooms until the face fills about 42% of the frame, `card`
  keeps the whole head in view, `strip` (Who Are Ya) shows the whole photo unless that leaves bars over
  45% of the frame. A close-up too tall for the frame gets side bars rather than a cut face. The file width
  follows the drawn size (Commons' standard 120–1280px thumbnails), so it stays sharp.
- **`check_fit.py`** reproduces both, for every photo, game and ui-check viewport, using the frame sizes
  measured once in the real app (`frames.json`; re-measure if a game's photo CSS changes), and flags faces
  cut, off-centre, too small, upscaled or missing. 2026-10-18: 0 major issues, 28 minor (19 faces at the
  photo's edge, 8 small originals, 4 trimmed hair, 1 strip with side bars).

Commons photos are public domain or CC. The CC licenses need the author, the license and a link,
which `/credits` lists.
