# Player photos without cdn.nba.com — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every player photo in every game and answer review comes from Wikimedia Commons (free licence, face-checked, fit-checked) or is the silhouette; nothing loads from cdn.nba.com.

**Architecture:** The existing pipeline (`scripts/player-photos/`: `build.mjs` → `detect_faces.py` → human review → `build.mjs` → `check_fit.py`) is pointed at all 4,900 players instead of only those without an NBA headshot, so the map `public/photos/player-photos.json` lists every player as `commons` or `none`. The app's photo resolver then has two outcomes (Commons or silhouette) and the two review boards that hotlink the CDN use `<PlayerPhoto>` like every game. The ~1,500 new face boxes are reviewed from numbered contact sheets by parallel subagents, whose verdicts a small script merges into `commons-extra.json` / `faces.json`.

**Tech Stack:** Node 22 (`.mjs`, `node --test`, `--experimental-strip-types`), Python 3.11 (`opencv-python` for YuNet; `check_fit.py` and the new merge script are stdlib only), Next.js 16 app in TypeScript, Wikidata SPARQL + Commons API.

**Spec:** `docs/superpowers/specs/2026-10-25-photos-commons-only.md`

## Global Constraints

- All work in the worktree `C:\Users\stefa\.team-worktrees\photos-commons` on branch `feat/photos-commons-only` (from `origin/dev`). Never run a command against the main checkout `C:\Users\stefa\OneDrive\Desktop\nba-projects\nba-minigames` or any other worktree; other sessions are working there. Below, `WT` means the worktree path.
- Nothing is pushed, no PR, no merge, until the owner asks (memory rule `git-commit-authority-nba-projects`). Commit messages: one short plain line, no attribution trailer (global CLAUDE.md).
- The drawing rules are fixed: no change to `placePhoto`, `PlayerPhoto`'s frame logic, `frames.json` measurements, or any game CSS. A photo that does not fit is excluded, not the rule relaxed.
- `python scripts/player-photos/check_fit.py` must exit 0 (0 major issues) before any data commit that changes the map.
- Python with OpenCV is `py -3.11` only; `check_fit.py` and `apply_review.py` run on any Python 3.
- Commons etiquette: keep `detect_faces.py`'s 1 s pause per photo and 30 s back-off on HTTP 429; keep the build's 50-title batches; keep the existing `User-Agent` strings.
- Review reasons are written as `photo review <YYYY-MM-DD>: <reason>` (the day the review ran), matching the 2026-10-18 entries in `commons-extra.json`.

## Review Focus

1. A player id absent from the map (a player added by a later data sync, before the build is rerun) must show the silhouette, never a cdn.nba.com URL — pinned by the `photoSource(999999)` test in Task 8.
2. The map fetch failing (offline, 404) must leave every player on the silhouette with no error — pinned by the rejecting-fetch test in Task 8.
3. A Commons file renamed or deleted after the build must fall back to the silhouette at runtime — `PlayerPhoto`'s existing `onError`/`failed` path does this and is untouched; the hand-over report states it as unverified at runtime.
4. The Who Are Ya and LeContexto answer reviews for a player with no photo must show the silhouette inside a frame that keeps its size — covered by the ui-check run in Task 9 (`GM-who-are-ya-*`, `GM-contexto-*`).
5. A detector box on the wrong person in a two-person photo cannot be caught by `check_fit.py` — the reviewer criteria in Task 6 make "box on someone other than the named player" an exclusion, and the apply script records the reason.

---

### Task 1: Worktree, dependencies, spec and plan on the branch

**Files:**
- Create: worktree `C:\Users\stefa\.team-worktrees\photos-commons` (branch `feat/photos-commons-only`)
- Copy into it: `docs/superpowers/specs/2026-10-25-photos-commons-only.md`, `docs/superpowers/plans/2026-10-25-photos-commons-only.md` (both exist untracked in the main checkout)

