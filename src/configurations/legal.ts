/** Facts the Privacy Policy and Terms state about the operator. Edit them here, nowhere else.
 *
 *  `operatorName`, `operatorAddress` and `country` are REQUIRED by law before launch at scale (EU
 *  e-Commerce Directive Art 5, DSA Arts 11-12, GDPR Art 13(1)(a)) and are left empty on purpose: the
 *  pages show them once they are filled in, and `npm run check:legal` warns until they are. */
export const LEGAL = {
  service: "Swish Quest",
  formerName: "HOOPS24",
  /** Where privacy requests, takedown notices, ban appeals and everything else legal goes. */
  contactEmail: "stefanromanpers@gmail.com",
  /** Full legal name of the person or company running the service. */
  operatorName: "",
  /** Postal address where the operator can be reached. */
  operatorAddress: "",
  /** Country whose law governs the Terms, e.g. "Romania". */
  country: "",
  /** Must equal TERMS_VERSION in backend/users/consent.py (checked by `npm run check:legal`). */
  version: "2026-10-07",
  updated: "7 October 2026",
  minimumAge: 16,
} as const;
