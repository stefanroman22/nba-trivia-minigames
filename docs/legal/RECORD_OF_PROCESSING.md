# Record of processing (GDPR Art 30), legitimate-interests assessment, DPIA screening

Verified against the code on 2026-10-07; consent rows updated 2026-10-11; rows 6a and 6b added 2026-10-15; Anthropic recipient added 2026-10-16; ads rows 14-17, recipient, LIA 3c and the DPIA decision added 2026-10-28 (ads not live: `NEXT_PUBLIC_ADS_ENABLED` off) (data audit of `backend/`, `src/`, `multiplayer_server/`). Controller and
contact: see `src/configurations/legal.ts`. No DPO appointed (see OPEN_ITEMS.md for the thresholds to watch).

## 1. Processing activities

| # | Data | Subjects | Purpose | Lawful basis | Visible to | Retention | Where |
|---|---|---|---|---|---|---|---|
| 1 | Email, display name, public ID, password hash or Google `sub` | Account holders | Account and sign-in | Contract (Art 6(1)(b)) | Operator; name and ID public | Until deletion | Supabase Postgres (`users_customuser`) |
| 2 | Points, rank | Account holders | Leaderboards, matchmaking | Contract | Public | Until deletion | Postgres; Redis ZSET if provisioned (it is not today) |
| 3 | Consent record (terms version, accepted-at, how it was agreed (`consent_source`: `signup_text` or `google_continue`; tick-box / birth-date sources on older accounts)). Legacy, no longer written or used since 2026-10-26: 13+ confirmed-at, coarse age group teen/adult and a birth month and year (never the day) on accounts that gave them | Account holders | Prove valid sign-up | Legitimate interests; legal obligation | Operator | Until deletion | Postgres |
| 4 | Profile photo (256x256 JPEG); upload is OFF in production until the photo-check service is deployed | Account holders (optional) | Show to other players | Consent (Art 6(1)(a)), removable | Public | Until removed or deletion | Postgres (`profile_photo_data`) |
| 5 | Friends, requests, blocks | Account holders | Friends features | Contract | The parties; operator | Until removed or deletion | Postgres |
| 6 | Game sessions and per-guess answers | Account holders; guests (answers only, unlinked) | Player record, statistics, fair play | Contract (own record); legitimate interests (statistics) | Operator | Sessions 24 months; answers 30 days | Postgres (`GameSession`, `GuessLog`) |
| 6a | Questions already shown to you (user, game, question ID, time; no answer text) | Account holders | No repeats | Contract | Operator | Until the question is retired or the account is deleted | Postgres (`SeenQuestion`) |
| 6b | Problem reports about questions (game, question ID, optional note up to 500 characters, user if signed in, time) | Account holders and guests | Fix wrong questions | Legitimate interests | Operator | Until handled, at most 12 months; deleted with the account. When the doctor scan handles a report it copies the note alone (no user, no time) onto the question, kept until 180 days after the question is retired; the weekly doctor research sends those notes to Anthropic (section 2), and its copies (GitHub artifacts) are deleted after 1 day | Postgres (`QuestionReport`; handled notes in `Question.quality`) |
| 6c | Time on the site per day (seconds the tab was visible and in use) and the connection's country code (ISO 3166, from Vercel's `x-vercel-ip-country` header; no IP stored) | Account holders only (guests are never tracked) | Usage statistics for the operator (admin Users tab): how much and from where the service is used | Legitimate interests (LIA in section 3b) | Operator | 12 months; deleted with the account; in the export | Postgres (`DailyActivity`) |
| 7 | Daily play gate for Wordle and LeContexto (user or random device ID, game, date) | Account holders, guests | One Wordle and one LeContexto per day | Legitimate interests | Operator | Pruned daily after the day | Postgres (`WordlePlay`) |
| 8 | Feedback (rating, message, page, email and name snapshot) | Any sender | Product improvement, reply | Legitimate interests | Operator | Until handled; resolved: 12 months; deleted with account | Postgres (`Feedback`) |
| 9 | Moderation events (reason code, salted SHA-256 of IP) and the strike count / ban status on the account | Account holders; sign-up attempts | Enforce rules, stop repeat abuse | Legitimate interests (LIA below) | Operator | Events 12 months (or while a ban stands); strike count and ban status stay with the account (strikes do not expire); ban record at most 5 years | Postgres (`ModerationEvent`, user fields) |
| 10 | Ban record after deletion of a banned account (canonical email, reason code, strikes, the moderation events with IP hashes, creation date) | Banned players | Prevent trivial re-registration | Legitimate interests; Art 17(3)(e) | Operator | While needed, at most 5 years from the ban | Postgres |
| 11a | Rate-limit counters (IP address) in the database cache table | Visitors | Stop guessing and flooding | Legitimate interests | Operator | About an hour | Postgres (`django_cache_table`) |
| 11 | Server logs (IP, time, URL) | Visitors | Security, operations | Legitimate interests | Operator | Provider-defined short period | Vercel |
| 12 | Multiplayer session (name, ID, rank, points, photo) | Players online | Run a match | Contract | Opponents | Memory only, until the match ends | Game server (not yet deployed) |
| 13 | Browser storage (Privacy section 11 table; keys verified in `src/` on 2026-10-28): `accessToken`, `refreshToken`, `nba3via-session-user` (localStorage); `nba-mg:wordle-device-id`; `nba3via-theme`; `sq:profile-view`; `gamedata:…`, `pool:…`, `questions:…` caches; `seen:<game>`, `seen:<game>:base`; sessionStorage (this tab only): `sq:guest-points`, `sq:rail-strip-x`. No first-party cookie is written by the frontend | Visitors | Sign-in and function | Strictly necessary (ePrivacy Art 5(3)); no consent needed | The user | Until cleared; tokens 90 days max; sessionStorage until the tab closes | The user's browser |
| 14 | Ad delivery, not live (flag off): IP address, browser and device details, page address, sent by the visitor's browser to Google; no account data ever passed | Visitors (guests and accounts), once ads are on | Show non-personalised ads (NPA for everyone, owner decision Q1 2026-10-27), limit repeats, stop ad fraud | Legitimate interests for a basic ad without cookies and fraud prevention (LIA 3c); consent for advertising cookies (EEA, UK, CH) | Google (independent controller) | Operator keeps nothing; Google per its policy | Google |
| 15 | Privacy-message choice cookie (`FCCDCF`; possibly `FCNEC`), not live (flag off) | Visitors in the EEA, UK and CH, once ads are on | Remember the visitor's ad and cookie choice and prove it was given | Legal obligation | The user; Google | 13 months (`FCNEC` 1 year), earlier if changed with Privacy and cookie settings | The user's browser (set by Google's CMP) |
| 16 | Ad measurement and fraud-prevention cookies (`__gads`, `__gpi`, `__gpi_optout`, `__eoi`, `IDE`, `id`, `DSID`, `test_cookie`, `TESTCOOKIESENABLED`), not live (flag off); list from Privacy section 11, to be checked against the live stack before launch | Visitors, once ads are on | Show and measure ads, limit repeats, prevent fraud | Consent (advertising cookies, EEA/UK/CH); fraud-only storage under limited ads is an open ePrivacy point (lawyer L1) | Google and, with consent, the minimal certified ad partner list (Q5) | 15 minutes to 13 months (24 months outside EEA/UK/CH for `IDE`, `id`) | The user's browser |
| 17 | AdSense reports (earnings, numbers of ads shown), not live (flag off) | None: aggregate totals, not personal data | Run the site's finances | n/a | Operator | As long as useful | AdSense account |

No special-category data is collected on purpose. No third-party analytics, tracking pixels or sale of account data.
Ads are not live yet; when switched on (rows 14-17) they are served by Google as an independent controller. The only
first-party usage measurement is row 6c.

## 2. Recipients and processors

| Recipient | Role | Region | Contract / transfer basis | Action to keep it valid |
|---|---|---|---|---|
| Vercel (site, API in Frankfurt `fra1`, photo-moderation service) | Processor | Global edge; API in the EU | DPA with SCCs and UK addendum, accepted via its terms: https://vercel.com/legal/dpa | Keep a dated copy of the accepted DPA |
| Supabase (Postgres) | Processor | `eu-central-1` (Frankfurt) | DPA with SCCs, accepted via its terms: https://supabase.com/legal/dpa | Confirm region; prefer EU |
| GitHub (Actions) | Processor: stores the code and runs scheduled jobs holding the production `DATABASE_URL` (weekly prune, Wordle word, question maintenance) | United States / global | GitHub's data protection terms | Keep a dated copy; scope secrets to what each job needs |
| Anthropic (Claude, run by the GitHub Action `doctor-research.yml`) | Processor for the question-research step: checks reported questions. Receives the doctor cases, which hold the report notes copied onto the question (row 6b: the note text only, no user, no time; `QuestionReport` rows themselves are never exported), next to anonymous question data and anonymous counts of the wrong answers players typed (`WrongAnswerStats`, no user link). The job has no database access | United States | Anthropic's terms for the plan behind `CLAUDE_CODE_OAUTH_TOKEN` | The cases and verdicts are kept as GitHub artifacts for 1 day (`retention-days: 1`). The plan's terms may not cover processing on our behalf; the owner accepted that risk on 2026-10-18, to revisit before a public launch (OPEN_ITEMS.md section B) |
| Developer tooling (AI-assisted tools used by the operator) | Processor-like: may be given database access for maintenance | Provider-defined | Provider terms | Restrict to non-personal tables where possible (OPEN_ITEMS) |
| Google (sign-in) | Independent controller for its own account data | Global | Google's terms; API Services User Data Policy (Limited Use) | Verify the OAuth consent screen (branding, domains) |
| Google (AdSense and its privacy message / CMP), not live (flag off) | Independent controller for ad delivery and the consent message; the operator is jointly responsible only for the collection step (putting Google's ad code on the page: the visitor's browser contacting Google). Receives what row 14 lists; nothing from the account | Google Ireland Limited (EEA, CH); Google LLC (United States) worldwide | Google Controller-Controller Data Protection Terms (https://business.safety.google/controllerterms/); EU-US Data Privacy Framework (UK and Swiss extensions) with SCCs in Google's terms as a fallback | Before launch: accept the terms in AdSense, configure the CMP, RDP for US states and the minimal ad partner list (OPEN_ITEMS "Before ads go live") |
| Game-server host (to be chosen) | Processor | To be set | DPA required before launch | Choose an EU region; list it in the policy |
| NBA (`cdn.nba.com`: the official headshot of every player who has one, again since 2026-10-28, owner decision; no team logos since 2026-10-27). Wikimedia Foundation (`upload.wikimedia.org`: the player photos the NBA has no headshot for) | Independent controllers for what they log; the operator is jointly responsible only for making the visitor's browser send the request (CJEU C-40/17 Fashion ID). They receive IP, browser/device details and the site origin (Referrer-Policy `strict-origin-when-cross-origin`); nothing from the account | United States / global | No contract possible; legitimate interests (show the game pictures without copying them); disclosed in Privacy section 5 with how to object (block the host: silhouette fallback) | Removing the direct request (serving the pictures from our own domain) is OPEN_ITEMS E; LG München I 3 O 17493/20 (Google Fonts) is the risk it removes |

## 3. Legitimate-interests assessment (moderation and anti-abuse records, rows 9-10)

- **Purpose:** keep a public leaderboard with user-chosen names and photos free of abuse, and stop banned players creating new accounts.
- **Necessity:** automated checks are the only practical way to screen every name and photo for a free service run by one person; a reason code and a salted IP hash are the least data that supports a three-strike rule and a sign-up lock. No offending text or raw IP is stored.
- **Balance:** the data is visible to the operator only, is short-lived (12 months) except for a standing ban, and a banned player's data is otherwise erased on request. Players can see the reason, appeal to a person and obtain reversal (Terms section 7). Reasonable expectation: the rules and the strike system are stated at sign-up and in the Terms.
- **Safeguards:** the classifier (when deployed) keeps no image; ban records are capped at five years; erasure is possible except the minimal ban record.
- **Outcome:** legitimate interests apply. Review yearly and whenever the moderation rules change.

## 3b. Legitimate-interests assessment (time on the site and country, row 6c; added 2026-10-20)

- **Purpose:** know how much the service is used, by whom and from which countries, to decide what to build, spot drop-off and plan capacity.
- **Necessity:** a daily total of seconds and one country code per player-day is the least that answers those questions; no page-by-page trail, no IP, no device fingerprint, no third-party tool. Counting stops when the tab is hidden or idle for 3 minutes.
- **Balance:** signed-in players only, visible to the operator only, 12 months, in the export and erased with the account. Disclosed in the Privacy Policy row and summary. Country-level location is coarse and not used to decide anything about the player.
- **Safeguards:** server-side clamps (15 minutes per report, 24 hours per day); no cookie or new browser storage (ePrivacy Art 5(3) not engaged beyond the existing sign-in token).
- **Outcome:** legitimate interests apply. Objection: on request the operator deletes the rows (no self-service switch yet; see OPEN_ITEMS.md).

## 3c. Legitimate-interests assessment (limited / non-personalised ad delivery, row 14; added 2026-10-28, ads not live)

- **Purpose:** fund a free service.
- **Necessity:** an ad request needs the IP and user agent; there is no cookie-free way to show an ad at all.
- **Balance:** contextual only, no profile, users told in advance (Privacy sections 2 and 11), a content blocker works, nothing from the account is passed.
- **Safeguards:** NPA for everyone (no age data exists; owner decision Q1 2026-10-27), blocked categories, no Auto ads formats that cover content.
- **Outcome:** legitimate interests apply to delivery. **The IVT cookies and storage set without consent are an ePrivacy question, not a GDPR one, and LIA cannot fix that (lawyer point L1).**

## 4. DPIA screening (Art 35)

| Trigger | Present? | Note |
|---|---|---|
| Large-scale processing of personal data | Possibly, as the user base grows | Public display data of many users |
| Children's data | Partly mitigated: the Terms say accounts are 13+, but the app checks no age (owner decision 2026-10-11, pre-launch; removed from the app 2026-10-26); no chat; no birth date asked; deletion on discovering an under-13 account | Residual: nothing stops a minor (or an under-13) from opening an account; every account is public and may add a photo |
| User-generated photos shown publicly | Yes | Automated classifier, fail-closed, removable |
| Profiling, automated decisions with significant effect | Limited | Strike/ban is automated but reviewable by a person on request. Ads (rows 14-16, not live): non-personalised for everyone (Q1 NPA-all), so no ad profiling by Google and its partners is requested |
| Special categories, location, biometric | Country only (row 6c, since 2026-10-20) | No IP, city or GPS is stored; photos are not used for identification |
| Usage analytics | First-party only (row 6c, since 2026-10-20) | Daily seconds on the site for signed-in players, operator-only, 12 months; screened 2026-10-20: no DPIA needed at this scope |
| Third-party advertising | Not live yet (flag off); planned | DPIA required before ads go live: [DPIA-ADS.md](DPIA-ADS.md) (draft, pending owner review). ANSPDCP Decision 174/2018 Art 1(1)(d) names processing of minors' data by automated monitoring of behaviour, including for advertising; the audience includes guests of any age. Under NPA-all the profiling criterion drops out, but the DPIA is kept |

**Conclusion:** a full DPIA is required before ads go live; it is drafted in [DPIA-ADS.md](DPIA-ADS.md) (draft, pending
owner review; sign-off date left for the owner). For everything else this screening stands. Redo it before analytics,
chat, location, an app-store release, a change of ad configuration (personalisation, new ad partners, Auto ads formats),
or reaching a scale at which a lawyer advises a DPO/DPIA (see OPEN_ITEMS.md).

## 5. Security measures (Art 32)

HTTPS with 1-year HSTS in production; salted PBKDF2 password hashes; 15-minute access tokens and 90-day rotating,
blacklistable refresh tokens; rate limits on sign-in, sign-up, refresh and account actions; Django admin and admin API
restricted to staff; production refuses to start without a real `DJANGO_SECRET_KEY`; generic API error messages and one generic login failure message; baseline
security headers; weekly pruning. Known gaps are tracked in OPEN_ITEMS.md (CSP, HttpOnly cookies, admin 2FA and audit log).
