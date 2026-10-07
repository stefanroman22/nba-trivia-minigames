"""Profile-photo moderation client (docs/team/designs/2026-10-07-photo-moderation-with-a-small.md).

Django never runs the classifier: it POSTs the normalized 256x256 JPEG to the separate
`moderation_service` Vercel project (onnxruntime stays out of this bundle) and decides from the scores.

FAIL CLOSED. Any transport error, timeout (after one retry), non-200, malformed body, or "required but
not configured" raises ModerationUnavailable and the caller saves nothing. The check is skipped only
when MODERATION_REQUIRED is false (local sqlite) AND IMAGE_MODERATION_URL is unset, with a warning.

Image bytes are never logged, stored or put in an exception message — only scores and the user's pk.
"""
import logging
import math
from dataclasses import dataclass

from django.conf import settings

logger = logging.getLogger(__name__)

TIMEOUT_SECONDS = 4
ATTEMPTS = 2  # the first call plus one retry on timeout / connection error / 5xx

BLOCK = "block"
REVIEW = "review"
ALLOW = "allow"

MESSAGE_PHOTO_REJECTED = "That photo isn't allowed. Repeated attempts will lead to a ban ({n} of 3)."
MESSAGE_MODERATION_UNAVAILABLE = "Photo check is unavailable right now, try again later."


class ModerationUnavailable(Exception):
    """The photo could not be checked; the upload must be refused (503), never allowed."""


@dataclass(frozen=True)
class Scores:
    nsfw: float
    nsfl: float
    sfw: float
    model: str
    version: str


def _parse_scores(body):
    try:
        values = {k: float(body[k]) for k in ("nsfw", "nsfl", "sfw")}
    except (KeyError, TypeError, ValueError):
        raise ModerationUnavailable("malformed moderation response") from None
    # NaN compares False against every threshold, which would read as "allow": refuse it instead.
    if not all(math.isfinite(v) and 0.0 <= v <= 1.0 for v in values.values()):
        raise ModerationUnavailable("moderation scores out of range")
    return Scores(model=str(body.get("model") or ""), version=str(body.get("version") or ""), **values)


def classify_photo(jpeg):
    """POST the JPEG to IMAGE_MODERATION_URL and return its Scores; ModerationUnavailable on any failure."""
    url = settings.IMAGE_MODERATION_URL
    secret = settings.MODERATION_SHARED_SECRET
    if not url or not secret:
        raise ModerationUnavailable("image moderation is not configured")
    import requests  # lazy: keeps the request path's startup imports unchanged

    headers = {"X-Moderation-Key": secret, "Content-Type": "image/jpeg"}
    failure = "no attempt"
    for _ in range(ATTEMPTS):
        try:
            res = requests.post(url, data=jpeg, headers=headers, timeout=TIMEOUT_SECONDS)
        except (requests.Timeout, requests.ConnectionError) as exc:
            failure = exc.__class__.__name__
            continue
        except requests.RequestException as exc:
            raise ModerationUnavailable(exc.__class__.__name__) from None
        if res.status_code >= 500:
            failure = f"HTTP {res.status_code}"
            continue
        if res.status_code != 200:
            raise ModerationUnavailable(f"HTTP {res.status_code}")
        try:
            body = res.json()
        except ValueError:
            raise ModerationUnavailable("moderation response is not JSON") from None
        if not isinstance(body, dict):
            raise ModerationUnavailable("malformed moderation response")
        return _parse_scores(body)
    raise ModerationUnavailable(failure)


def decide(scores):
    """"block" | "review" | "allow" on max(nsfw, nsfl) against the settings thresholds."""
    score = max(scores.nsfw, scores.nsfl)
    if score >= settings.PHOTO_BLOCK_THRESHOLD:
        return BLOCK
    if score >= settings.PHOTO_REVIEW_THRESHOLD:
        return REVIEW
    return ALLOW


def moderate_photo(jpeg, user_pk=None):
    """The decision for one normalized photo, or None when the check is skipped (local dev only).

    Raises ModerationUnavailable when the check is required but unconfigured, or the service fails.
    """
    if not settings.IMAGE_MODERATION_URL and not settings.MODERATION_REQUIRED:
        logger.warning(
            "IMAGE_MODERATION_URL is unset and MODERATION_REQUIRED is false: profile photo NOT moderated "
            "(user %s). Never run production like this.",
            user_pk,
        )
        return None
    try:
        scores = classify_photo(jpeg)
    except ModerationUnavailable as exc:
        logger.error("photo moderation unavailable (user %s): %s", user_pk, exc)
        raise
    decision = decide(scores)
    if decision != ALLOW:
        logger.info(
            "photo moderation %s (user %s): nsfw=%.3f nsfl=%.3f sfw=%.3f model=%s",
            decision, user_pk, scores.nsfw, scores.nsfl, scores.sfw, scores.version,
        )
    return decision
