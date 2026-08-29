# Fan Favorites Upgrade + Global UI Rules — Design Spec

**Date:** 2026-07-09 · **Status:** Approved (design) → implementing · **Mode:** single-player now, multiplayer-ready

## 1. Goals
1. Upgrade **Fan Favorites**: category-aware autocomplete suggestions + a new loss end-state that keeps the board in view.
2. Three **global UI rules** applied across all games.

## 2. Scope
- **In:** FF renderer + data (`category` field), a non-destructive `AutoCompleteInput` extension, coach/season suggestion sources, the reusable MiniGame end-state mechanism, exit-button positioning, username/id stacking.
- **Out:** multiplayer wiring (built MP-ready, not wired — per project agreement); other games' bespoke end-states (this only establishes the reusable mechanism + G2 for FF).

## 3. Global rules (ALL games)
- **G1 — Exit button 12px from container bottom, always.** `.exit-link { margin-top:auto; margin-bottom:12px; }` in `src/styles/MiniGame.css` (`.exit-link` lives once in the `.playing-wrap` column-flex shell — `MiniGame.tsx:189`). Verify `.playing-wrap` bottom padding doesn't double the gap.
- **G2 — End-of-game answers-in-view.** For games that reveal correct answers at the end, leave the answers visible and show the score below, replacing the input. Per-game specifics live in each game's section; FF's is §5. The reusable mechanism is the `onGameEnd(score, {inPlace})` option (§5).
- **G3 — Public #id BELOW the username, not next to it,** everywhere it renders. Sites (12): `Navigation.tsx` mobile `:98` + desktop `:157`; `Leaderboard.tsx` rows `:53` + self `:69`; `modals/LeaderboardModal.tsx` rows `:34` + self `:47`; `UserProfile.tsx` welcome `:163`; `MultiPlayer/OnlineMatch.tsx` Standings `:291-293` + playbar chip `:450` (id currently only in `title` — add below name); `MultiPlayer/FriendPlay.tsx` seats `:154-157`. `MultiPlayer/PlayerCard.tsx:53-54` **already stacks** — use as the reference pattern. Standalone "Player ID" stat card (`UserProfile.tsx:210`) and transient toasts (`LogInSignUp.tsx:90`) unchanged.

## 4. Fan Favorites — category-aware suggestions
- **Add `category`** wherever the question is defined: model `FanFavoritesQuestion` (`backend/trivia/models.py:114`) + migration; seed `backend/trivia/utils/fan_favorites_seed.json` (24 entries); `load_seed()` (`utils/fan_favorites.py`); `build_fan_favorites()` (`build_pools_from_db.py:91`); live serializer `_fan_favorites_row()` (`views.py:170`); static pool `backend/trivia/data/fan-favorites.json`; frontend type `FanFavoritesQuestion` (`src/types/types.tsx:67`). Values: `player | team | season | coach`.
- **Suggestion source per category:**
  - `player` → `fetchWholePool("all-players")` → 5,186 name strings (already published; no sync).
  - `team` → `nbaTeams` constant (30) **∪ this question's own answer names** (so relocated answers like "Seattle SuperSonics" are findable).
  - `coach` → new frontend constant `nbaCoaches` (~60 notable NBA head coaches, mirroring `nbaTeams`).
  - `season` → client-generated array `1946-47 … 2025-26` (no question uses it yet; future-proofing).
- **Component:** extend shared `AutoCompleteInput` with an optional `maxResults` prop (default = current unlimited behavior; FF passes `8`) so the 5,186-name list yields a small dropdown. Prefer prefix matches when sorting the capped list. FF keeps its Confirm button and routes matching through the existing alias-aware `matchAnswer`.
- **No answer-storage change (the "adjust Supabase"):** picked suggestions are canonical NBA names; `normalizeAnswer`/`matchAnswer` (accent + alias aware) already reconcile them to the stored `{answer,count,aliases}`. Only the `category` column is added. Canonical guesses also improve the guess-log → live-standings flywheel for free.

