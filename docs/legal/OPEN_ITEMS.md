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
| **Dedicated privacy mailbox** instead of the personal Gmail (kept for now by choice). Higher priority once ads are on: ad-related requests would land in a personal Gmail | Public and permanent | `contactEmail` in `legal.ts` |
| **Terms/Privacy version 2026-10-20.1, promoted 2026-10-20 with an owner waiver.** The dates are the promotion day (effective 3 November 2026; the home-page notice was removed before launch, see the notice-mechanism row below). Because `main` deploys the backend with the frontend, the backend and relay changes apply from 2026-10-20, before `effective`. Waiver: the owner instructed the promotion on 2026-10-20 in the session ("promote to production"); production had 4 accounts. | Terms section 12 promises existing accounts the change applies from `effective` | `src/configurations/legal.ts`, `backend/users/consent.py TERMS_VERSION` |

## A2. Before ads go live

Ads (Google AdSense) are built behind `NEXT_PUBLIC_ADS_ENABLED` (unset = off, the production default) and
`NEXT_PUBLIC_ADSENSE_PUB_ID` (unset now); the Privacy Policy describes them as "not live yet" (legal version
2026-10-28.1). AdSense and Google's privacy message (CMP, Privacy & messaging) are free; no paid CMP. None of these
rows is done.