- [ ] **Step 1: Create the worktree from the latest dev**

Run (PowerShell; `git` against the main checkout is read-only here apart from registering the worktree):
```powershell
git -C "C:\Users\stefa\OneDrive\Desktop\nba-projects\nba-minigames" fetch origin
git -C "C:\Users\stefa\OneDrive\Desktop\nba-projects\nba-minigames" worktree add "C:\Users\stefa\.team-worktrees\photos-commons" -b feat/photos-commons-only origin/dev
```
Expected: `Preparing worktree (new branch 'feat/photos-commons-only')`, `HEAD is now at 2759bab` (or newer).

- [ ] **Step 2: Install node modules in the worktree**

Run: `npm ci` in `WT` (needed for `tsc`, `lint`, `build`, ui-check; the photo scripts themselves need no modules).
Expected: exit 0.

- [ ] **Step 3: Check the tool versions the plan relies on**

Run: `node --version` (expect `v22.x`, ≥ 22.6 for `--experimental-strip-types`); `py -3.11 -c "import cv2, numpy; print(cv2.__version__)"` (expect a version, e.g. `5.0.0`).

- [ ] **Step 4: Move the spec and the plan onto the branch**

Copy both files from the main checkout into the same paths in `WT`, then delete the two untracked copies from the main checkout (`git -C <main> status --short` must no longer list `docs/superpowers/`).

- [ ] **Step 5: Commit**

```bash
git add docs/superpowers/specs/2026-10-25-photos-commons-only.md docs/superpowers/plans/2026-10-25-photos-commons-only.md
git commit -m "docs: spec and plan for Commons-only player photos"
```

---

### Task 2: `npm run check:photos` — the map must cover every player, with face data and credits

**Files:**
- Create: `scripts/check-photo-map.mjs`
- Modify: `package.json` (`scripts`: add `"check:photos": "node scripts/check-photo-map.mjs"`; do NOT add it to `lint` yet — Task 10 does, once it is green)

**Interfaces:**
- Produces: `npm run check:photos` — exit 0 when all rules hold, exit 1 with one line per broken rule and up to 20 offending ids each. Used by Tasks 3, 6, 7, 8, 10 as the red/green gate for the data.

- [ ] **Step 1: Write the check**

`scripts/check-photo-map.mjs` reads `backend/trivia/data/players-index.json`, `public/photos/player-photos.json`, `src/data/photo-credits.json` and checks:

1. `covered`: every `person_id` in the index is a key of `commons` or a member of `none`, and never both;
2. `known`: every key of `commons` and every member of `none` is in the index;
3. `faces`: every `commons` entry has exactly 7 elements (path, width, height, face cx, cy, fw, fh — the face box `build.mjs` writes from `faces.json`);
4. `credits`: `photo-credits.json` has exactly one row per `commons` entry (same count);
5. `no-cdn`: no file under `src/` contains the string `headshots/nba` (player headshot URLs; team logos under `cdn.nba.com/logos` are a separate step and stay).

Prints a summary line first: `check-photos: <n> players — <c> Commons, <s> silhouette` and then `check-photos: <rule> — <count> …` for each broken rule. Match the style of `scripts/check-legal-config.mjs` (plain `console.error`, `process.exit(1)`).

- [ ] **Step 2: Run it against the current data to see it fail**

Run: `npm run check:photos`
Expected: exit 1; `covered` lists 1,702 ids (the NBA-CDN players are in neither list today); `no-cdn` lists `src/utils/playerPhotos.ts` and `src/components/review/BoardReviews.tsx`.

- [ ] **Step 3: Commit**

```bash
git add scripts/check-photo-map.mjs package.json
git commit -m "check:photos: the photo map must cover every player"
```

---

### Task 3: `build.mjs` searches Commons for every player

