"""Username matcher (users.moderation_text): false positives on real names, recall on generated variants.

The offensive set is generated PROGRAMMATICALLY from the seed terms in moderation_data/severe.json and
mild.json (leet, repeated letters, camelCase, underscores, digit suffixes); no slur is hand-written here.
The measured numbers are printed so the build report can quote them.
"""
import json
import os
import re

from django.test import SimpleTestCase

from users import moderation_text as mt

USERNAME_RE = re.compile(r"^[A-Za-z0-9_]{3,20}$")
LEET_OUT = {"a": "4", "e": "3", "i": "1", "o": "0", "s": "5", "t": "7"}


def _benign():
    with open(os.path.join(mt.DATA_DIR, "corpus", "benign.json"), encoding="utf-8") as fh:
        data = json.load(fh)
    return {k: v for k, v in data.items() if isinstance(v, list)}


def _seed_words(entry):
    words = [mt.letters(w) for w in re.split(r"[\s\-']+", entry["term"]) if mt.letters(w)]
    return words


def variants(words):
    """Evasion variants of one seed (a list of letters-only words), all valid usernames."""
    base = "".join(words)
    camel = "".join(w.capitalize() for w in words)
    first_vowel = re.search(r"[aeiou]", base)
    out = {
        base + "123",                                            # digit suffix
        camel + "Master",                                        # camelCase
        "the_" + "_".join(words),                                # underscores
        base.upper() + "7",                                      # shouting
        "".join(LEET_OUT.get(c, c) for c in base),               # leet, every letter
        base + base[-1] * 3,                                     # repeated last letter
    }
    for i, c in enumerate(base):                                 # leet, first substitutable letter
        if c in LEET_OUT:
            out.add(base[:i] + LEET_OUT[c] + base[i + 1:] + "_x")
            break
    if first_vowel:                                              # repeated vowel
        i = first_vowel.start()
        out.add(base[:i] + base[i] * 3 + base[i + 1:])
    if len(base) <= 10:                                          # letter-by-letter split
        out.add("_".join(base))
    return sorted(v for v in out if USERNAME_RE.match(v))


def _offensive(path):
    with open(os.path.join(mt.DATA_DIR, path), encoding="utf-8") as fh:
        return json.load(fh)["terms"]


class RequiredNamesTests(SimpleTestCase):
    REQUIRED = [
        "Rudy Gay", "Dick Barnett", "Dell Curry", "Terry Cummings", "Collin Sexton",
        "CurryFan30", "DikembeMutombo", "Cockburn", "RudyGay", "DickBarnett", "AssistKing", "GlassCleaner",
    ]

    def test_required_names_pass(self):
        for name in self.REQUIRED:
            with self.subTest(name=name):
                self.assertEqual(mt.check_username(name).tier, "ok")

    def test_every_player_name_is_never_severe(self):
        names = mt.player_names()
        self.assertGreater(len(names), 5000)
        severe = [n for n in names if mt.check_username(n).tier == "severe"]
        compact = [n for n in names if mt.check_username(mt.letters(n)[:40]).tier == "severe"]
        not_ok = [n for n in names if mt.check_username(n).tier != "ok"]
        print(f"\n[moderation] players: {len(names)} names, severe {len(severe)}, "
              f"compact-severe {len(compact)}, any block {len(not_ok)}")
        self.assertEqual(severe, [])
        self.assertEqual(compact, [])
        self.assertEqual(not_ok, [])

    def test_no_severe_term_is_a_player_token(self):
        tokens = mt.lists()["allow_tokens"]
        rx = mt.lists()["severe_token"]
        hits = sorted(t for t in tokens if rx.fullmatch(t))
        self.assertEqual(hits, [])


class BenignCorpusTests(SimpleTestCase):
    def test_benign_corpus(self):
        corpus = _benign()
        total = sum(len(v) for v in corpus.values())
        blocked = {k: [n for n in v if mt.check_username(n).tier != "ok"] for k, v in corpus.items()}
        severe = [n for v in corpus.values() for n in v if mt.check_username(n).tier == "severe"]
        n_blocked = sum(len(v) for v in blocked.values())
        print(f"\n[moderation] benign: {n_blocked}/{total} blocked "
              f"({', '.join(f'{k} {len(v)}' for k, v in blocked.items())}); severe {len(severe)}")
        self.assertGreaterEqual(total, 150)
        self.assertEqual(blocked["nba"], [])
        self.assertEqual(severe, [])
        self.assertLessEqual(n_blocked, 1, blocked)


