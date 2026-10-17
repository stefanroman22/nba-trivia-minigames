# The Ladder — rank distribution, percentiles and "how points work" (design)

Owner ask 2026-10-16. Builds on Progression v2 (`2026-10-16-progression-design.md`): players should see, inside the
app, how ranks are distributed and what it takes to climb — in a way that is efficient, catchy, marketing-oriented and
responsive.

## Goals

1. **Transparency:** every rank with its points + active-day gate, the per-game maximums, and the daily rules (first-game
   bonus, soft cap, streak milestones) — one screen, no guessing.
2. **Social proof and goal-gradient:** "x % of players hold this rank", "x % share your rank", "you're ahead of x %",
   "N pts to the next rank", "N pts to enter the top 10 %". Research basis in the v2 spec: visible, close goals keep
   people playing; a percentile is a share trigger (Duolingo's Year in Review share rate rose when the XP percentile
   was added).
3. **Marketing:** a one-tap share line ("I'm in the top 8 % of Swish Quest players 🏀"), a tagline per rank, a
   sign-up CTA for guests, and a surface that reads well in a screenshot.
4. **Efficient:** one cached backend endpoint, one small payload, no chart library.
5. **Responsive:** works as a bottom sheet on phones and a wide modal on desktop; bars never overflow; nothing snaps.

## 1. Backend — `GET /api/ranks/ladder/` (AllowAny)

```json
{
  "total_players": 1240,
  "ladder": [
    {"name": "Rookie", "points": 0, "days": 0, "players": 496, "share_pct": 40.0},
    {"name": "Role Player", "points": 100, "days": 0, "players": 310, "share_pct": 25.0},
    "... one row per rank in users.ranks.LADDER order ..."
  ],
  "percentiles": {"1": 42000, "5": 9000, "10": 5200, "25": 1800, "50": 400},
  "rules": {
    "first_game_bonus": 100, "daily_full": 1500, "daily_half": 1500, "daily_tail_rate": 0.1,
    "streak_milestones": {"7": 200, "30": 1000, "100": 5000}, "max_freezes": 1, "guest_carryover_max": 1000
  },
  "you": null
}
```

- `ladder` and `percentiles` come from one cached computation (`users/ladder.py distribution()`, Django cache key
  `ladder:v1`, TTL 10 minutes): rank counts via one `GROUP BY rank` over the public players (`leaderboard._ranked()`:
  adult, not banned — the same population as the global board), and the points needed to be in the top P % for
  P ∈ {1, 5, 10, 25, 50} via `ORDER BY points DESC OFFSET k LIMIT 1` (k = ceil(total × P / 100) − 1), i.e. five
  tiny queries, no full table load, nothing new to index.
- `percentiles[P]` = the points of the player at the P-th percentile boundary: having **at least** that many points
  puts you in the top P %. With fewer than 100 players the small percentiles collapse onto the top player; that is
  fine and honest.
- `rules` mirror the constants in `trivia/awarding.py` and `users/views.py` so the UI can never drift from the code.
  Per-game maxima are NOT sent: the frontend already has them (`visibleGames[].maxPoints`, kept equal to
  `GAME_MAX_POINTS` by the v2 rules).
- `you` (signed-in only, computed per request, 1 extra query):
  ```json
  {"rank": "Starter", "division": null, "position": 287, "percentile": 23.1, "ahead_of_pct": 76.9,
   "same_rank_pct": 18.0, "next_rank": "All-Star", "points_to_next": 1240, "days_to_next": 2,
   "to_top": {"1": 39800, "5": 6800, "10": 3000, "25": 0, "50": 0}}
  ```
  `position` = `leaderboard.rank_of(user)` (Redis-aware); `percentile` = position / total × 100 (one decimal, "top
  23.1 %"); `ahead_of_pct` = 100 − percentile; `same_rank_pct` = players at the user's rank / total; `to_top[P]` =
  max(0, percentiles[P] − points). A 13–15 year-old or unknown-age account is not in the public population but still
  gets a `you` block computed against it.
- Throttling: none beyond DRF defaults (cached, read-only). Guests get `you: null`.

## 2. Frontend — the Ladder modal

`ModalKind "ladder"`, wide, title "The ladder". Opened from:
- the profile card's Rank stat (the rank label becomes a button with a chevron),
- the leaderboard card footer ("Ranks →" link),
- the rank-up modal ("See where you stand →" text link under the buttons),
- GuestPanel ("See the rank ladder →" text link).

Sections, top to bottom (one column by default, including on desktop where the wide modal panel is 520 px; the ladder and the rules sit side by side via a container query only in a panel ≥ 640 px wide):

1. **You** (signed-in): rank badge in the rank's colour, "Top 23 %" as the headline, then "You're ahead of 77 % of
   players · 18 % share your rank", the existing progress copy ("1,240 pts to All-Star · 2 more active days"), and a
   **Share** button (`navigator.share` → clipboard fallback → "Copied!" via SwapText) with the line
   `I'm in the top 23 % of Swish Quest players 🏀 Starter and climbing. Think you know the NBA better? Play free at swishquest.com` (percentile with one decimal, e.g. 23.1 %).
   Guests see "Sign up to claim a rank" (opens the login modal) over the same layout.
2. **The ladder**: 9 rows. Each row: colour dot, rank name + tagline, the gate ("1,500 pts · 3 days"), a horizontal
   bar whose width = `share_pct` (pure CSS, animated in with `staggerItem`), and "40 %". The player's rank row is
   highlighted with a "you" chip. Rows the player has passed are dimmed slightly; the next one carries "next".
3. **Top percentiles**: a chip row — "Top 1 % · 42,000 pts", "Top 10 % · 5,200 pts (+3,000 for you)" … 50 %.
4. **How points work**: the visible games as "Name · up to N pts" (two columns from 560 px), then the daily rules from
   `rules`: "+100 for your first scoring game of the day", "First 1,500 pts a day count in full, the next 1,500 at
   half, the rest at 10 %", "One game a day keeps your streak · 1 freeze · +200 / +1,000 / +5,000 at day 7 / 30 /
   100", "Sign up and keep up to 1,000 guest points".

Copy rules: numbers via `toLocaleString`, percentages with one decimal only in the headline ("Top 23.1 %"), whole
numbers elsewhere; never show "Top 0 %" (floor at 0.1) or "ahead of 100 %"; with `total_players < 20` the
percentile headline reads "Early adopter" instead of a meaningless "Top 50 %".

Rank taglines (`src/utils/ranks.ts RANK_TAGLINES`): Rookie "Everyone starts here" · Role Player "First points on the
board" · Sixth Man "Off the bench, into the rotation" · Starter "Three days in — you're in the lineup" · All-Star "Top
of the regulars" · All-NBA "Elite company" · MVP "Best in the building" · Hall of Famer "Legend status" · GOAT "The
180-day club".

Data: `src/hooks/useLadder.ts`, a module cache like `useLeaderboard` (10-minute TTL, re-fetched when the signed-in
user changes), one `GET /api/ranks/ladder/`.

## 3. Non-goals (this round)

A public `/ranks` landing page for shared links (follow-up: the same component rendered server-side without `you`),
rank badges as images, per-game percentile stats, leagues.