**Files:**
- Modify: `scripts/player-photos/build.mjs` (lines 1-10 header, 24, 54-65, 142-146, 239-244)
- Regenerated: `public/photos/player-photos.json`, `public/photos/player-ids.json`, `src/data/photo-credits.json`

**Interfaces:**
- Produces: `player-photos.json` `{ generated, commons: { [person_id]: [path, w, h, cx?, cy?, fw?, fh?] }, none: number[] }` where every index player is in `commons` or `none`; log line `[player-photos] done: <n>/<total> with a photo (Commons), <m> silhouette; <r> Commons files skipped as possibly someone else, <e> excluded by review` and, when relevant, the existing `… have no face data yet` line listing ids (Task 4 consumes that).

- [ ] **Step 1: Remove the cdn.nba.com probe**

Delete `NBA_PLACEHOLDER_ETAG`, `hasNbaHeadshot` and the probe block (`const nba = await pool(...)`, `const missing = …`, its log line). Every index row is a Commons candidate: replace later uses of `missing` with `players`. Rewrite the header comment (lines 1-10) to say: the map covers every player as a Commons file or `none`; an id the map doesn't list is a build error (`npm run check:photos`), and the app shows the silhouette for it. Change the final log line to the shape in Interfaces (drop the `NBA +` part). Keep `pool`, `retry`, `wikidataImages`, `commonsInfo`, `namesPlayer`, the face-entry code and the ids file untouched.

- [ ] **Step 2: Run the build**

Run: `node scripts/player-photos/build.mjs` (a few minutes: one SPARQL query, ~60 Commons metadata calls).
Expected: `Wikidata images for missing players: ~2,860`; `done: ~2,750/4,900 with a photo (Commons), ~2,150 silhouette`; a `have no face data yet` line naming roughly 1,450-1,500 ids. (1,547 of the 1,702 former CDN players have a Wikidata image; the name rule rejects a few dozen.)

- [ ] **Step 3: Check the gate moves**

Run: `npm run check:photos`
Expected: exit 1 with only `faces` (the new entries have 3 elements) and `no-cdn` broken; `covered`, `known` and `credits` pass.

- [ ] **Step 4: Commit the script and the interim data**

```bash
git add scripts/player-photos/build.mjs public/photos/player-photos.json public/photos/player-ids.json src/data/photo-credits.json
git commit -m "player photos: build the map for every player from Commons, no cdn.nba.com probe"
```

---

### Task 4: `detect_faces.py` writes numbered review sheets

**Files:**
- Modify: `scripts/player-photos/detect_faces.py` (docstring lines 1-11, `main()` lines 95-110)
- Modify: `scripts/player-photos/.gitignore` (`faces-review.png` → `faces-review*.png`, plus `review/`)

**Interfaces:**
- Produces: `faces-review-01.png`, `faces-review-02.png`, … next to the script, `--per-sheet N` photos each (default 48 = 8 rows × 6 columns at the existing 220×240 px cells), each cell labelled with the person_id as today; `faces.json` gains one entry per analysed photo. Prints `review sheets: <k> files, <per-sheet> photos each` and each path.

- [ ] **Step 1: Add the sheet split**

`argparse` with `--per-sheet` (int, default 48). Replace the single-sheet block: chunk `done` into groups of `per_sheet`, draw each group with the same cell layout and labels, write `faces-review-{i:02d}.png`. Update the docstring (sheet names, the flag) and `.gitignore`.

- [ ] **Step 2: Run the detector on the new photos (long; run in the background)**

Run: `py -3.11 scripts/player-photos/detect_faces.py`
Expected: `~1,480 photos to analyse` (the ids `build.mjs` listed); after 40-70 minutes `faces.json` has those ids added (non-manual), ~31 sheets written, and the log lists any `NO FACE` and `unreadable` ids.

- [ ] **Step 3: Rebuild the map with the boxes**

Run: `node scripts/player-photos/build.mjs`, then `npm run check:photos`.
Expected: `faces` now lists only the `NO FACE` photos (3-element entries); `no-cdn` still red.

