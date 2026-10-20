/** Facts the Privacy Policy and Terms state about the operator. Edit them here, nowhere else.
 *
 *  `operatorName`, `operatorAddress` and `country` are REQUIRED by law (EU e-Commerce Directive Art 5,
 *  DSA Arts 11-12, GDPR Art 13(1)(a)); the pages show them, and `npm run check:legal` warns if any is
 *  emptied. */
export const LEGAL = {
  service: "Swish Quest",
  /** Where privacy requests, takedown notices, ban appeals and everything else legal goes. */
  contactEmail: "stefanromanpers@gmail.com",
  /** Full legal name of the person or company running the service. */
  operatorName: "Roman Ioan-Stefan",
  /** Postal address where the operator can be reached. */
  operatorAddress: "Orizontului 7, 407035 Apahida, Cluj County, Romania",
  /** Country whose law governs the Terms, e.g. "Romania". */
  country: "Romania",
  /* ⚠ PROMOTION STEP: on the day the production frontend is promoted, set updated/updatedIso/effective/
   * showUntilIso (+ the version here AND in backend/users/consent.py) to that day; promote the backend + relay
   * no earlier than `effective`, or record an owner waiver. See docs/legal/OPEN_ITEMS.md and the promote-to-prod
   * runbook. The values below were set on the promotion day, 2026-10-20. */
  /** Must equal TERMS_VERSION in backend/users/consent.py (checked by `npm run check:legal`). */
  version: "2026-10-20.1",
  updated: "20 October 2026",
  /** The same date as ISO, for the sitemap. */
  updatedIso: "2026-10-20",
  /** The home-page notice of a significant change (components/LegalChangeNotice), shown for 14 days
   *  before the change applies to existing accounts (Terms section 12, Privacy section 15). Accounts
   *  created from `updated` on accept the new version at sign-up; older accounts from `effective`. */
  changeNotice: {
    effective: "3 November 2026",
    /** First day the notice is no longer shown (14 days after `updatedIso`). */
    showUntilIso: "2026-11-03",
    summary:
      "Sign-up is now one tick-box confirming you're 13 or older (Google sign-up too), and we ask your birth month and year only when you add a profile photo. Every account is on the public leaderboard and in name search, and online opponents see your name, whatever your age: the only thing an account without a confirmed age of 16 or over can't do is add a profile photo. We now delete the answers you submit after 30 days, and for signed-in players we remember which questions you have already been shown so you don't get repeats.",
  },
  minimumAge: 13,
  /** Accounts younger than this cannot upload a public profile photo. Equals PHOTO_MIN_AGE in backend/users/consent.py. */
  photoMinimumAge: 16,
} as const;
