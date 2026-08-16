---
name: classify
description: Classify a team task — difficulty, areas, risk, model/effort tier, required docs, CODE_MAP hits. Used by planner-architect at pipeline step 2.
---

# Classify a Task

Input: task title + spec text (from `node scripts/notion.mjs get-spec <pageId>`) and Area tags from the card.

## Procedure
1. Read `docs/team/RETRO.md` — if a similar task was parked before, factor its post-mortem in.
2. Confirm/correct the card's Area tags by grepping the codebase for the features named in the spec.
3. Grep `docs/team/CODE_MAP.md` for nouns in the spec; collect up to 10 relevant entries.
4. Apply the rubric. If the card has a Difficulty override, it wins.

## Rubric
- **trivial** — docs/copy/config/single-file change, no logic branches. Engines: haiku / low.
- **standard** — one area, bounded logic, existing patterns cover it. Engines: sonnet / high.
- **hard** — multi-area, new patterns, state machines, migrations, or anything touching
  multiplayer protocol. Engines: opus / high. `needsDesignRound: true`.
- **risk: high** if it touches auth, data pipeline, multiplayer protocol, or anything in
  the protected-paths list — CTO gets a `Risk: high` PR label and extra scrutiny.
- Multi-area at any difficulty → `needsDesignRound: true`.

## Output (exact JSON, nothing else)
{ "difficulty": "standard", "areas": ["ui"], "risk": "low",
  "engineModel": "sonnet", "engineEffort": "high",
  "docs": ["docs/constraints/UI_SHELL_CONSTRAINTS.md"],
  "codeMapHits": ["- `src/hooks/useLeaderboard.ts` — ..."],
  "needsDesignRound": false }
