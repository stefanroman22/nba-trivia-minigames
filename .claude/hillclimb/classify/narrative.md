| round | change | routing | design | model tier | risk | difficulty | $/pass (API) | median s |
|-------|--------|---------|--------|------------|------|------------|--------------|----------|
| 0 | baseline | 85% | 94% | 90% | 94% | 78% | $51.77 | 69 |
| 1 | breadth pass: motion timing, judgment copy/layout, risk vocab + named surfaces, verify-driven multi-area, pass priority | **96%** | 97% | 99% | 97% | 82% | $48.59 | 95 |
| 2 | narrow v1 rules (risk by modified code; multiplayer = relay/sim) | **99%** | 99% | 100% | 97% | 86% | $44.58 | 65 |

Winner: round 2 (stopped at ceiling; rounds 3-4 not run). Scores are directional (no held-out split; 36 cases x 2 reps).

Round 1's breadth pass fixed all six baseline misses it targeted (r16 motion timing, u03/u01 judgment copy and layout, r10/r17 design rounds, r07 stability) and raised every guardrail, at slightly lower cost. It over-reached in two places: the new risk rule made a tests-only friends fix high-risk once (r13), and the verify-driven multi-area rule tagged a copy-link button on a multiplayer screen as multiplayer work (u12). Round 2 narrows both. One measurement incident: 16 round-1 runs hit the Max plan session limit and were scored as failures by a runner bug; they were moved to errors.jsonl, the runner now rejects limit notices, and the runs were redone.

Round 2 recovered both round-1 over-reaches (r13 back to low risk and sonnet, u12 back to no design round) without losing any round-1 gain, and was the cheapest and fastest pass. The one remaining routing miss is r05 on one of two reps (design round true vs false on identical input), a borderline case rather than a wording defect. Paired routing delta vs baseline: +13.9 pts (95% CI +/-12.1); round 2 vs round 1: +2.8 (+/-6.7, within noise). With 71/72 correct, another round cannot show a measurable gain, so the loop stopped at round 2 instead of spending rounds 3-4. Remaining guardrail misses: risk on r17 and u15, one rep each.