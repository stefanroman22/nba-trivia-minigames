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

## 2026-09-16 — Compact centered points/rank in account overview: trivial/haiku vs trivial/sonnet
Context: card 3dc2cfb1-c595-80b9-a2d4-f182a24358e6 asks for a smaller, center-aligned
points/rank block in the profile panel with reduced text on mobile. The card's Difficulty
override is `trivial` (it wins). The change lives in one CSS block (`.profile-stats*` in
`src/styles/LandPage.css`) plus at most the matching markup in `src/components/UserProfile.tsx`,
no logic — so haiku was defensible under the "trivial → haiku" row.
Decision: keep `trivial` (override) but set `engineModel: sonnet`. The haiku row is for
content/copy/config edits with zero judgment; "find a better way that takes less space" is a
small layout design call with a responsive breakpoint and a real-browser check, which is the
sonnet default. No design round (single area, thin spec) → `planModel: fable` is nominal.
Consequences: trivial-by-override tasks that are visual/layout rather than copy/config go to
sonnet, not haiku; difficulty and engine tier are decided separately when the override forces
`trivial` on a task that still needs layout judgment.

## 2026-09-16 — Mobile "Games" link must reach the games heading from any page: sonnet vs fable engine
Context: card 3dc2cfb1-c595-8068-ac4c-cee34b4124e6 (Difficulty override `trivial`, frontend
only). `Navigation.go("play")` targets the hero `#play`, not `#games-grid` (the section whose
`scroll-margin-top: 76px` gives the 12px-below-header landing the card asks for), and on
`type="back"` pages the fixed `setTimeout(..., 350)` races the exit fade + Next route push, so
the element is often absent when the scroll fires. Fable was defensible because the fix is
small and involves a real timing subtlety (Next App Router push + sticky header + hash scroll).
Decision: `engineModel: sonnet`. The work reduces to explicit steps with done-checks (retarget
to `games-grid`; replace the fixed delay with a scroll-after-arrival mechanism such as a hash or
a `Landpage` mount effect; update Rule UI-3 in `UI_SHELL_CONSTRAINTS.md`; browser pass from
`/admin` and a game page on a phone viewport). Difficulty stays `trivial` per the override.
Consequences: small nav/scroll timing fixes stay on sonnet as long as the target and the
arrival mechanism can be named up front; fable is reserved for cases where the mechanism itself
is unclear.

## 2026-09-17 — Pipeline v2: board columns, push-to-dev, human-merged dev→main

**Context.** Cards created without a Status were invisible to the pipeline; per-task PRs into
dev plus a CTO merge doubled the review work and left "Done" meaning "on dev, not production";
the actionable Slack cards lived in `#pipeline` while the agent channels only got digests.

**Decision.** Board = Backlog → To Do → In progress → QA → Done (Done = on main, set only by
`main-sync.yml`). Ship = rebase + fast-forward push to dev, no PR. QA/failure cards with model +
effort go to the agent channels and carry the ✅/🔄 loop; `#pipeline` gets one run summary.
Failures return the card to To Do with `Attempts`; two failures set `Needs human`.
Frontend+backend work in one card is split internally (backend first, one commit).
`maxTasksPerRun` is no longer a limit; time is. Promotion to `main` is covered by a separate
2026-09-19 entry below.

**Consequences.** Spec images can come from the body, the Attachments property or comments.
`Area` and per-task `PR` are gone from the board.
Spec: `docs/superpowers/specs/2026-09-17-pipeline-v2-board-flow-slack-design.md`.

## 2026-09-19 — Pipeline v2: push-to-dev-only, promotion is a manual/explicit action