- [ ] **Step 4: Commit**

```bash
git add scripts/player-photos/detect_faces.py scripts/player-photos/.gitignore scripts/player-photos/faces.json public/photos/player-photos.json
git commit -m "player photos: face detection for the new Commons photos, review sheets in batches"
```

---

### Task 5: `apply_review.py` merges reviewer verdicts

**Files:**
- Create: `scripts/player-photos/apply_review.py`
- Create: `scripts/player-photos/test_apply_review.py`

**Interfaces:**
- Consumes: review files `scripts/player-photos/review/*.json` (git-ignored, Task 4), each
  `{ "sheet": "faces-review-03.png", "exclude": { "<pid>": "<reason>" }, "box": { "<pid>": [x, y, w, h] } }` (box as fractions of the image, like `faces.json`).
- Produces: `apply(review_dir: str, extra_path: str, faces_path: str, today: str) -> tuple[int, int]` (number excluded, number boxed), and the CLI `python scripts/player-photos/apply_review.py` that calls it with the pipeline's paths and today's date and prints `applied: <e> excluded, <b> boxes set`.
  - `exclude`: `commons-extra.json[pid] = {"exclude": true, "reason": f"photo review {today}: {reason}"}`, replacing any existing entry for that pid.
  - `box`: `faces.json[pid]["box"] = [x, y, w, h]` and `["manual"] = true`; the entry must already exist (else `ValueError` naming the pid; nothing is written).
  - Both files are written sorted by numeric pid, via a `.tmp` file and `os.replace`, with `ensure_ascii=False`; `faces.json` with `indent=0` as `detect_faces.py` writes it, `commons-extra.json` with `indent=1`.

- [ ] **Step 1: Write the failing tests**

`test_apply_review.py` (stdlib `unittest`, temp dirs), tests:

```python
def test_exclude_adds_entry_with_dated_reason(self)      # extra[pid] == {"exclude": True, "reason": "photo review 2026-10-26: back view"}
def test_exclude_replaces_a_hand_find(self)              # a pid that had {"file": ..., "face_x": ...} becomes the exclude entry
def test_box_sets_manual_and_keeps_file_and_aspect(self) # faces[pid] == {"file": ..., "aspect": ..., "box": [0.4, 0.1, 0.2, 0.2], "manual": True}
def test_box_for_unknown_pid_raises_and_writes_nothing(self)  # ValueError message contains the pid; both files unchanged
def test_output_sorted_numerically_and_counts_returned(self)  # keys order ["2", "21", "100"]; apply(...) == (2, 1)
```

- [ ] **Step 2: Run them to see them fail**

Run: `python -m unittest discover -s scripts/player-photos -p "test_*.py" -v`
Expected: 5 errors, `ModuleNotFoundError: apply_review`.

- [ ] **Step 3: Implement `apply_review.py`**

Signature and behaviour as in Interfaces; `main()` uses `HERE`/`ROOT` like `detect_faces.py`, `review_dir = os.path.join(HERE, "review")`, `today = date.today().isoformat()`.

- [ ] **Step 4: Run the tests**

Run: `python -m unittest discover -s scripts/player-photos -p "test_*.py" -v`
Expected: `OK` (5 tests).

- [ ] **Step 5: Commit**

```bash
git add scripts/player-photos/apply_review.py scripts/player-photos/test_apply_review.py
git commit -m "player photos: apply_review merges sheet verdicts into commons-extra and faces"
```

---

### Task 6: Review every sheet, then fit-check until clean

**Files:**
- Create (git-ignored): `scripts/player-photos/review/sheet-NN.json`, one per sheet
- Modify (generated): `scripts/player-photos/commons-extra.json`, `scripts/player-photos/faces.json`, `public/photos/player-photos.json`, `src/data/photo-credits.json`

