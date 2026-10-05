"""Google sign-in: exchange the browser's authorization code and verify the identity.

Kept out of views.py so the network call can be mocked in tests and so the heavy
imports (requests + google-auth, ~0.5 s) stay lazy (guard: trivia/tests/test_startup.py).
"""
import os

# "postmessage" is the redirect URI Google's popup (auth-code) flow uses.
REDIRECT_URI = "postmessage"
TOKEN_URL = "https://oauth2.googleapis.com/token"
TOKEN_TIMEOUT_SECONDS = 8


class GoogleAuthError(Exception):
    """The code could not be turned into a verified Google identity.

    `public_message` is safe to show the player; the exception text is for logs only.
    """

    def __init__(self, public_message, detail=""):
        super().__init__(detail or public_message)
        self.public_message = public_message


def verify_google_code(code):
    """Exchange an auth code and return `{"sub", "email", "name"}` for a VERIFIED identity.

    Raises GoogleAuthError for every failure, including an unverified email address:
    accepting one would let anybody who can register that address at Google take over
    the matching account here.
    """
    client_id = os.getenv("CLIENT_ID")
    client_secret = os.getenv("CLIENT_SECRET")
    if not client_id or not client_secret:
        raise GoogleAuthError("Google sign-in isn't available right now.", "CLIENT_ID/CLIENT_SECRET not set")

    import requests
    from google.oauth2 import id_token
    from google.auth.transport import requests as google_requests

    try:
        token_json = requests.post(
            TOKEN_URL,
            data={
                "code": code,
                "client_id": client_id,
                "client_secret": client_secret,
                "redirect_uri": REDIRECT_URI,
                "grant_type": "authorization_code",
            },
            timeout=TOKEN_TIMEOUT_SECONDS,
        ).json()
    except (requests.RequestException, ValueError) as exc:
        raise GoogleAuthError("Couldn't reach Google. Please try again.", f"token exchange failed: {exc}")

    raw = token_json.get("id_token")
    if not raw:
        raise GoogleAuthError(
            "Google sign-in failed. Please try again.",
            f"no id_token: {token_json.get('error')} {token_json.get('error_description')}",
        )

    try:
        # Checks signature, expiry, issuer and that the audience is OUR client id.
        info = id_token.verify_oauth2_token(raw, google_requests.Request(), client_id)
    except ValueError as exc:
        raise GoogleAuthError("Google sign-in failed. Please try again.", f"id_token rejected: {exc}")

    sub = info.get("sub")
    email = (info.get("email") or "").strip().lower()
    if not sub or not email:
        raise GoogleAuthError("Your Google account didn't share an email address.", "missing sub/email")
    if info.get("email_verified") is not True:
        raise GoogleAuthError("Verify your Google email address first, then try again.", "email_verified is false")

    return {"sub": sub, "email": email, "name": info.get("name") or ""}
