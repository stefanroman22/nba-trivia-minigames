# Design: friend-photos-cacheable

Task: "Friend lists show profile photos via a cacheable photo endpoint" (Category fullstack, P1).
Follow-up to dbc9a0f (photos are 256px JPEG bytes in `CustomUser.profile_photo_data`, inlined as a
data URL only in the signed-in user's own payload). List rows (`users/friends.py::_brief`) return
`profile_photo: null` and `FriendsPanel` draws initials. Wanted: a cacheable photo endpoint plus
photos in the Friends rows, initials as fallback, `/me/` untouched, no paid storage.

Classify: hard / frontend + backend + ui + auth / risk high. Design round 2026-09-22, planner on
fable. Branch `team/friend-photos-cacheable` (cut from `origin/dev` 9227514).

## Decision summary

**Engine: sonnet** — 13 steps, each with an exact file, the exact code and a done-check command;
the two judgment calls (auth posture, version source) are settled here, not left to the build.

**Seats.** This cloud session has no `Agent` tool and `ListAgents` shows no engine teammates, so
the `backend-engine` and `frontend-engine` proposal seats were filled by the planner from source
(same fallback as 2026-09-20, recorded again in `docs/team/DECISIONS.md` 2026-09-22). The sign-off
pass is the 5b self-review at the end of this doc.

**D1 — Auth posture: public endpoint, keyed by `public_id`, JPEG bytes only.**
`GET /api/users/<public_id>/photo/?v=<n>` is a plain Django view with no authentication
(BE-9: public read-only → plain view; AUTH-3 forbids session auth; a browser `<img>` cannot carry
the Bearer header, and an `apiFetch`→blob-URL pattern forfeits the HTTP cache the card asks for).
Why this widens nothing: `public_id` is already shown to everyone (`get-users` is public and lists
the top 100 ids; every row/leaderboard renders `#K7F3QD`), and a player's photo is already handed
to every online opponent by the relay (`multiplayer_server/src/index.js` `publicUser.profile_photo`).
The response is the JPEG and nothing else — no username/email/points — and an unknown id and a
known id without a photo return the same 404, so the endpoint reveals nothing the leaderboard
doesn't. Not throttled: the URL space is 32^6 ≈ 1.07e9 (enumeration is useless), a miss is one
indexed query, and a throttle would add a `DatabaseCache` round-trip to every photo load in
production — doubling the cost of the very thing the card optimises (AUTH-10: reads stay
unthrottled by design; `get_users` is the precedent).

**D2 — Version source: a stored `profile_photo_version` column (migration 0006), not a hash.**
List rows must carry a cache key without loading bytes, so the version has to be a column.
`PositiveIntegerField(default=0, editable=False)`; `update_profile` bumps it on every upload;
`0 ⇔ no photo`. Migration `0006_customuser_profile_photo_version` is the `AddField` plus a
`RunPython` backfill (`version 1` for every row that already has bytes) so the invariant holds
for photos uploaded between dbc9a0f and this deploy. Chosen over a per-request byte hash (needs the
bytes on every list row or a revalidation request per row on every render) and over a
`DateTimeField` (same migration cost, less obvious in tests).

**D3 — Caching contract.** Response headers: `Content-Type: image/jpeg`, `ETag: "<version>"`
(Django's `condition` decorator handles `If-None-Match` → 304 with only the version query run).
`Cache-Control` depends on the query: `?v=` equal to the current version → `public,
max-age=31536000, immutable` (the URL names the bytes, a re-upload is a new URL); `?v=` missing or
stale → `no-cache` (store, but revalidate — the ETag makes that a cheap 304); 404 → `no-store`.

**D4 — Test contract: keep `profile_photo: None`, add a NEW key `photo_version`.**
`FriendsPhotoTests` keeps asserting `profile_photo is None` on `search-users` and `search-friends`
rows; it is extended in place (added assertions only) to also assert `photo_version`, and gains a
`friends-overview` row check. `/me/` (`user_payload`) is untouched — no `photo_version` there.

**D5 — Frontend.** `ui/Avatar` gains an optional `src` and falls back to initials when `src` is
null or the image errors (per-URL failure memory, so a bumped version gets a fresh try). `useFriends`
exposes `friendPhotoUrl(id, version)`; `FriendsPanel` passes it on all five row sites (friends,
incoming, sent, find, blocked — the blocked list is the player's own list of people they chose to
block; the photo helps them recognise who). Leaderboard rows are out of scope (spec names the
Friends rows); the multiplayer relay keeps sending data URLs, untouched.

**Not planned (needs its own card):** photos on leaderboard rows via the same endpoint;
retiring the relay's inline data URL in favour of this endpoint.

## Interfaces

### Backend (built first; the frontend relies only on this section)

```
GET /api/users/<public_id>/photo/[?v=<int>]          users/urls.py name="profile-photo", view users.photos.profile_photo_view
  auth:      none (AllowAny by construction — plain Django view, no DRF)
  methods:   GET, HEAD (require_safe → 405 otherwise)
  public_id: matched case-insensitively (public_id__iexact); rows always carry the canonical uppercase id
  200:       body = the stored JPEG bytes; Content-Type: image/jpeg; ETag: "<profile_photo_version>"
             Cache-Control: public, max-age=31536000, immutable   when ?v == str(profile_photo_version)
             Cache-Control: no-cache                              otherwise (missing/stale v)
  304:       when If-None-Match matches the ETag (empty body)
  404:       {"error": "No photo."} (application/json), Cache-Control: no-store, no ETag
             for BOTH an unknown public_id and a known one with profile_photo_version == 0 / no bytes
```

```python
# users/models.py  (CustomUser) — new column, migration 0006
profile_photo_version = models.PositiveIntegerField(default=0, editable=False)   # 0 = no photo

# users/friends.py::_brief — one NEW key, every list row (search-users, search-friends,
# friends-overview incoming/outgoing/blocked)
{"id": str, "username": str, "points": int, "rank": str,
 "profile_photo": None,            # unchanged — bytes never travel in a row
 "photo_version": int}             # 0 = no photo; else the ?v= for the URL above

# users/views.py::update_profile (multipart branch) — bumps the version on every successful upload
user.profile_photo_version += 1
user.save(update_fields=["profile_photo_data", "profile_photo_version"])
# /me/ (user_payload) unchanged: still the inline data URL, no photo_version key.
```

### Frontend

```ts
// src/hooks/useFriends.ts
export interface FriendUser { id: string; username: string; points: number; rank: string;
                              profile_photo: string | null; photo_version: number; }
export function friendPhotoUrl(id: string, version: number): string | null
//   version > 0 ? `${BACKEND_URL}/users/${encodeURIComponent(id)}/photo/?v=${version}` : null
//   (a backend without the field yields undefined → `undefined > 0` is false → null → initials)

// src/components/ui/Avatar.tsx — one new optional prop, existing callers unchanged
interface AvatarProps { initials: string; size?: number; bg?: string; src?: string | null; }
```

## File plan

| File | Change |
|---|---|
| `backend/users/models.py` | `CustomUser.profile_photo_version` (step B1). |
| `backend/users/migrations/0006_customuser_profile_photo_version.py` | New: AddField + RunPython backfill (B2). |
| `backend/users/photos.py` | New view `profile_photo_view` + `_photo_etag` (B3). |
| `backend/users/urls.py` | Route `users/<str:public_id>/photo/` (B4). |
| `backend/users/views.py` | `update_profile` multipart branch bumps the version (B5). |
| `backend/users/friends.py` | `_brief` adds `photo_version`; both `.only(...)` lists load the column; comment updates (B6). |
| `backend/users/tests.py` | Extend `FriendsPhotoTests`; new `ProfilePhotoEndpointTests` (B7). |
| `docs/ARCHITECTURE.md` | One bullet for the new endpoint in the `/api/...` list (B8). |
| `src/components/ui/Avatar.tsx` | Optional `src` with initials fallback (F1). |
| `src/hooks/useFriends.ts` | `photo_version` on `FriendUser`; `friendPhotoUrl` (F2). |
| `src/components/FriendsPanel.tsx` | Pass `src` on the five `Avatar` sites (F3). |
| Everything else | untouched — explicitly `user_payload`/`get_current_user`, `users/leaderboard.py`, `src/components/Leaderboard.tsx`, `LeaderboardModal.tsx`, `Navigation.tsx`, `UserProfile.tsx`, `userSlice.tsx`, `Api.tsx`, `multiplayer_server/`, `Friends.css`. |

## Risks

- **New unauthenticated read of user data** (why this is `risk: high`). Bounded per D1: bytes only,
  same 404 for unknown/photo-less ids, id space 1.07e9, already-public identifiers, photos already
  relayed to strangers online. Reviewer check: the view never touches `username`/`email`/`points`.
- **Migration on the shared dev/prod Supabase DB.** `AddField` with a constant default is a
  metadata-only change on Postgres ≥ 11 (no table rewrite); the backfill `UPDATE` touches only rows
  with bytes (a handful). The old backend code ignores the column. The Vercel build runs
  `manage.py migrate`; backend ships before frontend (pipeline split), and the frontend's
  `version > 0` guard renders initials against a backend that lacks the field anyway.
- **Extra query per row if the column is deferred.** `search_users`/`search_friends` use
  `.only(...)`; forgetting `"profile_photo_version"` there makes `_brief` lazy-load it per row
  (N+1). Step B6 adds it to both lists and the done-check greps for it. `friends_overview` uses
  `defer("<rel>__profile_photo_data")`, which already leaves every other column loaded.
- **Stale caches.** A URL whose `?v=` doesn't match is served `no-cache` (revalidated via ETag), a
  matching one is `immutable` because a new upload is a new URL; 404s are `no-store`, so a first
  upload is visible as soon as a row carries `photo_version ≥ 1`. Django's 304 carries no
  `Cache-Control`, which leaves the cached entry's own policy in force — correct.
- **CORS.** A plain `<img src>` (no `crossorigin` attribute) needs no CORS headers; do not add
  `crossorigin`, and no `settings.py` change is needed.
- **Shared `Avatar`.** `Leaderboard.tsx`/`LeaderboardModal.tsx` keep calling it without `src`; the
  only visual change for them is `overflow: hidden` on a chip whose initials already fit. QA glances
  at the leaderboard once.
- **`profile_photo` compatibility key.** Stays `None` in rows (D4) so nothing that reads
  `FriendUser.profile_photo` changes behaviour; `FriendsPhotoTests` guards it.

## Test plan

Baseline on this branch: `cd backend && .venv/bin/python manage.py test users` → `Ran 49 tests …
OK`; `manage.py makemigrations --check --dry-run` → `No changes detected`.

After the backend steps:
1. `cd backend && .venv/bin/python manage.py makemigrations --check --dry-run` → `No changes detected`.
2. `cd backend && .venv/bin/python manage.py check` → `System check identified no issues`.
3. `cd backend && .venv/bin/python manage.py test users` → `Ran 57 tests … OK` (49 + 8 new).
4. `cd backend && .venv/bin/python manage.py test users trivia` → `OK` (nothing in trivia reads the changed rows, sanity).

After the frontend steps:
5. `npx next typegen && npx tsc --noEmit` → exit 0.
6. `npm run lint` → no errors.
7. Browser QA (browser-qa stage, local Django from this worktree): sign in, open the profile card →
   Friends tab. A friend who has uploaded a photo shows it in the row (DevTools Network: one
   request `/api/users/<ID>/photo/?v=N` → 200 `image/jpeg`, `Cache-Control: public,
   max-age=31536000, immutable`); close/reopen the tab → the same URL is served from
   `(memory cache)`/`(disk cache)`, no request. A friend without a photo shows initials and
   triggers no photo request. Find tab: search a player with a photo → photo in the row. Upload a
   new photo on account A, then on account B reload the friend list → the row's URL has `?v=N+1`
   and the new image. Leaderboard modal still shows initials chips unchanged.

## Implementation plan

Work in the task worktree on branch `team/friend-photos-cacheable`. Do not touch any file outside
the File plan. Backend steps run first (backend build → verify), frontend steps after; the frontend
steps use only the Interfaces section above.

### Backend

#### Step B1 — `backend/users/models.py`: the version column

Insert directly after the `profile_photo_data = models.BinaryField(...)` line (line 50):

```python
    # Bumped by every upload; 0 = no photo. It is the cache key of the public photo endpoint
    # (users.photos.profile_photo_view: /api/users/<public_id>/photo/?v=N) and what list rows
    # carry instead of the bytes (users.friends._brief). Backfilled to 1 for pre-0006 photos.
    profile_photo_version = models.PositiveIntegerField(default=0, editable=False)
```

Done-check: `cd backend && .venv/bin/python manage.py makemigrations --check --dry-run` now exits
non-zero and names `Add field profile_photo_version to customuser` (proves the model change is
seen; B2 satisfies it).

#### Step B2 — `backend/users/migrations/0006_customuser_profile_photo_version.py`: AddField + backfill

Create the file with exactly this content (no `makemigrations` run needed — the operation below
is what it would generate, plus the data step):

```python
# Adds CustomUser.profile_photo_version and backfills it for photos that were uploaded
# before the column existed (dbc9a0f stored bytes with no version), so that
# `profile_photo_version > 0` means "has a photo" for every row.

from django.db import migrations, models


def backfill_photo_version(apps, schema_editor):
    """Every row that already holds photo bytes becomes version 1 (idempotent: rows with a
    non-zero version are left alone). users.friends._brief and users.photos rely on the
    invariant `version > 0 <=> photo present`."""
    CustomUser = apps.get_model("users", "CustomUser")
    CustomUser.objects.filter(profile_photo_data__isnull=False, profile_photo_version=0).update(
        profile_photo_version=1
    )


class Migration(migrations.Migration):

    dependencies = [
        ("users", "0005_customuser_profile_photo_data"),
    ]

    operations = [
        migrations.AddField(
            model_name="customuser",
            name="profile_photo_version",
            field=models.PositiveIntegerField(default=0, editable=False),
        ),
        migrations.RunPython(backfill_photo_version, migrations.RunPython.noop),
    ]
```

Done-check: `cd backend && .venv/bin/python manage.py makemigrations --check --dry-run` →
`No changes detected`; `.venv/bin/python manage.py migrate users` → applies `0006_…` with `OK`.

#### Step B3 — `backend/users/photos.py`: the public photo view

Append to the end of the file (keep everything already there; add the three imports at the top,
after `from PIL import Image, ImageOps`):

```python
from django.contrib.auth import get_user_model
from django.http import HttpResponse, JsonResponse
from django.views.decorators.http import condition, require_safe
```

```python
# A year: a URL whose ?v= names the current version can never go stale — a new upload bumps
# the version, so every list row points at a new URL (users.friends._brief).
PHOTO_MAX_AGE = 60 * 60 * 24 * 365


def _photo_etag(request, public_id):
    """ETag for the photo endpoint: the stored version, or None (no ETag) when there is no photo.
    Runs before the view, so a matching If-None-Match is answered 304 without loading the bytes."""
    User = get_user_model()
    version = (
        User.objects.filter(public_id__iexact=public_id)
        .values_list("profile_photo_version", flat=True)
        .first()
    )
    return str(version) if version else None


@require_safe
@condition(etag_func=_photo_etag)
def profile_photo_view(request, public_id):
    """GET /api/users/<public_id>/photo/[?v=N] — the stored 256x256 JPEG bytes, nothing else.

    Public on purpose: a browser <img> cannot send the JWT, the public id is already shown on
    every row and leaderboard, and a photo is already handed to any online opponent by the
    multiplayer relay. An unknown id and a known id without a photo get the same 404, so the
    endpoint reveals nothing the leaderboard doesn't. Not throttled (see the design doc): a miss
    is one indexed query and a throttle would cost a cache round-trip per photo load.

    Cache-Control follows ?v=: equal to the current version -> immutable for a year (the URL
    names the bytes); missing or stale -> no-cache (stored, revalidated via the ETag = version).
    """
    User = get_user_model()
    row = (
        User.objects.filter(public_id__iexact=public_id)
        .values_list("profile_photo_data", "profile_photo_version")
        .first()
    )
    if row is None or not row[0] or not row[1]:
        resp = JsonResponse({"error": "No photo."}, status=404)
        resp["Cache-Control"] = "no-store"
        return resp
    data, version = row
    resp = HttpResponse(bytes(data), content_type="image/jpeg")
    if request.GET.get("v") == str(version):
        resp["Cache-Control"] = f"public, max-age={PHOTO_MAX_AGE}, immutable"
    else:
        resp["Cache-Control"] = "no-cache"
    return resp
```

Also update the module docstring's last clause from `and served inline as a data URL in
user_payload().` to `served inline as a data URL in user_payload() (the signed-in user's own
payload only) and, for everyone else's list rows, by profile_photo_view() below.`

Notes for the engine: `bytes(data)` is required because Postgres returns a `memoryview`;
`not row[0]` is safe on both `bytes` and `memoryview`. Decorator order matters — `require_safe`
outermost. Do not add `@api_view`, `permission_classes` or a throttle (BE-9, D1).

Done-check: `cd backend && .venv/bin/python -c "import django,os;os.environ.setdefault('DJANGO_SETTINGS_MODULE','backend.settings');django.setup();from users.photos import profile_photo_view;print('ok')"` → `ok`.

#### Step B4 — `backend/users/urls.py`: the route

Add `from .photos import profile_photo_view` after the `from .tokens import SessionRefreshView`
import, and append to `urlpatterns` after the `friends-overview` entry:

```python
    # Public, cacheable profile photo for list rows (bytes only; see users.photos).
    path('users/<str:public_id>/photo/', profile_photo_view, name='profile-photo'),
```

Done-check: `cd backend && .venv/bin/python manage.py shell -c "from django.urls import reverse; print(reverse('profile-photo', args=['K7F3QD']))"` → `/api/users/K7F3QD/photo/`.

#### Step B5 — `backend/users/views.py`: bump the version on upload

In `update_profile`'s multipart branch replace the two lines

```python
        user.save(update_fields=["profile_photo_data"])
        return Response({"status": "success", "user": user_payload(request, user)}, status=status.HTTP_200_OK)
```

with

```python
        # New bytes = new version: list rows carry it as ?v= on the public photo URL, so the
        # browser cache of the previous photo is left behind rather than invalidated.
        user.profile_photo_version += 1
        user.save(update_fields=["profile_photo_data", "profile_photo_version"])
        return Response({"status": "success", "user": user_payload(request, user)}, status=status.HTTP_200_OK)
```

Nothing else in `views.py` changes — `user_payload` keeps the inline data URL and gains no key.

Done-check: `grep -n "profile_photo_version" backend/users/views.py` → exactly 2 lines, both inside
`update_profile`; `grep -c "photo_version" backend/users/views.py` → `2`.

#### Step B6 — `backend/users/friends.py`: `photo_version` on every row, column loaded eagerly

6a. Replace `_brief` (lines 33-45) with:

```python
def _brief(request, user):
    # Photo bytes never travel in a list row: an inline data URL (users.views.profile_photo_url)
    # is ~15-35 KB and would multiply across every row. `profile_photo` stays None for client
    # compatibility; rows carry `photo_version` instead (0 = no photo) and the client builds the
    # cacheable URL /api/users/<id>/photo/?v=<photo_version> (users.photos.profile_photo_view).
    return {
        "id": user.public_id,
        "username": user.username,
        "points": user.points,
        "rank": user.rank,
        "profile_photo": None,
        "photo_version": user.profile_photo_version,
    }
```

6b. In `search_users`, change
`.only("id", "public_id", "username", "points", "rank")[:MAX_RESULTS]` to
`.only("id", "public_id", "username", "points", "rank", "profile_photo_version")[:MAX_RESULTS]`.

6c. In `search_friends`, replace the comment + `.only(...)` line (lines 296-299) with:

```python
    # _brief() reads the small profile_photo_version column, never the blob, so this leaves the
    # heavy profile_photo_data column off the fetched fields entirely rather than deferring it.
    qs = qs.only("id", "public_id", "username", "points", "rank", "profile_photo_version").order_by("-points", "username")
```

`friends_overview` needs no change: its `defer("<rel>__profile_photo_data")` already loads every
other column of the related user.

Done-check: `grep -c '"profile_photo_version"' backend/users/friends.py` → `2` (the two `.only`
lists); `grep -c "photo_version" backend/users/friends.py` → `5` (docstring comment ×2, dict key,
two `.only`).

#### Step B7 — `backend/users/tests.py`: extend `FriendsPhotoTests`, add `ProfilePhotoEndpointTests`

7a. Imports: add `from io import BytesIO`, `from importlib import import_module`, `from django.apps
import apps as django_apps`, `from django.core.files.uploadedfile import SimpleUploadedFile`,
`from PIL import Image`, and change `from users.models import Friendship` to
`from users.models import FriendRequest, Friendship`. Add this helper after `login()`:

```python
def png_bytes(color=(200, 30, 30)):
    """A tiny valid PNG for the multipart upload path (users.photos.normalize_profile_photo)."""
    buf = BytesIO()
    Image.new("RGB", (16, 16), color).save(buf, format="PNG")
    return buf.getvalue()
```

7b. `FriendsPhotoTests` — replace the class (lines 125-151) with:

```python
class FriendsPhotoTests(TestCase):
    """List endpoints (search, search-friends, friends-overview) never inline a photo's bytes —
    only the signed-in user's own /me payload does. Rows carry `photo_version` instead, which
    the client turns into the cacheable /api/users/<id>/photo/?v= URL. See users/friends.py `_brief`."""

    def setUp(self):
        self.me = User.objects.create_user(username="Searcher1", email="searcher@example.com", password="Testpass123!")
        self.access = str(issue_session_tokens(self.me).access_token)
        self.friend = User.objects.create_user(username="Photogenic", email="photo@example.com", password="Testpass123!")
        self.friend.profile_photo_data = b"fake-normalized-jpeg-bytes"
        self.friend.profile_photo_version = 1
        self.friend.save(update_fields=["profile_photo_data", "profile_photo_version"])
        lo, hi = Friendship.ordered_pair(self.me, self.friend)
        Friendship.objects.create(user_low=lo, user_high=hi)
        self.requester = User.objects.create_user(username="Requester", email="req@example.com", password="Testpass123!")
        self.requester.profile_photo_data = b"other-fake-jpeg-bytes"
        self.requester.profile_photo_version = 2
        self.requester.save(update_fields=["profile_photo_data", "profile_photo_version"])
        FriendRequest.objects.create(sender=self.requester, receiver=self.me)

    def test_search_and_overview_omit_photo_for_user_with_photo_data(self):
        resp = self.client.get(
            reverse("search-users"), {"q": "Photogenic"}, HTTP_AUTHORIZATION=f"Bearer {self.access}"
        )
        self.assertEqual(resp.status_code, 200)
        results = resp.json()["results"]
        self.assertEqual(len(results), 1)
        self.assertIsNone(results[0]["profile_photo"])
        self.assertEqual(results[0]["photo_version"], 1)

        resp = self.client.get(reverse("search-friends"), HTTP_AUTHORIZATION=f"Bearer {self.access}")
        self.assertEqual(resp.status_code, 200)
        friends = resp.json()["results"]
        self.assertEqual(len(friends), 1)
        self.assertIsNone(friends[0]["profile_photo"])
        self.assertEqual(friends[0]["photo_version"], 1)

        resp = self.client.get(reverse("friends-overview"), HTTP_AUTHORIZATION=f"Bearer {self.access}")
        self.assertEqual(resp.status_code, 200)
        incoming = resp.json()["incoming_requests"]
        self.assertEqual(len(incoming), 1)
        self.assertIsNone(incoming[0]["profile_photo"])
        self.assertEqual(incoming[0]["photo_version"], 2)
```

7c. Add this class directly after `FriendsPhotoTests` (before `SessionLifetimeTests`):

```python
class ProfilePhotoEndpointTests(TestCase):
    """GET api/users/<public_id>/photo/ — the public, cacheable bytes behind list rows
    (users/photos.py profile_photo_view)."""

    JPEG = b"\xff\xd8\xff\xe0fake-jpeg-bytes"

    def setUp(self):
        self.user = User.objects.create_user(username="Photogenic", email="photo@example.com", password="Testpass123!")
        self.user.profile_photo_data = self.JPEG
        self.user.profile_photo_version = 3
        self.user.save(update_fields=["profile_photo_data", "profile_photo_version"])
        self.url = reverse("profile-photo", args=[self.user.public_id])

    def test_current_version_is_served_immutable_without_auth(self):
        resp = self.client.get(self.url, {"v": "3"})
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp["Content-Type"], "image/jpeg")
        self.assertEqual(resp.content, self.JPEG)
        self.assertEqual(resp["Cache-Control"], "public, max-age=31536000, immutable")
        self.assertEqual(resp["ETag"], '"3"')

    def test_missing_or_stale_version_must_revalidate(self):
        for params in ({}, {"v": "2"}):
            resp = self.client.get(self.url, params)
            self.assertEqual(resp.status_code, 200, params)
            self.assertEqual(resp.content, self.JPEG)
            self.assertEqual(resp["Cache-Control"], "no-cache")
            self.assertEqual(resp["ETag"], '"3"')

    def test_matching_if_none_match_is_304(self):
        resp = self.client.get(self.url, {"v": "3"}, HTTP_IF_NONE_MATCH='"3"')
        self.assertEqual(resp.status_code, 304)
        self.assertEqual(resp.content, b"")

    def test_lowercase_public_id_resolves(self):
        resp = self.client.get(reverse("profile-photo", args=[self.user.public_id.lower()]), {"v": "3"})
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.content, self.JPEG)

    def test_no_photo_and_unknown_id_are_the_same_404(self):
        bare = User.objects.create_user(username="NoPhoto", email="bare@example.com", password="Testpass123!")
        for pid in (bare.public_id, "ZZZZZZ"):
            resp = self.client.get(reverse("profile-photo", args=[pid]), {"v": "1"})
            self.assertEqual(resp.status_code, 404, pid)
            self.assertEqual(resp["Cache-Control"], "no-store")
            self.assertFalse(resp.has_header("ETag"))
            self.assertEqual(resp.json(), {"error": "No photo."})

    def test_only_safe_methods(self):
        self.assertEqual(self.client.post(self.url).status_code, 405)

    def test_upload_bumps_version_rows_carry_it_and_me_keeps_the_data_url(self):
        access = str(issue_session_tokens(self.user).access_token)
        for expected in (4, 5):
            resp = self.client.post(
                reverse("update"),
                {"profile_photo": SimpleUploadedFile("p.png", png_bytes(), content_type="image/png")},
                HTTP_AUTHORIZATION=f"Bearer {access}",
            )
            self.assertEqual(resp.status_code, 200, resp.content)
            self.user.refresh_from_db()
            self.assertEqual(self.user.profile_photo_version, expected)
        # The new bytes are served under the new version; the old version now revalidates.
        resp = self.client.get(self.url, {"v": "5"})
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp["ETag"], '"5"')
        self.assertEqual(resp.content[:2], b"\xff\xd8")  # a real JPEG now
        self.assertEqual(self.client.get(self.url, {"v": "3"})["Cache-Control"], "no-cache")
        # /me/ keeps the inline data URL and gains no version key.
        me = self.client.get(reverse("get_user"), HTTP_AUTHORIZATION=f"Bearer {access}").json()["user"]
        self.assertTrue(me["profile_photo"].startswith("data:image/jpeg;base64,"))
        self.assertNotIn("photo_version", me)
        # Another player's search row carries the version, never the bytes.
        other = User.objects.create_user(username="Searcher1", email="searcher@example.com", password="Testpass123!")
        other_access = str(issue_session_tokens(other).access_token)
        rows = self.client.get(
            reverse("search-users"), {"q": "Photogenic"}, HTTP_AUTHORIZATION=f"Bearer {other_access}"
        ).json()["results"]
        self.assertEqual(rows[0]["photo_version"], 5)
        self.assertIsNone(rows[0]["profile_photo"])

    def test_backfill_gives_legacy_photos_version_1(self):
        legacy = User.objects.create_user(username="Legacy1", email="legacy@example.com", password="Testpass123!")
        legacy.profile_photo_data = self.JPEG
        legacy.save(update_fields=["profile_photo_data"])  # version stays 0, like a pre-0006 row
        bare = User.objects.create_user(username="NoPhoto", email="bare@example.com", password="Testpass123!")
        migration = import_module("users.migrations.0006_customuser_profile_photo_version")
        migration.backfill_photo_version(django_apps, None)
        legacy.refresh_from_db()
        bare.refresh_from_db()
        self.user.refresh_from_db()
        self.assertEqual(legacy.profile_photo_version, 1)
        self.assertEqual(bare.profile_photo_version, 0)
        self.assertEqual(self.user.profile_photo_version, 3)  # already-versioned rows are left alone
```

Done-check: `cd backend && .venv/bin/python manage.py test users` → `Ran 57 tests … OK`.

#### Step B8 — `docs/ARCHITECTURE.md`: document the endpoint

In the `**Account/leaderboard** (`/api/...`)` list, insert after the `get-users` bullet:

```
- `users/<public_id>/photo` — a player's profile photo as a cacheable JPEG (public; `?v=` is the
  version list rows carry as `photo_version`; `/me/` still inlines your own photo as a data URL)
```

Done-check: `grep -n "users/<public_id>/photo" docs/ARCHITECTURE.md` → one hit.

#### Step B9 — backend green and committed

Done-checks, all from `backend/`: `.venv/bin/python manage.py check` → no issues;
`.venv/bin/python manage.py makemigrations --check --dry-run` → `No changes detected`;
`.venv/bin/python manage.py test users trivia` → `OK`. Commit the backend files (B1-B8) as
`feat(users): cacheable public profile-photo endpoint + photo_version on list rows` with a body
naming D1-D4 in one line each and the migration (`0006`, AddField + backfill, shared dev/prod DB).
`git diff --stat HEAD~1` lists exactly the eight backend-side files.

### Frontend

Relies only on the Interfaces section: rows carry `photo_version: number` (0 = none) and
`GET ${BACKEND_URL}/users/<id>/photo/?v=<n>` serves the JPEG.

#### Step F1 — `src/components/ui/Avatar.tsx`: optional photo with initials fallback

Replace the file with:

```tsx
import { useState } from "react";

interface AvatarProps {
  initials: string;
  size?: number;
  bg?: string;
  /** Photo URL. The initials show while it is null and again if it fails to load. */
  src?: string | null;
}

export default function Avatar({
  initials,
  size = 28,
  bg = "linear-gradient(140deg, var(--brand), var(--brand-deep))",
  src = null,
}: AvatarProps) {
  // Remember which URL failed, not just "failed": a re-upload bumps the version in the URL,
  // and that new URL deserves a fresh attempt.
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const showPhoto = !!src && src !== failedSrc;
  return (
    <span
      style={{
        width: size,
        height: size,
        borderRadius: Math.round(size * 0.24),
        background: bg,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: Math.round(size * 0.42),
        fontWeight: 700,
        color: "#fff",
        flex: "none",
        overflow: "hidden",
      }}
    >
      {showPhoto ? (
        <img
          src={src}
          alt=""
          loading="lazy"
          decoding="async"
          onError={() => setFailedSrc(src)}
          style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
        />
      ) : (
        initials
      )}
    </span>
  );
}
```

No `"use client"` directive: like `FriendsPanel`/`Leaderboard` (hooks, no directive) it is only
ever rendered under the `"use client"` views. Inline styles match the file's existing convention
(no CSS file, no Tailwind — UI-5). Do not add `crossorigin`.

Done-check: `grep -c "src" src/components/ui/Avatar.tsx` ≥ 5; existing callers
(`Leaderboard.tsx`, `LeaderboardModal.tsx`) untouched — `git status --short` shows only `Avatar.tsx`.

#### Step F2 — `src/hooks/useFriends.ts`: the field and the URL helper

2a. Replace the `FriendUser` interface with:

```ts
export interface FriendUser {
  id: string;
  username: string;
  points: number;
  rank: string;
  /** Always null in list rows — the bytes only travel inline in /me/. */
  profile_photo: string | null;
  /** 0 = no photo; otherwise the cache key for friendPhotoUrl(). Bumped by every upload. */
  photo_version: number;
}
```

2b. Add after the `FriendsPage` interface:

```ts
/** The cacheable photo URL for a list row, or null when the player has no photo.
 * The version is part of the URL, so the browser keeps a hit for a year and a
 * re-upload (new version) is simply a new URL — no per-row byte loads, no
 * invalidation. `version > 0` is also false for undefined, so a backend that
 * predates the field just yields initials. */
export function friendPhotoUrl(id: string, version: number): string | null {
  return version > 0 ? `${BACKEND_URL}/users/${encodeURIComponent(id)}/photo/?v=${version}` : null;
}
```

Done-check: `grep -n "photo_version\|friendPhotoUrl" src/hooks/useFriends.ts` → 3 hits (interface
field, helper name, helper body uses `version`).

#### Step F3 — `src/components/FriendsPanel.tsx`: photos on every row

3a. Change the `useFriends` import to add `friendPhotoUrl`:

```ts
import {
  useFriends,
  searchUsers,
  searchFriends,
  friendPhotoUrl,
  type FriendUser,
  type FriendSearchResult,
} from "../hooks/useFriends";
```

3b. Replace all five `<Avatar initials={initials(X.username)} size={30} />` lines — incoming (`r`,
line 102), sent (`r`, line 137), blocked (`b`, line 168), friends (`f`, line 279), find (`r`, line
387) — with the same line plus the `src` prop, e.g. for the friends row:

```tsx
                <Avatar initials={initials(f.username)} size={30} src={friendPhotoUrl(f.id, f.photo_version)} />
```

(and `r.id, r.photo_version` / `b.id, b.photo_version` for the other rows). No CSS change: the
30px chip keeps its size; `Friends.css` is untouched.

Done-check: `grep -c "friendPhotoUrl(" src/components/FriendsPanel.tsx` → `5`;
`grep -c "<Avatar initials" src/components/FriendsPanel.tsx` → `5`.

#### Step F4 — frontend green and committed

Done-checks: `npx next typegen && npx tsc --noEmit` → exit 0; `npm run lint` → no errors. Commit
`Avatar.tsx`, `useFriends.ts`, `FriendsPanel.tsx` as `feat(friends): show profile photos in the
Friends rows via the cacheable photo endpoint, initials as fallback`. `git diff --stat HEAD~1`
lists exactly those three files. Browser QA per Test plan item 7 runs in the QA stage.

## Self-review (5b)

- **Coverage.** "cacheable way to show other players' photos in lists" → B3/B4 (endpoint, ETag,
  Cache-Control, `?v=`), B2/B5/B6 (version column, bump, `photo_version` on rows). "render it in
  FriendsModal rows with the initials Avatar as fallback" → F1-F3. "Keep the inline data URL for
  /me/" → B5 leaves `user_payload` alone; test 7c asserts it. "No paid storage" → bytes stay in the
  DB column; no infra, no Redis. Hard constraints: byte-free rows + `FriendsPhotoTests` (D4, 7b);
  stable URL that changes with the photo (D3); auth posture decided and justified (D1); no leak
  beyond the JPEG (B3, same 404 either way); 404 chosen over placeholder (D3); `<img>` loading
  answered (public endpoint, no header needed); fallback on missing/error (F1); version source +
  exact migration (D2, B2); tests + typecheck planned (B7, F4); steps grouped Backend then Frontend
  with the frontend relying only on Interfaces.
- **No placeholders.** Every step carries the exact code or exact text and a command with its
  expected output. The 404 body, header strings and ETag format are literal in both view and tests.
- **Consistency.** Names used identically across model, migration, view, `_brief`, tests, hook
  and panel: `profile_photo_version` (DB/model), `photo_version` (row key / TS field),
  `profile_photo_view` + URL name `profile-photo`, `friendPhotoUrl`. Test count 49 → 57 (1 extended,
  8 new). `?v=` value is `str(version)` on the server and `${version}` on the client.
- **Scope.** No leaderboard, relay, `Navigation`, `UserProfile`, `userSlice`, `Api.tsx`,
  `settings.py` or CSS changes. The `ARCHITECTURE.md` bullet is the one doc touch the new endpoint
  warrants; the stale "save points" wording next to it is left alone.
- **Ambiguity resolved.** (a) Public vs authenticated: public (D1). (b) 404 vs 204/placeholder:
  404 JSON, `no-store` (D3). (c) Version column vs hash vs timestamp: integer column with backfill
  (D2). (d) `profile_photo` key: kept `None`, new `photo_version` key, test extended in place (D4).
  (e) Throttle or not: not (D1). (f) Which rows get photos: all five, including blocked (D5).
  (g) Where the view lives: `users/photos.py` (the photo-concern module; `friends.py` is the
  precedent for per-concern endpoint modules), plain view per BE-9.