**Interfaces:**
- Consumes: the sheets from Task 4; `apply_review.py` from Task 5.
- Produces: `check_fit.py` exit 0 and `check:photos` green on rules 1-4.

- [ ] **Step 1: Dispatch the sheet reviews in parallel (REQUIRED SUB-SKILL: superpowers:dispatching-parallel-agents)**

One subagent per sheet, batches of 6 at a time. Each prompt names exactly one sheet path and one output path `review/sheet-NN.json`, the JSON shape from Task 5, and these criteria (from `scripts/player-photos/README.md`, "Adding or changing photos"):

- **Exclude** (give the reason in 2-6 words): no clear face (jersey, banner, back view, side view with the face hidden); a group or game shot where the named player cannot be told apart; the box is on someone other than the obvious subject; a face too small to recognise in a 32 px circle (the box shorter than about 1/12 of the cell); a cartoon, statue, card scan or trading card; a photo that is plainly not a basketball player.
- **Set the box** (fractions of the image, ±0.02 is fine) when the face is clear but the orange box is missing (`NO FACE` label), on the wrong face, or covers less than the brows-to-chin area.
- Otherwise leave the pid out: the box is accepted.
- The reviewer writes only its own `review/sheet-NN.json`; nothing else.

- [ ] **Step 2: Apply, rebuild, fit-check**

Run, in order: `python scripts/player-photos/apply_review.py` → `node scripts/player-photos/build.mjs` → `python scripts/player-photos/check_fit.py --list`.
Expected: the apply line reports the totals; the build no longer lists `have no face data yet`; `check_fit.py` prints `photos shown: ~2,500  with a major issue: <n>` and the per-type counts.

- [ ] **Step 3: Resolve every major issue**

For each pid in a major row: `HEAD_CUT` or `FACE_TOO_SMALL` whose box is right → exclude (reason `fit: <issue> in <game>`); whose box is wrong → set the box in a new `review/fit-pass.json`; `NO_FACE` → exclude. Rerun Step 2. Repeat until `check_fit.py` exits 0. Minor issues are reported, not fixed (same policy as 2026-10-18).

- [ ] **Step 4: Gate**

Run: `npm run check:photos`
Expected: exit 1 with only `no-cdn` broken (Task 8 fixes that).

- [ ] **Step 5: Commit**

```bash
git add scripts/player-photos/commons-extra.json scripts/player-photos/faces.json public/photos/player-photos.json public/photos/player-ids.json src/data/photo-credits.json
git commit -m "player photos: reviewed Commons photos for the former cdn.nba.com players"
```

---

### Task 7: Hand search for well-known and active players still on the silhouette

**Files:**
- Modify: `scripts/player-photos/commons-extra.json` (new `{ file, face_x, face_y }` entries), then the generated files as in Task 6

**Interfaces:**
- Consumes: the map after Task 6; the Commons API (`action=query&list=search&srnamespace=6&srsearch=…`, `prop=imageinfo&iiprop=size|mime|extmetadata`), Wikidata `P180` (depicts), Commons categories `Category:<Player name>`.
- Produces: `commons-extra.json` entries that pass the same gates as a Wikidata find (free licence shown by `LicenseShortName`, `image/jpeg` or `image/png`, file name mentions the player, file not already used by another pid).

- [ ] **Step 1: List the targets**

Run a one-off (`node -e` or `python -c`) over `players-index.json` and the map: pids in `none` with `fame_tier <= 3`, and separately pids in `none` with `is_active`. Expected: tier 1-3 → 0 to a few dozen (all 132 have a Wikidata image; some were rejected by the name rule or excluded in review); active → about 66 plus review exclusions.

- [ ] **Step 2: Search (parallel subagents, 10-15 players each)**

Every tier 1-3 player is searched; active tier-4 players get one search each. A subagent returns, per player, either `{ "file": "<Commons file name with spaces>", "face_x": <0-100>, "face_y": <0-100> }` with the Commons API evidence (licence, mime, dimensions) or `none`. Rejections: a file naming a different person, a non-free or non-image file, a file already in `faces.json` for another pid.

