# Research notes behind the design

Compiled 2026-10-07 from sourced briefings. **This is research for a developer to take to counsel, not legal advice.**
Confidence is marked H/M/L. Items I could not verify against a primary source are flagged; several sources are law-firm
and vendor blogs rather than regulator pages, so re-check any citation before relying on it.

## GDPR and ePrivacy

- **Notice content (Art 13)**: controller identity and contact; purposes and lawful basis per purpose; the legitimate
  interests relied on; recipients; transfers and safeguard; retention or criteria; rights including complaint; whether
  data is required; automated decisions. Layered, plain-language notices (WP29/EDPB WP260 rev.01). H.
  <https://www.edpb.europa.eu/system/files/2023-09/wp260rev01_en.pdf>
- **Lawful bases**: contract for account, game history, friends, matchmaking; legitimate interests (with a written
  assessment) for moderation, anti-abuse, security logs; consent only for non-essential trackers or marketing, none used.
  Public leaderboard/photo basis is a judgement call. M.
- **localStorage and ePrivacy Art 5(3)**: EDPB Guidelines 2/2023 confirm it covers localStorage; a token used only to keep
  a user signed in is strictly necessary and exempt from consent, but should be disclosed. No banner needed with only
  strictly-necessary storage. H. <https://edpb.europa.eu/system/files/2024-10/edpb_guidelines_202302_technical_scope_art_53_eprivacydirective_v2_en_0.pdf>
- **Third-party requests leak the IP**: LG München I, 3 O 17493/20 (20 Jan 2022) awarded damages for Google Fonts loaded
  without consent. This site self-hosts fonts. NBA and Wikimedia images are still fetched directly by the browser. H.
  <https://www.activemind.legal/guides/ruling-google-fonts/>
- **Rights**: one month to respond (+2 for complexity); erasure with Art 17(3) exceptions; portability in a
  machine-readable format. A minimal ban record to prevent re-registration rests on legitimate interests / Art 17(3)(e) and
  must be disclosed with a retention period. M-H.
- **Inactive accounts**: CNIL guidance (Sept 2025) recommends limiting retention with prior notice, typically around two
  years. Not implemented (no email channel). M. <https://cnil.fr/fr/achat-de-contenus-numeriques-quelle-duree-de-conservation-des-comptes-inactifs>
- **Transfers**: EU-US Data Privacy Framework upheld by the General Court (T-553/23, 3 Sept 2025); appeal C-703/25 P
  pending, so it stays valid but is not risk-free. Vercel and Supabase DPAs incorporate SCCs and the UK addendum and bind on
  acceptance of their terms. M. <https://vercel.com/legal/dpa> <https://supabase.com/legal/dpa>
- **Records, DPIA, DPO, representative**: Art 30(5)'s SME exemption does not cover regular processing, so a record is
  kept. DPIA/DPO are not mandatory today but arguable at scale with minors and photos. An EU-established controller needs no
  Art 27 representative. M.
- **Breach**: authority within 72 hours; processors notify (Supabase 48 h where feasible, Vercel without undue delay). H.

## Children and age

- GDPR Art 8 sets the consent age at 13-16 by member state, but applies only where the basis is consent; contract with a
  minor depends on national contract law. The EU table could not be confirmed from a primary source. M.
- COPPA (US, under 13): applies to child-directed sites or actual knowledge; a mixed-audience site needs a neutral age
  screen (no hint of the cut-off) and must not collect once it learns a user is under 13. 2025 amendments in force
  23 June 2025, compliance by 22 April 2026. M.
- UK Children's Code and Online Safety Act apply to services likely to be used by under-18s and user-to-user services; a
  16+ gate does not remove them (16-17 are children). M.
- Brazil ECA Digital (in force 17 March 2026), India DPDP (verifiable parental consent under 18, duties from about
  May 2027), Australia (under-16 social media rules; trivia likely out of scope). L-M.
- **Chosen policy**: accounts 16+ worldwide with a neutral month/year check (birth date not stored), guest play for all,
  deletion on discovering an under-age account. Lowering it is a legal decision.

## Platform rules (DSA, UK OSA)

- DSA: a service hosting user names/photos is a hosting service; whether leaderboards make it an "online platform" is
  arguable, and micro/small enterprises are exempt from the platform section (Art 19). Applicable either way: points of
  contact (Arts 11-12), terms describing moderation (Art 14), notice-and-action (Art 16), statement of reasons for
  restrictions (Art 17). Implemented as: email contact, Terms sections 5-8, statement of reasons in the runbook. M.
- UK OSA: a short illegal-content risk assessment, a way to report and complain, and terms covering illegal content. M-L.

## Terms of service

- Clickwrap (checkbox plus links) is routinely enforced; browsewrap often is not (Specht v. Netscape; Nguyen v. Barnes &
  Noble). Sign-up now has an explicit tick and the accepted version and time are stored. H.
- EU consumer law: no unilateral changes without reason and notice, no exclusive foreign jurisdiction, no mandatory
  arbitration or class waiver, no blanket liability exclusion (Unfair Contract Terms Directive 93/13 Annex; UK CRA 2015).
  Rome I Art 6 keeps the consumer's mandatory protections whatever the governing-law clause says. H.
- The Digital Content Directive 2019/770 may treat a free service paid with personal data as a consumer contract; data used
  only to supply the service falls outside it. Adding ads or analytics could bring it in. M.
- Mandatory identification of the provider (e-Commerce Directive Art 5; Romania Law 365/2002; Germany Impressum, France
  mentions légales). H.

## IP, NBA, trademarks

- NBA Terms of Use: statistics only for legitimate news reporting or private non-commercial use; no reproducing or linking
  images and logos without permission. <https://www.nba.com/termsofuse> H on the text, M on enforceability against a visitor.
- Nominative fair use covers names; logos and headshots carry trademark, copyright and publicity-rights risk. Enforcement
  examples found target commercial fan merchandise, not non-commercial trivia. M.
- DMCA s512 safe harbour needs a registered designated agent ($6, renew every 3 years). H.
- No trademark register could be queried; clearance of "Swish Quest" and "HOOPS24" is unverified.

## Google sign-in

- openid/email/profile are non-sensitive: no verification review, no user cap or 7-day token expiry once the app is
  "In production". Brand verification applies if the consent screen shows an app name/logo: homepage and privacy policy on a
  verified domain, privacy policy disclosing Google user data use. The API Services User Data Policy (Limited Use) applies.
  H. <https://developers.google.com/identity/protocols/oauth2/production-readiness/brand-verification>
  <https://developers.google.com/terms/api-services-user-data-policy>

## Other jurisdictions (summary)

CCPA/CPRA and most US state laws: thresholds (about 100k consumers) probably not met yet; the policy is written to the
notice-at-collection standard and says "we do not sell or share". Brazil LGPD and Canada/Quebec apply with a contact
channel; India from 2027; Korea's local-agent duty starts at about 1 million Korean users; Turkey (VERBIS), China and Russia
need lawyer input, with Russia the clearest case for blocking (data-localisation law). Table in the original briefing; L-M
confidence on everything outside the EU, UK and US.
