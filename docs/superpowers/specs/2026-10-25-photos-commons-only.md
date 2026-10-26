# Player photos without cdn.nba.com (ads readiness, step 1)

**Date:** 2026-10-25. **Decided in chat with the owner** (ads-compliance scan, same day).

## Why

Google AdSense rejects sites built on copyrighted material, and the NBA's terms limit its images to
non-commercial use. Today 1,702 of 4,900 players (every active and most well-known player) load their
headshot from `cdn.nba.com`; 1,316 come from Wikimedia Commons under free licences (verified on
2026-10-25: 657 public domain / CC0, 223 CC BY, 434 CC BY-SA, 2 custom attribution; 0 non-free);
1,882 have no photo (silhouette). Team logos are a separate step (generated crests), not this one.

## What changes

1. **No player photo is ever loaded from cdn.nba.com again.** Source order becomes Commons → silhouette,
   in every game and every answer review, including the two reviews that hotlink the CDN directly
   today (Who Are Ya, LeContexto in `src/components/review/BoardReviews.tsx`).
2. **The 1,702 NBA-CDN players are searched on Commons** through the existing pipeline
   (`scripts/player-photos/`). Wikidata already lists an image for 1,547 of them (all 132 fame tier 1-3
   players included); the other 155 are all tier 4 (66 active). Every new photo passes the same gates as
   the existing ones: free JPEG/PNG, the file names the player, not shared by two players, a detected
   face box reviewed by eye, and `check_fit.py` exit 0 (no cut, tiny or missing face in any game frame
   at any ui-check viewport). Whatever fails becomes a silhouette rather than a bad crop.
3. **The map lists every player** (`commons` or `none`), so an id missing from the map is a build
   error, not a silent CDN fallback.
4. **Fame tier 1-3 and active players** who still have no photo after the automatic pass get a
   hand search on Commons (categories, "depicts", other-language Wikipedia), each find verified
   against the Commons API before it is added to `commons-extra.json`.
5. **Credits** (`/credits`, `src/data/photo-credits.json`) cover every Commons photo; copy that says
   "most photos come from cdn.nba.com" is corrected. The Privacy Policy sentence naming cdn.nba.com for
   player photos is left for the ads legal rewrite (it bumps the legal version with everything else).

## Constraints

- Work happens in its own git worktree outside OneDrive; the main checkout and other worktrees are
  never touched. Nothing is pushed or merged until the owner says so (memory rule).
- No change to how a photo is drawn (`placePhoto`, `PlayerPhoto` frames, game CSS): the fit rules are
  the standard; photos are chosen to meet them.
- `check_fit.py` must exit 0 before the data is committed; `npm run lint`, `npx tsc --noEmit` and
  `npm run build` must pass before the branch is handed over.
- Commons rate limits: `detect_faces.py` sleeps 1 s per photo and 30 s on HTTP 429; the build's
  Commons metadata calls batch 50 titles.

## Out of scope

Team logos and the logo game, the Privacy Policy text, the AdSense set-up, the dependency update.
