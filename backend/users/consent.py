"""Sign-up consent: Terms/Privacy acceptance and the minimum-age confirmation.

Accounts are for players aged MIN_AGE and over (guests of any age can still play without an
account; no name or email is stored for them). 13 is the COPPA line: below it, US law needs
verifiable parental consent, so it is the practical floor. Between 13 and 15 several EU states
still treat the player as a child for consent purposes, so those accounts are marked "teen" and
cannot upload a public profile photo (PHOTO_MIN_AGE); see docs/legal/OPEN_ITEMS.md.

Sign-up (owner decision 2026-10-11) is one tick-box, "I'm 13 or older and agree to the Terms of
Service and Privacy Policy", for email and Google alike: the request carries `accepted_terms` and
`age_confirmed`. That is a self-declaration, a weaker age gate than a birth-date screen, chosen by
the owner. The age stays unknown (age_group "") until the player adds a profile photo, when they
give their birth month and year (set_age_from_birth_date); until an age proves 16+ the account is
treated as a teen (is_teen). Older clients that still send birth_month/birth_year are accepted, and
those fields still refuse an under-13 sign-up.

The birth date is NEVER stored: only the coarse age group, that the confirmation was given, and when.
"""
import calendar
from datetime import date

from django.utils import timezone

# Bump when the Terms or Privacy Policy change materially; it is stored with each acceptance.
TERMS_VERSION = "2026-10-15.1"
MIN_AGE = 13
PHOTO_MIN_AGE = 16

CONSENT_REQUIRED_MESSAGE = "Please confirm you're 13 or older and agree to the Terms and Privacy Policy."
# Says the minimum plainly (owner decision 2026-10-10). Under-age sign-ups are refused and nothing is stored.
AGE_BLOCKED_MESSAGE = f"You need to be at least {MIN_AGE} years old to create an account."


def is_old_enough(birth_year, birth_month, today=None, min_age=MIN_AGE):
    """True only when the player is certainly at least `min_age`.

    Month + year only, so the exact day is unknown; we assume the last day of the birth month
    (the younger reading), so nobody under the limit passes by rounding in their favour.
    """
    today = today or date.today()
    try:
        year, month = int(birth_year), int(birth_month)
    except (TypeError, ValueError):
        return False
    if not (1 <= month <= 12) or year < 1900 or year > today.year:
        return False
    # They turn `min_age` on the last day of that month, `min_age` years on.
    last_day = calendar.monthrange(year + min_age, month)[1]
    return today >= date(year + min_age, month, last_day)


def has_birth_date(data):
    """True when an (older) client sent birth_month/birth_year with the request."""
    return any(data.get(key) not in (None, "") for key in ("birth_year", "birth_month"))


def check_consent(data, today=None):
    """Validate the consent fields of a sign-up request -> (ok, error_code, message).

    Needs `accepted_terms` and the 13+ confirmation: `age_confirmed`, or a birth date proving 13+
    from an older client. A birth date proving under 13 is refused even with the box ticked.
    """
    if data.get("accepted_terms") is not True:
        return False, "consent_required", CONSENT_REQUIRED_MESSAGE
    if has_birth_date(data):
        if not is_old_enough(data.get("birth_year"), data.get("birth_month"), today):
            return False, "age_requirement", AGE_BLOCKED_MESSAGE
    elif data.get("age_confirmed") is not True:
        return False, "consent_required", CONSENT_REQUIRED_MESSAGE
    return True, "", ""


def age_group_for(data, today=None):
    """"adult" (certainly PHOTO_MIN_AGE or over), "teen" (MIN_AGE up to PHOTO_MIN_AGE), or "" when no
    birth date was given (unknown; treated as teen). Only meaningful after check_consent passed. This
    coarse flag is all that is kept of the age."""
    if not has_birth_date(data):
        return ""
    return "adult" if is_old_enough(data.get("birth_year"), data.get("birth_month"), today, PHOTO_MIN_AGE) else "teen"


def consent_source_for(data, google=False):
    """How the 13+ confirmation was given, stored with the consent record."""
    via = "birth_date" if has_birth_date(data) else "checkbox"
    return f"google_signup_{via}" if google else f"signup_{via}"


def stamp_consent(user, age_group, source):
    """Record the accepted Terms version, the 13+ confirmation, how it was given and the coarse age
    group on a new account."""
    now = timezone.now()
    user.terms_accepted_at = now
    user.terms_version = TERMS_VERSION
    user.age_confirmed_at = now
    user.age_group = age_group
    user.consent_source = source


CONSENT_FIELDS = ["terms_accepted_at", "terms_version", "age_confirmed_at", "age_group", "consent_source"]


def is_teen(user):
    """Unknown age counts as teen: only an age that proves PHOTO_MIN_AGE+ makes an account public."""
    return getattr(user, "age_group", "") != "adult"


def set_age_from_birth_date(user, data, today=None):
    """Record the coarse age group from a birth month + year given at photo upload -> (ok, message).

    Only for an account whose age is still unknown, so a teen can't retry with another year. The
    birth date itself is not stored.
    """
    if user.age_group:
        return False, "Your age is already confirmed."
    if not is_old_enough(data.get("birth_year"), data.get("birth_month"), today, min_age=0):
        return False, "Please choose your birth month and year."
    user.age_group = age_group_for(data, today)
    user.save(update_fields=["age_group"])
    return True, ""
