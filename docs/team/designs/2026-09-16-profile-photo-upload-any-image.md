# Design: profile-photo-upload-any-image

Task: "Changing the photo of my account does not work. Make sure we allow any format; any size
of image is automatically cropped/fitted nicely to fit in our container."

Classify: hard / backend + ui / risk high. Design round 2026-09-16 (backend-engine +
frontend-engine proposals on sonnet, one sign-off pass).

## Decision summary

> **Superseded in review (2026-09-19):** the shipped migration is `0005_customuser_profile_photo_data` (after the friends-system `0004`) — `AddField` only. Friend-list rows return `profile_photo: null` (initials) until a cacheable photo endpoint exists. Dev and production share one database and the live backend still selects `profile_photo`, so the legacy `ImageField` stays (unused) and is dropped in a later two-step release. The normalizer also rejects images over 40 MP and flattens alpha after resizing.

**Engine: sonnet** — the plan below is long and every step carries an explicit done-check.

Sign-off: both engines' proposals agreed with the direction; the merged doc (decisions 4–5 below
differ from them on the alpha-flatten colour, where the 4 MiB cap lives, fixed error strings, and
test-file placement) was sent back for objections. backend-engine: OK (verified the migration
dependency, the admin-test import cleanup and the absence of a `DATA_UPLOAD_MAX_MEMORY_SIZE`
override). frontend-engine: OK with one minor objection — the `<img>` fallback in `decode()`
leaked the object URL on the zero-dimension early return — folded into step 8.

1. **Root cause.** `CustomUser.profile_photo` is an `ImageField` on `FileSystemStorage`
   (`MEDIA_ROOT`), and `/media/` is only routed when `DEBUG`. Production is Vercel serverless
   (read-only/ephemeral disk), so `update_profile` either fails or the file vanishes and the
   returned URL 404s. `UserProfile.tsx` hides this by previewing a local blob until reload.
2. **Storage: bytes in the database.** Zero infra, no new env vars, no paid service. The
   `SUPABASE_S3_*` keys in the local `backend/.env` are undocumented in `docs/DEPLOYMENT.md` /
   `docs/CREDENTIALS.md` and not known to be on Vercel, so object storage is out. New field
   `profile_photo_data = BinaryField(null=True, blank=True, editable=False)`; the old
   `ImageField` is removed (RemoveField + AddField, never touches the media dir; Postgres `bytea`,
   SQLite `BLOB`). Photos that only ever lived in a dev `backend/media/` folder are dropped —
   production never persisted any.
3. **Serving: data URL inline in the existing `profile_photo` field.** `user_payload()` emits
   `data:image/jpeg;base64,...` or `null`, so the client contract (`profile_photo: string | null`)
   and every render site (nav, profile, multiplayer cards/chips, imposter seats, socket relay)
   stay untouched. Leaderboard rows carry no photo (`users/leaderboard.top()` returns
   id/username/points; the UI draws initials via `ui/Avatar.tsx`), so the only payloads that
   grow are `/me/`, login/signup/google responses and the socket `identify` relay — ~15–35 KB
   each at 256×256 JPEG q82. A public `GET api/users/<id>/photo/` route would add a new
   unauthenticated surface, cache-busting, and one request per avatar for no payload win.
