---
name: classify
description: Classify a team task — difficulty, areas, risk, model/effort tier, required docs, CODE_MAP hits. Used by planner-architect at pipeline step 2.
---

# Classify a Task

Input: task title + spec text (from `node scripts/notion.mjs get-spec <pageId>`) and Area tags from the card.
The spec text may contain `[Image attached: <path>]` lines — each is a local file already
downloaded from the card; Read it, it's part of the spec, not a footnote.

## Procedure
1. Read `docs/team/RETRO.md` (parked-task failures) and `docs/team/DECISIONS.md` (prior
   close-call model picks — see "Close calls" below) so similar tasks get consistent treatment.
2. Read every `[Image attached: <path>]` file in the spec before judging anything else — a
   mockup/screenshot changes area (usually implies `ui`) and can change difficulty (e.g. exact
   layout/spacing shown in the image raises the bar past what the text alone states).
3. Confirm/correct the card's Area tags by grepping the codebase for the features named in the spec.
4. Grep `docs/team/CODE_MAP.md` for nouns in the spec; collect up to 10 relevant entries.
5. Apply the difficulty rubric, then the model rubric. If the card has a Difficulty override, it wins.

## Difficulty rubric (drives risk / design-round — unchanged)
- **trivial** — docs/copy/config/single-file change, no logic branches.
- **standard** — one area, bounded logic, existing patterns cover it.
- **hard** — multi-area, new patterns, state machines, migrations, or anything touching
  multiplayer protocol. `needsDesignRound: true`.
- **risk: high** if it touches auth, data pipeline, multiplayer protocol, or anything in
  the protected-paths list — CTO gets a `Risk: high` PR label and extra scrutiny.
- Multi-area at any difficulty → `needsDesignRound: true`.

## Model rubric
Two separate picks. The model that writes code is the cheap one; the intelligence goes into
the plan and the review, not the implementation (see `docs/team/DECISIONS.md` 2026-09-06).

### `engineModel` — who implements. Never `opus` or `fable`.
| Model | When | Example |
|---|---|---|
| **haiku** (effort low) | `trivial`: content/copy/config edit, zero logic. | "Change the CTA button text from 'Play Now' to 'Start Game'." |
| **sonnet** (effort high) | Everything else — `standard` **and** `hard`. Sonnet is the default implementer because it costs a fraction of opus/fable per token, and it builds on top of an existing feature or follows an explicit plan well. A hard task does not earn a bigger engine — it earns a design round whose implementation plan is explicit enough that sonnet executes it without inventing anything. | "Add a 'career-high' stat row to the profile page, mirroring the existing stat-row pattern." / "New minigame built on the existing `GameFrame` shell, following a similar existing game as the template." |

### `planModel` — who thinks. Always `opus` or `fable`.
Used by the orchestrator for the design round (when `needsDesignRound`), the replan after
repeated verify failures, and the `code-reviewer` pass — so output it on **every** task, even
when no design round runs. Pick by spec quality, not by difficulty:

| Model | When | Example |
|---|---|---|
| **opus** | The spec is explicit: it either states how to handle every edge case, or states enough that the rest can be reasoned out from what's given. | Card: "Add a multiplayer 'best of 3' bracket mode. Ties break by total round wins; on disconnect, forfeit the current game only, not the match; reconnection within 30s resumes the bracket." → opus. |
| **fable** | The spec is thin — no edge-case guidance given, so the planner must invent the missing rules itself under real ambiguity. | Card: "Add a multiplayer 'best of 3' bracket mode." (no further detail) → fable. Same feature as the opus example above — the spec's level of detail is what changes the pick, not the feature. |

`fable` means the current Fable release (5.1 today) — a rolling alias like `opus`/`sonnet`,
never a pinned version id.

### Close calls
If you seriously weighed two adjacent picks for this task (e.g. trivial/haiku vs.
standard/sonnet, or planModel opus vs. fable) and could defend either, after picking: append a short entry to
`docs/team/DECISIONS.md` in its existing format (`## YYYY-MM-DD — <title>` then Context /
Decision / Consequences) — name both candidates considered and why one won. This is what makes
step 1's read-back actually keep future similar tasks consistent instead of re-litigating the
same judgment call from scratch each time.

## Output (exact JSON, nothing else)
{ "difficulty": "standard", "areas": ["ui"], "risk": "low",
  "engineModel": "sonnet", "engineEffort": "high",
  "planModel": "opus",
  "docs": ["docs/constraints/UI_SHELL_CONSTRAINTS.md"],
  "codeMapHits": ["- `src/hooks/useLeaderboard.ts` — ..."],
  "attachments": [],
  "needsDesignRound": false }
`attachments` is the list of `[Image attached: <path>]` paths pulled verbatim from the spec
text (empty array if none) — carry them forward unchanged so build/design stages don't have
to re-parse the spec to find them.
