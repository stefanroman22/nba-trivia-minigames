# Record of processing (GDPR Art 30), legitimate-interests assessment, DPIA screening

Verified against the code on 2026-10-07 (data audit of `backend/`, `src/`, `multiplayer_server/`). Controller and
contact: see `src/configurations/legal.ts`. No DPO appointed (see OPEN_ITEMS.md for the thresholds to watch).

## 1. Processing activities

| # | Data | Subjects | Purpose | Lawful basis | Visible to | Retention | Where |
|---|---|---|---|---|---|---|---|
| 1 | Email, display name, public ID, password hash or Google `sub` | Account holders | Account and sign-in | Contract (Art 6(1)(b)) | Operator; name and ID public | Until deletion | Supabase Postgres (`users_customuser`) |
| 2 | Points, rank | Account holders | Leaderboards, matchmaking | Contract | Public | Until deletion | Postgres; Redis ZSET if provisioned (it is not today) |
| 3 | Consent record (terms version, accepted-at, age-confirmed-at) | Account holders | Prove valid sign-up | Legitimate interests; legal obligation | Operator | Until deletion | Postgres |
| 4 | Profile photo (256x256 JPEG) | Account holders (optional) | Show to other players | Consent (Art 6(1)(a)), removable | Public | Until removed or deletion | Postgres (`profile_photo_data`) |
| 5 | Friends, requests, blocks | Account holders | Friends features | Contract | The parties; operator | Until removed or deletion | Postgres |
| 6 | Game sessions and per-guess answers | Account holders; guests (answers only, unlinked) | Player record, statistics, fair play | Contract (own record); legitimate interests (statistics) | Operator | Sessions 24 months; answers 12 months | Postgres (`GameSession`, `GuessLog`) |
| 7 | Wordle play gate (user or random device ID, date) | Account holders, guests | One Wordle per day | Legitimate interests | Operator | Pruned daily after the day | Postgres (`WordlePlay`) |
| 8 | Feedback (rating, message, page, email and name snapshot) | Any sender | Product improvement, reply | Legitimate interests | Operator | Until handled; resolved: 12 months; deleted with account | Postgres (`Feedback`) |
| 9 | Moderation events and strikes (reason code, salted SHA-256 of IP) | Account holders; sign-up attempts | Enforce rules, stop repeat abuse | Legitimate interests (LIA below) | Operator | Events 12 months; while ban stands; ban record at most 5 years | Postgres (`ModerationEvent`, user fields) |
| 10 | Ban record after deletion of a banned account (canonical email, reason, strikes) | Banned players | Prevent trivial re-registration | Legitimate interests; Art 17(3)(e) | Operator | While needed, at most 5 years from the ban | Postgres |
| 11 | Server logs (IP, time, URL) | Visitors | Security, operations | Legitimate interests | Operator | Provider-defined short period | Vercel |
| 12 | Multiplayer session (name, ID, rank, points, photo) | Players online | Run a match | Contract | Opponents | Memory only, until the match ends | Game server (not yet deployed) |
| 13 | Browser storage: tokens, cached profile, device code, theme, game caches, 24h age-check note | Visitors | Sign-in and function | Strictly necessary (ePrivacy Art 5(3)); no consent banner | The user | Until cleared; tokens 90 days max | The user's browser |

No special-category data is collected on purpose. No ads, analytics, tracking pixels or data sales.

## 2. Recipients and processors

| Recipient | Role | Region | Contract / transfer basis | Action to keep it valid |
|---|---|---|---|---|
| Vercel (site, API in Frankfurt `fra1`, photo-moderation service) | Processor | Global edge; API in the EU | DPA with SCCs and UK addendum, accepted via its terms: https://vercel.com/legal/dpa | Keep a dated copy of the accepted DPA |
| Supabase (Postgres) | Processor | Confirm project region (OPEN_ITEMS) | DPA with SCCs, accepted via its terms: https://supabase.com/legal/dpa | Confirm region; prefer EU |
| Google (sign-in) | Independent controller for its own account data | Global | Google's terms; API Services User Data Policy (Limited Use) | Verify the OAuth consent screen (branding, domains) |
| Game-server host (to be chosen) | Processor | To be set | DPA required before launch | Choose an EU region; list it in the policy |
| NBA CDN, Wikimedia | Image sources (browser fetches directly; they see the visitor's IP) | Global | None possible; disclosed in the policy | See OPEN_ITEMS (asset licensing) |

## 3. Legitimate-interests assessment (moderation and anti-abuse records, rows 9-10)

- **Purpose:** keep a public leaderboard with user-chosen names and photos free of abuse, and stop banned players creating new accounts.
- **Necessity:** automated checks are the only practical way to screen every name and photo for a free service run by one person; a reason code and a salted IP hash are the least data that supports a three-strike rule and a sign-up lock. No offending text or raw IP is stored.
- **Balance:** the data is visible to the operator only, is short-lived (12 months) except for a standing ban, and a banned player's data is otherwise erased on request. Players can see the reason, appeal to a person and obtain reversal (Terms section 7). Reasonable expectation: the rules and the strike system are stated at sign-up and in the Terms.
- **Safeguards:** the classifier keeps no image; ban records are capped at five years; erasure is possible except the minimal ban record.
- **Outcome:** legitimate interests apply. Review yearly and whenever the moderation rules change.

## 4. DPIA screening (Art 35)

| Trigger | Present? | Note |
|---|---|---|
| Large-scale processing of personal data | Possibly, as the user base grows | Public display data of many users |
| Children's data | Mitigated: accounts 16+, age check, no birth date stored; teens still reachable by guests | Residual: minors lying about age |
| User-generated photos shown publicly | Yes | Automated classifier, fail-closed, removable |
| Profiling, automated decisions with significant effect | Limited | Strike/ban is automated but reviewable by a person on request |
| Special categories, location, biometric | No | Photos are not used for identification |

**Conclusion:** a full DPIA is not mandatory today; this screening is the record of that decision. Redo it before any
of: ads or analytics, chat, location, an app-store release, or reaching a scale at which a lawyer advises a DPO/DPIA
(see OPEN_ITEMS.md).

## 5. Security measures (Art 32)

HTTPS with 1-year HSTS in production; salted PBKDF2 password hashes; 15-minute access tokens and 90-day rotating,
blacklistable refresh tokens; rate limits on sign-in, sign-up, refresh and account actions; Django admin and admin API
restricted to staff; production refuses to start without a real `DJANGO_SECRET_KEY`; generic API error messages; baseline
security headers; weekly pruning. Known gaps are tracked in OPEN_ITEMS.md (CSP, HttpOnly cookies, admin 2FA and audit log).
