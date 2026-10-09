# SEO: owner to-do (after the swishquest.com move, 2026-10-09)

Everything in code and the cutover is done and live. These need your Google/Microsoft sign-in or are follow-ups.

## Tomorrow

- [ ] **Request indexing for who-would-win.** Search Console -> property `swishquest.com` -> URL inspection ->
      paste `https://swishquest.com/who-would-win` -> REQUEST INDEXING. (It hit the ~10/day limit on 2026-10-09.
      Home + 10 game pages were already requested.) Optional: `/privacy` and `/terms` the same way; the sitemap
      covers them anyway.
- [ ] **Bing Webmaster Tools.** bing.com/webmasters -> sign in -> "Import from Google Search Console" -> pick
      swishquest.com. Brings the site and sitemap to Bing (also feeds DuckDuckGo and ChatGPT search).
- [ ] **Check the sitemap was read.** Search Console -> Sitemaps: status should change from "Couldn't fetch" to
      "Success" with 14 discovered pages. If it still says "Couldn't fetch" after 2-3 days, remove and resubmit
      `https://swishquest.com/sitemap.xml`.
- [ ] **Rich Results Test.** search.google.com/test/rich-results -> test `https://swishquest.com/` and
      `https://swishquest.com/wordle`; expect no errors (the JSON-LD parses; this is Google's own confirmation).
- [ ] **Share previews.** Paste `https://swishquest.com/` and a game link into Slack / X / LinkedIn / WhatsApp and
      check the card shows the Swish Quest image and title. LinkedIn caches: use linkedin.com/post-inspector to refresh.

## Over the next weeks (just look, nothing to do unless it is wrong)

- [ ] Search Console -> Settings -> Change of address on the old `nba-minigames.vercel.app` property still says
      "This site is currently moving" (started 2026-10-09). Do not cancel it.
- [ ] Search Console -> Pages (swishquest.com): pages move to "Indexed". On the old property they become
      "Page with redirect".
- [ ] Google results show the name "Swish Quest" and the new basketball favicon (days to weeks).
- [ ] Core Web Vitals report (once there is traffic): LCP < 2.5 s, INP < 200 ms, CLS < 0.1.

## Keep in place

- The old-address redirects in `vercel.json` (301 to swishquest.com): at least a year, ideally forever.
- The `google-site-verification` meta tag (`GOOGLE_SITE_VERIFICATION` in `src/configurations/site.ts`) and the
  Search Console TXT record in Vercel DNS: removing them un-verifies the properties.

## Optional, later

- Social profiles (X, Instagram, TikTok, YouTube) for Swish Quest: send me the URLs and I add them to the
  Organization `sameAs` in the home page JSON-LD.
- A real `@swishquest.com` mailbox for contact/privacy (then update `LEGAL.contactEmail`).
