"""Username moderation: plain Python, no AI, no external API, no new dependencies.

Two tiers with different matching modes (docs/team/designs/2026-10-06-ban-system-and-username.md D1):

* severe   (a strike on a name change): slurs, explicit sexual terms, the f-word family. Matched as a
             whole token, as a run of adjacent tokens ("Fu" + "Ck"), and — only for terms with
             >= SUBSTRING_MIN_LETTERS letters after collapsing repeats, explicit multi-word phrases, or
             terms the data marks `"substring": true` — as a substring of the letters-only "compact"
             name. `"token_only": true` opts a long term out when it sits inside a word ("draping") or
             straddles two real tokens ("Goat"+"Seth", "Isa"+"Lopez"); a term's `"except"` words
             ("snigger" for the n-slur) are removed from the compact name before the
             substring search. The allowlist NEVER cancels a severe hit.
* mild     (reject, no strike): ambiguous or short words and every other LDNOOBW entry.
* reserved (reject, no strike): names that impersonate staff ("admin1", "Moderator").
             Both match whole-token only.

Allowlist (every token of trivia/data/all-players.json + allowlist_extra.json) cancels MILD only:
a term that is itself a player-name token ("pau", "pele") is dropped from the mild list, and the
owner's strict mild words (dick, gay, ...) are cancelled only by a whole-name match: a run of
adjacent tokens that spells a real player ("DickBarnett", "Rudy_Gay").

Matching is run-aware rather than collapse-then-compare: "nigger" compiles to n+i+g{2,}e+r+, so
"niiiggger" matches but "Niger"/"Nigeria" do not, and "fuuuck" matches f+u+c+k+.

The word lists live under users/moderation_data/ and never leave the server: every message below is
generic and never echoes the matched term (check-name/ returns only these strings).
"""
import json
import os
import re
import unicodedata
from collections import namedtuple
from functools import lru_cache

from django.conf import settings

DATA_DIR = os.path.join(os.path.dirname(__file__), "moderation_data")
PLAYERS_PATH = os.path.join(settings.BASE_DIR, "trivia", "data", "all-players.json")

# Leetspeak digits. "1" is ambiguous (i or l), so both readings are tried.
LEET = {"0": "o", "1": ("i", "l"), "3": "e", "4": "a", "5": "s", "7": "t", "8": "b"}
SUBSTRING_MIN_LETTERS = 6
# Longest run of adjacent tokens joined when looking for a split term or a player's full name.
MAX_SPAN = 4

Verdict = namedtuple("Verdict", "tier reason")  # tier: "ok" | "severe" | "mild" | "reserved"
OK = Verdict("ok", "")

MESSAGE_BLOCKED = "That name isn't allowed. Please choose another."
MESSAGE_RESERVED = "That name is reserved. Please choose another."
MESSAGE_STRIKE = "That name isn't allowed. Repeated attempts will lead to a ban ({n} of 3)."
MESSAGE_SIGNUP_SEVERE = "That name isn't allowed. Repeated attempts will block sign-ups from your network."

_SEGMENT_RE = re.compile(r"[A-Za-z0-9]+")
# camelCase / ACRONYMWord / digit runs: "DickBarnett42" -> Dick, Barnett, 42; "NBAKing" -> NBA, King.
_WORD_RE = re.compile(r"[A-Z]+(?![a-z])|[A-Z]?[a-z]+|[0-9]+")


# ---------------------------------------------------------------------------
#  Normalization
# ---------------------------------------------------------------------------
def strip_accents(text):
    """Accents stripped, case kept ("Jokić" -> "Jokic")."""
    norm = unicodedata.normalize("NFKD", str(text or ""))
    return "".join(c for c in norm if not unicodedata.combining(c))


def fold(text):
    """Lowercase ASCII with accents stripped ("Coño" -> "cono", "pizdă" -> "pizda")."""
    return strip_accents(text).lower()


def letters(text):
    """Only a-z, after folding."""
    return re.sub(r"[^a-z]", "", fold(text))


def collapse(s):
    """Collapse runs of the same letter: "fuuuck" -> "fuck". Used to measure a term's length
    for the substring rule (matching itself is run-aware, see _term_pattern)."""
    return re.sub(r"(.)\1+", r"\1", s)


