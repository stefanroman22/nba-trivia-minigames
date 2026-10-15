UI check run 20261014-1153x (prod build · code c58db03) found 2 open finding(s) that share files or acceptance checks, so they are fixed together by backend-engine. Target: main.
## Findings
### UIC-20261014-1153-001 · Masked stranger "Player" still shows a permanent player ID (VS intro)
blocker · backend · security · route /series-winner · viewports pairA, pairB, pairC, pairD · state: 1v1 random match, searching / match found; both players
Current: The 1v1 opponent is shown as "Player" (teen masking) but the card still prints the #ID (#G8RW2B / #RG8H3M), which lets anyone find and friend-request a masked teen.
Expected: A masked stranger shows no #ID tag on any online surface (intro, results).
Evidence: check MP-MATCH-01 · opponent tag #G8RW2B shown next to Player · selector .om-matchup .om-pc-tag
![UIC-20261014-1153-001 MP-MATCH-01](/runs/20261014-1153x/sheets/MP-MATCH-01.jpg)
- shot (run dir): shots/MP-MATCH-01/mp@pairA-host-host-searching.jpg
Files:
- multiplayer_server/src/index.js:206 — publicUser masks username and photo but still sends the permanent id
- src/components/MultiPlayer/OnlineMatch.tsx:295 — passes tag={opp0?.id} to the opponent PlayerCard
- src/components/MultiPlayer/PlayerCard.tsx:56 — renders #tag whenever a tag is given
How to fix:
- Change: In publicUser, send no public tag for a masked user (e.g. masked:true, or the id only in friend rooms) while keeping the internal uid for seat keys
- Change: In OnlineMatch hide the tag on the opponent PlayerCard when the opponent is masked
- Reuse: maskedForStrangers in multiplayer_server/src/index.js
- Rules: docs/legal/README.md
Acceptance:
- Digest lines teen-masking `.om-matchup .om-pc-tag` disappear from MP-MATCH-01
- check MP-MATCH-01 @ mp@pairA passes
- verify: node scripts/ui-check/verify.mjs --from <attached findings.json> UIC-20261014-1153-001
### UIC-20261014-1153-002 · Masked stranger "Player" still shows a permanent player ID (results)
blocker · backend · security · route /series-winner · viewports pairA, pairB, pairC, pairD · state: 1v1 random match, results; both players
Current: The 1v1 opponent is shown as "Player" (teen masking) but the card still prints the #ID (#G8RW2B / #RG8H3M), which lets anyone find and friend-request a masked teen.
Expected: A masked stranger shows no #ID tag on any online surface (intro, results).
Evidence: check MP-RESULT-01 · opponent tag #G8RW2B shown next to Player · selector .om-stage--results .om-pc-tag
![UIC-20261014-1153-002 MP-RESULT-01](/runs/20261014-1153x/sheets/MP-RESULT-01.jpg)
- shot (run dir): shots/MP-RESULT-01/mp@pairA-host-playing.jpg
Files:
- multiplayer_server/src/index.js:206 — publicUser masks username and photo but still sends the permanent id
- src/components/MultiPlayer/OnlineMatch.tsx:295 — passes tag={opp0?.id} to the opponent PlayerCard
- src/components/MultiPlayer/PlayerCard.tsx:56 — renders #tag whenever a tag is given
How to fix:
- Change: In publicUser, send no public tag for a masked user (e.g. masked:true, or the id only in friend rooms) while keeping the internal uid for seat keys
- Change: In OnlineMatch hide the tag on the opponent PlayerCard when the opponent is masked
- Reuse: maskedForStrangers in multiplayer_server/src/index.js
- Rules: docs/legal/README.md
Acceptance:
- Digest lines teen-masking `.om-stage--results .om-pc-tag` disappear from MP-RESULT-01, MP-PROP-01, MP-PROP-02
- check MP-RESULT-01 @ mp@pairA passes
- check MP-PROP-01 @ mp@pairA passes
- check MP-PROP-02 @ mp@pairA passes
- verify: node scripts/ui-check/verify.mjs --from <attached findings.json> UIC-20261014-1153-002
## Pipeline
- Engine protocol: "Fixing a UI-check finding" in .claude/agents/backend-engine.md; the full finding objects are in the attached findings.json (this body is a summary).
- QA: verify assertion runs the attached findings (node scripts/ui-check/verify.mjs --from <attached findings.json>); every finding must PASS.
- Ship: Target main — branch from origin/main, PR into main, then back-merge main into dev. Relay (multiplayer_server/) deploys are parked for the owner.
- Fingerprints (Source key = rule|route|selector):
- 5d9d7ae6d0be = teen-masking|/series-winner|.om-matchup .om-pc-tag
- 193af9d6b382 = teen-masking|/series-winner|.om-stage--results .om-pc-tag