**Context.** Mid-implementation of the above, discovered live that a real, human-authenticated
push to `dev` (not just the pipeline's bot-token merges) still auto-triggered `dev-ci.yml`'s
promote-to-main job — that's how an unrelated feature PR reached production without anyone
asking. A concurrent session had already opened a PR gating that job to manual
`workflow_dispatch` only. Owner's directive: "all coding agents and pipeline push to dev only.
Push to prod can only be done if explicitly asked within prompting or via triggering the manual
action on GitHub."

**Decision.** Drop this plan's original batch `dev → main` PR + CTO-review + owner-merge design
in favor of the simpler, already-in-flight fix: `dev-ci.yml` keeps its promote job, gated to
`workflow_dispatch` only (no push, from anyone, auto-promotes). `claude.yml`'s `cto-review`/
`cto-act` jobs are retired — with no PR left anywhere in the loop (per-task PRs were already gone;
now the batch PR is too), there's nothing left for a PR-triggered review to attach to. Quality
into `dev` stays the in-run `code-reviewer` (fable) step, unchanged. `scripts/promote.mjs` is not
built; `main-sync.yml` is unaffected (it watches pushes to `main`, whatever the mechanism).

**Consequences.** No batch review gate before production — the owner (or an agent explicitly
asked to) is trusted to check `dev` before promoting. `cto-approved`/`cto-changes-requested`
labels and the fix-tasks-first CTO loop in `team-run` are gone. Spec revision:
`docs/superpowers/specs/2026-09-17-pipeline-v2-board-flow-slack-design.md` (2026-09-19 addendum).

## 2026-09-20 — Stale trivia tests that drive the multiplayer sim: backend-only vs backend+multiplayer
Context: card "Fix 3 trivia tests that fail on a clean dev checkout" (Category backend, P1). All
three failures are stale tests, not regressions: the questions-store migration (6e82128,
40b1ef8, 6a1a11b) removed `drawSlots`/`dailySecret` from `src/Game Renderers/SuperDraft.tsx` /
`Contexto.tsx` (the invariants the string assertions guard still hold — multiplayer never redraws,
the sent `secret_person_id` is the only secret accepted) and moved the relay's superdraft/contexto
rounds from Django fetches to `multiplayer_server/src/questions.js` (`deal()` via a schema-1
manifest), so `scripts/sim_round_fanout.js`'s `global.fetch` stub of the Django payloads no longer
reaches the relay and `getManifest` throws `questions schema undefined unsupported`. Fix side is
the tests every time. Classifying it `areas: ["backend"]` was defensible (Category backend, the
Python tests are the deliverable, no design round) but the sim rewrite is real Node work against
`questions._setForTest` mirroring `scripts/sim_turngames.js`'s fixture, i.e. multiplayer-area code.
Decision: `areas: ["backend","multiplayer"]`, `difficulty: standard`, `risk: low` (a test harness,
not the socket protocol), `needsDesignRound: true` per the multi-area rule, `engineModel: sonnet`
(each test maps to a named file and a "passes on clean dev" done-check), `planModel: opus-4.8`
(the spec enumerates every failure and its error text).
Consequences: test-only fixes that need a `multiplayer_server/scripts/*` sim rewritten still get
the short multi-area design round; the plan should say explicitly that no renderer or relay code
changes and that the sim moves to the `_setForTest` fixture pattern rather than re-stubbing fetch.

## 2026-09-20 — Design round with no spawnable engines: planner fills the engine seats and says so
Context: design round for "Fix 3 trivia tests that fail on a clean dev checkout" ran on a cloud
session (TEAM_CLOUD=1) whose tool list has no `Agent` tool, and `ListAgents` showed no teammate
engines to message — only the planner subagent itself. The `design-round` skill's steps 1 and 3
(engine proposals, engine sign-off) could not be executed as written.
Decision: the planner filled both `backend-engine` seats natively from source and `git log -p`
(the evidence is in the design doc's verdict table), replaced the sign-off pass with the step-5b
self-review, and states this in the design doc's Decision summary. Not parked: the task is
`standard`/`risk: low`, the spec enumerated every failure, and all three verdicts rest on commit
evidence (6e82128, 40b1ef8, 6a1a11b) rather than judgment calls an engine would have changed.
Consequences: `team-run`/`planner-architect` should check that the Agent tool is present before
spawning a design round that requires engine consults, or the `design-round` skill should name
this fallback explicitly for cloud runs; until then a design doc from a cloud run must say whether
its proposals came from real engines or from the planner.

## 2026-09-20 — Online Contexto/SuperDraft relay→renderer mismatch found while fixing the tests: recorded, not bundled
Context: the questions-store Phase E commit (6a1a11b) switched the relay's `superdraft`/`contexto`
rounds to `questions.deal()` (a full `SuperDraftQuestion`/`ContextoQuestion`), while Phase C/D
(6e82128/40b1ef8) had deliberately left the renderers' multiplayer branches on the old
`{pool, day, slots}` / `{pool, day, secret_person_id}` configs "for a future phase". Result on
`dev`: online Contexto shows "No player data available" (`round.secret_person_id` is undefined);
online SuperDraft works only because `useRoundPool` defaults to `players-index`, and has lost the
server `day` for `dailyObjective`. None of the three failing tests covers this contract.
Decision: keep the P1 card to the three tests (tests-only fix, no renderer/relay change) and
record the mismatch in the design doc as a follow-up card ("Port Contexto/SuperDraft multiplayer
branches to the dealt question — spec §10.3"; areas ui + multiplayer; needs
GAME_DESIGN_CONSTRAINTS and browser QA). Bundling a renderer port into a test-unblock card would
turn a low-risk backend change into a UI change the ship gate for every backend card waits on.
Consequences: the follow-up must be filed on the board; until it ships, `docs/games/MASTER_PLAN.md`
readers should treat online Contexto as broken on dev and production alike (the relay change is
already promoted).

## 2026-09-22 — Stale FriendsPhotoTests (friends-overview KeyError 'friends'): trivial/haiku vs trivial/sonnet
Context: backend card, no override. `users.tests.FriendsPhotoTests` reads `resp.json()["friends"]`
from `friends-overview`, but commit `3fa8788` (search your own friend list) moved the friend
list into `search_friends` (`search-friends/`, `{"results": [...], "total": n}`) and left
`friends_overview` returning only `incoming_requests`/`outgoing_requests`/`blocked_users`
(its docstring says so). The endpoint is right, the test is stale — a one-file test edit with
no logic branches, so `trivial` fits and haiku was defensible. The open "cacheable photo
endpoint" card has not shipped (`users/friends.py` HEAD is still `3fa8788`), so nothing has
fixed this yet and the two cards do not collide as long as this one only touches `tests.py`.
Decision: `difficulty: trivial`, `engineModel: sonnet`. Same split as 2026-09-16: haiku is for
copy/config with zero judgment; this needs the engine to reproduce the failure, confirm the
correct route (`search-friends`, `results` key, `profile_photo is None`) rather than guess,
and run `manage.py test users` green. `risk: low` (auth headers are used but auth code is
untouched), no design round, `planModel: fable` nominal.
Consequences: "test is stale after a shipped refactor" cards are trivial/sonnet, test-file
only; the engine must not restore a `friends` key to `friends_overview` (the frontend already
consumes `search-friends`). If the photo-endpoint card ships first and rewrites this test,
the ship stage's rebase test check is the signal to close this card as already fixed.

## 2026-09-22 — Cacheable friend-photo endpoint: standard vs hard, sonnet vs fable engine
Context: fullstack P1 card, no override. Backend today: photos are 256px JPEG bytes in
`CustomUser.profile_photo_data` (dbc9a0f), inlined as a data URL only in `user_payload`;
`users/friends.py::_brief` returns `profile_photo: None` and `FriendsPhotoTests` (fixed in 51d601b)
asserts list rows stay byte-free. Frontend: `FriendsPanel` rows draw `ui/Avatar` (initials only, no
`src` prop). Two things the spec leaves open make this more than "add a view": (1) an `<img src>`
cannot carry the Bearer header (AUTH-3/AUTH-5), so `GET api/users/<public_id>/photo/` is either
`AllowAny` keyed by the unguessable public_id — a product rule about photo visibility — or an
`apiFetch`+blob-URL pattern that forfeits the HTTP cache the card asks for; (2) a version/ETag that
lets list rows cache-bust without loading bytes needs either a per-request hash on the photo view
(no migration, stale-for-max-age after a re-upload) or a `profile_photo_version` column on the
AUTH-9-listed `users/models.py` (migration 0006 on the DB dev and prod share). `standard` was
defensible (bounded, existing DRF patterns, the design round runs anyway for multi-area); `fable`
was defensible for the same reason — one small view with real caching/auth judgment.
Decision: `difficulty: hard` (multi-area, first binary/HTTP-cached endpoint in a JSON-only DRF app,
probable migration), `risk: high` (AUTH-9 files `users/models.py` and `update_profile` are the
natural touch points, plus a new unauthenticated-by-design read of user data), `engineModel: sonnet`
provisional — once the design round fixes the two rules above the rest is explicit steps with
done-checks (view + URL + ETag/Cache-Control + 404/304 tests; `_brief` gains a version/has-photo
key while `FriendsPhotoTests` stays green; `Avatar` gains an optional `src` with `onError` fallback
to initials; `FriendsPanel` rows pass it). `planModel: fable` — the spec is concrete about shape
but the auth and versioning rules have to be invented.
Consequences: the design round must settle photo-endpoint auth and the version source before
anything is built, and must keep `search-users`/`search-friends` rows free of photo bytes (the
51d601b test is the contract). If the plan lands on the migration path, the backend commit must
ship first per pipeline v2's backend-then-frontend split and note the shared-DB migration.

## 2026-09-22 — Friend-photo endpoint design: public by public_id + stored version column; engine seats filled by the planner
Context: design round for "Friend lists show profile photos via a cacheable photo endpoint" (hard /
risk high, `docs/team/designs/2026-09-22-friend-photos-cacheable.md`). The classify entry above
left two rules open. (1) Auth: a browser `<img>` cannot send the JWT (AUTH-3/AUTH-5), so the
choice was an unauthenticated endpoint keyed by `public_id` or `apiFetch`→blob URL, which forfeits
the HTTP cache the card asks for. (2) Version: a per-request byte hash needs the bytes on every
list row (or a revalidation per row per render), while a column needs migration 0006 on the shared
dev/prod DB. Also: this cloud session again has no `Agent` tool and `ListAgents` lists no engine
teammates, so the `backend-engine`/`frontend-engine` proposal and sign-off seats could not be run
as the `design-round` skill writes them.
Decision: `GET /api/users/<public_id>/photo/?v=N` is a plain Django view (BE-9), no auth, no
throttle, JPEG bytes only, identical 404 for unknown and photo-less ids — `public_id` is already
shown on every row and the leaderboard, and the multiplayer relay already hands photos to any
opponent, so the endpoint widens nothing. `CustomUser.profile_photo_version`
(PositiveIntegerField, 0 = no photo) is bumped by `update_profile` and backfilled to 1 for
pre-existing photos in `0006` (AddField + RunPython); list rows gain a NEW `photo_version` key and
keep `profile_photo: None` (the 51d601b test contract is extended in place, not replaced).
Cache-Control: immutable/1y when `?v=` matches, `no-cache` otherwise, `no-store` on 404; ETag =
version via Django's `condition`. The planner filled both engine seats from source, states so in
the design doc, and the 5b self-review stands in for sign-off (same fallback as 2026-09-20).
Engine finalised as `sonnet` (13 explicit steps with done-checks).
Consequences: the backend commit (with the migration) ships before the frontend one; the
frontend's `version > 0` guard renders initials against a backend without the field. Leaderboard
rows and the relay's inline data URL are follow-up cards. Two cloud design rounds in a row have
hit the missing-`Agent` fallback — the `design-round` skill should name it explicitly.

## 2026-09-22 — Port Contexto/SuperDraft multiplayer branches to the dealt question: standard vs hard, sonnet vs fable
Context: fullstack P1 card, no override, follow-up to the 2026-09-20 finding. The relay
(`multiplayer_server/src/index.js` `fetchRound` → `[await questions.deal(gameId)]`) already deals a
full `ContextoQuestion`/`SuperDraftQuestion`, so `roundData.gameData` reaches `RenderGame` as
`[question]` today; only the two renderers' `multiplayer` branches still cast `gameInfo[0]` to the
retired `{pool, day, secret_person_id}` / `{pool, day, slots}` configs and go through `useRoundPool`
(whose only two callers are these files). `hard` was defensible: multi-area, it deletes the
client-side similarity engine and `buildCandidates`/`resolveSlots`, and one rule is genuinely
missing — the dealt `SuperDraftQuestion` carries no `day` (`questions/games/superdraft.py`
`index_item` → `[None]`, `materialize` envelopes `{slots}` only; spec §7.4 keeps the objective
"chosen by date in the renderer"), so with the relay contract frozen the shared objective has to come
from something both clients already hold (the qid) or the contract has to grow. `fable` was
defensible for that same open rule.
Decision: `difficulty: standard` (bias small: the solo branch of each renderer is the exact pattern
the multiplayer branch adopts, the relay and Django views are untouched, and the objective rule is one
decision the design round makes, not a state machine), `risk: low` (renderer-side consumption of an
existing payload; no socket protocol, auth or pipeline change), `needsDesignRound: true` (multi-area:
frontend/ui + multiplayer + backend), `engineModel: sonnet` provisional (once the objective rule is
fixed every step names a file and a done-check: two renderers, `RenderGame` casts, `types.tsx`
cleanup, delete `useRoundPool`, re-pin the backend source-string guards), `planModel: fable` (the spec
names the defects and the target shape but the objective rule and the fate of the `RoundConfig`
types/hook must be invented).
Consequences: the backend area is real but tests-only — `backend/trivia/tests/test_contexto.py`
(`round?.secret_person_id`, `useRoundPool(...)`, `const secret = multiplayer ? mpSecret : ...`) and
`test_superdraft.py` (`resolveSlots(candidates, round?.slots ?? [])`, `dailyObjective(round?.day)`)
pin renderer lines the port deletes and must be re-pinned in the same change; `sim_round_fanout.js`
and `multiplayer_server/src/*` stay untouched. If the design round decides the relay must add a
field after all, that contradicts the card's "keep the relay contract as is" and should be raised on
the card rather than silently widened.

## 2026-09-22 — Contexto/SuperDraft dealt-question port design: online objective from the qid hash, relay untouched; engine seats filled by the planner
Context: design round for "Port Contexto/SuperDraft multiplayer branches to the dealt question"
(standard / risk low, `docs/team/designs/2026-09-22-port-contexto-superdraft-mp.md`). The classify
entry above left open how online SuperDraft gets a shared objective when the dealt
`SuperDraftQuestion` carries no `day` (`questions/games/superdraft.py index_item` → `[None]`; spec
§7.4 keeps the objective in the renderer) and what happens to the retired `*RoundConfig` types and
`useRoundPool`. Three rules were possible: hash the qid both clients already hold; use `utcToday()`
on each client; add `day` to the relay payload. This cloud session again had no `Agent` tool and
`ListAgents` listed no engine teammates, so the `frontend-engine`/`backend-engine` proposal and
sign-off seats could not be run as the `design-round` skill writes them.
Decision: online objective = `OBJECTIVES[hashStr(question.qid) % 4]` (the existing FNV-1a in
`src/utils/questions.ts`, now exported); solo keeps `dailyObjective()` on the local date unchanged.
`utcToday()` was rejected because the two clients can straddle UTC midnight between their
`roundData` arrivals and a next-day reconnect would recompute a different objective from the
opponent's; a relay field was rejected because the card freezes the contract and the value is
derivable client-side. So: **no relay or Django change.** Both renderers consume `gameInfo[0]` as the
question in both modes (spec §10.3); `ContextoRoundConfig`/`SuperDraftRoundConfig`/
`SlotConstraintConfig` and `src/hooks/useRoundPool.ts` are deleted (their only consumers are the two
branches removed); Contexto drops its `multiplayer` prop (nothing reads it; MP-12), SuperDraft keeps
it for the re-roll guard and the objective rule. The Contexto awards-metric source guard, which the
deleted TypeScript engine would have broken, moves onto `trivia/questions/similarity.py` with a
numeric mirror check rather than being dropped. The planner filled both engine seats from source and
the 5b self-review stands in for sign-off (same fallback as 2026-09-20 and the friend-photo round).
Engine finalised as `sonnet` (13 explicit steps with done-checks).
Consequences: the frontend half must be built before the backend half — the backend is tests-only
and its re-pins fail against the unported renderers by design. MULTIPLAYER_CONSTRAINTS acceptance
check 4 now reads 4 / six files (it was already 5 / 7 on the base commit against a documented 3 / 7);
the doc is left for `bootstrap-audit`. On the cloud QA VM supabase.co is blocked, so the browser pass
serves a fixture questions store on `localhost:5280` to both the relay (`QUESTIONS_PUBLIC_BASE`) and
the browser (`VITE_QUESTIONS_BASE`); online mode still fetches only the manifest and the names list
from the store after the port. Three cloud design rounds have now hit the missing-`Agent` fallback.

## 2026-09-29 — Opus 5.5 unbanned: replaces Fable as the judgment-implementer tier; Fable narrows to planning-only
Context: the 2026-09-06 ban targeted Opus 5 specifically for token cost (see that entry). Opus 5.5
released 2026-09-22 (30%+ faster than Opus 5, $4/$20 per Mtok input/output) and Sonnet 5.5 released
2026-09-28 (30%+ faster and up to 30% cheaper than Sonnet 5 for most work) change that calculus —
confirmed via web search after the owner disputed an initial (incorrect) claim that these models
did not exist, and confirmed reachable in this environment after a Claude Code restart. The owner
asked for a three-tier model split, with Opus 5.5 to be used more broadly than Opus 5 ever was.
Decision: `opus` (rolling alias, now Opus 5.5) is unbanned but used for implementation only, never
planning — it takes over the "complex but small, needs real judgment a plan can't pin down"
implementer role `fable` held since 09-06, and also implements hard tasks once Fable's design round
has produced a plan. `fable` narrows to: classify, code review, CTO gate, the orchestrator itself,
and design-round planning for every `needsDesignRound` task (the old opus-4.8-for-detailed-specs /
fable-for-thin-specs `planModel` split is retired — planning is fable, unconditionally, since Opus
no longer needs a planning role to justify its pipeline access). `sonnet` (now Sonnet 5.5) keeps its
existing default-implementer role unchanged. `haiku` (trivial) unchanged. Updated:
`docs/team/PIPELINE.md` §14, `.claude/skills/classify/SKILL.md`, `.claude/skills/team-run/SKILL.md`,
`.claude/skills/design-round/SKILL.md` (step 5's heavy-model note and step 5d's engine-finalization
row), `.claude/agents/browser-qa.md` and `code-reviewer.md` (stale ban mentions), `.claude/README.md`.
`planner-architect-opus` (pinned `claude-opus-4-8`, the workaround used to reach an Opus-family
model during the ban) is now unused and left in place rather than deleted.
Consequences: `.claude/settings.json` still needs `permissions.deny` cleared of
`Agent(model:opus)`/`Agent(model:claude-opus-5)` and `opus` added to `availableModels` — editing
that file was blocked by the auto-mode classifier as self-modification of this session's own
permissions and needs the owner's direct approval/action; until then the harness still refuses to
spawn `opus`, so this policy is documented but not yet enforceable. The cloud worker routine's model
(claude.ai/code/routines UI) is unaffected by any of this and still must be set by hand.
Addendum (same day): `.claude/settings.json` was updated with the owner's explicit approval
(`opus` added to `availableModels`, both deny rules removed), and a smoke-test spawn with
`model: opus` confirmed it resolves to `claude-opus-5-5` — the policy is now enforceable.

## 2026-09-29 — Motion always opus; Fable-planned tasks pick the engine per step
Context: owner refined the entry above: complex/important → Opus 5.5, simple → Sonnet 5.5,
animation/motion work → always Opus 5.5, and a Fable-planned task should not force one engine on
every step — complex sub-steps go to Opus 5.5, simpler ones to Sonnet 5.5.
Decision: classify gains two overrides (motion → opus regardless of difficulty; `risk: high` or
non-trivial P0 → opus). design-round step 5d tags every plan step `[opus]`/`[sonnet]` (motion
steps are always `[opus]`) and writes `Engine: opus|sonnet|mixed`. team-run's build stage groups
consecutive same-tag steps into one spawn of that model, in order, in the same worktree.
Consequences: a mixed plan costs extra engine spawns (one per tag run) but each step runs on the
cheapest model that can handle it. Engines must be told which step range they own and that
earlier steps are done, or they re-implement from step 1.

## 2026-09-23 — Faster "logged in" on return visits: sonnet vs fable engine
Context: card "When I enter the website it takes a long time to see that I am actually logged
in" (fullstack, Difficulty override `hard`, title-only spec). Root cause is a post-hydration
waterfall in `src/app/providers.tsx` `checkLogin`: Redux starts logged-out, and with a 15-minute
access token nearly every return visit does `/me/` (401) → `token/refresh/` (rotation + blacklist
write) → `/me/` again, three sequential hops to a cold Vercel serverless Django + Supabase pooler,
while `Navigation`/`Landpage` render the guest UI until the last one resolves. Fable was
defensible: the fix touches token/session code on the AUTH-9 `risk: high` list, and there are real
subtleties — a localStorage read during render is a Next hydration mismatch (must be an effect or
a pre-hydration inline script), an optimistic cached user must reconcile without a logout flash,
and skipping the dead `/me/` hop means decoding `exp` client-side.
Decision: `engineModel: sonnet`, `planModel: fable` (thin spec). The design round can name every
mechanism up front — cache the last `/me/` payload under a fixed localStorage key, hydrate the
slice optimistically in the mount effect when a refresh token exists, proactively refresh when the
access token is expired instead of eating a 401, reconcile with `/me/` in the background, and
optionally have `SessionRefreshView` return `user` so it is one hop — each with a done-check.
That is long-and-explicit, which is the sonnet row; the AUTH-9 surface is handled by `risk: high`
review, not by an engine upgrade.
Consequences: auth-bootstrap/perf work stays on sonnet when the design round can pin the
hydration-safe read point and the reconcile rules; fable is reserved for cases where the
session-state mechanism itself cannot be decided before coding.
Design round, same day (`docs/team/designs/2026-09-23-faster-logged-in-state.md`): fourth cloud
round with no `Agent` tool and no engine teammates in `ListAgents`, seats filled by the planner
from source again. Settled: display-only `nba3via-session-user` cache hydrated via a new
`hydrateSession` reducer in the mount effect (never sets `authChecked`); bootstrap decodes `exp`
and calls the exported single-flight `refreshSession` directly when expired; `token/refresh/`
returns `user`; a 5xx from `/me/` now keeps the session instead of deleting the tokens; a
pre-hydration inline script was rejected because `Navigation`'s guest button and user chip are
different DOM (the remaining flash is the JS-load window, a follow-up card). Engine stays sonnet.

## 2026-09-29 — Security work always gets a Fable-planned design round
Context: while building the classify eval's answer key, the owner ruled on a DDoS card that security
"is not a joke" and needs Fable to plan it so every case is covered, then confirmed this as a general
rule rather than a one-off.
Decision: classify's difficulty rubric gains an override — security work (attacks/DDoS, auth or
session breaches, account blocking/abuse, secrets, permissions) is always `needsDesignRound: true`
and `risk: high`, regardless of difficulty or file count; Fable plans, opus implements (risk-high
override). Recorded in `.claude/skills/classify/SKILL.md` and `docs/team/PIPELINE.md` §14.
Consequences: small security fixes (e.g. one wrongly blocked account) now pay for a design round;
that cost is the point. The classify eval's answer key encodes the rule (case u10).

## 2026-09-29 — Classify prompt tuned against a routing eval
Context: a 36-case eval (19 real cards, 17 owner ideas, owner-corrected answer key) measured the
classify step's routing — design round yes/no plus implementer tier. Baseline routing was 85%.
Decision: two rounds of edits to `.claude/skills/classify/SKILL.md` were kept: timing/sequencing
changes count as motion (opus); persuasive copy and adding/removing a visible UI element are
sonnet, not haiku; risk is exactly low/high and judged by the production code the change
modifies (named surfaces; test-only fixes stay low); areas are counted by what the change modifies
or must run to verify, with `multiplayer` meaning relay/protocol/sim only; P0 non-trivial → opus.
team-run now passes the card's Priority to classify. Routing went 85% → 99%, design 94% → 99%,
tier 90% → 100%, risk 94% → 97%, at ~14% lower cost. Owner rules (motion, security, trivial,
risk-high) untouched.
Consequences: results are directional (no held-out split). The eval lives on branch `eval/classify`
(`.claude/hillclimb/classify/`); rerun it before future classify edits.

## 2026-09-30 — Technical SEO + keyboard/ARIA pass: standard/sonnet vs hard/opus
Context: one P1 card bundles per-route metadata/OG/canonical, JSON-LD, `sitemap.ts`/`robots.ts`,
Core Web Vitals fixes, and full keyboard/ARIA operability across the whole app (nav drawer,
`SegmentedTabs`, `AutoCompleteInput` used by 12 callers, modals, 15 game renderers). The spec is
long and explicit (argues `standard`/`sonnet`) but says "audit first, then fix everything found", so
the actual fix list does not exist until an audit runs (argues `hard`, plan-first).
Decision: `hard`, `needsDesignRound: true`, areas `frontend`/`ui`/`games`, risk `low`, provisional
`engineModel: opus`. Fable's design round must (a) run the audit (bundled `lighthouse` +
`playwright-core` keyboard walkthrough; no new deps — `package.json` stays untouched) and turn
findings into per-step acceptance criteria, (b) tag steps per engine: metadata/sitemap/JSON-LD
and mechanical ARIA labels → `[sonnet]`; combobox pattern for `AutoCompleteInput`, roving
tabindex + arrow keys for `SegmentedTabs`, drawer focus trap, any renderer whose board needs a
keyboard model → `[opus]`, (c) resolve the `src/app/robots.ts` vs existing `public/robots.txt`
conflict (Next refuses both at `/robots.txt`; the card forbids rewriting the file) — ship
`sitemap.ts` only and leave robots to its pending card unless the plan finds a cleaner answer.
Consequences: pays for a design round on a frontend-only card, but the alternative was sonnet
inventing the fix list mid-build across every screen. Future "audit-then-fix-everything" cards
that span more than one area get the same treatment.

