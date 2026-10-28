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
  /* ⚠ PROMOTION STEP: on the day the production frontend is promoted, set updated/updatedIso/effective
   * (+ the version here AND in backend/users/consent.py) to that day; promote the backend + relay
   * no earlier than `effective`, or record an owner waiver. See docs/legal/OPEN_ITEMS.md and the promote-to-prod
   * runbook. The values below were written on dev on 2026-10-28. */
  /** Must equal TERMS_VERSION in backend/users/consent.py (checked by `npm run check:legal`). */
  version: "2026-10-28.2",
  updated: "28 October 2026",
  /** The same date as ISO, for the sitemap. */
  updatedIso: "2026-10-28",
  /** When a significant change applies to existing accounts (Terms section 12, Privacy section 15).
   *  Accounts created from `updated` on accept the new version at sign-up; older accounts from `effective`.
   *  No home-page notice: removed before launch (no players to notify); see docs/legal/RUNBOOKS.md F. */
  changeNotice: {
    effective: "3 November 2026",
  },
  /** The age the Terms require for an account. The app does not check it (owner decision 2026-10-11). */
  minimumAge: 13,
} as const;