- [ ] **Step 3: Add, detect, review, build, fit-check**

Add the finds to `commons-extra.json` (sorted numerically). Then: `node scripts/player-photos/build.mjs` → `py -3.11 scripts/player-photos/detect_faces.py` (only the new files) → review the new sheet(s) as in Task 6 Step 1 → `apply_review.py` → `build.mjs` → `check_fit.py` until exit 0.

- [ ] **Step 4: Gate and commit**

Run: `npm run check:photos` → only `no-cdn` broken.
```bash
git add scripts/player-photos/commons-extra.json scripts/player-photos/faces.json public/photos/player-photos.json src/data/photo-credits.json
git commit -m "player photos: hand-found Commons photos for well-known and active players"
```

---

### Task 8: The app resolves Commons or silhouette, nothing else

**Files:**
- Modify: `src/utils/playerPhotos.ts` (lines 1-6, 23-24, 38-42, 50, 128-138, 181)
- Modify: `src/components/ui/PlayerPhoto.tsx` (lines 2-9, 35-39, 46-49, 52-83)
- Modify: `src/components/review/BoardReviews.tsx` (lines 23, 321, 348 + import)
- Modify: `src/Game Renderers/BingoGame.tsx:42`, `src/Game Renderers/SuperDraft.tsx:221` (drop `size="sm"`)
- Create: `scripts/test-player-photos.mjs`; `package.json` script `"test:player-photos": "node --experimental-strip-types scripts/test-player-photos.mjs"`

**Interfaces:**
- Produces (`src/utils/playerPhotos.ts`):
  - `type PhotoSource = { source: "commons"; path: string; width: number; aspect: number; face?: PhotoFace }` (the `"nba"` variant, `PhotoSize` and `NBA_SIZE` are removed);
  - `photoSource(personId: number): PhotoSource | null` — `null` for a pid in `none` **and** for a pid the map does not mention;
  - `usePhotoSource(personId: number | null | undefined): PhotoSource | null | undefined` (unchanged semantics, no `size`);
  - `loadPhotoMap()` unchanged; its comment now says a failed fetch means "everything on the silhouette".
- Produces (`PlayerPhoto`): props `personId, alt, frame?, className?, fallbackClassName?, style?` (no `size`); renders `CommonsPhoto` or `PlayerSilhouette` only.

- [ ] **Step 1: Write the failing test**

`scripts/test-player-photos.mjs` (style of `scripts/test-ranks.mjs`):

```js
import { test } from "node:test";
import assert from "node:assert/strict";

const map = { generated: "2026-10-26", commons: { "2": ["6/65/Byron_Scott_(cropped).jpg", 842, 1311, 49.4, 16.1, 18.1, 16.8] }, none: [26] };

test("Commons entry, none entry, and an id the map does not know", async () => {
  globalThis.fetch = async () => new Response(JSON.stringify(map));
  const { loadPhotoMap, photoSource } = await import("../src/utils/playerPhotos.ts");
  await loadPhotoMap();
  assert.deepEqual(photoSource(2), { source: "commons", path: "6/65/Byron_Scott_(cropped).jpg", width: 842, aspect: 1311 / 842, face: { cx: 0.494, cy: 0.161, fw: 0.181, fh: 0.168 } });
  assert.equal(photoSource(26), null);
  assert.equal(photoSource(999999), null); // not in the map: the silhouette, never a cdn.nba.com URL
});

test("a failed map fetch puts everyone on the silhouette", async () => {
  globalThis.fetch = async () => { throw new Error("offline"); };
  const { loadPhotoMap, photoSource } = await import("../src/utils/playerPhotos.ts?offline");
  await loadPhotoMap();
  assert.equal(photoSource(2), null);
});
```
(The `?offline` query gives a fresh module instance so the second test gets its own `mapPromise`.)