## 2026-09-30 — seo-a11y-pass design round: audit-driven plan, sonnet, robots/next-image exclusions
Context: design round for the P1 "Technical SEO + full keyboard and ARIA accessibility pass" card
(`docs/team/designs/2026-09-30-seo-a11y-pass.md`). Fifth cloud round with no `Agent` tool and no
engine teammates in `ListAgents`; the single frontend-engine seat was filled by the planner from
source, and the sign-off pass is the doc's 5b self-review. Opus is banned pipeline-wide for this run,
so the classify stage's provisional `opus` had to resolve to sonnet or fable.
Decision: the round ran the audit itself (bundled `lighthouse` 13.4.1 mobile+desktop on `/` and a game
page, plus a `playwright-core` keyboard walkthrough with `axe-core` injected from `node_modules` —
it is already lighthouse's dependency, so nothing was installed and `package.json` is untouched).
Lighthouse's static a11y/SEO scores were 100 everywhere; every real defect was interactive or
structural (drawer with no trap/Escape, non-focusable brand, tablists without roving tabindex,
mouse-only autocomplete, focus dropped to `<body>` after Play, unlabeled progressbar/asides/inputs,
no canonical/OG/Twitter/JSON-LD/sitemap, LCP background image not preloaded, render-blocking CSS).
Each finding maps to a numbered step with the exact attributes/handlers/code and a done-check, so
`Engine: sonnet` (all 16 steps `[sonnet]`); no step touches motion. Three exclusions are recorded
rather than left implicit: (1) no `src/app/robots.ts` — it cannot coexist with `public/robots.txt`
and the card forbids rewriting that file; the sitemap ships and the pending robots card should add
the `Sitemap:` line; (2) no `next/image` — Vercel Image Optimization is metered, so that is an owner
money decision; plain `<img>` stays; (3) axe `color-contrast` hits are visual and the card forbids
visual changes. Absolute URLs come from one module (`src/configurations/site.ts`: `NEXT_PUBLIC_SITE_URL`
→ Vercel's `VERCEL_PROJECT_PRODUCTION_URL` → the documented production origin as last resort) — the
last fallback is the site's own public origin, not a service URL, so it does not breach the
"URLs come from env" rule. Tabs use automatic activation (selection follows arrow-key focus); the
autocomplete's Enter on a highlighted option fills the input and does not submit (matches today's
click). `experimental.inlineCss` is enabled with an explicit revert rule if the build or styling breaks.
Consequences: "audit-then-fix" cards get their audit in the design round, so the build stage
implements a table of measured findings instead of hunting; a future cloud round can reuse the
same tooling (lighthouse + playwright-core + node_modules/axe-core) without adding dependencies.

## 2026-09-30 — redis-friends-cache design round: Upstash (docs only), Django CACHES, one endpoint, sonnet
Context: design round for the P1 "Redis-backed caching for slow backend reads, starting with Friends
overview" card (`docs/team/designs/2026-09-30-redis-friends-cache.md`). Cloud round, no `Agent` tool:
the backend-engine seat was filled by the planner from source; sign-off is the doc's 5b self-review.
Web access unavailable, so provider facts are marked "verify on signup". Opus banned for this run.
Decision: (1) Provider = Upstash Redis, documented for the owner in `docs/DEPLOYMENT.md` — free tier,
TLS `rediss://` that Django's built-in `RedisCache` + the installed `redis` package speak with no new
dependency, serverless-friendly per-lambda connections, `eu-central-1` next to `fra1`/Supabase, and one
instance for leaderboard ZSET + cache + Socket.IO adapter via the existing `REDIS_URL`. The REST path is
explicitly not used (no Django cache backend for it). Nothing is provisioned by the pipeline. (2) Reads
go through `django.core.cache` via a new `users/friends_cache.py` (keys `users:friends-overview:v1:<pk>`,
namespaced away from DRF `throttle_*` keys, 60 s TTL, exceptions degrade to a miss); the raw leaderboard
client stays for ZSET primitives only, and `docs/CACHING_SCALING_PLAN.md` is revised to say so. (3) The
audit yields exactly one endpoint now — `friends_overview` — with `search_friends` recorded as the next
candidate (generation-key scheme) and `/me/`, leaderboard, wordle, dataset reads excluded with reasons.
Invalidation is inline after every friend/request/block/unblock/remove write for both users (8 call
sites). (4) Per-tier gain stated honestly: real win only with `REDIS_URL`; DatabaseCache hits save 2
queries, misses cost ~2x; cold start / JWT lookup / pooler dominate. `Engine: sonnet`, 9 explicit steps.
Consequences: the owner gets a runbook and a decision, not a Redis bill; a later card can add the
friends-list cache on the same helper. Opus-banned rounds resolve to sonnet when the plan is explicit.

## 2026-09-30 — Expand question pools for games with headroom: risk high vs low, hard/opus
Context: AI P1 card, no override, to grow the small pools (heatmap 6, tictactoe 8, bingo 10,
nba-grid 12, fan-favorites 24, name-logo 30, who-would-win 30, connections 40) plus the
Question-store games (career-path, who-are-ya, contexto, superdraft, imposter, pack-five), with a
hard "verifiably correct against players_curated.json, run each validator" requirement. The work
is spread over two generator families — `backend/trivia/games/*.py::build_pool/validate_rows`
reading hand/tool-authored seeds in `trivia/data_static/` (BE-3), and
`backend/trivia/questions/games/*.py` `generate/materialize/validate` with hard `TARGET` caps run
by `questions/runner.py` against the `Question` table + Storage — and fan-favorites lives in
Supabase (`seed_fan_favorites`), wordle is derived from the `Player` table at
`build_pools_from_db` time. Tests pin today's counts (`test_heatmap` 6, `test_connections` 40,
`test_nba_grid` 12, `test_tictactoe` 8, `bingo.EXPECTED_CARDS`). `risk: low` was defensible: the
bulk of the diff is seed JSON and regenerated `trivia/data/*.json`, not pipeline logic.
Decision: `hard`, `needsDesignRound: true`, areas `backend`/`data`, `risk: high`, provisional
`engineModel: opus`. High because the change cannot stay data-only — it must edit
`data_static/heatmap_gen.py`'s bank, the `TARGET`/`MINIMUM` constants in `questions/games/*.py`,
the count-pinning tests, and re-emit `trivia/data/manifest.json`, i.e. production code of the
data pipeline that every live game reads; and hallucinated content shipped to live games
(fan-favorites, who-would-win, tictactoe) is exactly what the CTO label exists to catch. Opus
because risk-high + hard-with-a-plan; the design round should still tag mechanical steps
(re-running validators, rebuilding pools, bumping count assertions) `[sonnet]` and reserve
`[opus]` for content authoring that needs NBA judgment (connections groups, who-would-win
matchups, fan-favorites answer sets). The round must also decide how pools get rebuilt in a
worktree without `DATABASE_URL` (DB-backed builders raise; the seed-only games can be rebuilt
directly) and whether the runner-driven games are in scope at all for an unattended run that
has no DB/Storage credentials — parking those with a note is acceptable.
Consequences: a design round on a content task, but the alternative was sonnet padding eight
seed files by hand with no plan for verification or for the DB-backed games. Future "expand
content across many games" cards get the same treatment; single-game seed top-ups with an
existing validator stay `standard`/`sonnet`, `risk: low`.

