# Teams — Extensive Data Fields

Wishlist of fields to collect for each NBA team (30 teams). Main sources: `nba_api` (stats.nba.com — `teamdetails`, `teaminfocommon`, `franchisehistory` endpoints), balldontlie API, Wikipedia/Basketball-Reference for historical facts.

## Identity
- **Team name** — full name, e.g. "Los Angeles Lakers"
- **Nickname** — just the name part, e.g. "Lakers"
- **Abbreviation** — official 3-letter code, e.g. LAL, BOS, OKC — great for "guess the team from the code" questions
- **Current logo** — official logo (SVG/PNG from cdn.nba.com: `https://cdn.nba.com/logos/nba/{team_id}/global/L/logo.svg`)
- **Historical logos** — old logos if easy to source — "which era is this logo from?" questions
- **Primary color** — hex code
- **Secondary color** — hex code — useful for UI theming per team AND "guess the team by its colors" questions
- **Conference** — East / West
- **Division** — Atlantic, Central, Southeast, Northwest, Pacific, Southwest

## Location
- **City**
- **State** — if Toronto put province (Ontario) or mark country = Canada
- **Country** — USA / Canada (only Raptors are Canada — fun trivia fact)
- **Former cities** — relocation history with years, e.g. "Seattle (1967–2008) → Oklahoma City" — great for hard-mode trivia
- **Former team names** — e.g. New Jersey Nets → Brooklyn Nets, Charlotte Bobcats → Hornets

## Arena
- **Arena name** — current, e.g. "Crypto.com Arena" — these get renamed often (sponsors), flag as "changes often"
- **Arena capacity** — basketball configuration
- **Arena opening year**
- **Former arena names** — e.g. Staples Center → Crypto.com Arena — "what was this arena called before?" questions

## History
- **Founding year** — year the franchise was established
- **Year joined NBA** — differs from founding for ABA teams (Nets, Nuggets, Pacers, Spurs joined 1976)
- **NBA championships count**
- **Championship years** — list, e.g. Celtics: 1957, 1959…2024 — enables "which team won in year X?" questions
- **Finals appearances count** — includes losses — "which team lost the most Finals?"
- **Retired jersey numbers** — number + player name — strong crossover with player data: "which team retired #23?"

## People
- **Current head coach** — changes often
- **Owner** — changes rarely but does (e.g. Celtics 2025)
- **Greatest players (franchise legends)** — 3–5 names per team — links to players data for "which team is this legend associated with?"
- **Current star player** — changes often — "who plays for X?" easy-mode questions

## Fun / Trivia-oriented
- **Mascot name** — e.g. Benny the Bull, Gritty-style fame varies; Lakers and Warriors famously have NO mascot — that itself is a trivia question
- **Main rivalries** — e.g. Lakers–Celtics, Knicks–Heat — "who is X's historic rival?"
- **Longest playoff drought / notable streaks** — e.g. Kings 2006–2022 drought, Warriors 73-win season 2015–16
- **All-time win percentage** — from `franchisehistory` — "which franchise has the best all-time record?" (Spurs/Lakers territory)
- **Name origin story** — one-liner, e.g. Lakers = Minnesota "Land of 10,000 Lakes", Jazz = New Orleans music scene, 76ers = 1776 — excellent "why is the team called X?" questions

## Stats — these change often
- **Current season wins / losses**
- **Conference standing**
- **Last season result** — e.g. "Lost 1st round", "Won Finals"

## Minigame ideas this data enables
- **Logo quiz** — show logo (or blurred/partial logo), guess the team
- **Higher or lower** — championships count, founding year, arena capacity
- **Map game** — place the team on a US map (city/state data)
- **Color match** — guess team from its two colors
- **Odd one out** — 4 teams, which one is not in the Atlantic Division?
- **Timeline** — order teams by founding year / championship year
- **Franchise journey** — "this team started in Seattle…" relocation riddles
- **Jersey vault** — which team retired this number for this player? (crossover with players data)
