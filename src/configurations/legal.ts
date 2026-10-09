/** Facts the Privacy Policy and Terms state about the operator. Edit them here, nowhere else.
 *
 *  `operatorName`, `operatorAddress` and `country` are REQUIRED by law (EU e-Commerce Directive Art 5,
 *  DSA Arts 11-12, GDPR Art 13(1)(a)); the pages show them, and `npm run check:legal` warns if any is
 *  emptied. */
export const LEGAL = {
  service: "Swish Quest",
  formerName: "HOOPS24",
  /** Where privacy requests, takedown notices, ban appeals and everything else legal goes. */
  contactEmail: "stefanromanpers@gmail.com",
  /** Full legal name of the person or company running the service. */
  operatorName: "Roman Ioan-Stefan",
  /** Postal address where the operator can be reached. */
  operatorAddress: "Orizontului 7, 407035 Apahida, Cluj County, Romania",
  /** Country whose law governs the Terms, e.g. "Romania". */
  country: "Romania",
  /** Must equal TERMS_VERSION in backend/users/consent.py (checked by `npm run check:legal`). */
  version: "2026-10-08.2",
  updated: "9 October 2026",
  /** The same date as ISO, for the sitemap. */
  updatedIso: "2026-10-09",
  minimumAge: 13,
  /** Accounts younger than this cannot upload a public profile photo. Equals PHOTO_MIN_AGE in backend/users/consent.py. */
  photoMinimumAge: 16,
} as const;