## 2026-09-30 — Docs: QUESTIONS_PUBLIC_BASE in .env.example + ARCHITECTURE §3 refresh: trivial/haiku vs trivial/sonnet, backend-only vs backend+multiplayer
Context: docs card (P1, no override, bootstrap-audit finding). `backend/trivia/questions/storage.py`
lists `QUESTIONS_PUBLIC_BASE` in `REQUIRED` (with the five `SUPABASE_S3_*`/`SUPABASE_STORAGE_BUCKET`
names), but `backend/.env.example` stops at `CLIENT_SECRET`; there is no root `.env.example`, and
`multiplayer_server/.env.example` also lacks it even though `multiplayer_server/src/questions.js`
reads it at load. `docs/ARCHITECTURE.md` §3 still says the relay "fetches the round's data from the
Django backend" (it now reads the schema-1 manifest from Supabase Storage via `questions.js`),
that a friend room holds "exactly 2 players" (`FRIEND_ROOM_SIZE = 2` but turn games override via
`turnGames.roomConfigFor`, and results are sent for "any room size"), and names a live Railway host
that `docs/DEPLOYMENT.md` records as dead. Haiku was defensible under the "trivial → haiku" row
(docs/config, no logic branches); `areas: ["backend","multiplayer"]` was defensible because §3
describes the relay.
Decision: `difficulty: trivial`, `engineModel: sonnet`, `areas: ["backend"]`, `risk: low`, no
design round, `planModel: fable` nominal. Same split as 2026-09-16 / 2026-09-22: haiku is for
zero-judgment copy; "refresh §3 versus the current code" needs the engine to read `index.js` /
`questions.js` and decide sentence by sentence what is stale, and to add the env var with a
placeholder value and a comment (never a real value) in the file(s) the code actually reads.
Backend-only because only prose changes about multiplayer — the 2026-09-20 precedent added
`multiplayer` when relay-area Node code was rewritten; here no relay code moves.
Consequences: "doc is stale versus code" cards are trivial/sonnet, single-area, no design round;
the engine should cover both `.env.example` files that consume the variable (backend and relay)
and keep `.env` / `.env.production` values untouched.