def _leet_reading(text, one):
    """Decode leet digits with "1" read as `one` everywhere, keeping camelCase readable.

    A decoded digit takes the case of the next letter (else the previous one), so "D1ck" -> "Dick"
    and "N1GGER" -> "NIGGER" still split into the right tokens. Linear in len(text).
    """
    n = len(text)
    nxt, prev = [""] * n, [""] * n
    last = ""
    for i in range(n - 1, -1, -1):
        nxt[i] = last
        if text[i].isalpha():
            last = text[i]
    last = ""
    for i in range(n):
        prev[i] = last
        if text[i].isalpha():
            last = text[i]
    out = []
    for i, c in enumerate(text):
        if c not in LEET:
            out.append(c)
            continue
        ch = one if c == "1" else LEET[c]
        out.append(ch.upper() if (nxt[i] or prev[i]).isupper() else ch)
    return "".join(out)


def _leet_variants(text):
    """At most two readings of the whole text: every "1" as "i", and every "1" as "l".

    Deliberately not the per-digit product: "1" * 20 is a valid username and 2**20 readings
    would make one check take minutes (a DoS on the unauthenticated check-name/ and signup/).
    """
    if not any(c in LEET for c in text):
        return [text]
    readings = [_leet_reading(text, "i")]
    if "1" in text:
        readings.append(_leet_reading(text, "l"))
    return readings


def _words(segment):
    return [w.lower() for w in _WORD_RE.findall(segment) if not w.isdigit()]


def token_sequences(name):
    """Ordered token lists for the name: the raw split (digits are separators) and each of the
    two leet readings. Runs of 3+ single letters are joined as well ("f_u_c_k" -> "fuck")."""
    text = strip_accents(name)
    raw = [w for seg in _SEGMENT_RE.findall(text) for w in _words(seg)]
    seqs = [raw]
    # The reading is applied to the whole name at once, so the count stays at two however many
    # segments carry a "1".
    for reading in _leet_variants(text):
        decoded = [w for seg in _SEGMENT_RE.findall(reading) for w in _words(seg)]
        if decoded not in seqs:
            seqs.append(decoded)
    out = []
    for seq in seqs:
        out.append(seq)
        joined, run = [], []
        for t in seq + [""]:
            if len(t) == 1:
                run.append(t)
                continue
            if len(run) >= 3:
                joined.append("".join(run))
            elif run:
                joined.extend(run)
            run = []
            if t:
                joined.append(t)
        if joined != seq:
            out.append(joined)
    return out


def _distinct_tokens(seqs):
    seen = []
    for seq in seqs:
        for t in seq:
            if t not in seen:
                seen.append(t)
    return seen


def tokenize(name):
    """Every distinct token the matcher considers, lowercased and leet-decoded."""
    return _distinct_tokens(token_sequences(name))


def compact_forms(name):
    """Letters-only lowercase forms: digits dropped, and each leet reading (1 -> i and 1 -> l)."""
    raw = strip_accents(name)
    forms = {letters(raw)}
    for reading in _leet_variants(raw):
        forms.add(letters(reading))
    forms.discard("")
    return forms


def _spans(seq):
    """Joined runs of 1..MAX_SPAN adjacent tokens, as (joined, start, end) triples."""
    for i in range(len(seq)):
        for j in range(i + 1, min(len(seq), i + MAX_SPAN) + 1):
            yield "".join(seq[i:j]), i, j


# ---------------------------------------------------------------------------
#  Data
# ---------------------------------------------------------------------------
def _load(name):
    with open(os.path.join(DATA_DIR, name), encoding="utf-8") as fh:
        return json.load(fh)


def _term_pattern(key):
    """"nigger" -> "n+i+g{2,}e+r+": extra repeats match, fewer letters than the term do not."""
    parts = []
    for m in re.finditer(r"(.)\1*", key):
        run = m.group(0)
        parts.append(f"{re.escape(run[0])}+" if len(run) == 1 else f"{re.escape(run[0])}{{{len(run)},}}")
    return "".join(parts)


def _alternation(keys):
    keys = sorted(set(keys), key=len, reverse=True)
    if not keys:
        return None
    return re.compile("(?:" + "|".join(_term_pattern(k) for k in keys) + ")")


def player_names():
    """Every name in trivia/data/all-players.json (empty if the bundle is missing)."""
    try:
        with open(PLAYERS_PATH, encoding="utf-8") as fh:
            return [str(n) for n in json.load(fh)]
    except (OSError, ValueError):
        return []


