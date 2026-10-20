# Admin Users tab — design (2026-10-20)

**Ask (owner):** an admin-only view of every player: totals, ranks, when they joined, usage statistics —
time on the app above all, aggregable — games played, points, whether they play multiplayer, the
country they play from; and from the panel, email a player, ban them, and send them a friend request
from the admin's own account.

## What was built

| Piece | Where |
|---|---|
| Time on the site per player per Paris day + country code | `users.DailyActivity` (migration `users.0014`), `users/activity.py`, `POST /api/activity/` (throttle `activity` 120/h) |
| Browser tracker (signed-in only; visible tab + interaction in the last 3 min; batched every 5 min and on hide/close with `keepalive`) | `src/hooks/useActivityTracker.ts`, mounted in `src/app/providers.tsx` |
| Admin API | `users/admin_users_api.py`, mounted under `/api/admin/users/…` in `trivia/admin_urls.py` |
| Users tab UI | `src/components/admin/{UsersTab,UsersCharts,usersApi}.tsx`, `src/styles/AdminUsers.css` |
| Privacy | policy row + summary, `LEGAL.version`/`TERMS_VERSION` 2026-10-20.1 (applies to existing accounts from 3 Nov; no home-page banner pre-launch), record of processing row 6c + LIA 3b + DPIA rows, OPEN_ITEMS objection switch, retention 12 months, export + deletion |

### Endpoints (all `IsAdminUser`)
- `GET /api/admin/users/overview/?period=7d|30d|90d|12m|all` — users (total/new/banned/admins/Google), active today/7d/30d/period,
  time (period, all-time, per active player, per visit-day, tracked since), games (signed-in/guest/online, players, online players),
  bucketed series (sign-ups, active players, seconds, games), ranks, countries (period), most-played games, top 10 by time.
- `GET /api/admin/users/?q=&filter=&rank=&country=&sort=&limit=&offset=` — rows with games, online games, game time,
  app seconds (all-time and 30 d), last seen, latest country. Annotations are correlated subqueries (no join fan-out).
- `GET /api/admin/users/<public_id>/` — account, the admin's own friend relationship to the player, usage (totals,
  30-day daily series, countries), per-game stats, recent games, social counts, feedback/report counts, moderation history.
- `POST /api/admin/users/<public_id>/ban/` `{action: ban|unban}` — `strikes.ban_user(reason="admin", kind="admin")` /
  `unban_user`; refuses the admin's own account and other admins.

### Decisions (builder's calls)
- **Email** opens the admin's own Gmail/mail app from a compose dialog (subject + message prefilled). The site has no
  email provider; wiring one (Resend, SES…) needs an API key and a sender domain, and may cost money — owner decision.
- **Friend request** reuses the ordinary friends endpoints: the admin is a player there, so there is no admin-only path.
- **Block = ban** (the admin-panel meaning): the existing ban switch, reason code `admin`; the player-to-player block
  stays a friends-screen feature.
- **Country** comes from Vercel's `x-vercel-ip-country` header (Cloudflare's as a fallback); no IP is stored. Local dev has no header,
  so country shows "—" there.
- **Time on site** starts counting when this ships ("tracked since" is shown). Game time (`GameSession.duration_ms`)
  is reported separately and existed already.
- Guests are never tracked (no new browser storage, nothing about guests).

## Known limits
- The old production backend shares the database. Django's CASCADE is ORM-side, so until the backend is promoted, an
  account deleted through the OLD backend that has `DailyActivity` rows (only accounts used on the dev site) fails
  with an FK error. Promote frontend + backend together.
- Each open tab sends about one request per 5 minutes of use; that counts against Vercel function invocations.
