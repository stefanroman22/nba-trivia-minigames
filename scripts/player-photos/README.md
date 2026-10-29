# Player photos

Every player who has an official NBA headshot (cdn.nba.com) gets it: one studio template for every era, the
uniform look the owner chose on 2026-10-28 (it reverses the 2026-10-26 Commons-only switch; the AdSense /
takedown risk is in docs/legal/OPEN_ITEMS.md D.1). A player without one gets a Wikimedia Commons photo
(public domain or Creative Commons, credited on `/credits`), or the silhouette.

`node scripts/player-photos/build.mjs` (a few minutes, all reads; it probes cdn.nba.com for every player) writes:

| File | What | Used by |
|---|---|---|
| `public/photos/player-photos.json` | Every player: in `nba` (has an NBA headshot), their Wikimedia Commons file (with size and face box), or `none` | `src/utils/playerPhotos.ts` → `<PlayerPhoto>` in every game and answer review |
| `public/photos/player-ids.json` | Name and alias → `person_id` (latest player wins a shared name) | Starting Five, whose data has names only |
| `src/data/photo-credits.json` | Author and license of every Commons photo used | `/credits` |

Run it after a data sync adds players, and commit the three files. `npm run check:photos` (part of
`npm run lint`) fails while a player is missing from the map, a Commons photo has no face box or credit, or
a file other than `src/utils/playerPhotos.ts` loads a cdn.nba.com headshot (every game must frame photos
through `<PlayerPhoto>`); the app shows the silhouette for an id the map doesn't list.

## Adding or changing photos

1. Edit `commons-extra.json` if needed, then `node scripts/player-photos/build.mjs`. It lists any Commons
   photo without face data.
2. `py -3.11 scripts/player-photos/detect_faces.py [--per-sheet 48]` (needs `pip install opencv-python numpy`;
   with its output redirected to a file, set `PYTHONIOENCODING=utf-8` or a non-ASCII file name crashes the
   print): finds the face in each new photo, adds it to `faces.json` and writes review sheets
   `faces-review-01.png`, `faces-review-02.png`, … (git-ignored), 48 photos each.
3. Look at every box on every sheet. Write the verdicts for sheet NN to `review/sheet-NN.json` (git-ignored):
   `{"sheet": "faces-review-NN.png", "exclude": {"<pid>": "<reason>"}, "box": {"<pid>": [x, y, w, h]}}`.
   Exclude a bad photo (jersey or banner, back view, group or game shot where the player can't be told apart,
   the box on someone else, a face too small for a 32px circle, a card scan or drawing); give a box (fractions
   of the image, brows to chin) where the detector missed or misplaced the face. Leave good boxes out.
   `python scripts/player-photos/apply_review.py` writes them into `commons-extra.json` (exclusions, dated
   reason) and `faces.json` (`"manual": true`, never overwritten); its tests:
   `python -m unittest discover -s scripts/player-photos -p "test_*.py"`.
4. `node scripts/player-photos/build.mjs` again, then `python scripts/player-photos/check_fit.py`. It must
   exit 0 (no major issue); `--list` shows every issue. Exclude a photo with a major issue whose box is
   right, fix the box when it is wrong, and repeat.

## How it decides

- **NBA headshot**: cdn.nba.com never 404s; a missing id gets its generic grey silhouette, told apart by its
  fixed ETag. Every player with a real headshot is in `nba`, whatever Commons has.
- **Wikimedia Commons** (players without an NBA headshot): the Wikidata image (P18) of the item with that NBA.com player id (P3647), only a
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
- Otherwise the player gets the silhouette (mostly role players before 2000 and short careers, for whom no
  free photo exists).

## How a photo is fitted

- Every photo is framed like an NBA headshot, so every player looks the same in every game. `<PlayerPhoto>`
  measures the game's frame and `placePhoto` (utils/playerPhotos.ts) draws the photo in a window of the
  headshot's shape (1040 x 760; the whole frame when the frame is narrower, full height and centred when it
  is wider, as in Who Are Ya's strip), with the face box at the NBA template's place: 48% of the window's
  height, centred across, its centre 37% down. An NBA headshot lands exactly on its own template.
- Commons photos are arbitrary. `faces.json` holds each one's face box
  (`{file, aspect, box: [x, y, w, h]}`, fractions of the image; `manual` = set by hand, never overwritten),
  and the photo is zoomed so that box lands where the template has it (`frame="avatar"` may zoom further
  than `card` / `strip`). A close-up too tall for the window gets side bars rather than a cut face. The
  file width follows the drawn size (NBA 260 or 1040px, Commons' standard 120–1280px thumbnails), so it
  stays sharp.
- **`check_fit.py`** reproduces it for every photo (NBA and Commons), game, answer review and ui-check
  viewport, using the frame sizes measured once in the real app (`frames.json`; re-measure if a game's photo
  CSS changes), and flags faces cut, off-centre, too small, upscaled or missing.

Commons photos are public domain or CC. The CC licenses need the author, the license and a link,
which `/credits` lists (`credit.mjs`): the author without Commons' hidden duplicates, the attribution line a licence
asks for when Commons gives one, and the source when no author is known but attribution is required. An author that a
file page states only in its text (no infobox) goes in `credit-overrides.json`, checked by hand against the page.
