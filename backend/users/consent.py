"""Sign-up consent: the Terms of Service / Privacy Policy acceptance.

Owner decision 2026-10-11 (pre-launch): there is no age check in the app. The Terms say accounts are
for players aged 13 and over; sign-up asks for no age. Agreement is by the text under the sign-up
buttons ("By creating an account or continuing with Google you agree to ..."): email sign-up sends
`accepted_terms` when the button is pressed, and a brand-new Google account is created on return
with source "google_continue". Older clients that still send `age_confirmed` or birth_month /
birth_year are accepted and those fields are ignored. See docs/legal/OPEN_ITEMS.md.

The age_confirmed_at / age_group / birth_month / birth_year / age_sets columns stay in the database
(no destructive migration); nothing writes them any more and nothing reads them to decide anything.
"""
from django.utils import timezone

# Bump when the Terms or Privacy Policy change materially; it is stored with each acceptance.
TERMS_VERSION = "2026-10-29.1"

CONSENT_REQUIRED_MESSAGE = "Please agree to the Terms of Service and Privacy Policy."

EMAIL_SIGNUP_SOURCE = "signup_text"
GOOGLE_SIGNUP_SOURCE = "google_continue"


def check_consent(data):
    """Validate an email sign-up request's consent -> (ok, error_code, message). Needs `accepted_terms`."""
    if data.get("accepted_terms") is not True:
        return False, "consent_required", CONSENT_REQUIRED_MESSAGE
    return True, "", ""


def stamp_consent(user, source):
    """Record the accepted Terms version, when, and how it was agreed on a new account."""
    user.terms_accepted_at = timezone.now()
    user.terms_version = TERMS_VERSION
    user.consent_source = source


CONSENT_FIELDS = ["terms_accepted_at", "terms_version", "consent_source"]
