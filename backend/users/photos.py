"""Profile-photo normalization. Photos are stored as JPEG bytes on CustomUser.profile_photo_data
(no filesystem/object storage: the API runs on read-only serverless disk) and served inline as a
data URL in user_payload()."""
import base64
from io import BytesIO

from PIL import Image, ImageOps

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
