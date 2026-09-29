---
name: classify
description: Classify a team task — difficulty, areas, risk, model/effort tier, required docs, CODE_MAP hits. Used by planner-architect at pipeline step 2.
---

# Classify a Task

Input: task title + spec text (from `node scripts/notion.mjs get-spec <pageId>`), the card's Category and its Priority.
The spec text may contain `[Image attached: <path>]` / `[File attached: <path>]` lines and `## Comment (...)` sections — the owner's comments and their images are part of the spec.

## Procedure
1. Read `docs/team/RETRO.md` (parked-task failures) and `docs/team/DECISIONS.md` (prior
   close-call model picks — see "Close calls" below) so similar tasks get consistent treatment.
2. Read every `[Image attached: <path>]` file in the spec before judging anything else — a
   mockup/screenshot changes area (usually implies `ui`) and can change difficulty (e.g. exact
   layout/spacing shown in the image raises the bar past what the text alone states).
3. Derive `areas` (`frontend`, `backend`, plus any of games/ui/multiplayer/auth/data) from the Category and by grepping the codebase for the features named in the spec. Category `fullstack` always yields both `frontend` and `backend`; any other Category may still yield both when the spec needs it.
4. Grep `docs/team/CODE_MAP.md` for nouns in the spec; collect up to 10 relevant entries.
5. Apply the difficulty rubric, then the model rubric. If the card has a Difficulty override, it wins.

## Difficulty rubric (drives risk / design-round — unchanged)
- **trivial** — docs/copy/config/single-file change, no logic branches.
- **standard** — one area, bounded logic, existing patterns cover it.
- **hard** — multi-area, new patterns, state machines, migrations, anything touching
  multiplayer protocol, or work that generates or regenerates data consumed by several games.
  `needsDesignRound: true`.
- **risk** is exactly `low` or `high` — never any other value. **High** if it touches auth,
  data pipeline, multiplayer protocol, anything in the protected-paths list, or any surface
  on the risk-high list in `docs/constraints/AUTH_CONSTRAINTS.md` AUTH-11 (friends, blocking,
  profile photos, sessions, throttles, the admin API, the `CACHES` / settings layer) — read
  AUTH-11 whenever the task touches `backend/users/`, `backend/backend/settings.py` or caching.
  CTO gets a `Risk: high` PR label and extra scrutiny.
- Multi-area at any difficulty → `needsDesignRound: true`. Count areas by what the change must
  touch **or run to verify**, not by the card's Category: a fix whose check drives the
  multiplayer relay or its sim scripts involves `multiplayer` even if only backend tests change.
- **Security work → `needsDesignRound: true`, `risk: high`, always** — attacks/DDoS, auth or
  session breaches, account blocking/abuse, secrets, permissions — regardless of difficulty or
  how few files it touches. Fable plans it so the plan covers every case; opus implements.

## Model rubric
As of 2026-09-29, Opus is unbanned (see `docs/team/DECISIONS.md` 2026-09-29) — the 2026-09-06 ban
targeted Opus 5's cost specifically; Opus 5.5 and Sonnet 5.5 are meaningfully faster and cheaper.
The models in play: `fable` (Fable 5.1: classify, review, the CTO gate, and design rounds for
hard tasks — no longer an implementer), `opus` (Opus 5.5: implementation requiring real
judgment), `sonnet` (Sonnet 5.5: the default implementer) and `haiku` (Haiku 4.5: trivial only).
All four are rolling aliases.

### `engineModel` — who implements
| Model | When | Example |
|---|---|---|
| **haiku** (effort low) | `trivial`: mechanical content/copy/config edit, zero logic and zero judgment — the new text or value is given or fully determined. Not haiku: copy that has to be *written* to persuade or engage (headlines, marketing, onboarding text), and adding or removing a visible UI element (it changes layout and needs a visual check) — both are sonnet. | "Change the CTA button text from 'Play Now' to 'Start Game'." |
| **sonnet** (effort high) | **The default.** Any task whose work can be written as clearly defined steps, each with an acceptance criterion — however many steps — or a spec detailed enough that nothing needs inventing. Building on an existing feature, following an existing pattern, or executing a design-round plan step by step. Long-and-explicit is sonnet territory. | "Add a 'career-high' stat row to the profile page, mirroring the existing stat-row pattern." / "New minigame built on the existing `GameFrame` shell, following a similar existing game as the template." / A 12-step bracket-mode plan where every step names its file and its done-check. |
| **opus** (effort high) | **Complex.** A few steps that each need real judgment a plan cannot fully pin down — a novel algorithm, a tricky state machine, subtle multiplayer timing — or a spec that genuinely cannot be reduced to steps with acceptance criteria; also the implementer for a hard task once Fable has produced its design-round plan. Rule of thumb: short-and-hard or hard-with-a-plan → opus; long-and-explicit → sonnet; long-and-vague → the plan is the problem, fix it in the design round rather than upgrading the engine. | Card: "Elo-style rating updates for 3-player rooms with disconnect forfeits" — one file, hard math, ambiguous ties → opus. |

Two overrides beat the table:
- **Motion/animation → opus, always.** Any task whose core is motion — framer-motion, transitions,
  animated UI, springs, gestures, scroll/reveal effects — goes to opus regardless of difficulty,
  even a one-file change. This includes changing *when* or *how* something animates — timing,
  sequencing, delays, what triggers an animation, what stays still vs. animates — even when no
  new animation is authored. Feel and timing are judgment, not steps.
- **Important + complex → opus.** `risk: high`, or a `Priority: P0` card that is not trivial, goes
  to opus rather than sonnet. Simple tasks stay sonnet (or haiku if trivial).

This is a **provisional** pick. When a design round runs, the planner finalizes it once the
plan exists (`design-round` step 5d), **per step** — a Fable-planned task can mix opus steps
(complex, or motion) and sonnet steps (simpler). Only then is the step count and the
explicitness of the acceptance criteria actually known.

### `planModel` — who runs the design round and any replan
Output it on every task (it is ignored when `needsDesignRound` is false and no replan happens).
Always **fable** — Opus is no longer used for planning under this policy, only implementation.

### Close calls
If you seriously weighed two adjacent picks for this task (e.g. trivial/haiku vs.
standard/sonnet, or engineModel sonnet vs. fable) and could defend either, after picking: append a short entry to
`docs/team/DECISIONS.md` in its existing format (`## YYYY-MM-DD — <title>` then Context /
Decision / Consequences) — name both candidates considered and why one won. This is what makes
step 1's read-back actually keep future similar tasks consistent instead of re-litigating the
same judgment call from scratch each time.

## Output (exact JSON, nothing else)
{ "difficulty": "standard", "areas": ["frontend","ui"], "risk": "low",
  "engineModel": "sonnet", "engineEffort": "high",
  "planModel": "fable",
  "docs": ["docs/constraints/UI_SHELL_CONSTRAINTS.md"],
  "codeMapHits": ["- `src/hooks/useLeaderboard.ts` — ..."],
  "attachments": [],
  "needsDesignRound": false }
`attachments` is the list of `[Image attached: <path>]` paths pulled verbatim from the spec
text (empty array if none) — carry them forward unchanged so build/design stages don't have
to re-parse the spec to find them.