- [ ] **Step 2: Run it to see it fail**

Run: `npm run test:player-photos`
Expected: the first test fails on `photoSource(999999)` (today it returns `{ source: "nba", src: "https://cdn.nba.com/…/999999.png" }`), or a TypeScript arity error on `photoSource(2)`.

- [ ] **Step 3: Change the resolver**

In `playerPhotos.ts`: remove `PhotoSize`, `NBA_SIZE` and the `"nba"` variant; `photoSource(personId)` returns the Commons entry or `null`; `usePhotoSource(personId)` drops `size`. Rewrite the header comment (lines 1-6) and the `loadPhotoMap` comment for the new order (Commons → silhouette; an id the map doesn't list is a silhouette and `npm run check:photos` catches it).

- [ ] **Step 4: Change the component and the two reviews**

`PlayerPhoto.tsx`: drop the `size` prop and the `<img data-source="nba">` branch; `usePhotoSource(personId)`; update the doc comments (lines 35-39, 46-49). `BingoGame.tsx:42` and `SuperDraft.tsx:221`: remove `size="sm"`. `BoardReviews.tsx`: delete `headshotUrl`; import `PlayerPhoto from "../ui/PlayerPhoto"`; line 321 → `<PlayerPhoto personId={review.mystery.person_id} alt={review.mystery.full_name} className="cp-reveal-photo" fallbackClassName="cp-reveal-fallback" />` (the default `card` frame, as `RevealHeadshot` in CareerPath); line 348 → `<span className="cx-reveal-photo"><PlayerPhoto personId={review.secret.person_id} alt={review.secret.full_name} frame="avatar" /></span>` (as the game at `Contexto.tsx:265-267`).

- [ ] **Step 5: Run the test, the types, the lint and the gate**

Run: `npm run test:player-photos` → `OK` (2 tests). `npx tsc --noEmit` → no output. `npm run lint` → exit 0. `npm run check:photos` → exit 0 (all five rules).

- [ ] **Step 6: Commit**

```bash
git add src/utils/playerPhotos.ts src/components/ui/PlayerPhoto.tsx src/components/review/BoardReviews.tsx "src/Game Renderers/BingoGame.tsx" "src/Game Renderers/SuperDraft.tsx" scripts/test-player-photos.mjs package.json
git commit -m "player photos: Commons or silhouette only, reviews use PlayerPhoto"
```

---

### Task 9: `check_fit.py` covers the two review boards; ui-check still passes

**Files:**
- Modify: `scripts/player-photos/frames.json` (add `who-are-ya-review`, `contexto-review`)
- Modify: `scripts/player-photos/check_fit.py` (docstring lines 6-9, `players_per_game` line 161)
- Modify: `scripts/ui-check/games/who-are-ya.mjs` (comment lines 8-9)

**Interfaces:**
- Produces: `check_fit.py` evaluates `who-are-ya-review` with the `career-path` frames (the review reuses `.cp-reveal-photo`, `src/styles/CareerPath.css:164-170`) and `contexto-review` with the `contexto` frames (`.cx-reveal-photo`, `Contexto.css:81-96`), for every player of those games.

- [ ] **Step 1: Add the frames and the game sets**

`frames.json`: `"who-are-ya-review"` = a copy of the `career-path` block, `"contexto-review"` = a copy of the `contexto` block; extend `_about` with one sentence saying so. `check_fit.py` line 161: every question game gets its review set, `games[...] |= {g, f"{g}-review"}`. Docstring: "the game's CSS fit for cdn.nba.com headshots" → "every photo is a Commons photo placed by `placePhoto`" (the `source == "nba"` branch in `check()` is now unreachable; leave it, note it in the hand-over).

- [ ] **Step 2: Fit-check**

Run: `python scripts/player-photos/check_fit.py`
Expected: exit 0; `photos shown` unchanged, the per-game lines include no `major in who-are-ya-review` / `contexto-review`. Any major → resolve as Task 6 Step 3 and commit the data.

- [ ] **Step 3: ui-check adapter comment**

`who-are-ya.mjs` lines 8-9: the mystery is no longer identifiable from the photo URL (a Commons path, no person_id); the adapter takes the newest payload (its existing `id == null` path). Code unchanged.

- [ ] **Step 4: Run the photo games through ui-check from the worktree**

Run: `node scripts/ui-check/run.mjs --suite games --mode dev --repo "C:\Users\stefa\.team-worktrees\photos-commons" --vp core --only "GM-who-are-ya-*,GM-contexto-*,GM-career-path-*,GM-starting-five-*,GM-bingo-*,GM-super-draft-*,GM-pack-five-*" --skip-slow`
Expected: exit 0; in the contact sheets the reveal photos are Commons photos or silhouettes, no console violation about `cdn.nba.com`.

- [ ] **Step 5: Commit**

```bash
git add scripts/player-photos/frames.json scripts/player-photos/check_fit.py scripts/ui-check/games/who-are-ya.mjs
git commit -m "player photos: fit-check the Who Are Ya and LeContexto reviews"
```

---

### Task 10: Copy, docs, lint wiring, final verification, hand-over

**Files:**
- Modify: `src/app/credits/page.tsx:35-37`, `scripts/player-photos/README.md`, `package.json` (`lint` chain), `docs/legal/OPEN_ITEMS.md` (section D.1 and the `StartingFive.tsx` row's neighbour), memory `nba-player-photos.md`

- [ ] **Step 1: Credits copy**

`credits/page.tsx` line 35-37 → `Every player photo comes from <a>Wikimedia Commons</a> ({rows.length} photos, used under the licence named below); players without a usable free photo get a silhouette. Each photo may be cropped to fit the game.` Update the file's top comment and `metadata.description` to match.

- [ ] **Step 2: README**

Rewrite the "How it decides" section of `scripts/player-photos/README.md`: Commons (Wikidata P18 → gates) → `commons-extra.json` → silhouette; delete the cdn.nba.com paragraph; the "How a photo is fitted" NBA bullet becomes one line saying NBA headshots are no longer used. Document `--per-sheet`, the numbered sheets, `review/*.json`, `apply_review.py`, and `npm run check:photos` in "Adding or changing photos". Update the first table (the map now lists every player).

- [ ] **Step 3: Wire the gate into lint; legal open items**

`package.json`: append `&& npm run check:photos` to `lint`. `docs/legal/OPEN_ITEMS.md` D.1: player headshots are no longer hotlinked (Commons/silhouette since this branch); logos remain the open item.

- [ ] **Step 4: Final verification (REQUIRED SUB-SKILL: superpowers:verification-before-completion)**

Run, each must pass: `npm run lint` (exit 0, includes `check:photos`), `npx tsc --noEmit`, `npm run test:player-photos`, `python -m unittest discover -s scripts/player-photos -p "test_*.py"`, `python scripts/player-photos/check_fit.py` (exit 0), `npm run build` (exit 0), `rg -n "headshots/nba" src scripts/ui-check` (no output).

- [ ] **Step 5: Commit and report**

```bash
git add src/app/credits/page.tsx scripts/player-photos/README.md package.json docs/legal/OPEN_ITEMS.md
git commit -m "player photos: credits copy, pipeline README, check:photos in lint"
```
Report to the owner: players with a photo before/after (by fame tier and active), how many of the 1,702 got a Commons photo, how many were excluded and why (counts by reason), `check_fit.py` minor counts, the unverified runtime fallback (Review Focus 3), the dead `nba` branch in `check_fit.py`, and that the branch sits unpushed in the worktree awaiting the word to push / open the PR to `dev`. Update memory `nba-player-photos.md` (source order, counts, the new scripts and flags).