class RecallTests(SimpleTestCase):
    def test_generated_offensive_recall(self):
        sev_total = sev_hit = mild_total = mild_hit = 0
        missed = []
        for entry in _offensive("severe.json"):
            for v in variants(_seed_words(entry)):
                sev_total += 1
                if mt.check_username(v).tier == "severe":
                    sev_hit += 1
                else:
                    missed.append(("severe", v))
        effective_mild = set(mt.lists()["mild_keys"])
        for entry in _offensive("mild.json"):
            words = _seed_words(entry)
            # Terms skipped at load because they are real player-name tokens are allowed by design.
            if "".join(words) not in effective_mild:
                continue
            for v in variants(words):
                mild_total += 1
                if mt.check_username(v).tier != "ok":
                    mild_hit += 1
                else:
                    missed.append(("mild", v))
        sev_recall = sev_hit / sev_total
        overall = (sev_hit + mild_hit) / (sev_total + mild_total)
        print(f"\n[moderation] recall: severe {sev_hit}/{sev_total} = {sev_recall:.1%}; "
              f"mild {mild_hit}/{mild_total} = {mild_hit / mild_total:.1%}; "
              f"overall {sev_hit + mild_hit}/{sev_total + mild_total} = {overall:.1%}")
        self.assertGreaterEqual(sev_total, 150)
        self.assertGreaterEqual(sev_recall, 0.98, [m for m in missed if m[0] == "severe"][:40])
        self.assertGreaterEqual(overall, 0.90, missed[:40])


class TierAndMessageTests(SimpleTestCase):
    def test_reserved_names(self):
        for name in ("admin", "admin1", "Admin_Joe", "Moderator", "official_hoops", "Hoops24", "NBA", "nba_1"):
            with self.subTest(name=name):
                self.assertEqual(mt.check_username(name).tier, "reserved")

    def test_fan_tags_with_nba_are_not_reserved(self):
        for name in ("NBA2KPro", "NBA_Fan_99", "NBAKing"):
            with self.subTest(name=name):
                self.assertEqual(mt.check_username(name).tier, "ok")

    def test_first_severe_term_with_digit_is_severe(self):
        # The QA flow submits severe.json's first term + "1".
        first = _offensive("severe.json")[0]["term"]
        self.assertEqual(mt.check_username(f"{first}1").tier, "severe")

    def test_lone_owner_mild_words_are_rejected_not_struck(self):
        for name in ("Dick", "Gay", "cum_23"):
            with self.subTest(name=name):
                self.assertEqual(mt.check_username(name).tier, "mild")

    def test_repeat_tolerance_does_not_shorten_terms(self):
        # "nigger" needs the double g: the country and its people are not a match.
        for name in ("Niger_Baller", "NigeriaHoops", "Therapist", "Scunthorpe"):
            with self.subTest(name=name):
                self.assertEqual(mt.check_username(name).tier, "ok")

    def test_messages_never_echo_a_term(self):
        terms = mt.lists()["severe_keys"] + mt.lists()["mild_keys"]
        for message in (mt.MESSAGE_BLOCKED, mt.MESSAGE_RESERVED, mt.MESSAGE_STRIKE, mt.MESSAGE_SIGNUP_SEVERE):
            words = set(re.findall(r"[a-z]+", message.lower()))
            self.assertFalse(words & set(terms), message)

    def test_leet_fan_out_is_bounded(self):
        # Every "1" has two readings; the matcher must try two whole-name readings, not 2**n.
        import time

        mt.lists()
        for name in ("1" * 20, "1_" * 9 + "1", "A1" * 10, "1a" * 10):
            start = time.perf_counter()
            mt.check_username(name)
            self.assertLess(time.perf_counter() - start, 0.1, name)
        self.assertLessEqual(len(mt.compact_forms("1" * 20)), 3)
        self.assertLessEqual(len(mt.token_sequences("1_" * 9 + "1")), 6)

    def test_odd_input_never_raises(self):
        for name in ("", None, "___", "12345", "Jokić", "a" * 200):
            self.assertIn(mt.check_username(name).tier, ("ok", "mild", "severe", "reserved"))
