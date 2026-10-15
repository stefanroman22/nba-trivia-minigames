# Game card pipeline

Generates the 800×450 images behind the game tiles (`src/assets/Games Backrounds/`) so every
card looks like the Series Winner card: dark charcoal, one orange accent, cinematic 3D feel.
The tile overlays the title and description itself (`GameTile.tsx`), so **cards never contain
text**.

Two stages. The first is free and runs offline; the second calls an image model.

```
sources/<id>.jpg   (optional real photo)        out/raw/<id>.png   (AI render)
          \                                          /
           +------------>  finish.mjs  <------------+        palette lock, glow, vignette, grain
                               |
                        out/cards/<id>.jpg  ->  sheet.mjs (review)  ->  apply.mjs (overwrite assets)
```

## Commands

| Command | What it does | Cost |
|---|---|---|
| `npm run cards:finish -- --from existing` | Translate the current assets into the palette (preview of the look) | free |
| `npm run cards:finish` | Finish the best input per game: `out/raw` > `sources/<id>.*` > current asset | free |
| `npm run cards:sheet` | Contact sheet of `out/cards` at `out/contact-sheet.jpg` (`-- --dir out/raw` for renders) | free |
| `npm run cards:generate` | **Dry run**: prints each prompt, the attached references and an estimated cost | free |
| `npm run cards:generate -- --yes` | Actually render every game to `out/raw/` | see below |
| `npm run cards:sources` | Pull candidate real photos per game from Pexels into `sources/candidates/<id>/` | free key |
| `npm run cards:apply` | Copy `out/cards/<id>.jpg` over the asset `GameUtils.tsx` imports (backups in `out/backup/`) | free |

All commands take `--ids a,b,c` to limit to some games. Ids and the asset mapping live in
`manifest.mjs`; the style prompt lives in `style.mjs`; the palette ramp in `lib.mjs` (`RAMP`).

### finish.mjs knobs

`--exposure 0.55` darkens a bright source before the ramp (the Wordle image needs it),
`--mix 0.15` keeps some original colour, `--glow`, `--vignette`, `--floor`, `--grain`,
`--quality`, `--position attention|centre`.

## Workflow for a game

1. **Has a usable picture already** (a photo or a render you like): drop it in `sources/<id>.jpg`
   and run `cards:finish --ids <id>`. Done if the look is right. If the picture carries text,
   logos or a real player's face, that stays in the card, so go to step 3 instead.
2. **Generic placeholder** (most games today): either find a photo (`cards:sources --ids <id>`,
   pick one into `sources/<id>.jpg`) or skip straight to step 3.
3. **AI render**: `cards:generate --ids <id>` (dry run) then `--yes`. The prompt is the
   Series Winner style + the game's `concept` from the manifest. `playoff_series.jpg` is attached
   as the style anchor and `sources/<id>.*`, if present, as the subject reference. Then
   `cards:finish --ids <id>` to lock the palette and size, `cards:sheet` to review,
   `cards:apply --ids <id>` to put it live.

## Providers and keys

Set one of these in `.env.local` (repo root) or `scripts/game-cards/.env` (both git-ignored):

- `GEMINI_API_KEY` → provider `gemini`, model `gemini-2.5-flash-image` (override with
  `GEMINI_IMAGE_MODEL`). Has a free API tier with a daily quota; paid list price about $0.04 per
  image (third-party roundups, 2026-10; check Google's pricing page).
- `OPENAI_API_KEY` → provider `openai`, model `gpt-image-1.5` (override with
  `OPENAI_IMAGE_MODEL`); `--quality low|medium|high`, 16:9 at roughly $0.015 / $0.05 / $0.20 per
  image (third-party roundups, 2026-10; check OpenAI's pricing page).
- `PEXELS_API_KEY` → free at pexels.com/api; photos are free to use, no attribution required
  (credits are saved anyway in `credits.json`).

`IMAGE_PROVIDER=openai` switches the default provider. The generate stage refuses to spend
without `--yes`, and skips renders that already exist unless `--force`.

## Rules baked into the prompt

No text, letters or numbers; no logos, crests or watermarks; no real people or faces. The
current MVP, Starting Five, Wordle and Logo assets are third-party pictures with exactly those
problems, which is why the manifest marks them `replace` and the AI stage reinterprets them
(trophy and confetti, five faceless silhouettes, a blank tile grid, blank shields).

`sharp` comes from Next.js's dependency tree (`node_modules/sharp`); nothing to install.
