# Open items

Nothing in this repository makes the service "impossible to sue" or "impossible to take down". What it does is bring the
product to a documented, standards-based baseline. These are the things that still need a decision, money, or a
lawyer. Ordered by how much they matter for launch at scale.

## A. Must be filled in before promoting to production (blocking)

| Item | Why | Where |
|---|---|---|
| **Operator identity**: full legal name, postal address, country (person or company) | EU e-Commerce Directive Art 5, DSA Arts 11-12, GDPR Art 13(1)(a). Anonymous operators get demand letters and complaints. A company (even a one-person one) keeps a personal home address off a public page. | `src/configurations/legal.ts` (`npm run check:legal` warns until set) |
| **A real privacy/legal mailbox** (for example privacy@your-domain) instead of a personal Gmail | Public, permanent, abusable. Cloudflare Email Routing is free once the domain is on Cloudflare. | `contactEmail` in `legal.ts` |
| **Google consent screen**: Publishing status "In production"; branding with a homepage and privacy URL **on a domain verified in Google Search Console**; authorized JavaScript origins | Without it only test users can sign in; Google can disable a client whose homepage/privacy policy are not on a verified domain. | Google Cloud Console → Google Auth Platform |
| **Governing-law country** | Terms section 14 | `country` in `legal.ts` |

## B. Decisions that are yours

| Decision | Current setting | Trade-off |
|---|---|---|
| **Minimum age for accounts** | 16, worldwide, guests of any age | 16 avoids parental-consent mechanics (GDPR Art 8 ranges 13-16 by country; COPPA below 13; Brazil/India stricter) at the cost of 13-15 year-old fans. Lowering to 13 keeps most of the world workable but brings Art 8 and children's-code duties for under-16s in several countries. Change `MIN_AGE` in `backend/users/consent.py`, the pages, and re-bump the version. |
| **Public profile defaults** | Display name, ID, rank, points and photo are public; photo is optional and removable | Privacy-by-default arguments favour a "private profile" switch, especially for 16-17 year-olds under the UK Children's Code. Not built. |
| **Inactive-account deletion** | None; accounts stay until deleted | Regulators (CNIL) expect a limit, normally with warning email. The site sends no email at all today, so it cannot warn. Building email (also needed for password reset, email verification) unlocks this. |

## C. Costs (stop and ask)

| Item | Cost | Note |
|---|---|---|
| Production game-server host | From about $5/month (Railway Hobby) or a free tier that sleeps | Needs an EU region and a DPA; add it to the Privacy Policy table when chosen. |
| US DMCA designated agent | $6, renew every 3 years | Only matters for the safe harbour on user-uploaded photos for US users. Cheap insurance. |
| Trademark clearance for "Swish Quest" (and the old HOOPS24) | Lawyer or search-service fees | No register could be queried in research; a pending "24 8 HOOPS" mark exists. |
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
| Existing accounts have no consent record. Show the Terms/Privacy on next sign-in and store acceptance (`terms_version`) | Pre-existing users are not covered by a recorded agreement |
| Notice mechanism for changes to Terms/Privacy (site banner, ideally email) | Terms section 12 promises notice |
| In-product "Report" button for players, names, photos | DSA notice-and-action is email-only today |
| Email sending (verification, password reset, notices) | No password reset, no email change, no email verification today; also enables inactive-account warnings |
| "Log out everywhere" and change-password | Account security basics |
| Content-Security-Policy, and moving tokens to HttpOnly cookies | localStorage tokens are readable by any XSS; needs a tested allow-list (Google sign-in, NBA CDN) |
| Admin: audit log of reads of feedback and raw game data, 2FA or IP allow-list, drop raw `user_id` from source-row views | Art 32 access accountability |
| Supabase region: confirm it is in the EU, then state it in the Privacy Policy | Transfers |
| Block Russia and sanctioned regions at the edge (Vercel firewall) | Terms/Privacy say the service is not available there but nothing enforces it |
| Remove `.sqlite3` data and `backend/media/profiles/*` personal-looking files, and `local deployment/ADMIN_CREDENTIALS.md`, from the OneDrive-synced tree | Personal data and a credential in a cloud-synced folder |
| `StartingFive.tsx` has an unused `RevealedFace` component and a placeholder avatar URL (`i.pravatar.cc`) that would leak a player name if ever rendered | Dead today; delete it rather than ever wiring it in |
| Accept and file the Vercel and Supabase DPAs (dated copies) | Art 28 evidence |
| Throttle or require login for the public photo endpoint | Scraping; weighed and left public for now (the photos are already public on leaderboards) |

## F. Done in this change (for the record)

Consent and age check at sign-up (email and Google); self-service data export, photo removal and account deletion;
`erase_user` for banned or emailed requests; weekly pruning job; production secret-key guard; 1-year HSTS; generic
error messages; security headers; privacy policy and terms rewritten against the system; this record, runbooks and
research.
