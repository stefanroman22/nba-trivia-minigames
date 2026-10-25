# owner-actions.md template

`docs/seo/owner-actions.md` is rewritten whole by every run from its `owner` findings (spec §6, §8). The owner reads
only this file, on GitHub or locally. Fill the `<…>`; keep the headings, their order and the wording around them.

## Rules
- `OA-<runId>-<n>`: the `owner` findings in `findings.json` order, `n` from 1. Same id in `REPORT.md`.
- `## Do now`: every `owner` finding except "Set up Search Console access", one checkbox each. None → the line `- none`.
- `## Setup (once)`: only while the findings hold "Set up Search Console access" (no Google credentials); otherwise
  leave the whole section out.
- The reason is the Search Console verdict and status as the slice printed them, never a Search Analytics value.
- The URL in full, and the path in the bold label.

## Layout
~~~
# SEO owner actions

Run `<runId>` · <run date YYYY-MM-DD> · site <site>. Written by the SEO run (`docs/seo/README.md`); the next run rewrites it,
so tick boxes only as your own note: the system learns from the command under each action.

## Do now

- [ ] **OA-<runId>-<n> Request indexing: `<path>`.** Search Console → property `swishquest.com` → URL inspection →
      paste `<url>` → REQUEST INDEXING. Reason: <verdict> · <coverageState> · last crawl <date | never>.
      Then run: `node scripts/seo/ledger.mjs requested <url>`

## Setup (once)

**OA-<runId>-<n> Set up Search Console access.** The weekly run cannot read Search Console or write the Drive export
until this is done; the audit runs without it. Full text: `docs/seo/README.md` → Owner setup.

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
~~~

## Example `## Do now` with nothing to do
~~~
## Do now

- none
~~~
