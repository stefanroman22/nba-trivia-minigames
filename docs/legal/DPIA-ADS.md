Status: draft - pending owner review

# DPIA: Google AdSense ads (GDPR Art 35)

Drafted 2026-10-28 from the ads-compliance research ticket (2026-10-26) and the owner's answers of 2026-10-27. Ads are
**not live**: everything is behind `NEXT_PUBLIC_ADS_ENABLED` (unset = off, off in production) and
`NEXT_PUBLIC_ADSENSE_PUB_ID` (unset). Nothing in this document is in operation yet; every measure below marked "to
configure before launch" is a launch gate (OPEN_ITEMS.md section A2). Why a DPIA is required: RECORD_OF_PROCESSING.md
section 4. Not legal advice; the lawyer points L1-L7 are open and not booked.

## 1. Description of the processing

- **What:** Google AdSense ads, with Google's free privacy message (CMP, Privacy & messaging) shipped inside the AdSense tag. Record rows 14-17.
- **Data flows:** the visitor's browser → Google (IP address, browser and device details, page address; advertising cookies only after consent in the EEA, UK and CH); with consent, → the ad technology providers on the minimal certified list. Nothing from the account (email, display name, player ID, scores) is ever passed to Google's advertising systems.
- **Regions:** worldwide; the CMP message applies in the EEA, the UK and Switzerland; US states get restricted data processing.
- **Configuration chosen (owner answers, 2026-10-27):**
  - Q1: non-personalised ads (NPA) for everyone, every country, guests and accounts. The code sets `requestNonPersonalizedAds = 1` before the AdSense tag loads (`src/components/AdsLoader.tsx`). No per-account rule and no age-based treatment: the app holds no age data.
  - Q2: Option A, restricted data processing (RDP) for all US states; no "Do Not Sell or Share" link.
  - Q3 (UK) and Q4 (guests): covered by NPA-all.
  - Q5: Google plus the minimal certified ad partner list.
  - Q6: launch day not set; flag off by default and off in production.
  - Q7: the footer control is labelled "Privacy and cookie settings".
- **What the operator receives:** aggregate AdSense reports only (earnings, numbers of ads shown), not personal data (row 17).

## 2. Necessity and proportionality

- **Need:** ads are the service's only planned revenue; the service is free.
- **Alternatives considered:** no ads; contextual-only ads; NPA for everyone (chosen); a sponsor.
- **Data minimisation:** no account data to Google; NPA for everyone; minimal ad partner list; no Auto ads formats that cover content.
- **Retention:** the operator keeps nothing; Google's cookie lifetimes are listed in Privacy section 11 (13 months for the choice cookie).
- **Information:** Privacy Policy sections 2, 5, 11 and 13 (written as "not live yet" until launch) and the CMP message.
- **Rights:** Privacy and cookie settings (reopens the CMP message), Google's Ads Settings, Global Privacy Control; RUNBOOKS.md G.

## 3. Risks (likelihood x severity)

To be scored by the owner at review; listed from the research ticket.

| Risk | Note under the chosen configuration |
|---|---|
| Profiling of minors (guests of any age, young account holders) | Reduced by NPA-all: no ad personalisation is requested for anyone |
| Ad cookies before consent (wrong CMP order) | Consent test plan T2-T4 before launch |
| IVT (fraud-prevention) cookies or storage without consent under limited ads | ePrivacy / Law 506/2004 question, not fixable by an LIA; lawyer L1 |
| Inappropriate ads to minors (gambling, dating, weight loss) | Category blocking, to configure before launch |
| Transfers to the US (Data Privacy Framework invalidation, C-703/25 P) | Google's terms fall back to SCCs; Privacy section 6 |
| Loss of control over ad technology providers | Minimal certified list (Q5) |
| The US "sale/share" threshold (CCPA 50%-revenue test) | RDP for all US states (Option A); lawyer L6 |
| Layout and dark-pattern risk (consent fatigue, reject option hidden) | 3-button first layer in every country, to configure before launch |

## 4. Measures

All to configure before launch unless marked as built (built = in the code, inactive while the flag is off).

- Built: the AdSense tag loads only when `NEXT_PUBLIC_ADS_ENABLED` is "true" and a publisher id is set, at most once per page load, with `requestNonPersonalizedAds = 1` set first.
- Built: the footer "Privacy and cookie settings" button (rendered only with the flag on) reopens Google's revocation message.
- Built: `/ads.txt` and the `google-adsense-account` meta tag exist only once `NEXT_PUBLIC_ADSENSE_PUB_ID` is set.
- To configure before launch: Google's CMP (certified, TCF) with the 3-button first layer in every EEA, UK and CH country; ad requests only after the CMP signal (consent test plan T2).
- To configure before launch: RDP for all US states.
- To configure before launch: the minimal ad partner list (exact AdSense options UNVERIFIED).
- To configure before launch: category blocking (OPEN_ITEMS.md A2 list; record the final list and date here).
- To configure before launch: no anchor or vignette Auto ads formats.
- To configure before launch: ads.txt status "Authorized" on the AdSense Sites page.
- Before launch and quarterly after: the consent test plan (T2-T9 of the ads ticket), and the Privacy section 11 cookie table checked against what the live stack sets.
- Kept: this DPIA and the record rows 14-17.

## 5. Residual risk and sign-off

- **Residual risk:** to be assessed by the owner. Prior consultation with ANSPDCP (Art 36) only if high residual risk remains; not expected with these measures.
- **Open lawyer points:** L1-L7 (OPEN_ITEMS.md A2), not booked.
- **Owner sign-off:** name: ________ date: ________ (required before ads go live).
- **Review:** 12 months after sign-off, or on any change of ad configuration (personalisation, new ad partners, Auto ads formats).
