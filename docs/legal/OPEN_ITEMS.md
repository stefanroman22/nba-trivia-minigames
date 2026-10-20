# Open items

Nothing in this repository makes the service "impossible to sue" or "impossible to take down". What it does is bring the
product to a documented, standards-based baseline. These are the things that still need a decision, money, or a
lawyer. Ordered by how much they matter for launch at scale.

## A. Blocking items

Done: operator name, address and country are set; the Google consent screen is published. Remaining:

| Item | Why | Where |
|---|---|---|
| **Git history cleaned (done 2026-10-08).** Remaining: rotate the Google OAuth client secret (it was public) and ask GitHub Support to purge cached views and old PR refs | Audit finding C2; see HISTORY-CLEANUP-2026-10-08.md for the exact steps and the request text | Google Cloud Console, Vercel env `CLIENT_SECRET`, GitHub Support |
| **NBA assets** (logos, headshots, the scraping workaround) | Audit finding C5; the most likely takedown | Section D.1 |
| **Dedicated privacy mailbox** instead of the personal Gmail (kept for now by choice) | Public and permanent | `contactEmail` in `legal.ts` |
| **Terms/Privacy version 2026-10-20.1, promoted 2026-10-20 with an owner waiver.** The dates were set to the promotion day (effective 3 November 2026, notice shown until then). Because `main` deploys the backend with the frontend, the backend and relay changes apply from 2026-10-20, before `effective`. Waiver: the owner instructed the promotion on 2026-10-20 in the session ("promote to production"); production had 4 accounts. Revisit if a player objects before 3 November. | The change notice promises existing accounts 14 days before a material change applies | `src/configurations/legal.ts`, `backend/users/consent.py TERMS_VERSION` |

## B. Decisions that are yours

| Decision | Current setting | Trade-off |
|---|---|---|
| **Minimum age for accounts** | **13**, worldwide; guests of any age. Since 2026-10-11 sign-up is one self-declared tick-box (13+ and Terms/Privacy, email and Google); birth month/year is asked only when adding a profile photo. Accounts without a confirmed age of 16+ (unknown age or 13-15) are treated as "teen": no public photo (`PHOTO_MIN_AGE` 16). **Owner decision 2026-10-19:** the photo is the only age restriction; teen accounts are on the public leaderboard and in name search and show their name, photo and ID to strangers in online matches like every account (they were hidden from those until then; terms version 2026-10-19.1) | 13 is the practical floor: below it US law (COPPA) needs verifiable parental consent, and several countries want it up to 16. Remaining exposure for 13-15: contract capacity under national law in 14-16 states, UK Children's Code defaults, Brazil ECA Digital, India (under 18). Mitigations in place: no chat, no photo, no birth date stored, deletion on request, parent contact route. Hiding teens from the public leaderboard, name search and random-match opponents was removed by the owner on 2026-10-19 (it had been the audit H2 fix); a "private profile" default and friend-search limits for teens are the next steps if a lawyer asks. Constants: `MIN_AGE`, `PHOTO_MIN_AGE` in `backend/users/consent.py`; `minimumAge`, `photoMinimumAge` in `legal.ts`. |
| **Account deletion confirmation** | **Owner decision 2026-10-19:** Profile → Delete account asks the player to type their username and the word "delete"; no password (Google-only accounts confirm the same way) | Typing the username + "delete" prevents accidents only: anyone holding a live session (an unlocked device, a leaked token) can delete the account. A re-authentication step (password, or a fresh Google sign-in) would close that; not built. |
| **Public profile defaults** | Display name, ID, rank, points and photo are public; photo is optional and removable | Privacy-by-default arguments favour a "private profile" switch, especially for 16-17 year-olds under the UK Children's Code. Not built. |
| **Report notes sent to Claude** | The question doctor sends players' optional report notes (no user, no time) to Anthropic's Claude through the Max-plan token, which may not carry a data processing agreement. **Owner accepted this risk on 2026-10-18**; revisit before a public launch | Keep (current), stop sending notes (free; the doctor still sees the question, wrong-answer counts and report count), or pay for a plan with a DPA. Record of processing row "Anthropic". |
| **Inactive-account deletion** | None; accounts stay until deleted | Regulators (CNIL) expect a limit, normally with warning email. The site sends no email at all today, so it cannot warn. Building email (also needed for password reset, email verification) unlocks this. |

## C. Costs (stop and ask)