@lru_cache(maxsize=1)
def lists():
    """Compiled lists, built once per process."""
    severe = _load("severe.json")["terms"]
    mild = _load("mild.json")["terms"]
    reserved = _load("reserved.json")
    extra = _load("allowlist_extra.json")["words"]

    allow_tokens = set()
    allow_names = set()
    for full in player_names():
        parts = [letters(p) for p in re.split(r"[\s\-'.]+", fold(full))]
        allow_tokens.update(p for p in parts if p)
        allow_names.add(letters(full))
    for word in extra:
        allow_tokens.add(letters(word))
        if " " in word:
            allow_names.add(letters(word))

    severe_keys, severe_sub, severe_except = [], [], set()
    for entry in severe:
        key = letters(entry["term"])
        if not key:
            continue
        severe_keys.append(key)
        phrase = bool(re.search(r"[\s\-]", entry["term"].strip()))
        if not entry.get("token_only") and (
            entry.get("substring") or phrase or len(collapse(key)) >= SUBSTRING_MIN_LETTERS
        ):
            severe_sub.append(key)
            severe_except.update(letters(w) for w in entry.get("except", ()))

    mild_loose, mild_strict = [], []
    for entry in mild:
        key = letters(entry["term"])
        if len(key) < 3:
            continue
        if entry.get("strict"):
            mild_strict.append(key)
        elif key not in allow_tokens:
            mild_loose.append(key)

    return {
        "severe_keys": sorted(set(severe_keys)),
        "severe_token": _alternation(severe_keys),
        "severe_sub": _alternation(severe_sub),
        # Longest first, so a long exception is removed before a shorter one could split it.
        "severe_except": sorted(severe_except, key=len, reverse=True),
        "mild_keys": sorted(set(mild_loose) | set(mild_strict)),
        "mild_loose": _alternation(mild_loose),
        "mild_strict": _alternation(mild_strict),
        "reserved_token": {letters(r) for r in reserved["token"]},
        "reserved_whole": {_alnum(r) for r in reserved["whole_name"]},
        "allow_tokens": allow_tokens,
        "allow_names": allow_names,
    }


# ---------------------------------------------------------------------------
#  Verdict
# ---------------------------------------------------------------------------
def _full(rx, s):
    return rx is not None and rx.fullmatch(s) is not None


def _severe(seqs, forms, data):
    for seq in seqs:
        for joined, _, _ in _spans(seq):
            if _full(data["severe_token"], joined):
                return True
    rx = data["severe_sub"]
    if rx is None:
        return False
    for form in forms:
        for word in data["severe_except"]:
            form = form.replace(word, "-")
        if rx.search(form):
            return True
    return False


def _alnum(text):
    return re.sub(r"[^a-z0-9]", "", fold(text))


def _reserved(name, seqs, forms, data):
    if any(form in data["reserved_whole"] for form in forms | {_alnum(name)}):
        return True
    return any(t in data["reserved_token"] for t in _distinct_tokens(seqs))


def _whole_name_cover(seq, index, allow_names):
    """True if token `index` sits inside a run of adjacent tokens that spells a real player."""
    for i in range(max(0, index - MAX_SPAN + 1), index + 1):
        for j in range(index + 1, min(len(seq), i + MAX_SPAN) + 1):
            if j - i >= 2 and "".join(seq[i:j]) in allow_names:
                return True
    return False


def _mild(seqs, data):
    for seq in seqs:
        for i, tok in enumerate(seq):
            # A real player-name token ("Bonner", "Pau") is never a mild hit, even when a term's
            # repeat-tolerant pattern would stretch to it.
            if tok in data["allow_tokens"] and not _full(data["mild_strict"], tok):
                continue
            if _full(data["mild_loose"], tok):
                return True
            if _full(data["mild_strict"], tok) and not _whole_name_cover(seq, i, data["allow_names"]):
                return True
        # Multi-word mild phrases ("eat my ass") match a run of whole tokens.
        for joined, start, end in _spans(seq):
            if end - start > 1 and (_full(data["mild_loose"], joined) or _full(data["mild_strict"], joined)):
                if not any(_whole_name_cover(seq, k, data["allow_names"]) for k in range(start, end)):
                    return True
    return False


def check_username(name):
    """Verdict for a display name. Severe before reserved before mild; the allowlist only
    cancels mild. Never raises on odd input."""
    data = lists()
    # Built once and shared by every tier (each holds at most a handful of sequences/forms).
    seqs = token_sequences(name)
    forms = compact_forms(name)
    if _severe(seqs, forms, data):
        return Verdict("severe", "blocked")
    if _reserved(name, seqs, forms, data):
        return Verdict("reserved", "blocked")
    if _mild(seqs, data):
        return Verdict("mild", "blocked")
    return OK


def message_for(verdict):
    """The generic, never-echoing message for a non-ok verdict."""
    return MESSAGE_RESERVED if verdict.tier == "reserved" else MESSAGE_BLOCKED
