---
name: classify
description: Classify a team task — difficulty, areas, risk, model/effort tier, required docs, CODE_MAP hits. Used by planner-architect at pipeline step 2.
---

# Classify a Task

Input: task title + spec text (from `node scripts/notion.mjs get-spec <pageId>`) and Area tags from the card.

## Procedure
1. Read `docs/team/RETRO.md` (parked-task failures) and `docs/team/DECISIONS.md` (prior
   close-call model picks — see "Close calls" below) so similar tasks get consistent treatment.
2. Confirm/correct the card's Area tags by grepping the codebase for the features named in the spec.
3. Grep `docs/team/CODE_MAP.md` for nouns in the spec; collect up to 10 relevant entries.
4. Apply the difficulty rubric, then the model rubric. If the card has a Difficulty override, it wins.

## Difficulty rubric (drives risk / design-round — unchanged)
- **trivial** — docs/copy/config/single-file change, no logic branches.
- **standard** — one area, bounded logic, existing patterns cover it.
- **hard** — multi-area, new patterns, state machines, migrations, or anything touching
  multiplayer protocol. `needsDesignRound: true`.
- **risk: high** if it touches auth, data pipeline, multiplayer protocol, or anything in
  the protected-paths list — CTO gets a `Risk: high` PR label and extra scrutiny.
- Multi-area at any difficulty → `needsDesignRound: true`.

## Engine model rubric
Four tiers, effort always `high` unless noted. Pick by what the task actually needs, not by
difficulty label alone — `hard` forks into two different models depending on spec quality.

| Model | When | Example |
|---|---|---|
| **haiku** (effort low) | `trivial`: content/copy/config edit, zero logic. | "Change the CTA button text from 'Play Now' to 'Start Game'." |
| **sonnet** | `standard`: reuses existing logic, or adds a simple-to-moderate feature on top of an existing, well-defined structure. **Prefer sonnet over opus whenever the existing system already gives a clear pattern to extend** — a complex surrounding codebase argues *for* sonnet if it's well-structured, not against it. | "Add a 'career-high' stat row to the profile page, mirroring the existing stat-row pattern." / "New minigame built on the existing `GameFrame` shell, following a similar existing game as the template." |
| **opus** | `hard`: new logic, no existing pattern covers it — **and** the spec is explicit: it either states how to handle every edge case, or states enough that the rest can be reasoned out from what's given. | Card: "Add a multiplayer 'best of 3' bracket mode. Ties break by total round wins; on disconnect, forfeit the current game only, not the match; reconnection within 30s resumes the bracket." → opus. |
| **fable** | Same difficulty class as opus (new logic, no pattern covers it) **but the spec is thin** — no edge-case guidance given, so the engine must invent the missing rules itself under real ambiguity. | Card: "Add a multiplayer 'best of 3' bracket mode." (no further detail) → fable. Same feature as the opus example above — the spec's level of detail is what changes the pick, not the feature. |

### Close calls
If you seriously weighed two adjacent tiers for this task (e.g. standard/sonnet vs. hard/opus,
or hard/opus vs. hard/fable) and could defend either, after picking: append a short entry to
`docs/team/DECISIONS.md` in its existing format (`## YYYY-MM-DD — <title>` then Context /
Decision / Consequences) — name both candidates considered and why one won. This is what makes
step 1's read-back actually keep future similar tasks consistent instead of re-litigating the
same judgment call from scratch each time.

## Output (exact JSON, nothing else)
{ "difficulty": "standard", "areas": ["ui"], "risk": "low",
  "engineModel": "sonnet", "engineEffort": "high",
  "docs": ["docs/constraints/UI_SHELL_CONSTRAINTS.md"],
  "codeMapHits": ["- `src/hooks/useLeaderboard.ts` — ..."],
  "needsDesignRound": false }