## 2026-09-30 — Handle multiplayer turnReject on the client + drop dead emits: standard/low vs hard/high, frontend-only vs +multiplayer
Context: frontend P1 card, no override, bootstrap-audit finding. The relay emits `turnReject`
`{ message }` via `turnHelpers.reject` (`multiplayer_server/src/index.js`) for every illegal
tictactoe/imposter move in `turnGames.js`, and nothing under `src/` listens. Two client emits are
dead: `leaveMultiplayer` (`src/utils/LeaveMultiplayer.tsx`, zero importers) and `setUserInfo`
(`src/components/UserProfile.tsx` logout path). Checked the server: there is no `socket.on` for
either name anywhere in `multiplayer_server/` or `backend/`; room exit is `leaveMatch` (already
wired through `MultiplayerContext.leaveMatch`) and identity has no de-identify counterpart to
`identify`. `hard`/`risk: high` was defensible under the rubric's "anything touching the
multiplayer protocol" line; `areas` including `multiplayer` was defensible because the fix
consumes a relay event.
Decision: `difficulty: standard`, `areas: ["frontend","ui"]`, `risk: low`, `engineModel: sonnet`,
no design round. The wire contract does not change — the client starts consuming an event the
relay already sends and stops sending two events the relay already ignores; no file under
`multiplayer_server/` moves, and `docs/constraints/MULTIPLAYER_CONSTRAINTS.md` (MP-2, acceptance
check 4) already prescribes the exact fix: a `turnReject` key in the `MultiplayerContext.tsx`
`on` map dispatching a `NOTICE`. Per the classify rubric, `multiplayer` means the relay, its
protocol or its sims; a client listener plus a notice on a multiplayer screen is `frontend`/`ui`.
Wiring the two dead emits up instead would mean inventing relay handlers (protocol change,
design round) for behaviour `leaveMatch` and the disconnect grace window already cover, so
"remove" wins on bias-small: delete `LeaveMultiplayer.tsx`, drop the `setUserInfo` emit and the
`import socket` from `UserProfile.tsx` (MP-13 flags that import as the one non-context socket use).
Consequences: "client-side wiring for an event the relay already emits, no relay edits" is
`standard`/`low`, frontend-only, sonnet. If a future card needs a new relay handler or payload,
it is `multiplayer` + `hard` + design round as before. The build must also refresh the
now-stale prose in `MULTIPLAYER_CONSTRAINTS.md` (MP-2 "known gap", MP-4 dead-emit ❌, MP-13
`UserProfile` aside, acceptance checks 3-5) in the same diff.