| Item | Why | Where |
|---|---|---|
| **Decide the ads launch date** | Not set (owner, 2026-10-27). The launch date must be at least 14 days after the Terms and Privacy text is live (the Terms and the policy promise 14 days' notice of a significant change before it applies: Terms section 12, Privacy section 15) | `legal.ts`, RUNBOOKS F |
| **AdSense account: block sensitive categories** | Young audience; the policy says gambling, betting and simulated-gambling ads will be blocked. The Terms (section 10) deliberately do not claim any blocked category: add that sentence back only once the categories are actually blocked in the account. Block Gambling & Betting (restricted, default) plus Simulated gambling, Dating, Weight loss, Cosmetic procedures & body modification, Get rich quick, References to sex & sexuality, Sexual & reproductive health, Drugs & supplements, Sensationalism; confirm restricted categories (alcohol, etc.) stay blocked. Category names differ by UI version (UNVERIFIED). Record the list with a date in DPIA-ADS.md | AdSense → Brand safety → Blocking controls |
| **Lawyer review L1-L7: not booked** (costs money, owner's call) | L1 ePrivacy / Law 506/2004: the ad script request and Google's IVT cookies or storage for limited ads without consent; L2 FCNEC before a choice; L3 joint-responsibility wording (Fashion ID) vs Google's controller-controller framing, and the tension between Google's required-content sentences in Privacy section 5 ("ads based on your prior visits") and the site's non-personalised ads for everyone (NPA-all); L4 DPIA sign-off and "large scale" in ANSPDCP 174/2018 (d); L5 minors (Recital 38, UK Children's Code, COPPA mixed audience); L6 the CCPA 50%-revenue test and other states' minors-ads rules; L7 Romanian gambling-advertising rules and Romanian Bill 256/2026. Also: IVT cookies, DCD 2019/770 (Terms card) | Section C (cost), section D |
| **Register the operator before ad income (PFA or other)** | The operator stays an individual and no business is registered (owner, 2026-10-29). Regular ad income may make him a "trader" (CJEU C-105/17 Kamenova) with identity duties (e-Commerce Art 5; Law 365/2002) and possibly tax registration: an owner and accountant decision (UNVERIFIED). `operatorRegistration` and `operatorTaxId` in `legal.ts` stay empty; the Operator box shows them only when filled | `src/configurations/legal.ts`, accountant |
| **Terms lawyer review (a)-(f): not booked** (costs money, owner's call) | (a) whether the operator is a "trader" once ads earn money and what identity data must then be shown (Law 365/2002, e-Commerce Art 5); (b) whether notice plus continued use is enough for existing accounts, or whether some markets (Germany, BGH XI ZR 26/20) need active acceptance; (c) whether adding ads is a DCD Art 19 modification with negative impact, and whether the banner or PDF satisfies "durable medium" without email; (d) whether removing "fan project" and adding ads changes the NBA/IP risk enough to block launch (section D.1); (e) whether the section 13 ad-content limitation is fair under Directive 93/13 and Romanian Law 193/2000; (f) whether the site is a DSA "online platform" and whether the micro-enterprise exemption covers Arts 26 and 28. The Terms are written conservatively meanwhile | Section C (cost), section D |
| **Owner sign-off on the DPIA** | Required before ads go live (record section 4) | [DPIA-ADS.md](DPIA-ADS.md) |
| **Configure Google's CMP** (free): European regulations message for every EEA, UK and CH country, 3-button first layer, privacy link https://swishquest.com/privacy, operator name as on the policy; **RDP for all US states**; **the minimal certified ad partner list** (exact AdSense options UNVERIFIED); no anchor or vignette Auto ads formats | The policy's sections 5, 11 and 13 are true only with this configuration | AdSense → Privacy & messaging, Blocking controls |
| **Check the section 11 cookie table against the live stack** (consent test plan T2-T6 of the ads ticket: EEA first visit, "Do not consent", "Consent", cookie-table truth) and update the policy before launch | The table is Google's published list, not what was observed | `src/app/privacy/page.tsx` section 11 |
| **Switch the flags on** in the Vercel project (`NEXT_PUBLIC_ADS_ENABLED=true`, `NEXT_PUBLIC_ADSENSE_PUB_ID`), only on the launch day, and reword the policy's "not live yet" sentences in the same release | The policy must be true at all times | Vercel env, docs/DEPLOYMENT.md |
| **ui-check:** add "Privacy and cookie settings" to G-NAV-02 in `scripts/ui-check/CHECKS.md` and the guest pagemap when the flag goes on | The footer gains one item | `scripts/ui-check/` |
| **CSP must allow Google's ad domains** when the CSP is built (pagead2.googlesyndication.com, *.doubleclick.net, fundingchoicesmessages.google.com, *.google.com, *.gstatic.com, *.adtrafficquality.google; full list UNVERIFIED) | Otherwise the ads and the privacy message break | Section E (CSP row) |
| **Quarterly consent re-test** after launch | Google's CMP and cookies change | Consent test plan |

## B. Decisions that are yours

| Decision | Current setting | Trade-off |
|---|---|---|
| **Minimum age for accounts** | **13**, worldwide; guests of any age. Since 2026-10-11 sign-up is one self-declared tick-box (13+ and Terms/Privacy, email and Google); birth month/year is asked only when adding a profile photo. Accounts without a confirmed age of 16+ (unknown age or 13-15) are treated as "teen": no public photo (`PHOTO_MIN_AGE` 16). **Owner decision 2026-10-19:** the photo is the only age restriction; teen accounts are on the public leaderboard and in name search and show their name, photo and ID to strangers in online matches like every account (they were hidden from those until then; terms version 2026-10-19.1). **Owner decision 2026-10-11, removed from the app 2026-10-26 (pre-launch; terms version 2026-10-26.2):** no age check at all. The Terms keep "You must be 13 or older to create an account"; sign-up asks no age and has no tick-box (agreement is the text under the sign-up buttons; Google is one click); no photo age prompt, no birth date in Profile settings, `is_teen` always false. The legacy age columns stay in the database, unused (exported and cleared with the account) | 13 is the practical floor: below it US law (COPPA) needs verifiable parental consent, and several countries want it up to 16. Remaining exposure for 13-15: contract capacity under national law in 14-16 states, UK Children's Code defaults, Brazil ECA Digital, India (under 18). Mitigations in place: no chat, no photo, no birth date stored, deletion on request, parent contact route. Hiding teens from the public leaderboard, name search and random-match opponents was removed by the owner on 2026-10-19 (it had been the audit H2 fix); a "private profile" default and friend-search limits for teens are the next steps if a lawyer asks. Since 2026-10-26 none of these mitigations rests on an age: the only constant left is `minimumAge` in `legal.ts` (shown in the Terms, not checked). |
| **Account deletion confirmation** | **Owner decision 2026-10-19:** Profile → Delete account asks the player to type their username and the word "delete"; no password (Google-only accounts confirm the same way) | Typing the username + "delete" prevents accidents only: anyone holding a live session (an unlocked device, a leaked token) can delete the account. A re-authentication step (password, or a fresh Google sign-in) would close that; not built. |
| **Public profile defaults** | Display name, ID, rank, points and photo are public; photo is optional and removable | Privacy-by-default arguments favour a "private profile" switch, especially for 16-17 year-olds under the UK Children's Code. Not built. |
| **Report notes sent to Claude** | The question doctor sends players' optional report notes (no user, no time) to Anthropic's Claude through the Max-plan token, which may not carry a data processing agreement. **Owner accepted this risk on 2026-10-18**; revisit before a public launch | Keep (current), stop sending notes (free; the doctor still sees the question, wrong-answer counts and report count), or pay for a plan with a DPA. Record of processing row "Anthropic". |
| **Ads configuration (answered 2026-10-27)** | Q1 personalisation: non-personalised ads for everyone (NPA-all), every country, guests and accounts. Q2 US: Option A, restricted data processing for all US states, no "Do Not Sell or Share" link. Q3 UK and Q4 guests: covered by NPA-all. Q5 ad partners: Google plus the minimal certified list. Q6 launch day: not set; everything behind `NEXT_PUBLIC_ADS_ENABLED`, off. Q7 footer label: "Privacy and cookie settings" | NPA-all and RDP cost ad revenue (vendor claims of 40-60% are unverified); the owner trades this for the lowest legal risk with no age data and a young audience. Section A2 |
| **Inactive-account deletion** | None; accounts stay until deleted | Regulators (CNIL) expect a limit, normally with warning email. The site sends no email at all today, so it cannot warn. Building email (also needed for password reset, email verification) unlocks this. |

## C. Costs (stop and ask)

| Item | Cost | Note |
|---|---|---|
| Production game-server host | From about $5/month (Railway Hobby) or a free tier that sleeps | Needs an EU region and a DPA; add it to the Privacy Policy table when chosen. |
| US DMCA designated agent | $6, renew every 3 years | Only matters for the safe harbour on user-uploaded photos for US users. Cheap insurance. |
| Trademark clearance for "Swish Quest" | Lawyer or search-service fees | No register could be queried in research; a pending "24 8 HOOPS" mark exists. |
| A lawyer's review of the pages and these items | One-off | See D. Strongly recommended before launch at scale. |
| A lawyer's review of the ads text and DPIA-ADS.md (L1-L7) | One-off | Not booked; owner decides. Google's CMP is free; a paid CMP is only needed if Google's is dropped. |

## D. Needs a lawyer's judgement

1. **NBA assets (largest exposure).** Player photos no longer come from `cdn.nba.com` (branch `feat/photos-commons-only`, 2026-10-26: every photo is a freely licensed Wikimedia Commons file credited on `/credits`, else a silhouette); no team logo is shown since 2026-10-27 (team-colour badges and names); the Name the NBA Club puzzle still uses scrambled derivatives of the 30 current logos (`public/logos/scrambled`, owner decision to keep); player data comes from the unofficial `nba_api`. NBA's Terms restrict stats to non-commercial/news use and bar reproducing or linking images and logos without permission. Names alone are low risk (nominative use); logos and headshots are the real risk (trademark, copyright, right of publicity). Options: licensed or Wikimedia/public-domain images, silhouettes, text-only. The NBA disclaimer is in the Terms (section 9).
2. Trademark clearance of the product name and logo (above).
3. Whether leaderboards/public photos make the service a DSA "online platform" (micro/small-enterprise exemption likely applies) and a UK Online Safety Act user-to-user service (illegal-content risk assessment, reporting, terms). Write the Ofcom risk assessment (short) if UK users are expected.
4. Legal basis for public profile data (contract vs legitimate interests), and the legitimate-interests assessment in `RECORD_OF_PROCESSING.md`.
5. Whether the strike/ban system is an Art 22 automated decision (a human review route exists).
6. DPO and DPIA thresholds at scale; UK representative (UK GDPR Art 27); lead supervisory authority.
7. Retention period for ban records (currently capped at 5 years) and for moderation events (12 months).
8. EU-US transfers if the Data Privacy Framework is invalidated (appeal Latombe, C-703/25 P pending as of the research).
9. Per-country extras: Turkey VERBIS, India under-18 consent (from about May 2027), Brazil ECA Digital age assurance, China, Russia and sanctioned countries (blocking).
10. Whether the commitments in the Terms (14-day appeal answer, 14 days' notice of material changes) are ones you can keep.
11. Terms and ads (list (a)-(f) in section A2): trader status once ads earn money; whether notice plus continued use is enough for existing accounts (BGH XI ZR 26/20, UNVERIFIED); whether adding ads is a DCD Art 19 modification and what counts as a durable medium without email; whether the section 13 ad-content limitation is fair (Directive 93/13, Law 193/2000); gambling ads to a 13+ audience.

## E. Engineering follow-ups

| Item | Risk it addresses |
|---|---|
| Existing accounts (created before the consent step) have no consent record and no age check; also needed for the 14-day change notice. Show the Terms and an age prompt on next sign-in and store acceptance | Pre-existing users are not covered by a recorded agreement |
| Notice mechanism for changes to Terms/Privacy: the home-page banner (`src/components/LegalChangeNotice.tsx`) was removed on 2026-10-20 because the app has not launched and there are no players to notify; after launch, restore it from git history for each significant change and promote it at least 14 days before the change applies (RUNBOOKS F) | Terms section 12 |
| In-product "Report" button for players, names, photos | DSA notice-and-action is email-only today |
| Email sending (verification, password reset, notices) | No password reset, no email change, no email verification today; also enables inactive-account warnings |
| "Log out everywhere" and change-password | Account security basics |
| Content-Security-Policy, and moving tokens to HttpOnly cookies | localStorage tokens are readable by any XSS; needs a tested allow-list (Google sign-in, Wikimedia Commons, and Google's ad domains once ads are on: section A2) |
| Admin: audit log of reads of feedback and raw game data, 2FA or IP allow-list, drop raw `user_id` from source-row views | Art 32 access accountability |
| Deploy and pin the photo-check service (`moderation_service`, set `IMAGE_MODERATION_URL`), then switch photo upload on and update the policy | Photo upload returns 503 in production today |
| Block Russia and sanctioned regions at the edge (Vercel firewall) | Terms/Privacy say the service is not available there but nothing enforces it |
| Remove `.sqlite3` data and `backend/media/profiles/*` personal-looking files, and `local deployment/ADMIN_CREDENTIALS.md`, from the OneDrive-synced tree | Personal data and a credential in a cloud-synced folder |
| ~~`StartingFive.tsx` sent revealed player names to `i.pravatar.cc` for placeholder faces~~ | Resolved 2026-10-16: it was rendered on every card flip; replaced by real photos via `PlayerPhoto` (cdn.nba.com, else Wikimedia Commons with credits at `/credits`, else a silhouette) |
| Accept and file the Vercel and Supabase DPAs (dated copies) | Art 28 evidence |
| Self-service "don't count my time on the site" switch (row 6c in RECORD_OF_PROCESSING.md); today an objection is handled by email and the operator deletes the `DailyActivity` rows | Art 21 objection to legitimate-interests processing |
| Serve player photos from our own domain (copies in `public/`, credited as now, or a proxy) instead of the visitor's browser fetching `upload.wikimedia.org` | Every visitor's IP goes to a US third party without consent; disclosed and objectable (Privacy section 5, legitimate interests), but LG München I 3 O 17493/20 awarded damages for the same pattern with Google Fonts. Copies in the repo cost nothing; an image proxy (e.g. Vercel image optimisation) may cost money: ask first. **Owner decision 2026-10-26: not now; do it only if someone complains** |
| Throttle or require login for the public photo endpoint | Scraping; weighed and left public for now (the photos are already public on leaderboards) |

## F. Done in this change (for the record)

Consent at sign-up (email and Google; since 2026-10-26 the text under the sign-up buttons, no tick-box and no age check); self-service data export, photo removal and account deletion;
`erase_user` for banned or emailed requests; weekly pruning job; production secret-key guard; 1-year HSTS; generic
error messages; security headers; privacy policy and terms rewritten against the system; this record, runbooks and
research.

- 2026-10-29: Terms rewritten for ads under legal version 2026-10-28.1 (summary, sections 1, 4, 5, 9, 10, 12, 13, 16); no banner, no re-consent, no backend change; the "fan project" wording is gone; the blocked-categories sentence is withheld until the categories are blocked in AdSense (section A2).
