# Team Decisions Log

Append-only. One entry per architectural/design decision made by the planner or a design round.
Format: `## YYYY-MM-DD — <title>` then Context / Decision / Consequences (2–3 lines each).

## 2026-08-29 — Native plan-and-self-review step for hard-task design rounds, not superpowers:writing-plans
Context: asked to have planner-architect use the `superpowers:brainstorming`/`writing-plans`
skills for complex tasks (write a plan, self-review it, hand it to the engine).
Decision: build the same rigor (numbered plan, self-review for coverage/placeholders/
consistency/scope/ambiguity) directly into `design-round`'s procedure instead of invoking those
skills. Two reasons: (1) `superpowers:brainstorming` hard-gates on human approval before any
implementation step — incompatible with an unattended pipeline run; (2) both skills are
machine-local plugins, not committed to this repo, so referencing them would silently no-op on
every cloud routine run (the pipeline's primary execution mode).
Consequences: the plan-and-self-review discipline now runs identically local or cloud, with no
external dependency. If those skills are ever made repo-portable and their approval gate made
optional for headless use, this can be revisited.

## 2026-09-06 — Model policy: cheap implementer, heavy planner and reviewer
Context: the owner wants token spend cut without losing quality. Previously `classify` sent
hard tasks to an opus or fable *engine*; sonnet/haiku only implemented easier tiers. Reviewer
and QA models were fixed by frontmatter/profile, so the `deep`/`max` profile could silently put
browser-qa on opus.
Decision: split the pick in two. `engineModel` is haiku (trivial) or sonnet (everything else,
hard included) — never opus/fable. `planModel` is opus (explicit spec) or fable (thin spec) and
drives the design round, the replan, and code-reviewer. Every design round now produces a
full implementation plan (previously hard-only), explicit enough that sonnet executes it
rather than reasoning it out. test-qa-engine and browser-qa are always sonnet; the CTO gate
is pinned to opus in the workflow (never fable). The orchestrator passes every model
explicitly. Revisits 2026-08-29: `superpowers:writing-plans` may be used for the plan when it
is present in the skill listing (local runs); the native a–c step remains the cloud fallback.
`superpowers:brainstorming` stays excluded — its human-approval gate is still incompatible
with unattended runs.
Consequences: opus/fable spend moves from implementation (the longest stage) to two short
stages (plan, review). Plan quality is now load-bearing for hard tasks — a thin plan will
show up as sonnet build failures and verify fix-cycles, which is the signal to fix the plan,
not to raise the engine model.

## 2026-09-06 — Opus banned; fable 5.1 for all thinking, fable-or-sonnet for implementation
Context: same day as the entry above, the owner banned opus (5 and 4.8) from the pipeline
outright and asked for Fable 5.1 as the single heavy model, with the implementer chosen by the
shape of the work rather than by spec quality.
Decision: supersedes the opus/fable `planModel` split above — `planModel` is removed; every
thinking role (classify, design round, replan, code-reviewer, CTO gate, orchestrator default in
`.claude/settings.json`, the `deep`/`max` engine profiles) is fable. `engineModel` gains a
`fable` option: haiku for trivial; sonnet for work that is clearly defined steps with
acceptance criteria, however many; fable for complex-but-small work — few steps, each needing
judgment a plan cannot pin down. Because step count and criteria explicitness are only known
after planning, classify's pick is provisional and the design round finalizes it (`Engine:`
line, step 5d). The earlier "CTO never fable" rule is dropped: with opus gone, fable is the only
reviewer-grade model left.
Consequences: no repo surface can spawn opus. The cloud worker routine's model lives in the
claude.ai routine settings, not in this repo — it has to be switched to Fable 5.1 by hand and
cannot be enforced from here. Long-and-vague plans remain a plan defect, never an engine
upgrade.

## 2026-09-06 — Opus 4.8 reinstated for planning detailed specs; Opus 5 ban made enforceable
Context: hours after the entry above, the owner narrowed the ban to Opus 5 and asked for Opus
4.8 on design rounds where the task comes with detailed instructions (Anthropic's own
guidance: 4.8 is strongest when the full spec is given up front in one pass). Research into
Claude Code's model resolution found the `opus` alias now means Opus 5, the spawn-call
`model` parameter is alias-only in practice, subagent frontmatter accepts full ids, and
precedence is spawn param → frontmatter → `CLAUDE_CODE_SUBAGENT_MODEL` → parent — so the
README's claim that the engine profile overrides frontmatter was wrong.
Decision: `planModel` returns as `opus-4.8 | fable` (detailed spec vs thin), used for the
design round and replan only; Opus 4.8 is reached solely via a new `planner-architect-opus`
agent whose frontmatter pins `claude-opus-4-8`, spawned with no model parameter. Review, CTO
gate and classify stay on fable. `Agent(model:opus)` and `Agent(model:claude-opus-5)` are
denied in `.claude/settings.json` so the banned model cannot be spawned by mistake. README
corrected.
Consequences: the ban is now enforced by the harness, not by prose. The `npm run engine`
profile's `subagentModel` is documented as a fallback that rarely decides anything.
