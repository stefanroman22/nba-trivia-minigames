# Card template (spec §8)

You never write the card: `scripts/seo/notion-push.mjs` renders it from a `decision: "card"` finding
(`scripts/seo/lib/card-body.mjs`) after you return. This is what your finding's fields become, so fill them for it.

## Properties
| property | value | from |
|---|---|---|
| Title | `[seo] <IX-nn> <what> on <n> page(s)` (`[seo] Regression: …` when it came back after a Done card) | `check`, the `CHECKS.md` "what", `urls` |
| Source | `seo-check fp:<12-hex> run:<runId>` | the hash of `fingerprint` (the dedupe key: same check and URLs = same card) |
| Target | `dev`, always | |
| Priority | P0: IX-01/02/03/04 on a sitemap URL, or `regression: true`; P1: IX-05…IX-11; P2: IX-12 | `check`, `urls`, `regression` |
| Category | `frontend` (`CI/CD` only when every `files` entry is under `.github/`) | `files` |
| Difficulty | `standard` | |
| Attachment | none, ever (QA treats an attached `findings.json` as a check card) | |

## Body
~~~
SEO check run <runId> (site <site>) found <IX-nn> <what> failing on <n> page(s). Finding <id>, severity <severity>. Target: dev.
## Current
<current>                                    ← the digest's evidence lines, joined with "; "
- <url>                                      ← one per url
## Expected
<expected>                                   ← the CHECKS.md pass rule
## Files
- <file>                                     ← CHECKS.md files + nextjs-patterns.md, with a note: "src/app/layout.tsx (no canonical here)"
## How to fix
<howToFix>                                   ← the playbook step's How, concrete: which file, which key, what value
## Acceptance
- node scripts/seo/audit.mjs --only <IX-nn> --site <site> passes (before shipping, run it with --site set to a dev preview or localhost)
- QA assertion #1: on <route>, <selector> → <expect>
- Fingerprint (Source key): <12-hex> = <fingerprint>
## QA assertions
```json
[ { "route": "...", "selector": "...", "expect": "..." } ]
```
## Finding
```json
{ the whole finding }
```
~~~

## `acceptance.qa` per check
One assertion per failing URL (at most 5), `route` = the URL's path. Leave `qa` `[]` for IX-01, IX-02, IX-10, IX-11
(no selector on one page proves them; the audit command does).

| check | selector | expect (example) |
|---|---|---|
| IX-03 | `meta[name=robots]` | `absent, or content without noindex` (expected-noindex pages: `content contains noindex`) |
| IX-04 | `link[rel=canonical]` | `exactly one, href = https://swishquest.com/wordle` |
| IX-05 | `title` | `unique, 10-70 characters, not "Swish Quest"` |
| IX-06 | `meta[name=description]` | `content 50-160 characters, unique` |
| IX-07 | `h1` | `exactly one, visible in the server HTML` |
| IX-08 | `main` | `≥ 300 characters of text and ≥ 1 internal a[href] without JavaScript` |
| IX-09 | `script[type="application/ld+json"]` | `parses; @context, @type; url = the canonical; no aggregateRating` |
| IX-12 | `meta[property="og:image"]` | `present; the URL answers 200 with an image type` |

## Example finding
```json
{
  "id": "SEO-20261102-0600-seo-001",
  "check": "IX-04",
  "severity": "blocker",
  "urls": ["https://swishquest.com/wordle"],
  "current": "https://swishquest.com/wordle: canonical https://swishquest.com/ (expected https://swishquest.com/wordle)",
  "expected": "exactly one <link rel=\"canonical\">, absolute, equal to the sitemap URL; ?ref=x variants keep it",
  "files": ["src/app/[game]/page.tsx (generateMetadata alternates.canonical)", "src/app/layout.tsx (metadataBase, no canonical)"],
  "howToFix": "Step 4: set alternates: { canonical: entry.urlPath } in generateMetadata of src/app/[game]/page.tsx and keep any canonical out of src/app/layout.tsx.",
  "acceptance": {
    "audit": "node scripts/seo/audit.mjs --only IX-04 --site https://swishquest.com",
    "qa": [{ "route": "/wordle", "selector": "link[rel=canonical]", "expect": "exactly one, href = https://swishquest.com/wordle" }]
  },
  "fingerprint": "IX-04|https://swishquest.com/wordle",
  "decision": "card"
}
```