## 5. Fan Favorites — end-state
- **Win (all answers revealed):** unchanged — celebration → full-screen `GameResult` overview.
- **Loss (hearts = 0):** reveal missed answers muted (as today); then replace the input+Confirm row with an **inline score panel** ("Found X / Y · N pts") + a **Play again** button; the board stays in view; global exit remains available.
- **Mechanism (reusable, G2):** extend the finish contract to `OnGameEnd = (score:number, opts?:{ inPlace?:boolean }) => void`. In `MiniGame.tsx`, extract point-award (POST `/update-profile/` when `score>0`, POST `/log-session/`, `dispatch(updatePoints)`) into a single function invoked on every `onGameEnd`; when `opts.inPlace` is set, award points but do **not** `setShowResult(true)` (renderer stays mounted); otherwise today's overview flow runs unchanged. FF loss calls `onGameEnd(finalScore, { inPlace:true })`; Play again reuses the existing `onPlayAgain` → `handleStart` refetch (pass `onPlayAgain` to FF). All other games call `onGameEnd(score)` with no opts → behavior identical to today. Guard against double-award.

## 6. Multiplayer readiness
`category` is carried on both the static pool and the live/MP endpoint. Suggestions are equal-info for both players (fair — not an unfair assist). The loss inline-score panel is single-player only; in MP the score flows through `submitScore` → the head-to-head scoreboard, which already foregrounds player-vs-player scores over correct answers (project multiplayer rule).

## 7. Category backfill map (24 questions)
- **player (15):** ff-001, 003, 004, 005, 007, 008, 009, 012, 013, 014, 017, 018, 019, 020, 021
- **team (8):** ff-002, 006, 010, 011, 015, 016, 023, 024
- **coach (1):** ff-022
- **season (0):** none currently

## 8. Data pipeline note
The static SP pool `fan-favorites.json` is normally regenerated by `manage.py build_pools_from_db` from the Supabase DB. Because that requires the migration applied + reseed against Supabase (a manual deploy step per the deploy topology), the implementation will: (a) make all DB-side code changes (model/migration/seed/builder/serializer) so a future rebuild is correct, and (b) inject `category` into the committed static `fan-favorites.json` from the §7 map so single-player works immediately without a DB round-trip. Both derive from the same qid→category map to stay consistent.

## 9. Testing / verification
- **Automated:** `AutoCompleteInput` `maxResults` cap + prefix-preference; season generator; category→source selection; FF scoring unchanged; MiniGame awards exactly once for both the overview and inPlace paths (no double POST).
- **Manual @ 390×844:** each category's suggestions (player/team/coach); win → overview; loss → inline score + Play again (board stays); exit button 12px from bottom; id-below-username on 2–3 screens; a dirty/short question degrades gracefully.
- `npm run lint` + `npx tsc -b` + `npm run build` clean.

## 10. Files touched
- **Backend:** `models.py`, `migrations/000X_fanfavorites_category.py`, `utils/fan_favorites.py`, `utils/fan_favorites_seed.json`, `management/commands/build_pools_from_db.py`, `views.py`, `data/fan-favorites.json`.
- **Frontend:** `types/types.tsx`, `components/AutoCompleteInput.tsx`, `Game Renderers/FanFavorites.tsx`, `styles/FanFavorites.css`, `pages/Trivia/MiniGame.tsx`, `styles/MiniGame.css`, `constants/nbaCoaches.tsx` (new), a seasons helper (new), and the G3 id-stacking sites: `Navigation.tsx`/`.css`, `Leaderboard.tsx`, `modals/LeaderboardModal.tsx`, `UserProfile.tsx`, `MultiPlayer/OnlineMatch.tsx`, `MultiPlayer/FriendPlay.tsx` + `Multiplayer.css`/`FriendPlay.css`.