| Item | Cost | Note |
|---|---|---|
| Production game-server host | From about $5/month (Railway Hobby) or a free tier that sleeps | Needs an EU region and a DPA; add it to the Privacy Policy table when chosen. |
| US DMCA designated agent | $6, renew every 3 years | Only matters for the safe harbour on user-uploaded photos for US users. Cheap insurance. |
| Trademark clearance for "Swish Quest" | Lawyer or search-service fees | No register could be queried in research; a pending "24 8 HOOPS" mark exists. |
| A lawyer's review of the pages and these items | One-off | See D. Strongly recommended before launch at scale. |

## D. Needs a lawyer's judgement

1. **NBA assets (largest exposure).** Team logos and player headshots are hotlinked from `cdn.nba.com`; player data comes from the unofficial `nba_api`. NBA's Terms restrict stats to non-commercial/news use and bar reproducing or linking images and logos without permission. Names alone are low risk (nominative use); logos and headshots are the real risk (trademark, copyright, right of publicity). Options: licensed or Wikimedia/public-domain images, silhouettes, text-only. The NBA disclaimer is in the Terms (section 9).
2. Trademark clearance of the product name and logo (above).
3. Whether leaderboards/public photos make the service a DSA "online platform" (micro/small-enterprise exemption likely applies) and a UK Online Safety Act user-to-user service (illegal-content risk assessment, reporting, terms). Write the Ofcom risk assessment (short) if UK users are expected.
4. Legal basis for public profile data (contract vs legitimate interests), and the legitimate-interests assessment in `RECORD_OF_PROCESSING.md`.
5. Whether the strike/ban system is an Art 22 automated decision (a human review route exists).
6. DPO and DPIA thresholds at scale; UK representative (UK GDPR Art 27); lead supervisory authority.
7. Retention period for ban records (currently capped at 5 years) and for moderation events (12 months).
8. EU-US transfers if the Data Privacy Framework is invalidated (appeal Latombe, C-703/25 P pending as of the research).
9. Per-country extras: Turkey VERBIS, India under-18 consent (from about May 2027), Brazil ECA Digital age assurance, China, Russia and sanctioned countries (blocking).
10. Whether the commitments in the Terms (14-day appeal answer, 14 days' notice of material changes) are ones you can keep.

## E. Engineering follow-ups

| Item | Risk it addresses |
|---|---|
| Existing accounts (created before the consent step) have no consent record and no age check; also needed for the 14-day change notice. Show the Terms and an age prompt on next sign-in and store acceptance | Pre-existing users are not covered by a recorded agreement |
| Notice mechanism for changes to Terms/Privacy: a home-page banner now exists (`src/components/LegalChangeNotice.tsx`, dates in `LEGAL.changeNotice`); the operator still has to set its dates for each significant change and promote it at least 14 days before the change applies (RUNBOOKS F) | Terms section 12 |
| In-product "Report" button for players, names, photos | DSA notice-and-action is email-only today |
| Email sending (verification, password reset, notices) | No password reset, no email change, no email verification today; also enables inactive-account warnings |
| "Log out everywhere" and change-password | Account security basics |
| Content-Security-Policy, and moving tokens to HttpOnly cookies | localStorage tokens are readable by any XSS; needs a tested allow-list (Google sign-in, NBA CDN) |
| Admin: audit log of reads of feedback and raw game data, 2FA or IP allow-list, drop raw `user_id` from source-row views | Art 32 access accountability |
| Deploy and pin the photo-check service (`moderation_service`, set `IMAGE_MODERATION_URL`), then switch photo upload on and update the policy | Photo upload returns 503 in production today |
| Block Russia and sanctioned regions at the edge (Vercel firewall) | Terms/Privacy say the service is not available there but nothing enforces it |
| Remove `.sqlite3` data and `backend/media/profiles/*` personal-looking files, and `local deployment/ADMIN_CREDENTIALS.md`, from the OneDrive-synced tree | Personal data and a credential in a cloud-synced folder |
| ~~`StartingFive.tsx` sent revealed player names to `i.pravatar.cc` for placeholder faces~~ | Resolved 2026-10-16: it was rendered on every card flip; replaced by real photos via `PlayerPhoto` (cdn.nba.com, else Wikimedia Commons with credits at `/credits`, else a silhouette) |
| Accept and file the Vercel and Supabase DPAs (dated copies) | Art 28 evidence |
| Throttle or require login for the public photo endpoint | Scraping; weighed and left public for now (the photos are already public on leaderboards) |

## F. Done in this change (for the record)

Consent and age check at sign-up (email and Google; since 2026-10-11 a single 13+/Terms tick-box, birth month/year only when adding a photo); self-service data export, photo removal and account deletion;
`erase_user` for banned or emailed requests; weekly pruning job; production secret-key guard; 1-year HSTS; generic
error messages; security headers; privacy policy and terms rewritten against the system; this record, runbooks and
research.
