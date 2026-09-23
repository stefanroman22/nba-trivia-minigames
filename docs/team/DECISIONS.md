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
