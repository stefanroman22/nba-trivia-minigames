"""Sign-up consent: Terms/Privacy acceptance and the minimum-age check.

Accounts are for players aged MIN_AGE and over (guests of any age can still play without an
account, and nothing about them is stored). 16 is the one number that keeps parental-consent
rules (GDPR Art 8, COPPA, similar) from applying to account holders; lowering it is a legal
decision, see docs/legal/.

The age check is neutral (month + year of birth, no hint of the cut-off) and the birth date is
NEVER stored: only that the check passed, and when.
"""
import calendar
from datetime import date

from django.utils import timezone

# Bump when the Terms or Privacy Policy change materially; it is stored with each acceptance.
TERMS_VERSION = "2026-10-07"
MIN_AGE = 16

CONSENT_REQUIRED_MESSAGE = "Please agree to the Terms of Service and Privacy Policy to create an account."
AGE_BLOCKED_MESSAGE = "You can't create an account right now."  # deliberately says nothing about why


def is_old_enough(birth_year, birth_month, today=None):
    """True only when the player is certainly at least MIN_AGE.

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
    # They turn MIN_AGE on the last day of that month, MIN_AGE years on.
    last_day = calendar.monthrange(year + MIN_AGE, month)[1]
    return today >= date(year + MIN_AGE, month, last_day)


def check_consent(data, today=None):
    """Validate the consent fields of a sign-up request -> (ok, error_code, message)."""
    if data.get("accepted_terms") is not True:
        return False, "consent_required", CONSENT_REQUIRED_MESSAGE
    if not is_old_enough(data.get("birth_year"), data.get("birth_month"), today):
        return False, "age_requirement", AGE_BLOCKED_MESSAGE
    return True, "", ""


def stamp_consent(user):
    """Record the accepted Terms version and the passed age check on a new account."""
    now = timezone.now()
    user.terms_accepted_at = now
    user.terms_version = TERMS_VERSION
    user.age_confirmed_at = now
