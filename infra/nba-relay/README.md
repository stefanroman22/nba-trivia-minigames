# nba-relay

A Cloudflare Worker that relays the NBA stats API for the monthly data refresh.
`stats.nba.com` refuses datacenter addresses: from a GitHub-hosted runner it hangs. A Worker gets a
normal 200, so the refresh points `nba_api` at this relay and no longer needs the owner's PC
(design spec §4.13).

URL: `https://nba-relay.stefanroman.workers.dev` (Stefan's personal Cloudflare account, free plan).

## What it does

- `GET /stats/<endpoint>?<query>` → `https://stats.nba.com/stats/<endpoint>?<query>`.
  `<endpoint>` must be lowercase letters and digits (`commonplayerinfo`), anything else is 404.
- Every `/stats` request needs the header `X-Relay-Key` equal to the Worker secret `RELAY_KEY`,
  otherwise 401. If the secret is not set, every request gets 401.
- The client's headers are forwarded as sent (nba_api's `STATS_HEADERS`: User-Agent, Referer,
  Accept*, `x-nba-stats-*`, ...), minus `Host`, `X-Relay-Key`, `cf-*` and `x-forwarded-*`.
- Upstream status, body and `Content-Type` pass through, with `Cache-Control: no-store`.
- 25 s upstream timeout: 504 on timeout, 502 if the fetch fails.
- `GET /health` → 200 `{"ok":true}`, no key needed (monitoring).
- Nothing else is served (404).

**Client side:** do not send nba_api's `Host: stats.nba.com` header to the relay. Cloudflare routes
by `Host` and answers 403 before the Worker runs. Drop `Host` from `STATS_HEADERS` when
`NBA_RELAY_BASE` is set, and add `X-Relay-Key`.

## Deploy

From `infra/nba-relay`:

```
npx wrangler@4 deploy
npx wrangler@4 secret put RELAY_KEY
```

`secret put` prompts for the value, or reads it from stdin (`cmd /c "npx wrangler@4 secret put RELAY_KEY < key.txt"`).

## GitHub side

The workflows read the key from a secret and the URL from a repo variable:

```
gh secret set NBA_RELAY_KEY --repo stefanroman22/nba-trivia-minigames < key.txt
gh variable set NBA_RELAY_BASE --repo stefanroman22/nba-trivia-minigames --body "https://nba-relay.stefanroman.workers.dev"
```

## Rotating the key

1. Generate a key: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))" > key.txt`
   (strip the trailing newline, or write it without one).
2. Set it on both sides within the same minute: `npx wrangler@4 secret put RELAY_KEY` and
   `gh secret set NBA_RELAY_KEY`, both from `key.txt`.
3. Delete `key.txt`.

The refresh runs monthly, so a short mismatch between the two sides costs nothing; avoid rotating
while a `data-refresh` run is in progress.

## Free-tier limits

Workers free plan: 100,000 requests a day and 10 ms CPU per request (time spent waiting on
`stats.nba.com` does not count). A full regeneration is about 16k calls, well under the daily limit.
If the limit is hit, requests fail until the daily reset (00:00 UTC); nothing is billed. Never enable
a paid plan for this Worker.

## Verify

```
curl -i https://nba-relay.stefanroman.workers.dev/health                                   # 200 {"ok":true}
curl -i https://nba-relay.stefanroman.workers.dev/stats/commonplayerinfo?PlayerID=2544     # 401
curl -i -H "X-Relay-Key: $KEY" \
  -H "User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:72.0) Gecko/20100101 Firefox/72.0" \
  -H "Referer: https://stats.nba.com/" -H "Accept: application/json, text/plain, */*" \
  -H "x-nba-stats-origin: stats" -H "x-nba-stats-token: true" \
  "https://nba-relay.stefanroman.workers.dev/stats/commonplayerinfo?PlayerID=2544"         # 200, JSON with "LeBron"
```

Send nba_api's browser headers on the keyed request; without them `stats.nba.com` may hang until
the 25 s timeout (504). Logs: `npx wrangler@4 tail` from this folder.