4. **Server normalization (never trust the client).** `users/photos.py`
   `normalize_profile_photo(bytes) -> bytes`: anything Pillow opens is accepted; EXIF-oriented;
   first frame of animated images; alpha composited onto the theme's avatar-chip background
   (`--surface3` = `#2b2b30`, RGB 43/43/48 — decided over "white" so transparent logos blend
   into the dark chip); centre-square crop + LANCZOS to 256×256; JPEG quality 82, optimize.
   Unreadable → `InvalidPhoto` → 400 with a fixed friendly message (never Pillow's text).
   The 4 MiB raw cap lives in the view (checked on `upload.size` before reading), not in the
   normalizer. `pillow-heif` is NOT added: HEIC works on Safari (browser decodes it) and gets
   the clear "couldn't read" error on Chrome — recorded as a possible follow-up.
5. **Client downscale (Vercel 4.5 MB body limit).** `src/utils/imagePrep.ts`
   `prepareProfilePhoto(file) -> Blob`: decode with `createImageBitmap` (EXIF applied), fall
   back to `<img>`; centre-square crop onto a ≤512×512 canvas filled with `#2b2b30`; export
   JPEG 0.9 (~≤150 KB for any input size). If the browser cannot decode: pass the raw file
   through when ≤ 4 MiB (server tries Pillow), otherwise fail client-side with a clear message.
   Canvas output carries no EXIF, so the server's `exif_transpose` is a no-op — no double
   rotation.
6. **Redux from the server response.** `update_profile` returns `{"status":"success","user":
   user_payload}`; the client dispatches `updateProfilePhoto(data.user.profile_photo)`. The
   blob preview is deleted. Nav avatar updates via Redux immediately; reload gets the same data
   URL from `/me/`.
7. **Containers.** Audited: `.nav3-avatar--photo img`, `.profile-avatar img`, `.om-pc-avatar img`,
   `.om-chip-av`, `.om-st-av`, `.fp-seat-av`, `.imp-av` already have a fixed square box,
   `border-radius: 50%` and `object-fit: cover`. No CSS changes. `ui/Avatar.tsx` is
   initials-only by design (leaderboard) and stays that way.

## Interfaces

### Backend

```python
# backend/users/photos.py
PHOTO_SIZE = 256
PHOTO_JPEG_QUALITY = 82
PHOTO_BACKGROUND = (43, 43, 48)           # theme.css --surface3 (#2b2b30)
MAX_PHOTO_UPLOAD_BYTES = 4 * 1024 * 1024  # under Vercel's 4.5 MB body limit

class InvalidPhoto(ValueError): ...
def normalize_profile_photo(data: bytes) -> bytes: ...   # JPEG bytes, always 256x256 RGB
def profile_photo_data_url(data) -> str | None: ...      # bytes/memoryview/None -> data URL | None
```

```python
# backend/users/models.py  (CustomUser)
profile_photo_data = models.BinaryField(null=True, blank=True, editable=False)
```

`POST api/update-profile/` (unchanged route, `IsAuthenticated`, multipart field `profile_photo`):

| Case | Status | Body |
|---|---|---|
| ok | 200 | `{"status": "success", "user": <user_payload>}` |
| no file | 400 | `{"error": "No file provided"}` |
| `upload.size > 4 MiB` | 400 | `{"error": "Image is too large. Please choose one under 4 MB."}` |
| Pillow can't open/decode | 400 | `{"error": "We couldn't read that image. Try a JPG, PNG, WebP or GIF."}` |

`user_payload.profile_photo`: `"data:image/jpeg;base64,<b64>"` or `null`. All other keys unchanged.

### Frontend

```ts
// src/utils/imagePrep.ts
export const PHOTO_MAX_UPLOAD_BYTES = 4 * 1024 * 1024;
export const PHOTO_CANVAS_SIZE = 512;
export const PHOTO_BACKGROUND = "#2b2b30";
export class PhotoPrepError extends Error {}
export async function prepareProfilePhoto(file: File): Promise<Blob>;
```

Client error string (thrown as `PhotoPrepError`, shown via `showErrorAlert(msg, "Upload Error")`):
`"We couldn't read that image. Try a JPG, PNG, WebP or GIF under 4 MB."`

Redux: `updateProfilePhoto(string)` unchanged; `User.profile_photo: string | null` unchanged.

## File plan

| File | Change |
|---|---|
| `backend/users/photos.py` | NEW — constants, `InvalidPhoto`, `normalize_profile_photo`, `profile_photo_data_url` |
| `backend/users/models.py` | remove `profile_photo` ImageField; add `profile_photo_data` BinaryField |
| `backend/users/migrations/0004_remove_customuser_profile_photo_and_more.py` | NEW — RemoveField + AddField |
| `backend/users/views.py` | `profile_photo_url` → data URL via `photos.profile_photo_data_url`; multipart branch normalizes + returns user |
| `backend/users/admin.py` | drop `'profile_photo'` from `fieldsets` and `add_fieldsets` |
| `backend/trivia/tests/test_admin_api.py` | drop the `profile_photo` form entry and the media temp-dir wrapper it existed for |
| `backend/users/test_photos.py` | NEW — normalizer + endpoint tests |
| `src/utils/imagePrep.ts` | NEW — browser crop/downscale |
| `src/components/UserProfile.tsx` | `handlePhotoUpload` uses `prepareProfilePhoto`, updates Redux from server JSON |

Untouched on purpose: `MEDIA_URL`/`MEDIA_ROOT`/`STORAGES` in settings and the `static()` line in
`backend/backend/urls.py` (dead after this change but unrelated to the bug — mention, don't
remove), `Navigation.tsx`, `userSlice.tsx`, `types.tsx`, all CSS, `multiplayer_server/`.

## Risks

- `models.py`, `views.py:update_profile`, `userSlice` are AUTH-9 high-risk surfaces; changes are
  confined to the photo field/branch. Login/signup/`/me/` shapes only change in the value of
  `profile_photo`.
- Migration on prod Postgres runs in the Vercel build (`manage.py migrate --noinput`): dropping a
  varchar column and adding a nullable `bytea` is metadata-only. Migration must be committed
  with the model change (BE-6) and `makemigrations --check --dry-run` must be clean.
- Base64 inflates ~33%; at ≤ ~35 KB per user this is fine for `/me/` and the socket
  `identify` payload (Socket.IO default `maxHttpBufferSize` 1 MB).
- `React` `key={user?.profile_photo || "default"}` on the profile `<img>` becomes a ~35 KB
  string — valid, and it is what triggers the crossfade on change. Left as is.
- Decompression bombs: Pillow's default `MAX_IMAGE_PIXELS` raises `DecompressionBombError`
  above ~178 MP — caught as `InvalidPhoto`. Huge-but-legal inputs (e.g. 12000×3000) decode in
  memory once; acceptable for a one-off upload, and the client normally sends ≤512² anyway.
- Django admin can no longer set a photo (non-editable BinaryField). Accepted — players upload
  through the app.
- HEIC on Chrome/Firefox: neither the browser nor Pillow (without `pillow-heif`) can decode it;
  the user gets the "couldn't read" error. Follow-up candidate, out of scope.
- Non-image file ≤ 4 MiB is sent raw and rejected by the server with the same clear message —
  one round trip, acceptable.

## Test plan

Backend (`cd backend && python manage.py test users trivia` — BE-18) — `users/test_photos.py`:

Normalizer (build inputs with Pillow in the test; assert on the returned bytes re-opened with
`Image.open`):
- `test_landscape_is_centre_cropped_to_square` — 900×300 with vertical thirds red|green|blue →
  256×256, format `JPEG`, mode `RGB`, pixels (5,128) and (250,128) both ≈ green (±12/channel).
- `test_portrait_is_centre_cropped_to_square` — 300×900 horizontal thirds → (128,5)/(128,250) ≈ green.
- `test_tiny_image_is_upscaled` — 8×8 red → 256×256, pixel (128,128) ≈ red.
- `test_huge_image_is_downscaled` — 6000×4000 mode `L` → 256×256, `len(out) < 48_000`.
- `test_png_alpha_is_flattened_on_chip_background` — 100×100 fully transparent RGBA PNG →
  pixel (50,50) ≈ (43,43,48).
- `test_animated_gif_uses_first_frame` — two-frame GIF (red, blue; `save_all=True`) → (128,128) ≈ red.
- `test_exif_orientation_is_applied` — 512×256 JPEG, left half red / right half blue, saved with
  `Image.Exif()` tag `0x0112 = 3` (180°) → after normalize (10,128) ≈ blue, (245,128) ≈ red.
- `test_corrupt_bytes_raise_invalid_photo` — `b"not an image"` and the first 120 bytes of a valid
  JPEG both raise `InvalidPhoto`.
- `test_data_url_helper` — `profile_photo_data_url(None) is None`, `profile_photo_data_url(b"")
  is None`, `profile_photo_data_url(memoryview(b"\xff\xd8"))` starts with `"data:image/jpeg;base64,"`.

Endpoint (authenticate the way `users/tests.py` does: signup → `HTTP_AUTHORIZATION="Bearer <access>"`;
`reverse("update")`):
- `test_requires_auth` — anonymous multipart POST → 401.
- `test_upload_png_returns_normalized_user` — 640×480 PNG → 200, `body["status"] == "success"`,
  `body["user"]["profile_photo"]` starts with `data:image/jpeg;base64,`; base64-decoding it and
  `Image.open` gives 256×256 JPEG; `user.refresh_from_db()` → `profile_photo_data` equals those
  bytes; `GET reverse("get_user")` returns the identical `profile_photo` string.
- `test_upload_replaces_previous_photo` — two uploads (red, then blue) → second response decodes ≈ blue.
- `test_oversize_upload_rejected` — `SimpleUploadedFile("big.jpg", b"\xff" * (4*1024*1024 + 1),
  content_type="image/jpeg")` → 400, exact "too large" message, `profile_photo_data` still None.
- `test_unreadable_upload_rejected` — `b"hello"` as `x.png` → 400, exact "couldn't read" message.
- `test_no_file_rejected` — empty multipart → 400 `"No file provided"`.
- `test_only_owner_is_changed` — user A uploads; user B's `profile_photo_data` stays None.

Existing suites must stay green: `users/tests.py`, `users/test_leaderboard.py`, all of `trivia/tests/`
(including the edited `test_admin_api.py`). `python manage.py makemigrations --check --dry-run` → no changes.

Frontend: `npm run lint`, `npm run build` (typecheck). No unit harness for the canvas helper.

Browser QA (browser-qa; needs Django running — if no `backend/.venv` exists the harness cannot run
Django; the next run installs it, note it in the verdict):
1. Log in, open the profile panel, "Change photo" → a landscape PNG (e.g. 1600×600). Expect: spinner,
   then the profile avatar shows the centre square of the image (no squash), the nav avatar chip
   changes at the same moment without reload, no console errors, the `update-profile/` response is
   200 with `user.profile_photo` starting `data:image/jpeg;base64,`.
2. Repeat with a tall JPEG (e.g. 600×1600). Expect the centre square, both avatars updated.
3. Hard reload. Expect both avatars still show the last upload (served from `/me/`).
4. Upload a `.txt` renamed to `.png`. Expect the "We couldn't read that image…" alert and the
   previous avatar untouched.
5. Mobile width (≤900px): nav shows the avatar-only chip with the new photo, round, not stretched.

## Implementation plan

Work in the task worktree only. Backend steps first (1–7), then frontend (8–9). Python may not be
installed with a venv in the worktree; where a step says "run", run it if `python -c "import django"`
works, otherwise write the file exactly as specified and rely on the verify stage.

### Step 1 — `backend/users/photos.py` (new)

Create the module with exactly these names:

```python
"""Profile-photo normalization. Photos are stored as JPEG bytes on CustomUser.profile_photo_data
(no filesystem/object storage: the API runs on read-only serverless disk) and served inline as a
data URL in user_payload()."""
import base64
from io import BytesIO

from PIL import Image, ImageOps, UnidentifiedImageError

PHOTO_SIZE = 256
PHOTO_JPEG_QUALITY = 82
# theme.css --surface3 (#2b2b30): the avatar chip background, so transparent PNGs blend in.
PHOTO_BACKGROUND = (43, 43, 48)
# Vercel rejects bodies over 4.5 MB; the browser downscales first, this is the server-side cap.
MAX_PHOTO_UPLOAD_BYTES = 4 * 1024 * 1024


class InvalidPhoto(ValueError):
    """Pillow could not open or decode the upload."""


def normalize_profile_photo(data: bytes) -> bytes:
    """Any image Pillow can open -> EXIF-oriented, first frame, centre-square 256x256 JPEG bytes."""
    try:
        img = Image.open(BytesIO(data))
        img.load()  # decodes frame 0 (animated formats) and fails on truncated/corrupt data
        img = ImageOps.exif_transpose(img)
    except (UnidentifiedImageError, Image.DecompressionBombError, OSError, ValueError, SyntaxError) as exc:
        raise InvalidPhoto("unreadable image") from exc
    if img.mode in ("RGBA", "LA") or (img.mode == "P" and "transparency" in img.info):
        img = img.convert("RGBA")
        background = Image.new("RGBA", img.size, PHOTO_BACKGROUND + (255,))
        img = Image.alpha_composite(background, img)
    img = img.convert("RGB")
    img = ImageOps.fit(img, (PHOTO_SIZE, PHOTO_SIZE), Image.Resampling.LANCZOS, centering=(0.5, 0.5))
    out = BytesIO()
    img.save(out, format="JPEG", quality=PHOTO_JPEG_QUALITY, optimize=True)
    return out.getvalue()


def profile_photo_data_url(data):
    """`data:image/jpeg;base64,...` for stored photo bytes (bytes or memoryview), else None."""
    if not data:
        return None
    return "data:image/jpeg;base64," + base64.b64encode(bytes(data)).decode("ascii")
```

Done when: the file imports cleanly (`python -c "import users.photos"` from `backend/` if a venv exists).

### Step 2 — `backend/users/models.py`

Replace the line
`profile_photo = models.ImageField(upload_to='profiles/', default='profiles/default.png')`
with:

```python
    # Normalized 256x256 JPEG bytes (users.photos). Stored in the DB because the API's disk is
    # read-only on Vercel; served inline as a data URL by users.views.user_payload.
    profile_photo_data = models.BinaryField(null=True, blank=True, editable=False)
```

Nothing else in the model changes. Done when: no other `profile_photo` reference remains in
`models.py`.

### Step 3 — migration `backend/users/migrations/0004_remove_customuser_profile_photo_and_more.py`

If Django is importable: `cd backend && python manage.py makemigrations users` and confirm it
produced exactly a `RemoveField(profile_photo)` + `AddField(profile_photo_data)` pair with that
filename. Otherwise write the file by hand in the auto-generated style:

```python
# Generated by Django 5.1 on 2026-09-16

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('users', '0003_identity_overhaul'),
    ]

    operations = [
        migrations.RemoveField(
            model_name='customuser',
            name='profile_photo',
        ),
        migrations.AddField(
            model_name='customuser',
            name='profile_photo_data',
            field=models.BinaryField(blank=True, editable=False, null=True),
        ),
    ]
```

Done when: `python manage.py makemigrations --check --dry-run` reports no changes (verify stage runs
it if no venv now).

### Step 4 — `backend/users/views.py`

a. Add `from users.photos import InvalidPhoto, MAX_PHOTO_UPLOAD_BYTES, normalize_profile_photo, profile_photo_data_url`
   next to the other `users.` imports.
b. Replace `profile_photo_url` (lines ~39–41) with:

```python
def profile_photo_url(request, user):
    """Inline data URL of the user's normalized profile photo, or None (see users.photos)."""
    return profile_photo_data_url(user.profile_photo_data)
```
   (keep the signature so `user_payload` is untouched).
c. Replace the multipart branch of `update_profile` with:

```python
    if request.content_type.startswith("multipart/form-data"):
        upload = request.FILES.get("profile_photo")
        if not upload:
            return Response({"error": "No file provided"}, status=status.HTTP_400_BAD_REQUEST)
        if upload.size > MAX_PHOTO_UPLOAD_BYTES:
            return Response(
                {"error": "Image is too large. Please choose one under 4 MB."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        try:
            user.profile_photo_data = normalize_profile_photo(upload.read())
        except InvalidPhoto:
            return Response(
                {"error": "We couldn't read that image. Try a JPG, PNG, WebP or GIF."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        user.save(update_fields=["profile_photo_data"])
        return Response({"status": "success", "user": user_payload(request, user)}, status=status.HTTP_200_OK)
```

Done when: the JSON (username) branch is byte-for-byte unchanged; `grep -n "profile_photo\b" views.py`
shows only the helper, `user_payload`, and the `request.FILES.get("profile_photo")` line.

### Step 5 — `backend/users/admin.py`

Remove `'profile_photo'` from the `'Personal info'` fieldset tuple and from `add_fieldsets`
`'fields'`. Done when: `grep profile_photo admin.py` is empty (a non-editable field in a fieldset
raises at admin load).

### Step 6 — `backend/trivia/tests/test_admin_api.py`

In `_add_user`: delete the `"profile_photo": SimpleUploadedFile(...)` entry and replace the
`with tempfile.TemporaryDirectory() as media: with override_settings(MEDIA_ROOT=media): return ...`
block with a plain `return self.client.post(self.ADD_URL, data)`. Delete the `GIF = bytes.fromhex(...)`
constant and its comment (lines ~71–72) and the now-unused imports `tempfile`,
`SimpleUploadedFile`, `override_settings` (keep `TestCase`). Done when: `grep -n "tempfile\|GIF\|override_settings\|SimpleUploadedFile"` in the file is empty and the file has no other use of them.

### Step 7 — `backend/users/test_photos.py` (new)

Implement every test in the Test plan above, two classes: `NormalizePhotoTests(TestCase)` and
`UpdateProfilePhotoTests(TestCase)`. Helpers at module top:
`def image_bytes(img, fmt, **save_kwargs)` (save to BytesIO, return bytes) and
`def decoded(out)` (`Image.open(BytesIO(out))`). Colour assertions use a tolerance of 12 per channel
(`assertLess(max(abs(a - b) for a, b in zip(px, expected)), 13)`). Auth: `signup(self.client, ...)`
copied from `users/tests.py` style (POST `reverse("signup")` JSON), token from `res.json()["access"]`,
requests with `HTTP_AUTHORIZATION=f"Bearer {access}"`; multipart uploads via
`self.client.post(reverse("update"), {"profile_photo": SimpleUploadedFile(name, data, content_type=...)})`.
Done when: `python manage.py test users trivia` is green (verify stage if no venv).

### Step 8 — `src/utils/imagePrep.ts` (new)

```ts
/** Browser-side prep for profile photo uploads: centre-square crop + downscale to a JPEG so any
 *  input size fits under the API's body limit. The server re-normalizes; this only bounds size. */
export const PHOTO_MAX_UPLOAD_BYTES = 4 * 1024 * 1024;
export const PHOTO_CANVAS_SIZE = 512;
/** theme.css --surface3: same flatten colour the server uses for transparent images. */
export const PHOTO_BACKGROUND = "#2b2b30";
export const PHOTO_UNREADABLE_MESSAGE = "We couldn't read that image. Try a JPG, PNG, WebP or GIF under 4 MB.";

export class PhotoPrepError extends Error {}

type Decoded = { source: CanvasImageSource; width: number; height: number; release: () => void };

async function decode(file: File): Promise<Decoded | null> {
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
    return { source: bitmap, width: bitmap.width, height: bitmap.height, release: () => bitmap.close() };
  } catch {
    // fall through to the <img> path (older browsers / formats createImageBitmap rejects)
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error("decode failed"));
      img.src = url;
    });
    if (!img.naturalWidth || !img.naturalHeight) {
      URL.revokeObjectURL(url);
      return null;
    }
    return { source: img, width: img.naturalWidth, height: img.naturalHeight, release: () => URL.revokeObjectURL(url) };
  } catch {
    URL.revokeObjectURL(url);
    return null;
  }
}

export async function prepareProfilePhoto(file: File): Promise<Blob> {
  const decoded = await decode(file);
  if (!decoded) {
    // The browser can't read it (e.g. HEIC on Chrome): let the server try, if it's small enough.
    if (file.size <= PHOTO_MAX_UPLOAD_BYTES) return file;
    throw new PhotoPrepError(PHOTO_UNREADABLE_MESSAGE);
  }
  try {
    const side = Math.min(decoded.width, decoded.height);
    const out = Math.max(1, Math.min(PHOTO_CANVAS_SIZE, side));
    const canvas = document.createElement("canvas");
    canvas.width = out;
    canvas.height = out;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new PhotoPrepError(PHOTO_UNREADABLE_MESSAGE);
    ctx.fillStyle = PHOTO_BACKGROUND;
    ctx.fillRect(0, 0, out, out);
    const sx = Math.floor((decoded.width - side) / 2);
    const sy = Math.floor((decoded.height - side) / 2);
    ctx.drawImage(decoded.source, sx, sy, side, side, 0, 0, out, out);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.9));
    if (!blob) throw new PhotoPrepError(PHOTO_UNREADABLE_MESSAGE);
    return blob;
  } finally {
    decoded.release();
  }
}
```

Done when: `npx tsc --noEmit` has no errors in this file (verify stage); no Tailwind, no DOM outside
the function.

### Step 9 — `src/components/UserProfile.tsx`

a. Add `import { PhotoPrepError, prepareProfilePhoto } from "../utils/imagePrep";` after the
   `apiFetch` import.
b. Replace `handlePhotoUpload` with:

```ts
  const handlePhotoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploadingPhoto(true);
    try {
      let photo: Blob;
      try {
        photo = await prepareProfilePhoto(file);
      } catch (err) {
        showErrorAlert(err instanceof PhotoPrepError ? err.message : "Photo upload failed", "Upload Error");
        return;
      }
      const formData = new FormData();
      formData.append("profile_photo", photo, "photo.jpg");

      const response = await apiFetch(`${BACKEND_URL}/update-profile/`, {
        method: "POST",
        body: formData,
      });
      const data = await response.json();
      if (response.ok && typeof data?.user?.profile_photo === "string") {
        // The server's normalized photo, not a local preview — what /me/ will return after reload.
        dispatch(updateProfilePhoto(data.user.profile_photo));
      } else {
        showErrorAlert(data?.error || "Photo upload failed", "Upload Error");
      }
    } finally {
      setUploadingPhoto(false);
      e.target.value = "";
    }
  };
```

   `URL.createObjectURL(file)` must no longer appear in the file. Everything else in the component
   (JSX, `key={user?.profile_photo || "default"}` crossfade, `accept="image/*"`) is unchanged.

Done when: `grep -n "createObjectURL" src/components/UserProfile.tsx` is empty; `npm run lint` and
`npm run build` pass (verify stage); browser QA steps 1–5 pass.

### Self-review (done by planner)

- Coverage: "does not work" → steps 1–4, 9 (persist in DB, serve inline, Redux from server); "any
  format" → step 1 (Pillow-opens-it rule) + step 8 pass-through; "any size … cropped/fitted" →
  step 8 (client bound) + step 1 (centre-square 256) + audited `object-fit: cover` containers.
- No placeholders: every step has literal code or an exact edit and a done-check.
- Consistency: names `profile_photo_data`, `normalize_profile_photo`, `profile_photo_data_url`,
  `InvalidPhoto`, `MAX_PHOTO_UPLOAD_BYTES`, `prepareProfilePhoto`, `PhotoPrepError` match across
  Interfaces / File plan / Test plan / steps; error strings identical in step 4, Test plan and step 8.
- Scope: no CSS, no nav/leaderboard/multiplayer changes, no settings/urls cleanup, no `pillow-heif`.
- Ambiguity resolved: transparent background = `#2b2b30` both sides; old dev photos dropped; admin
  cannot set photos; HEIC on Chrome = clear error.
