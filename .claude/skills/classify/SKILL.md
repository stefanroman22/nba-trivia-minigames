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
Opus — 5 and 4.8 alike — is banned pipeline-wide: never output it. The only models in play are
`fable` (Fable 5.1: all planning, review and gating, plus hard-but-small implementation),
`sonnet` (the default implementer) and `haiku` (trivial only). All three are rolling aliases,
never pinned version ids. Thinking is always fable; this rubric only decides who *implements*
(see `docs/team/DECISIONS.md` 2026-09-06).

### `engineModel` — who implements
| Model | When | Example |
|---|---|---|
| **haiku** (effort low) | `trivial`: content/copy/config edit, zero logic. | "Change the CTA button text from 'Play Now' to 'Start Game'." |
| **sonnet** (effort high) | **The default.** Any task whose work can be written as clearly defined steps, each with an acceptance criterion — however many steps. Building on an existing feature, following an existing pattern, or executing a design-round plan step by step. Long-and-explicit is sonnet territory; a hard task with a good plan is still sonnet. | "Add a 'career-high' stat row to the profile page, mirroring the existing stat-row pattern." / "New minigame built on the existing `GameFrame` shell, following a similar existing game as the template." / A 12-step bracket-mode plan where every step names its file and its done-check. |
| **fable** (effort high) | **Complex but small.** A few steps that each need real judgment a plan cannot fully pin down — a novel algorithm, a tricky state machine, subtle multiplayer timing — or a spec that genuinely cannot be reduced to steps with acceptance criteria. Rule of thumb: short-and-hard → fable; long-and-explicit → sonnet; long-and-vague → the plan is the problem, fix it in the design round rather than upgrading the engine. | Card: "Elo-style rating updates for 3-player rooms with disconnect forfeits" — one file, hard math, ambiguous ties → fable. |

This is a **provisional** pick. When a design round runs, the planner finalizes it once the
plan exists (`design-round` step 5d) — only then is the step count and the explicitness of the
acceptance criteria actually known.

### Close calls
If you seriously weighed two adjacent picks for this task (e.g. trivial/haiku vs.
standard/sonnet, or engineModel sonnet vs. fable) and could defend either, after picking: append a short entry to
`docs/team/DECISIONS.md` in its existing format (`## YYYY-MM-DD — <title>` then Context /
Decision / Consequences) — name both candidates considered and why one won. This is what makes
step 1's read-back actually keep future similar tasks consistent instead of re-litigating the
same judgment call from scratch each time.

## Output (exact JSON, nothing else)
{ "difficulty": "standard", "areas": ["ui"], "risk": "low",
  "engineModel": "sonnet", "engineEffort": "high",
  "docs": ["docs/constraints/UI_SHELL_CONSTRAINTS.md"],
  "codeMapHits": ["- `src/hooks/useLeaderboard.ts` — ..."],
  "attachments": [],
  "needsDesignRound": false }
`attachments` is the list of `[Image attached: <path>]` paths pulled verbatim from the spec
text (empty array if none) — carry them forward unchanged so build/design stages don't have
to re-parse the spec to find them.
