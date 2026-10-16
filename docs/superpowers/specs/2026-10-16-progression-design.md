# Progression v2 — points, ranks, streaks, weekly board (design)

Owner decision 2026-10-16. Replaces the 2026-08 points/ranks system described in
`docs/constraints/AUTH_CONSTRAINTS.md` AUTH-6.

## Why

- GOAT (5,000 pts) took 1–2 hours of play. Production confirmed it: one of four accounts was already Hall of Famer.
- Games paid between 24 and 140 points per minute, so the ladder silently told players which games to skip.
- Nothing rewarded coming back tomorrow: no streak, no daily bonus, no weekly board, no daily cap. The landing
  page promised "Build a streak", which did not exist.
- Research (Duolingo leagues +17% learning time / −40% top-user churn, goal-gradient, endowed progress, loss
  aversion ≈ 2×): front-load early ranks, make the top take months, never demote, pair a permanent ladder with a
  weekly fresh start, keep streaks cheap, cap farming.

## 1. Per-game points (public games)

Rule: a well-played game ≈ 100 pts, a perfect one 100–200, about 100 pts/min. Daily Wordle stays the premium.
`GAME_DESIGN_CONSTRAINTS.md` Rule 9.1 (`pointsPerCorrect × rounds = maxPoints`) still holds for the per-answer games.

| Game | Scoring | Max |
|---|---|---|
| Guess the Series Winner / Name the NBA Club / Guess the MVP | 20 per correct, 5 rounds | 100 |
| Fill in the Starting 5 | 20 per player + 50 full-lineup bonus | 150 |
| Career Path | solved: `max(40, 200 − 40 × wrong)`; out of guesses: 0 | 200 |
| Who Are Ya? | `200 − 25 × wrong` (8 guesses); fail: 0 | 200 |
| Fan Favorites | cleared: 200; else `round(200 × found / total)` | 200 |
| LeContexto | unchanged | 200 |
| NBA Tic-Tac-Toe solo | 20 per cell | 180 |
| NBA Tic-Tac-Toe online | win 200 / draw 120 / loss 30 | 200 |
| Who Would Win? | 10 with the crowd, 5 against, 0 skip | 100 |
| NBA Wordle (daily, solo) | unchanged: 500/400/300/200/100 | 500 |
| NBA Wordle (online 1v1) | 200/160/120/80/40 (no daily lock online, so no jackpot) | 200 |
| Hidden games | unchanged | — |

The backend caps every submission at the game's own maximum (`trivia/awarding.py GAME_MAX_POINTS`,
`MATCH_MAX_POINTS` for the online Wordle), replacing the single 1,000 ceiling.

## 2. Daily rules (`trivia/awarding.py`)

- The day is the Europe/Paris civil day, the same boundary as the daily Wordle (`trivia.wordle_daily.CET`).
- **First scoring game of the day: +100** (`FIRST_GAME_BONUS`). A scoring game is one whose clamped score is > 0.
- **Daily soft cap on game points** (bonuses excluded): the first 1,500 game points of a day count in full, the next
  1,500 at 50 %, anything beyond at 10 %. "Game points of the day" = the sum of the clamped `score` of the account's
  single/match sessions today.
- **Streak:** one scoring game per day keeps it. `streak_days`, `streak_best`, `streak_freezes` live on the account.
  A missed day is covered by a freeze if one is held (max 1); a freeze is refilled every time the streak reaches a
  multiple of 7. Milestones pay once, on the day they are reached: day 7 +200, day 30 +1,000, day 100 +5,000.
- **Active days:** `active_days` counts distinct Paris days with at least one scoring game. It gates the top ranks.
- A session with a 0 score is logged but counts for nothing (no bonus, no streak, no active day): opening and
  closing a game is not activity.
- Friend rooms still credit nothing. Guests still credit nothing.
- Every award writes a `GameSession` row with `awarded` = what actually landed on the account (score after the
  soft cap + bonuses). The weekly board sums this column.

## 3. Rank ladder (`users/ranks.py`)

Lifetime points AND active days, both required. Ranks never drop.

| Rank | Points | Active days |
|---|---|---|
| Rookie | 0 | 0 |
| Role Player | 100 | 0 |
| Sixth Man | 500 | 0 |
| Starter | 1,500 | 3 |
| All-Star | 5,000 | 7 |
| All-NBA | 15,000 | 20 |
| MVP | 40,000 | 45 |
| Hall of Famer | 80,000 | 90 |
| GOAT | 150,000 | 180 |

- Divisions III → II → I split each rank from All-Star up to Hall of Famer into thirds of its point span
  (display only, never stored). GOAT has no divisions.
- `progress()` returns the next rank, points and days still needed, and a 0–100 % bar for the profile card.
- Existing accounts: a data migration recounts `active_days` from their `GameSession` history (distinct Paris
  days), recalculates the rank under the new ladder and sets `founding_member = True` (a profile chip).

## 4. Weekly board

`GET /api/get-users/?scope=weekly`: top 100 by `sum(GameSession.awarded)` since Monday 00:00 Paris, same
visibility rules as the global board (adult, not banned). Pure Postgres; no Redis. Pooled leagues
(groups of ~30 with promotion/relegation) are a later phase once there are enough players.

## 5. Guest carry-over

The signup and Google-signup requests may carry `guest_points` (the display-only sessionStorage total); the
backend credits `min(guest_points, 1000)` to the new account. No session row, no streak, no active day.

## 6. Surfaces

- Profile card: rank with division ("All-Star II"), progress bar + "2,340 pts to All-NBA · 3 more active days",
  streak line ("🔥 5-day streak · 1 freeze"), Founding Member chip.
- Rank names on the global/weekly/friends leaderboard rows.
- Rank-up moment: a modal after the result screen ("Rank up! Sixth Man → Starter") with a share button
  (`navigator.share`, clipboard fallback). Online matches open the same modal from the relay's `pointsAwarded`.
- GuestPanel: "You've scored N pts as a guest. Sign up to keep them…".

## Non-goals (this round)

Pooled weekly leagues, rank decay, PNG share images, streak purchases, badges beyond Founding Member.