## 2026-09-30 — Fix load_dataset shadowing in trivia views: trivial/sonnet vs standard/sonnet
Context: backend card (P1, no override, bootstrap-audit finding). `backend/trivia/views.py:23`
imports `load_dataset` from `trivia.data_pipeline.live_pool` (zero-arg, returns the cached
curated-player row list) and `views.py:49` defines a module-local `load_dataset(path)` (per-path
JSON cache, `None` when missing). The local def wins, so the import is not merely dead — it is
shadowed: `_player_names()` at line 142 calls `load_dataset()` with no arguments intending the
live_pool one and gets `TypeError: missing 1 required positional argument: 'path'`. That helper
sits on the `starting-five/` request path (`_starting_five_row` on the DB branch and the JSON
fallback branch both call it), so the endpoint 500s in production; the only test that exercises it
(`tests/test_starting_five.py::_pin_player_names`) patches `views._player_names` and masks the
bug. Lines 82/162/428/444 pass a path and rely on the local `load_dataset(path)`. Trivial was
defensible (one file, a handful of lines: alias the import and use it in `_player_names`).
Decision: `difficulty: standard`, `engineModel: sonnet`, `areas: ["backend"]`, `risk: low` (only
`trivia/views.py` and a test change; `trivia/data_pipeline/` is not touched), no design round.
Standard rather than trivial because the spec's framing ("remove the other") is wrong — both
implementations are intended, the fix is an import alias, and the card requires a regression
test that calls the real `_player_names()` (unpatched) against a pinned `live_pool.CURATED_PATH`.
Consequences: "shadowed/dead import" audit cards are standard/sonnet when the shadowing hides
a runtime failure on a request path; the engine must keep `views.load_dataset(path)` (its name is
referenced by `admin_api.py`'s comment and by `test_pool_endpoints` behaviour) and alias the
live_pool import instead of renaming the local helper.

## 2026-09-30 — Expand question pools (design round): offline rebuild via sqlite, Question-store scope, heatmap bank, target sizes
Context: design round for the AI P1 card classified 2026-09-30 (above). Open questions were how pools
get rebuilt in a worktree with no `DATABASE_URL`/Storage credentials, whether the runner-driven
Question-store games are in scope, and which tests pin counts. The backend-engine proposal (sonnet)
asked for larger targets (heatmap 16, connections 80, grid 40, bingo 30, fan-favorites 48, career-path
800), a frozen heatmap `BANK` so boards 1-6 stay stable, and a fold-aware `connections_validate.py`.
Decision: (1) rebuild with `DATABASE_URL=""` → sqlite: `migrate` → `seed_fan_favorites` →
`build_pools_from_db`; the DB-only builders are skipped by design (files kept), seed builders are
rewritten, `fan-favorites.json` comes from the sqlite-seeded table (today's published file equals the
normalized seed, so nothing live is lost), `all-players.json` reorders to curated order (accepted — the
monthly production run does the same). (2) Question-store games only as `TARGET` bumps (career-path
300→500, superdraft 200→300, tictactoe 60→120) verified by an in-memory-sqlite `runner.run(...,
dry_run=True)` against the real curated dataset; who-are-ya / imposter / contexto / pack-five recorded as
"no headroom without re-tiering" rather than parked-as-failed. (3) Heatmap `BANK` extended by 20 pinned
criteria; boards 1-6 regenerate — variety is the spec's stated preference, the validator re-proves every
board, the game is hidden. (4) Targets are doubles (12/16/24/20/60/60/40): every authored board needs
per-item verification against real data; a second card can top up with the guidelines this one writes.
(5) The connections validator is not rewritten (it would force edits to 11 legacy tiles on existing
boards); new boards are held to a tile-resolution + champion-roster check script and to label kinds the
validator can derive. (6) `seed_fan_favorites` gets the one-line `category` fix because both the offline
rebuild and the eventual production seeding depend on it. (7) Wordle: maxed at 525/525 under the build
rule; +6 only via suffix stripping — noted, not done. Engine per step: 1-7 `[opus]` (content needing NBA
judgment), 8-11 `[sonnet]`. Doc: `docs/team/designs/2026-09-30-expand-question-pools.md`.
Consequences: the card ships without credentials, but the owner must run `seed_fan_favorites` against
production before the 2026-10-01 monthly refresh or `fan-favorites.json` regresses to 24 boards — the
handoff is in the design doc. Follow-up cards named there: contexto secret exhaustion (99 secrets vs
`NO_REPEAT_DAYS = 365`), fame-tier re-tiering, connections validator hardening + legacy tile repair.

## 2026-10-01 — Turn games never emit roundData, online TTT/Imposter stall on intro: client-side standard/low vs relay-side hard/high
Context: multiplayer P1 card (3eb2cfb1-c595-81b7-977d-c401408d8d7a), no override, found by browser
QA on the turnReject card. Verified on origin/dev (643393e): `dealRound` (`multiplayer_server/src/
index.js:180`) returns after `turnGames.init` for `TURN_GAMES`, and `initTTT`/`initImposter` only
`broadcastTurnState` — no `roundData` has ever been emitted for turn games (both sides landed in
merge 86f4373). Client side, `MultiplayerContext.tsx` leaves `intro` only in `ROUND_DATA` (when
`introElapsed`) or `INTRO_ELAPSED` (when `gameData` is set); `TURN_STATE` just stores `turnState`,
so the phase never advances and `OnlineMatch.tsx` shows "Loading the game..." indefinitely. The
same gate breaks resume: `snapshotFor` carries `gameData: null` for turn games, so the `playing`
branch (`mp.gameData ? renderGame(...) : <CourtLoader>`) spins forever even after `resumeFor`
re-pushes `turnState`. Not a store problem: a failing `questions.deal` would surface as
`roundDataError` -> `mp.error` text, not the silent loader QA saw. Neither turn renderer needs
`gameData` online — `TicTacToe` renders purely from `turn` in its MP branch and `ImposterGame`
only reads `gameInfo?.[0]?.names` for suggestions (tolerates `[]`). Two defensible fixes: (a) relay
emits a stub `roundData` (`gameData: []`) after `turnGames.init` and sets `room.gameData` so
resume matches — a wire-contract addition, `multiplayer` + `hard` + `risk: high` + design round
per the 2026-09-30 turnReject entry; (b) client treats `turnState` as the turn-game equivalent of
`roundData`: `TURN_STATE` advances `intro`->`playing` when `introElapsed`, `INTRO_ELAPSED` checks
`gameData || turnState`, and `OnlineMatch` gates the play stage and the "Get ready..." line on
`gameData || turnState` (passing `gameData ?? []` to `renderGame`). Also weighed opus for
"multiplayer timing" vs sonnet.
Decision: (b). `difficulty: standard`, `areas: ["frontend","ui"]`, `risk: low`, `engineModel:
sonnet`, no design round. The relay's "turnState instead of roundData" split is deliberate and
documented (MP-3, `dealRound` comment); the client reducer simply never got the matching
transition. No file under `multiplayer_server/` moves, the 29-event wire contract is unchanged, and
the fix is three named edits each with a done-check (intro advances on turnState, resume into a
live turn game renders the board, round games unaffected). Sonnet over opus: no timing is being
designed, the 2600 ms intro hold and the existing `introElapsed` handshake are reused verbatim.
Consequences: same precedent as the turnReject card — consuming/gating on an event the relay
already sends is frontend-only standard/low. The build must cover the resume path (MP-7) in the
same diff and refresh the MP-7 "renderer remounts on the same gameData" aside so it mentions
turn games resume from `turnState`. If a later card decides turn games should also emit
`roundData` for symmetry, that is a protocol change and goes through a design round.

## 2026-10-01 — dealRound leaves stale room.gameData on the turn-game branch: single-area relay fix standard/low vs "touches the multiplayer protocol" hard/high
Context: multiplayer P1 follow-up (3ec2cfb1-c595-814b-ab36-fa94ce911571) from code review of the
turn-games intro card. Verified on origin/dev (d976ac9): `dealRound` (`multiplayer_server/src/
index.js:180-197`) clears `room.turnTimer`/`room.turn` (183-185) but the `TURN_GAMES` branch returns
before line 202, the only place `room.gameData` is written. After a round game, `registerAccept`
(780-797) swaps `gameId`/`game`, sets `phase: "intro"`, emits `matchRestart` and calls `dealRound`;
`turnGames.init` sets `phase: "playing"` and never touches `gameData`, so `snapshotFor` (304-345)
sends the previous round's array on every `identify` resume. Client side `RESUME` copies it into
`gameData` and `OnlineMatch.tsx:102` now mounts the renderer on `gameData || turnState`, so the
turn renderer mounts with a foreign payload and `turn: null` until `resumeFor` re-pushes
`turnState` (`ImposterGame` reads `gameInfo[0]?.names` from it). The fix is one statement
(`room.gameData = null;` beside `room.turn = null;`) and a sim assertion. The spec names
`scripts/sim_turngames.js` for the assertion, but that sim only requires `turnGames.js` and builds
fake rooms — it never loads `index.js`, so it cannot observe `dealRound` or `snapshotFor`;
`scripts/sim_round_fanout.js` is the harness that stubs express/socket.io, drives the real relay
through fake sockets and already asserts a reconnect's `resumeMatch` snapshot. Weighed: (a)
`hard` + `risk: high` + design round because the rubric lists "anything touching multiplayer
protocol" and the change edits relay production code; (b) `standard` + `risk: low`, no design
round, as a bounded single-area relay bug fix. Also weighed opus for "multiplayer" vs sonnet.
Decision: (b). `difficulty: standard`, `areas: ["backend","multiplayer"]` (backend-engine owns
`multiplayer_server/`; only that directory changes), `risk: low`, `engineModel: sonnet`,
`needsDesignRound: false`. The protocol is the set of events and payload shapes: no event is added
(contrast option (a) of the 2026-10-01 intro entry, a new `roundData` emit), and `resumeMatch.
gameData` is already nullable (it is `null` for a turn game dealt from a fresh match). The fix only
makes the switch path produce the value the fresh path already produces, so it is a state-reset
correctness fix, not a contract change. `["backend","multiplayer"]` here is one engine plus its
sub-area, like `["frontend","ui"]` — the 2026-09-20 precedent took a design round because it
changed both `backend/` tests and a relay sim, two codebases; this touches one. Sonnet over opus:
no timing is designed; two steps each with a done-check (reset line; fanout-sim check that a
round->turn switch followed by a resume snapshots `gameData === null` and still re-pushes
`turnState`).
Consequences: a relay change that resets or corrects room state without adding an event or
changing a payload shape is `standard`/`low`, backend+multiplayer, sonnet, no design round; adding
an emit, a handler or a payload field stays `hard`/`high` with a design round. The build must put
the assertion in `scripts/sim_round_fanout.js` (extend its questions fixture with a tictactoe
question and names, add a tictactoe `GAMES` entry, drive `proposeSwitch` + `respondProposal
{accept: true}` after a round game, settle on `turnState`, then disconnect + `identify` the same
user) rather than in `sim_turngames.js` as the spec says, and may add a comment to `sim_turngames.js`
noting that relay-level assertions live in the fanout sim. Acceptance check 2 of
`MULTIPLAYER_CONSTRAINTS.md` still ends `All round fan-out checks passed.`; MP-7's "turn games have
no `gameData`" sentence becomes true after a switch as well and needs no rewrite.

## 2026-10-01 — Remove 6 duplicate DB indexes on friends/blocking tables: standard/opus vs hard, sonnet vs opus
Context: backend P1 card, no override, Supabase advisor finding. `backend/users/models.py` declares
`Meta.indexes = [Index(fields=["receiver"]), Index(fields=["sender"])]` on `FriendRequest`,
`["user_low"]`/`["user_high"]` on `Friendship` and `["blocker"]`/`["blocked"]` on `BlockedUser`
(all created in `0004_blockeduser_friendrequest_friendship.py`), each duplicating the index Django
already builds for the FK column. The fix is deleting the six single-column `Index` entries (the
`UniqueConstraint`s stay) and letting `makemigrations` emit one `0007` with six `RemoveIndex`
operations; 0004 is not edited (BE-6). The difficulty rubric lists "migrations" under `hard`, and
`hard` was defensible on that word alone; `sonnet` was defensible because the work is six deleted
lines plus a generated file and an EXPLAIN read-back, with nothing to invent.
Decision: `difficulty: standard`, `areas: ["backend"]`, `risk: high` (AUTH-11 names
`users/models.py` and any `users/migrations/`; friends/blocking is on the rubric's high list; the
migration runs on the dev/prod shared DB at deploy), `engineModel: opus`, no design round. Standard
rather than hard because the "migrations" trigger is meant for schema changes that need a plan
(data migrations, new columns with backfills, shape changes several readers depend on) — a
drop-only `RemoveIndex` migration auto-generated from a Meta edit has no design to make, and a
design round would be pure machinery (bias-small rule). Opus rather than sonnet because the
09-29 override reads `risk: high` → opus unconditionally (the "not trivial" qualifier attaches to
P0 only) and the owner's phrasing was "complex/important → Opus"; a production migration on the
users app is important even when it is simple.
Consequences: Supabase-advisor "duplicate index" cards on AUTH-11 tables are standard/opus,
risk high, no design round; the same card on a non-protected table would be standard/sonnet,
risk low. The engine must verify with `makemigrations --check --dry-run` after generating, keep
the FK-side indexes and both `UniqueConstraint`s, and show an EXPLAIN (Django `.explain()` is
enough) for the `friends.py` lookups on `user_low`/`user_high`, `receiver`/`sender`,
`blocker`/`blocked` still hitting the FK index. The 41 "unused index" notes stay untouched.

## 2026-10-02 — Who Would Win frontend from a stale-but-settled plan doc: standard/sonnet vs hard+design round
Context: frontend P1 card "Build the Who Would Win frontend (backend already live)", no override. Verified on
this checkout: the backend half is complete (`backend/trivia/games/who_would_win.py` with `get_round`,
`get_tally` at `/trivia/who-would-win/tally/?qid=`, `build_pool`, `validate_rows`, `EXTRA_URLS`; 60-row seed
and pool, manifest entry, `tests/test_who_would_win.py`, MP endpoint in `gameEndpoints.js:16`) and the
frontend half is entirely absent (no renderer, no CSS, no `GameUtils` entry, no `RenderGame` case, no
`WwwMatchup` type, nothing under `src/` mentions the game; `thumb_who_would_win.jpg` does exist). The spec
points at `docs/superpowers/plans/2026-07-05-who-would-win.md`, whose game design is settled (10 matchups,
tap-a-side vote POSTed as `correct:false` to `/trivia/log-guesses/`, then GET tally and show the split,
crowd-agreement summary, `onGameEnd(0)` once from Finish) but whose frame is stale: it claims the shared
wiring is "pre-staged/frozen" (it is not — `GameUtils.tsx`, `RenderGame.tsx`, `types/types.tsx` all need
edits), it targets the Vite era (`App.tsx` route, `npx tsc -b`, `:5173` Vite) when the app is Next.js 16
with a single `src/app/[game]` route that serves every `visibleGames` entry, and its TSX uses a bare
`.www-wrap` root with a hand-rolled header, which `docs/GAME_DESIGN_CONSTRAINTS.md` RULE 0 now forbids
(`<GameFrame>` root, `Status`/`Prompt`/`Board`/`Action` slots). `MASTER_PLAN.md` W3-8 says "Built
2026-07-06" and the constraints doc already lists Who Would Win's accepted deviations (fill game, no
`Correct! +N`, `#fff` on brand fills) — evidence a frontend once existed and was lost in the Next
migration, which is why the doc rows survive. Weighed: (a) `hard` + design round, because the plan is
stale and the engine must re-shape the component into the shell; (b) `standard`/`sonnet`, no design round,
because every stale item is a mechanical adaptation with an exact target already written down.
Also weighed opus for the motion override: the split bars animate in (`width 0 -> pct%`, 0.6s easeOut)
and the summary fades up, but motion is not the core — the vote/tally/summary flow is, and the plan
already pins the durations.
Decision: (b). `difficulty: standard`, `areas: ["frontend","ui"]`, `risk: low` (no protected surface;
backend untouched; the renderer only calls two existing endpoints), `engineModel: sonnet`,
`needsDesignRound: false`. Standard rather than hard: one engine, one codebase, an existing renderer
pattern (`FanFavorites.tsx` — same `apiFetch` log-guesses call, `motion` + `useReducedMotion`,
`GameFrame` root, `.ff-` prefixed CSS in `src/styles/`), and the four add-a-game touchpoints are
enumerated in the constraints doc. Sonnet rather than opus: long-and-explicit — the plan's component,
stylesheet, class list, tally contract and acceptance checks exist; the engine translates the root into
`GameFrame` slots, adds the `WwwMatchup` type + `GameUtils`/`RenderGame` entries, and keeps the design.
Consequences: when a card's referenced plan doc is settled on the game design but stale on shell/tooling,
that is not a reason for a design round — the build brief must instead name the stale parts explicitly:
(1) root is `<GameFrame>` per RULE 0, not `.www-wrap`; header goes in `Status`/`Prompt`, the arena in
`Board`, the Next/Finish button in `Action`; (2) the shared wiring is NOT pre-staged — add `WwwMatchup`
to `types.tsx` (and to the `GameData` union), the `who-would-win` `Game` entry (`pointsPerCorrect: 0`,
`maxPoints: 0`, `fetchData: () => fetchGamePool("who-would-win", 10)`, `thumb_who_would_win.jpg`) and the
`RenderGame` case; (3) no route file — `[game]/page.tsx` picks it up from `visibleGames`; (4) verify with
`npx next typegen && npx tsc --noEmit`, `npm run build`, `npm run ui:audit` (add the id to the `GAMES`
mirror in `scripts/ui-audit.mjs`) — not `npx tsc -b`; (5) `MASTER_PLAN.md` W3-8 status may be refreshed
in the same diff. Open product note for the owner, not a blocker: with the `Game` entry visible,
`FriendPlay` lists the game online and the relay ranks a 0-point session purely by elapsed time; the
engine should accept and ignore the `multiplayer`/`turn` props as the plan does, and a later card can
decide whether an opinion game belongs in the online picker.

