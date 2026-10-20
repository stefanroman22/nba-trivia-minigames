# Record of processing (GDPR Art 30), legitimate-interests assessment, DPIA screening

Verified against the code on 2026-10-07; consent rows updated 2026-10-11; rows 6a and 6b added 2026-10-15; Anthropic recipient added 2026-10-16 (data audit of `backend/`, `src/`, `multiplayer_server/`). Controller and
contact: see `src/configurations/legal.ts`. No DPO appointed (see OPEN_ITEMS.md for the thresholds to watch).

## 1. Processing activities

| # | Data | Subjects | Purpose | Lawful basis | Visible to | Retention | Where |
|---|---|---|---|---|---|---|---|
| 1 | Email, display name, public ID, password hash or Google `sub` | Account holders | Account and sign-in | Contract (Art 6(1)(b)) | Operator; name and ID public | Until deletion | Supabase Postgres (`users_customuser`) |
| 2 | Points, rank | Account holders | Leaderboards, matchmaking | Contract | Public | Until deletion | Postgres; Redis ZSET if provisioned (it is not today) |
| 3 | Consent record (terms version, accepted-at, 13+ confirmed-at, how it was given (`consent_source`: sign-up tick-box, Google sign-up tick-box, or birth date from an older client), coarse age group teen/adult and the birth month and year, only if given for a profile photo or in Profile settings (twice at most); never the day) | Account holders | Prove valid sign-up | Legitimate interests; legal obligation | Operator | Until deletion | Postgres |
| 4 | Profile photo (256x256 JPEG); upload is OFF in production until the photo-check service is deployed | Account holders aged 16+ (optional) | Show to other players | Consent (Art 6(1)(a)), removable | Public | Until removed or deletion | Postgres (`profile_photo_data`) |
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
| 13 | Browser storage: tokens, cached profile, device code, theme, game caches, questions already shown per game | Visitors | Sign-in and function | Strictly necessary (ePrivacy Art 5(3)); no consent banner | The user | Until cleared; tokens 90 days max | The user's browser |

No special-category data is collected on purpose. No ads, third-party analytics, tracking pixels or data sales;
the only usage measurement is first-party row 6c.

## 2. Recipients and processors

| Recipient | Role | Region | Contract / transfer basis | Action to keep it valid |
|---|---|---|---|---|
| Vercel (site, API in Frankfurt `fra1`, photo-moderation service) | Processor | Global edge; API in the EU | DPA with SCCs and UK addendum, accepted via its terms: https://vercel.com/legal/dpa | Keep a dated copy of the accepted DPA |
| Supabase (Postgres) | Processor | `eu-central-1` (Frankfurt) | DPA with SCCs, accepted via its terms: https://supabase.com/legal/dpa | Confirm region; prefer EU |
| GitHub (Actions) | Processor: stores the code and runs scheduled jobs holding the production `DATABASE_URL` (weekly prune, Wordle word, question maintenance) | United States / global | GitHub's data protection terms | Keep a dated copy; scope secrets to what each job needs |
| Anthropic (Claude, run by the GitHub Action `doctor-research.yml`) | Processor for the question-research step: checks reported questions. Receives the doctor cases, which hold the report notes copied onto the question (row 6b: the note text only, no user, no time; `QuestionReport` rows themselves are never exported), next to anonymous question data and anonymous counts of the wrong answers players typed (`WrongAnswerStats`, no user link). The job has no database access | United States | Anthropic's terms for the plan behind `CLAUDE_CODE_OAUTH_TOKEN` | The cases and verdicts are kept as GitHub artifacts for 1 day (`retention-days: 1`). The plan's terms may not cover processing on our behalf; the owner accepted that risk on 2026-10-18, to revisit before a public launch (OPEN_ITEMS.md section B) |
| Developer tooling (AI-assisted tools used by the operator) | Processor-like: may be given database access for maintenance | Provider-defined | Provider terms | Restrict to non-personal tables where possible (OPEN_ITEMS) |
| Google (sign-in) | Independent controller for its own account data | Global | Google's terms; API Services User Data Policy (Limited Use) | Verify the OAuth consent screen (branding, domains) |
| Game-server host (to be chosen) | Processor | To be set | DPA required before launch | Choose an EU region; list it in the policy |
| NBA CDN, Wikimedia | Image sources (browser fetches directly; they see the visitor's IP) | Global | None possible; disclosed in the policy | See OPEN_ITEMS (asset licensing) |

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

## 4. DPIA screening (Art 35)

| Trigger | Present? | Note |
|---|---|---|
| Large-scale processing of personal data | Possibly, as the user base grows | Public display data of many users |
| Children's data | Mitigated: accounts 13+ (self-declared tick-box since 2026-10-11, owner decision), only a birth month and year stored when the player gives them (never the day), no photo or chat for under-16s; the profile photo is the only age limit (owner decision 2026-10-19): accounts without a confirmed 16+ age cannot add a photo, and are otherwise on the public leaderboard and in name search like every account | Residual: minors lying about age (easier with a tick-box than with a birth-date screen) |
| User-generated photos shown publicly | Yes | Automated classifier, fail-closed, removable |
| Profiling, automated decisions with significant effect | Limited | Strike/ban is automated but reviewable by a person on request |
| Special categories, location, biometric | Country only (row 6c, since 2026-10-20) | No IP, city or GPS is stored; photos are not used for identification |
| Usage analytics | First-party only (row 6c, since 2026-10-20) | Daily seconds on the site for signed-in players, operator-only, 12 months; screened 2026-10-20: no DPIA needed at this scope |

**Conclusion:** a full DPIA is not mandatory today; this screening is the record of that decision. Redo it before any
of: ads or analytics, chat, location, an app-store release, or reaching a scale at which a lawyer advises a DPO/DPIA
(see OPEN_ITEMS.md).

## 5. Security measures (Art 32)

HTTPS with 1-year HSTS in production; salted PBKDF2 password hashes; 15-minute access tokens and 90-day rotating,
blacklistable refresh tokens; rate limits on sign-in, sign-up, refresh and account actions; Django admin and admin API
restricted to staff; production refuses to start without a real `DJANGO_SECRET_KEY`; generic API error messages and one generic login failure message; baseline
security headers; weekly pruning. Known gaps are tracked in OPEN_ITEMS.md (CSP, HttpOnly cookies, admin 2FA and audit log).
