# Search Console query data (OP-11)

What to do with `<runDir>/queries-summary.md`, the page × query view of the last 28 days (the guide's area 11). It
exists only on a run with `--areas indexing,onpage` and Search Console access; without it there is no OP-11 work and
the run's Coverage gaps say so.

## Privacy (binding)
- `queries-summary.md` is PRIVATE (its first line says so). Read it with the Read tool only; never `cat`, `grep` or
  echo it through Bash, never quote it in a command line.
- Query strings and Search Analytics numbers (impressions, clicks, CTR, position) may be written in exactly one place:
  the `current` and `howToFix` fields of a `decision: "card"` finding in `findings.json`. They reach Notion in the card
  body and nowhere else.
- Never in `REPORT.md`, `docs/seo/owner-actions.md`, your return text, a log line, a `wait`/`none` finding, `expected`,
  `files`, `acceptance` or a fingerprint. The flag names (`low-ctr`, `striking`, `mismatch`) and page paths are not
  values, but `REPORT.md` still carries only counts of them.
- `gsc-analytics-pq.json` (the raw rows) is never opened: `queries-summary.md` is its summary.

## The file
Per path: `## <path>`, `- primary query: …`, `- flags: low-ctr, striking, mismatch | none`, `- page: <impressions> ·
<clicks> · CTR · position`, then the top 5 queries by impressions with their numbers. The flags (thresholds in
`scripts/seo/CHECKS.md` OP-11):
- `low-ctr`: ≥ 100 impressions and CTR < 2 % (people see the result and skip it).
- `striking`: average position 8-20 with ≥ 50 impressions (page one's bottom or page two: close to traffic).
- `mismatch`: the top query by impressions shares no non-stopword with the page's primary query (Google ranks the page
  for something else).

## Flag → action
Decision rule 3. "The run's card" = the `decision: "card"` finding of that OP id in this run's `findings.json`; add
the page's URL to its `urls` if it is not there (sorted; recompute `fingerprint`). A finding of that id that is `wait`
(over the card budget) is not a card: the query data never goes into it.
| flag | goes to | what you add | guide (area 11) |
|---|---|---|---|
| `low-ctr` | the run's OP-02 card; also the OP-03 card when the run has one | `current`: `Search Console 28 days, <path>: <impressions> impressions, CTR <x> %, top query "<q>"`; `howToFix`: a rewritten title and description for the page that answers the top queries (copy rules apply) | "Many impressions, CTR under about 2%: rewrite the title and description" |
| `striking` | the run's OP-05 card; also the OP-06 card when the run has one | `current`: `… position <p> for "<q>"`; `howToFix`: content for the page (a section on what the query asks, from the game's real rules) and related-game links | "Average position 8 to 20: strengthen content and internal links" |
| `mismatch` | the run's OP-01 card | `current`: `… top query "<q>" vs primary "<primary>"`; `howToFix`: one of (a) retarget: the new `scripts/seo/keyword-map.json` entry, `"<path>": { "primary": "…", "related": ["…"] }`, when the query fits the game better than the current primary; (b) a section answering the query, when the game does what the query asks and the primary stays | "Ranking for an unexpected query: add a section that answers it, or give it its own page" |
| no such card in this run (no page fails that check, or it is over the budget) | nothing new | the page goes into the OP-11 `none` finding only (`current`: `<path>: <flags>; no on-page card to attach (re-check on the next 28-day window)`) | see the 28-day rule |

A flagged page never opens a card on its own: the on-page checks decide what is broken (rule 1), the query data
says where it hurts most and what to write.

## The 28-day rule
- The window is always the last 28 days (`days: 28`). Never judge a page on a shorter slice, never compare two runs'
  numbers (you never see the previous one).
- A change needs a full window of its own: a card's effect is re-checked 28 days after it is live. End every card that
  carries query data with: `Re-check: 28 days after this is live, the seo run reads this page's query data again; a flag
  before then is the old copy.`
- That is also why a flag alone never opens a card (the last row above): the page's copy may be younger than the
  window. The OP-11 `none` finding keeps it visible in `findings.json`; the owner reads the numbers in the Drive export.
- "Clicks falling after a change" (the guide's fourth row) needs two windows to compare: it is the owner's (Drive
  export), never a finding.

## OP-11 finding
One `none` finding per run when `queries-summary.md` has at least one flagged path: `check` `OP-11`, `severity`
`minor`, `urls` the flagged pages (absolute, sorted), `current` per page `<path>: <flags> → <OP ids of the cards it went to | no
on-page card to attach>` joined with `; ` (flags and paths only, no query, no number), `expected` `no low-ctr,
striking or mismatch flag on the page's Search Console data (28 days)`. No flagged path, or no `queries-summary.md`: no
OP-11 finding.
