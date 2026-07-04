"""Public player IDs.

Every account gets a permanent 6-character ID (e.g. "K7F3QD") shown as #K7F3QD
throughout the app. Usernames are display names and do NOT have to be unique —
the ID is what tells two "Baller23"s apart. The alphabet drops 0/O and 1/I so
IDs are always unambiguous to read aloud or retype; 32^6 ≈ 1.07 billion
combinations leaves the space nearly empty even at millions of players.
"""
import secrets

PUBLIC_ID_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ"
PUBLIC_ID_LENGTH = 6


def generate_public_id() -> str:
    """One crypto-random candidate ID (uniqueness is enforced by the caller/DB)."""
    return "".join(secrets.choice(PUBLIC_ID_ALPHABET) for _ in range(PUBLIC_ID_LENGTH))
