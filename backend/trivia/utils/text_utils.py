import unicodedata


def wordle_word(last_name):
    """Return a clean 5-letter A-Z Wordle answer from a surname, or None.

    Strips accents so the answer is typeable on a standard keyboard
    (e.g. "Jokić" -> "Jokic", "Mañon" -> "Manon") and rejects anything that
    isn't exactly five ASCII letters after stripping (apostrophes, hyphens,
    spaces, non-Latin scripts).
    """
    norm = unicodedata.normalize("NFKD", last_name or "")
    ascii_name = "".join(c for c in norm if not unicodedata.combining(c))
    if len(ascii_name) == 5 and ascii_name.isascii() and ascii_name.isalpha():
        return ascii_name
    return None
