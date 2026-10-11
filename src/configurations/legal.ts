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
  /** Must equal TERMS_VERSION in backend/users/consent.py (checked by `npm run check:legal`). */
  version: "2026-10-11.2",
  updated: "11 October 2026",
  /** The same date as ISO, for the sitemap. */
  updatedIso: "2026-10-11",
  /** The home-page notice of a significant change (components/LegalChangeNotice), shown for 14 days
   *  before the change applies to existing accounts (Terms section 12, Privacy section 15). Accounts
   *  created from `updated` on accept the new version at sign-up; older accounts from `effective`. */
  changeNotice: {
    effective: "25 October 2026",
    /** First day the notice is no longer shown (14 days after `updatedIso`). */
    showUntilIso: "2026-10-25",
    summary:
      "Sign-up is now one tick-box confirming you're 13 or older (Google sign-up too), and we ask your birth month and year only when you add a profile photo. Accounts without a confirmed age of 16 or over are treated as teen accounts: no photo, and not shown on the public leaderboard or in name search.",
  },
  minimumAge: 13,
  /** Accounts younger than this cannot upload a public profile photo. Equals PHOTO_MIN_AGE in backend/users/consent.py. */
  photoMinimumAge: 16,
} as const;