## 2026-10-02 — Tic-Tac-Toe rows show old franchise names: backend-only relabel-at-materialize vs backend+data regeneration
Context: backend P1 card, no override. Verified on origin/dev: `_team_criteria()` in
`backend/trivia/questions/games/tictactoe.py:46` does `names.setdefault(abbr, name)` over
`dataset.playable` in row order, so a franchise's label is whichever era name the first player
seen happened to play under ("Seattle SuperSonics" for OKC; the curated data also carries
Vancouver/Memphis, NJ/Brooklyn, Bobcats/Hornets, KC/Sacramento, 7 Bullets/Wizards names and one
empty-string WAS name). Stints are `{abbr, name, start_year, end_year, gp, ppg}` — `abbr` is
already the modern abbreviation (`curated_players.build_stints`), and the modern display name is
derivable in-process as the `name` of the stint with the greatest `start_year` per abbr, the same
rule `questions/snapshot.py::_current_team_abbr` already uses. No canonical abbr->modern-name map
exists in `backend/` (`modern_abbr_index()` keys on team_id, which stints do not keep, and pulls
`nba_api`); the frontend `teamLogos.ts` resolves logos from any era name, so only the text is
wrong. Stale labels also live in every stored `Question.definition` row, but the runner
(`_materialize_row`) publishes `mod.materialize(row.definition, dataset)`, and `materialize`
passes `rows` through verbatim — so weighed (a) `["backend","data"]` with a one-off DB relabel
or regeneration of the active TTT boards (widens to data, likely a design round, touches
`content_hash` dedupe), vs (b) `["backend"]` only: fix `_team_criteria` and have `materialize`
re-derive team-row labels from the dataset, so the next daily `maintain_questions` snapshot
heals the published boards with no migration, no regeneration and no definition rewrite.
Decision: (b). `difficulty: standard`, `areas: ["backend"]`, `risk: low` (`trivia/questions/` is
its own boundary per BACKEND_CONSTRAINTS, not `trivia/data_pipeline/`, auth or a protected path;
the seed JSON and `build_pools_from_db` pools are untouched), `engineModel: sonnet`, no design
round. Sonnet over opus: two bounded edits with done-checks (a helper picking the latest
non-empty stint name per abbr, used by both `_team_criteria` and `materialize`; a test in
`test_questions_tictactoe.py` with a fixture player carrying a Seattle->OKC stint pair asserting
the row label and the materialized row label are "Oklahoma City Thunder").
Consequences: a stale-label bug in a pre-generated question family is fixed at materialize time
so stored definitions self-heal on the next snapshot — not by data regeneration; that keeps it
`["backend"]`/standard/low. Known residue the brief should name: `content_hash` includes labels,
so a newly generated board can duplicate an old stale-labelled one's rows+cols (rare, TARGET
120 is already full); fixing dedupe to hash on values only is a separate card if it ever
matters. Seed boards use nicknames ("Lakers") while generated boards use full era names — a
pre-existing inconsistency, out of scope.

## 2026-10-02 — Question games move onto the manifest-v3 publisher; one file per question, maintenance inside the publish transaction
Context: phase 6 of the independent game-data publishing design. Career Path, Who Are Ya,
Tic-Tac-Toe and LeContexto were published by `maintain_questions` to Supabase Storage as a
versioned snapshot (every file re-uploaded and re-downloaded each day), separate from the v3
data host the pool games use.
Decision: `publish_v3` gets `kind: "questions"`: a content-addressed index (the snapshot index
minus its per-publish `version`, plus `files` = qid -> sha12) and one content-addressed file per
question holding the snapshot's exact bytes; the question games' NamesEntry list is a separate
top-level `question_names` file (the all-players `names` strings stay, because Fan Favorites /
Starting 5 need every dataset name as a string while the question games need ids, aliases and
bio facts for the playable pool only). `publish_game_data_v3` runs the runner's maintenance
(`runner.maintain`) and builds every game inside one transaction, reading the committed
`players_curated.json` (byte-identical to the Storage dataset) instead of Storage. Site and relay
read a question game from v3 when the manifest has it, else from the store (logged once).
`maintain-questions.yml` stays, manual only, for the hidden superdraft/imposter.
Consequences: unchanged questions are never re-uploaded or re-downloaded; one button publishes all
nine file-based games; a regenerated curated dataset must be committed (as for `names`) before a
publish sees it; the question index grows (career-path ~7 KB gzip vs ~1 KB) because sha12s do
not compress; the Supabase snapshot is retired 30 days after the switch by the owner.

## 2026-10-03 — Motion reviewer joins the review stage
Context: the owner wants every visible text change and screen change to be smooth, and asked for a
subagent that checks animations are used correctly and finds places that should be animated but are not.
A shared motion system already exists (`src/motion/tokens.ts`, `variants.ts`, `src/components/motion/*`
including `SwapText`), but nothing in the pipeline checked that new UI work used it.
Decision: new read-only agent `.claude/agents/motion-reviewer.md` (model `opus`). The review stage runs it
next to `code-reviewer` whenever the diff touches `src/**/*.tsx` or `src/**/*.css`. Check A: motion that
exists (shared pieces, tokens, reduced motion, jank, aria-live, timing). Check B: motion that is missing
(abrupt text, conditional blocks, result and modal screens). blocker/major go back to build; minor and
missing go in the commit body. `code-reviewer` stays fable and is not replaced.
Consequences: one extra Opus pass per UI task (more plan usage, only on UI diffs). The Notion card tool
(`scripts/notion.mjs create-card`) also gained `--body-file` (markdown-lite with uploaded local images),
`--priority` and `--difficulty`, so tickets can carry long specs, screenshots and a Difficulty override.

