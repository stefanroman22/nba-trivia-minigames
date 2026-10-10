"""Sign-up consent: Terms/Privacy acceptance and the minimum-age check.

Accounts are for players aged MIN_AGE and over (guests of any age can still play without an
account; no name or email is stored for them). 13 is the COPPA line: below it, US law needs
verifiable parental consent, so it is the practical floor. Between 13 and 15 several EU states
still treat the player as a child for consent purposes, so those accounts are marked "teen" and
cannot upload a public profile photo (PHOTO_MIN_AGE); see docs/legal/OPEN_ITEMS.md.

The age check is neutral (month + year of birth, no hint of the cut-off) and the birth date is
NEVER stored: only that the check passed, and when.
"""
import calendar
from datetime import date

from django.utils import timezone

# Bump when the Terms or Privacy Policy change materially; it is stored with each acceptance.
TERMS_VERSION = "2026-10-08.2"
MIN_AGE = 13
PHOTO_MIN_AGE = 16

CONSENT_REQUIRED_MESSAGE = "Please agree to the Terms of Service and Privacy Policy to create an account."
# Says the minimum plainly (owner decision 2026-10-10). GDPR doesn't require a "neutral" age screen;
# that is US COPPA / UK AADC best practice, and the 13+ minimum is already public in the Terms and
# Privacy Policy. Under-age sign-ups are still refused and nothing is stored.
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


def check_consent(data, today=None):
    """Validate the consent fields of a sign-up request -> (ok, error_code, message)."""
    if data.get("accepted_terms") is not True:
        return False, "consent_required", CONSENT_REQUIRED_MESSAGE
    if not is_old_enough(data.get("birth_year"), data.get("birth_month"), today):
        return False, "age_requirement", AGE_BLOCKED_MESSAGE
    return True, "", ""


def age_group_for(data, today=None):
    """"adult" (certainly PHOTO_MIN_AGE or over) or "teen" (MIN_AGE up to PHOTO_MIN_AGE). Only
    meaningful after check_consent passed. This coarse flag is all that is kept of the age."""
    return "adult" if is_old_enough(data.get("birth_year"), data.get("birth_month"), today, PHOTO_MIN_AGE) else "teen"


def stamp_consent(user, age_group):
    """Record the accepted Terms version, the passed age check and the coarse age group on a new account."""
    now = timezone.now()
    user.terms_accepted_at = now
    user.terms_version = TERMS_VERSION
    user.age_confirmed_at = now
    user.age_group = age_group
