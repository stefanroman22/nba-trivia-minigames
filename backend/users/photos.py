"""Profile-photo normalization. Photos are stored as JPEG bytes on CustomUser.profile_photo_data
(no filesystem/object storage: the API runs on read-only serverless disk) and served inline as a
data URL in user_payload() (the signed-in user's own payload only) and, for everyone else's list
rows, by profile_photo_view() below."""
import base64
from io import BytesIO

from PIL import Image, ImageOps
from django.contrib.auth import get_user_model
from django.http import HttpResponse, JsonResponse
from django.views.decorators.http import condition, require_safe

PHOTO_SIZE = 256
PHOTO_JPEG_QUALITY = 82
# theme.css --surface3 (#2b2b30): the avatar chip background, so transparent PNGs blend in.
PHOTO_BACKGROUND = (43, 43, 48)
# Vercel rejects bodies over 4.5 MB; the browser downscales first, this is the server-side cap.
MAX_PHOTO_UPLOAD_BYTES = 4 * 1024 * 1024
# A small, valid file can still declare huge dimensions (e.g. a 31 KB PNG at 12000x9000) that
# pass the byte cap but decode/composite into buffers big enough to OOM the function.
MAX_PHOTO_PIXELS = 40_000_000


class InvalidPhoto(ValueError):
    """Pillow could not open or decode the upload."""


def normalize_profile_photo(data: bytes) -> bytes:
    """Any image Pillow can open -> EXIF-oriented, first frame, centre-square 256x256 JPEG bytes."""
    try:
        img = Image.open(BytesIO(data))
        if img.width * img.height > MAX_PHOTO_PIXELS:
            raise InvalidPhoto("image dimensions too large")
        img.load()  # decodes frame 0 (animated formats) and fails on truncated/corrupt data
        img = ImageOps.exif_transpose(img)
        if img.mode in ("RGBA", "LA") or (img.mode == "P" and "transparency" in img.info):
            # Reduce to the output size before compositing so the alpha-flatten background
            # buffer is 256x256, not full source resolution.
            img = img.convert("RGBA")
            img = ImageOps.fit(img, (PHOTO_SIZE, PHOTO_SIZE), Image.Resampling.LANCZOS, centering=(0.5, 0.5))
            background = Image.new("RGBA", img.size, PHOTO_BACKGROUND + (255,))
            img = Image.alpha_composite(background, img)
            img = img.convert("RGB")
        else:
            img = img.convert("RGB")
            img = ImageOps.fit(img, (PHOTO_SIZE, PHOTO_SIZE), Image.Resampling.LANCZOS, centering=(0.5, 0.5))
        out = BytesIO()
        img.save(out, format="JPEG", quality=PHOTO_JPEG_QUALITY, optimize=True)
        return out.getvalue()
    except InvalidPhoto:
        raise
    except Exception as exc:
        # Pillow's own exception text (which can be arbitrary/adversarial) must never reach the
        # client; the view returns a fixed, friendly message for any InvalidPhoto.
        raise InvalidPhoto("unreadable image") from exc


def profile_photo_data_url(data):
    """`data:image/jpeg;base64,...` for stored photo bytes (bytes or memoryview), else None."""
    if not data:
        return None
    return "data:image/jpeg;base64," + base64.b64encode(bytes(data)).decode("ascii")


# A year: a URL whose ?v= names the current version can never go stale — a new upload bumps
# the version, so every list row points at a new URL (users.friends._brief).
PHOTO_MAX_AGE = 60 * 60 * 24 * 365


def _photo_etag(request, public_id):
    """ETag for the photo endpoint: the stored version, or None (no ETag) when there is no photo.
    Runs before the view, so a matching If-None-Match is answered 304 without loading the bytes.

    `public_id.upper()` (not `__iexact`) so the lookup can use the unique b-tree index on
    `public_id`: `__iexact` compiles to `UPPER(public_id) = UPPER(%s)`, which can't use that
    index and forces a sequential scan on this unauthenticated, unthrottled endpoint. Rows always
    store the canonical uppercase id (`PUBLIC_ID_ALPHABET` in users.identity is uppercase-only),
    so uppercasing the input here is the same case-insensitive contract, just indexed."""
    User = get_user_model()
    version = (
        User.objects.filter(public_id=public_id.upper())
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
        User.objects.filter(public_id=public_id.upper())
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
