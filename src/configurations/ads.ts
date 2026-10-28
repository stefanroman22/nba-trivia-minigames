/** Ads switch (owner decision Q6, 2026-10-27): everything ad-related is built behind one flag that is OFF by
 *  default and OFF in production until the owner sets a launch date. Read through `process.env.NEXT_PUBLIC_*`
 *  directly so Next inlines the values at build time: the footer HTML and the <head> are final on the server.
 *  - `NEXT_PUBLIC_ADS_ENABLED`: only the exact string "true" switches ads on; unset or anything else is off.
 *  - `NEXT_PUBLIC_ADSENSE_PUB_ID`: the AdSense publisher id ("ca-pub-..."); unset = no ads.txt, no account meta. */
export const ADS_ENABLED = process.env.NEXT_PUBLIC_ADS_ENABLED === "true";
export const ADSENSE_PUB_ID = process.env.NEXT_PUBLIC_ADSENSE_PUB_ID ?? "";

/** The globals Google's ad tag and its privacy message (CMP) read. Pushing onto them before the scripts
 *  load is Google's documented pattern; the scripts take the queued values over when they arrive. */
declare global {
  interface Window {
    adsbygoogle?: unknown[] & { requestNonPersonalizedAds?: 0 | 1 };
    googlefc?: { callbackQueue?: Array<() => void>; showRevocationMessage?: () => void };
  }
}
