# SEO owner actions

Run `20261025-1503-seo` · 2026-10-25 · site https://swishquest.com. Written by the SEO run (`docs/seo/README.md`); the
next run rewrites it, so tick boxes only as your own note: the system learns from the command under each action.

## Do now

- none

## Setup (once)

**OA-20261025-1503-seo-1 Set up Search Console access.** The weekly run cannot read Search Console or write the Drive
export until this is done; the audit runs without it. Full text: `docs/seo/README.md` → Owner setup.

1. [ ] Google Cloud: a project; enable **Search Console API** and **Google Drive API**; an OAuth client of type
       **Desktop app**; the consent screen **published to Production** (a Testing app's refresh token dies after 7
       days) with you as the only user.
2. [ ] `node scripts/seo/auth.mjs` on your PC; sign in as the Search Console owner account.
3. [ ] `gh secret set` the three Google secrets with the commands it printed. Keep `NOTION_TOKEN`, `SLACK_BOT_TOKEN`
       and `CLAUDE_CODE_OAUTH_TOKEN` as they are.
4. [ ] Drive: create the folder `SEO/Indexing/exports` and put its id in `scripts/seo/config.json` `driveFolderId`.
5. [ ] Later, optional: a Bing Webmaster Tools API key (`BING_WEBMASTER_KEY`). Bing itself: bing.com/webmasters →
       sign in → "Import from Google Search Console" → pick swishquest.com.

Then: nothing to report; the next run finds the credentials and this section goes away.