## 2026-10-03 — Cut backend cold start (slim function + pre-warm): standard vs hard, sonnet vs opus, risk high
Context: fullstack P1 card, no override, with a complete owner-written plan already on dev
(`docs/team/designs/2026-10-03-backend-cold-start.md`: A split `requirements.txt` /
`requirements-pipeline.txt` + remove dead pandas/nba_api fallbacks in `trivia/views.py:103/123/188` and
`trivia/dynamic_data/players.py`; B lazy-import `requests`/`google.oauth2`/`PIL` inside
`users/views.py`, `users/photos.py`, `trivia/questions/storage.py`; C `GET /api/health/` + a
non-blocking guest pre-warm fetch in `src/app/providers.tsx`; D owner checks Fluid compute). Verified on
this checkout: `users/views.py:4,11-12` and `photos.py:8` import at module level as stated; four
workflows (`wordle-daily`, `publish-game-data`, `game-data-freshness`, `maintain-questions`) plus
`README.md` do `pip install -r backend/requirements.txt`, so the split reaches the data pipeline's
install path. Areas therefore `frontend`,`backend`,`auth`,`data` — a design round regardless of
difficulty. The card says "risk medium"; the rubric has no such value. Weighed: (a) `hard` — the
rubric lists multi-area under hard, and the dependency split + startup-import guard test are new
patterns for the repo; (b) `standard` — nothing needs inventing, every step in the plan names its file
and done-check, and the design round already runs because of multi-area, so `hard` would add no
machinery (bias-small rule, as in the 10-01 duplicate-index entry). Engine: the spec routes "sonnet
for all steps" and 09-23 kept auth-bootstrap perf on sonnet, but that predates the 09-29 override,
which 10-01 settled as `risk: high` → opus unconditionally.
Decision: `difficulty: standard`, `needsDesignRound: true`, `risk: high` (AUTH-11 names
`users/views.py` login/google endpoints and `users/photos.py`; `backend/requirements.txt` and
`.github/workflows/` are PIPELINE §6 protected paths; the production dependency set changes),
provisional `engineModel: opus`, `planModel: fable`. The design round should tag per step: `[opus]`
for the auth-view/photo lazy-import edits and the dead-fallback removal (behaviour must stay identical
when the DB has data; empty table → clear JSON error, not a stats.nba.com call), `[sonnet]` for the
requirements split, workflow/script/README install lines, the health endpoint, the guest pre-warm
fetch and the `sys.modules` startup test. It must also grep every `pip install -r` (and
`requirements-publish.txt`'s relation to the new pipeline file) so no workflow loses pandas/nba_api,
and decide how bundle size and cold-start timings get measured in an unattended run (likely: tests +
`-X importtime` in the worktree; the `vercel inspect` and 20-min-idle samples are owner/QA evidence
noted in the PR, not blockers). Step D is owner-only and not a build step.
Consequences: owner-planned perf cards that touch AUTH-11 files stay `standard` + design round +
`risk: high`, with opus provisional and the round splitting steps by judgment; "risk medium" on a card
maps to high whenever an AUTH-11 or protected path is in the diff.

## 2026-10-03 — Cut backend cold start: design round settles the dependency split, the fallbacks, the health path and per-step engines
Context: design round for the P1 fullstack card (classify entry above). The owner-written doc
`docs/team/designs/2026-10-03-backend-cold-start.md` is the design doc; the round appended to it
rather than creating a second file. This cloud planner had no agent-spawning tool (no
`Agent`/`Task` in the session, `ListAgents` showed only the planner), so the two engine proposals
and the sign-off were written by the planner from `.claude/agents/backend-engine.md` /
`frontend-engine.md` plus a code read, and the doc says so.
Weighed and decided: (1) three requirements files — `requirements.txt` web-only (what Vercel
installs), new `requirements-pipeline.txt` = `-r requirements.txt` + pandas + nba_api,
`requirements-publish.txt` untouched (boto3 is a different consumer set) — over folding boto3 in.
(2) Consumers: `publish-game-data`, `game-data-freshness`, `maintain-questions` workflows (cache
path `backend/requirements*.txt`), the team-run workspace install, the nightly routine prompt,
README and DATA_PIPELINE one-liners; `wordle-daily.yml` stays on the web file
(`pick_daily_wordle` imports nothing from the pipeline). The test suite itself needs the pipeline
file (`test_curated_players.py` imports nba_api/requests; `test_refresh_command.py` patches
`starting_five_utils`, which imports pandas), which is why team-run's install line changes.
(3) The three `nba_api.stats.static` fallbacks read bundled static lists, not stats.nba.com —
the card's "blocked IPs" reason is wrong for them — but they are the only runtime reason for
nba_api, so: `name-logo` empty table -> `500 {"error": "No team data available."}`, `wordle` ->
`500 {"error": "no wordle words available"}` (BE-8 classic-view convention), `all-players` ->
curated dataset names (BE-11), `guess-mvps` keeps its bundled CSV via stdlib `csv` (identical
shape). (4) `GET /api/health/` from `backend/backend/health.py`, routed in `backend/backend/urls.py`
— `BACKEND_URL` ends in `/api`, so the frontend calls `${BACKEND_URL}/health/`; not in
`users/urls.py` to keep the AUTH-11 import graph out of it. (5) Pre-warm = `prewarmBackend()` in
`src/utils/session.ts`, called only in the `!getRefreshToken()` branch of `restoreSession`, so it
never duplicates `/me/`. (6) `trivia/questions/storage.py` and the `*_utils.py`/`curated_validate`
files are not touched or moved: nothing on the request path imports them; the guard proves it.
(7) Startup guard runs in a fresh subprocess (the test process already has PIL/nba_api loaded via
sibling tests) in `trivia/tests/test_startup.py`; fallbacks in `trivia/tests/test_classic_fallbacks.py`.
(8) Unattended measurement = WSGI+URLconf startup ms and loaded-heavy list before/after in the
venv, plus `du -sm` of pandas/numpy/numpy.libs/nba_api as the expected bundle delta; `vercel
inspect`, 20-min-idle samples and Fluid compute are owner evidence listed in the build report.
Engine: mixed — backend sonnet 1-3, opus 4-7 (classic-view fallback removal, `users/views.py`
and `users/photos.py` lazy imports: AUTH-11 files where behaviour must stay identical), sonnet
8-11; frontend sonnet 12-13.
Consequences: a module-level `import requests`/`PIL`/`google`/`pandas`/`nba_api` anywhere on the
request path now fails the suite by name; the web function's dependency set and the pipeline's are
two files, and any new installer must pick the right one; `backend/.venv/` is untracked and not
ignored in cloud checkouts, so engines stage by explicit path.

## 2026-10-03 — cold-start guard: requests is a DRF import
Context: build of the cold-start card, after steps 4-7. The startup guard planned in step 9
listed `requests` among the modules that must not be loaded by `get_wsgi_application()` + URL
resolution, but `rest_framework/compat.py:48` does `import requests` (optional dependency) whenever
the package is installed, reached by the first `@api_view` module the URL conf imports. `requests`
cannot leave `requirements.txt`: `google_login` and `google.auth.transport.requests` use it. Measured
`-X importtime` cost of the subtree on Linux: ~51 ms (the owner doc's ~400 ms was a Windows figure).
Options: (a) drop `requests` from the guard and say why in the test; (b) rewrite `google_login` on
`urllib`/`google.auth.transport.urllib3` and drop `requests` — auth logic in an AUTH-11 file on a
risk-high card, not asked for; (c) stub `sys.modules` — a hack.
Decision: (a). Guard tuple `("pandas", "numpy", "nba_api", "PIL", "google")`; the test comment
names DRF as the reason; step 11's report states the measured `requests` cost so the owner sees
the trade-off; the step 1/11 measurement list still includes `requests`.
Consequences: the card's "Done when" is met minus `requests`, which is documented rather than
asserted; moving Google login off `requests` (and `requests` out of the web set) is a separate
card if the ~51 ms ever matters.

## 2026-10-03 — Single "Close game" control on every game screen: card says sonnet, P0 override says opus; standard, no design round
Context: frontend P0 card, no Difficulty override, owner-investigated spec with a "Model routing:
sonnet" hint. Screenshots (Starting 5 and Fan Favorites result at phone width) confirm the bug: the
in-place `ScorePanel` ("Play again" / "Close game") sits above the shell's `.exit-link` "Exit game",
two leave controls at once. Verified on dev 6450a5f: `MiniGame.tsx:274` renders `.exit-link` for the
whole `playing` stage; the shell already receives the in-place ending — `onGameEnd(finalScore,
{ inPlace: true })` at `MiniGame.tsx:260-264` — but only uses `inPlace` to skip `setShowResult`,
storing no ended flag, so the exit link has nothing to key off today. Hiding it is one boolean state
set there and cleared in `handleStart`/`handleRestart`/`handleExit`/the `[gameId]` effect, plus a
conditional render: a few lines, which is the card's own threshold for skipping a design round.
`onExit` is dead (`RenderGame.tsx:53/69/114`, `StartingFive.tsx:19`, never read). Wordle ends via
`GameResult` (no `inPlace`), so "Close game only" there is a `GameResult`/shell condition, not a
renderer change. Hidden games' hand-rolled copies (`NbaGrid.tsx:422-423`, `SuperDraft.tsx:514-521,
667-674`) already read "Close game".
Weighed: (a) `difficulty: trivial` — the rename itself is given text; rejected because the task
removes/hides a visible UI element (rubric: visual check needed, not haiku) and adds shell state.
(b) `standard` with `needsDesignRound: false` — one area (`frontend`/`ui`), existing patterns, every
step has an acceptance check in the card. Engine: (c) `sonnet`, as the card routes and as the work is
long-and-explicit; (d) `opus`, because the 09-29 override ("`risk: high` or a non-trivial P0 → opus")
is unconditional and the 09-29 routing-eval entry restates it ("P0 non-trivial → opus"). The
card's routing line is a hint, not a Difficulty override, and only an override beats the rubric.
Decision: `difficulty: standard`, `areas: frontend, ui`, `risk: low`, `engineModel: opus`
(provisional, by the P0 override), `planModel: fable`, `needsDesignRound: false`.
Consequences: a card's "Model routing" hint does not downgrade a non-trivial P0 from opus; if the
owner wants sonnet on simple P0 cards, the override text in `classify/SKILL.md` is the place to
change it, not per-card. The build engine should key the hidden exit link off the existing
`inPlace` signal rather than inventing a renderer→shell callback or store flag.

## 2026-10-03 — Career Path result at the top: design round picks "same five slots, the content swaps"
Context: design round for the P0 frontend card (`hard`, areas frontend/ui/games, risk low). Doc:
`docs/team/designs/2026-10-03-career-path-result-top.md`. As on the cold-start round, this cloud
planner had no agent-spawning tool, so both proposals and the sign-off were written by the planner
from `frontend-engine.md`, the constraint docs and a full code read; `impeccable:impeccable` is not
installed here, so `GAME_DESIGN_CONSTRAINTS.md` was the only design guidance (it outranks generic
design skills for renderers anyway).
Weighed: (A) keep all five `GameFrame` slots mounted and swap each slot's content for an
equal-height end state — result line (`ScoreLine`) lone-left in the Status slot, a 22px chip toggle
in the Prompt slot, rail + answer panes stacked in one grid cell in the Board, `ScoreActions` in the
Action slot; (B) replace Status+Progress+Prompt with one result card and slide the answer in under
the rail. B needs either a per-game header wrapper (Rule 0 forbids) or a `layout` animation on the
shared `GameFrame` div to avoid the height jump, plus a reserved empty band for the answer on a
loss (Rule 6.2); A resizes nothing by construction.
Decided: (1) A. (2) `ScorePanel` becomes `ScoreLine` + `ScoreActions` + the composing default
export — an extension, not a fork; `EndSequence` untouched. (3) `ScoreLine` always renders the
score through `AnimatedNumber`, so Who Are Ya, Starting Five, Fan Favorites and Heatmap gain the
0.9 s count-up — deliberate, one shared behaviour, screenshots in the Done-when cover it. (4)
GameResult's spring becomes `springs.result` and the `resultIn` variant, consumed by `GameResult`
(dedupe) and the Career Path result line, because the card demands "reuse GameResult's spring" and
"tokens only". (5) New shared variant `stackPane` (swap's values + `visibility` via `transitionEnd`
+ `delayChildren`) for two always-mounted panes in one grid cell; `AnimatePresence mode="wait"`
cannot keep the zone rail-tall. (6) Career Path drops the §7b 1.5 s loader (`input -> score`): the
reveal is player-driven and the owner's rule is no button waits more than 400 ms; recorded in the
Accepted deviations table. (7) "Rail expanded or scrolled" = scrolled; a wrapping grid needs ~650px
at 390 wide. (8) The play label and counter vanish without an exit animation when the result
mounts: an exit under `mode="wait"` would slide the label to centre (lone-left rule) while fading;
a `missing` minor from the motion reviewer is accepted. (9) Rule 6.3 fix folded in: the losing
guess flashes `Not him.`, not `Out of guesses` — one string in the branch the plan rewrites.
Engine: mixed — opus on steps 3-7 (ScorePanel split, renderer header/end flow/stage panes, the
CSS that makes the slots static), sonnet on 1-2 (tokens/variants, GameResult 3-line swap) and
8-10 (docs, commit notes).
Consequences: an in-place game that wants its result at the top renders `ScoreLine` in the
Status slot and `ScoreActions` in the score slot; a view toggle that must not resize its container
uses `stackPane` on two always-mounted panes sharing a grid cell; `springs.result`/`resultIn` are
the only sanctioned result-entrance values.
