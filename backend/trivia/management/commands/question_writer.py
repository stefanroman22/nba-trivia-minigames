"""Tools for the prompt-driven question writer (.claude/skills/nba-question-writer).

    question_writer export   --game G [--out ops/out/G.json]
        Production state of one game (run on prod through ops-manage.yml, artifact "ops-out"): every
        Question row in any status with its definition, content_hash and difficulty label, plus the
        active data corrections, so local checks use exactly the production dataset.
    question_writer check    --game G --file proposals.json [--existing export.json] [--report out.json]
        Local, read-only. For each proposed definition: does it hold (materialize + validate), is it a
        duplicate (of production or of another proposal), its full accepted-answer list, and every
        spelling a fan types replayed through the game's own answer matching (a mirror of
        src/utils/answerMatch.ts and buildNameLookup in src/utils/questions.ts). Exit 1 when any
        proposal fails a check.
    question_writer capacity --game G [--existing export.json]
        How many more questions the game can take, and what is left to pick from.
    question_writer apply    --file payload.json [--dry-run] [--report ops/out/apply-report.json]
        The only write (run on prod through ops-manage.yml): extra player spellings (active
        DataCorrections on "aliases"), new questions (active at once, label if given) and difficulty
        labels. Duplicates and definitions that do not hold are skipped and reported, never forced.

proposals.json: {"game": G, "questions": [{"definition": {...}, "difficulty": "easy|medium|hard"|null,
                 "typed_forms": {"<answer or player name>": ["<spelling a fan types>", ...]}}]}
payload.json:   {"game": G, "aliases": [{"person_id": N, "add": ["..."], "reason": "..."}],
                 "add": [{"definition": {...}, "difficulty": "..."|null, "reason": "..."}],
                 "labels": [{"qid": "...", "difficulty": "easy|medium|hard", "reason": "..."}]}
"""
import copy
import datetime
import json
import os
import re
import unicodedata

from django.core.management.base import BaseCommand, CommandError
from django.db import transaction
from django.utils import timezone

from trivia.models import DataCorrection, Question, QuestionLabel
from trivia.questions import fame, quality, runner, specs
from trivia.questions.games import GAME_MODULES
from trivia.questions.hashing import content_hash
from trivia.questions.journal import Journal

WRITER_GAMES = ("tictactoe", "career-path", "who-are-ya", "contexto", "fan-favorites", "who-would-win", "connections")
LIVE = (Question.STATUS_ACTIVE, Question.STATUS_PENDING)
DIFFICULTIES = ("easy", "medium", "hard")

# Spellings fans type for a team that the board's own aliases may not carry (checked on team boards).
TEAM_FORMS = {
    "Philadelphia 76ers": ["Sixers", "76ers"], "Cleveland Cavaliers": ["Cavs"], "Dallas Mavericks": ["Mavs"],
    "Minnesota Timberwolves": ["Wolves", "Timberwolves"], "Portland Trail Blazers": ["Blazers", "Trail Blazers"],
    "Los Angeles Lakers": ["Lakers", "LA Lakers"], "Los Angeles Clippers": ["Clippers", "LA Clippers"],
    "Golden State Warriors": ["Warriors", "GSW"], "Oklahoma City Thunder": ["Thunder", "OKC"],
    "New Orleans Pelicans": ["Pelicans"], "New York Knicks": ["Knicks"], "Brooklyn Nets": ["Nets"],
}


# --- the frontend's answer matching, mirrored -------------------------------------------------

_MARKS = re.compile("[̀-ͯ]")
_PUNCT = re.compile("['’.,-]")
_SUFFIX = re.compile(r"\s+(jr|sr|ii|iii|iv|v)\.?$", re.I)


def normalize(s):
    """src/utils/answerMatch.ts normalizeAnswer: lowercase, strip accents, drop '.,- and collapse spaces."""
    s = _MARKS.sub("", unicodedata.normalize("NFD", (s or "").lower()))
    return re.sub(r"\s+", " ", _PUNCT.sub("", s)).strip()


def match_answer(guess, answers):
    """answerMatch.ts matchAnswer: index of the first answer whose name or alias equals the guess, else -1."""
    g = normalize(guess)
    if not g:
        return -1
    for i, a in enumerate(answers):
        if normalize(a["answer"]) == g or any(normalize(x) == g for x in a.get("aliases") or []):
            return i
    return -1


def _name_key(s):
    return normalize(s).replace(" ", "")


def _without_suffix(name):
    return _SUFFIX.sub("", name) if _SUFFIX.search(name) else None


class NameLookup:
    """src/utils/questions.ts buildNameLookup over the playable pool (the question-names list)."""

    def __init__(self, playable):
        self.exact, self.loose = {}, {}
        for r in playable:
            names = [r["full_name"], *(r.get("aliases") or [])]
            for s in names:
                self._add(self.exact, _name_key(s), r["person_id"])
            for s in names:
                bare = _without_suffix(s)
                if bare:
                    self._add(self.loose, _name_key(bare), r["person_id"])

    @staticmethod
    def _add(m, key, pid):
        if key:
            ids = m.setdefault(key, [])
            if pid not in ids:
                ids.append(pid)

    def to_ids(self, guess):
        key = _name_key(guess)
        out = []
        for ids in (self.exact.get(key), self.loose.get(key)):
            for pid in ids or []:
                if pid not in out:
                    out.append(pid)
        bare = None if out else _without_suffix(guess.strip())
        return list(self.exact.get(_name_key(bare), [])) if bare else out

    def resolve_ids(self, guess):
        """resolveIds: exact names/aliases first; the suffix-less match only when no player has that exact
        name ("Gary Payton" is the father, never Gary Payton II); then a typed suffix the name lacks."""
        key = _name_key(guess)
        if self.exact.get(key):
            return list(self.exact[key])
        if self.loose.get(key):
            return list(self.loose[key])
        bare = _without_suffix(guess.strip())
        return list(self.exact.get(_name_key(bare), [])) if bare else []

    def is_name(self, guess):
        return bool(self.exact.get(_name_key(guess)))


def player_forms(name, aliases=(), extra=()):
    """{spelling: why} a fan may type for a player (each must be accepted)."""
    forms = {name: "full name"}
    for a in aliases:
        forms.setdefault(a, "alias")
    bare = _without_suffix(name)
    if bare:
        forms.setdefault(bare, "without its suffix")
    if "-" in name:
        forms.setdefault(name.replace("-", " "), "hyphen typed as a space")
    if "'" in name or "’" in name:
        forms.setdefault(re.sub("['’]", " ", name), "apostrophe typed as a space")
    if re.search(r"\b[A-Z]\.", name):
        forms.setdefault(re.sub(r"\s+", " ", name.replace(".", ". ")).replace(".", "").strip(), "initials spaced")
    words = name.split()
    if len(words) > 2 and re.fullmatch(r"[A-Z]\.?", words[1]):
        forms.setdefault(" ".join([words[0], *words[2:]]), "middle initial left out")
    for e in extra:
        forms.setdefault(e, "you listed it")
    return forms


def team_forms(name, extra=()):
    words = name.split()
    k = 2 if name.endswith("Trail Blazers") else 1
    forms = {name: "full name", " ".join(words[-k:]): "nickname"}
    for f in TEAM_FORMS.get(name, []):
        forms.setdefault(f, "common short form")
    for e in extra:
        forms.setdefault(e, "you listed it")
    return forms


# --- helpers ----------------------------------------------------------------------------------

def definition_key(slug, d):
    """What makes two definitions the same question (the module's dup_key, from the definition alone)."""
    if slug == "tictactoe":
        return "|".join(sorted(f"{c['type']}:{c['value']}" for c in (d.get("rows") or []) + (d.get("cols") or [])))
    if slug in ("career-path", "who-are-ya"):
        return str(d.get("person_id"))
    if slug == "contexto":
        return str(d.get("secret_person_id"))
    return GAME_MODULES[slug].dup_key(d, None)


def _load(path):
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def _dataset(existing):
    """The production dataset: the committed curated rows plus the export's active corrections, else
    this DB's active corrections."""
    from trivia.data_pipeline import publish_v3

    if not existing or "corrections" not in existing:
        return publish_v3.curated_dataset()
    from trivia.data_pipeline.live_pool import CURATED_PATH
    from trivia.questions import corrections
    from trivia.questions.base import load_dataset_from_rows

    rows = _load(CURATED_PATH)
    active = [DataCorrection(pk=c["id"], person_id=c["person_id"], field_path=c["field_path"],
                             new_value=c["new_value"], status=DataCorrection.STATUS_ACTIVE)
              for c in existing["corrections"]]
    return load_dataset_from_rows(corrections.apply(rows, active), "export")


def _label(row):
    try:
        lab = row.label
    except QuestionLabel.DoesNotExist:
        return None
    return {"difficulty": lab.difficulty, "source": lab.source, "reason": lab.reason}


class Command(BaseCommand):
    help = "Question writer tools: export, check, capacity, apply (see the module docstring)."

    def add_arguments(self, parser):
        parser.add_argument("action", choices=("export", "check", "capacity", "apply"))
        parser.add_argument("--game", choices=WRITER_GAMES)
        parser.add_argument("--file")
        parser.add_argument("--existing", help="an export JSON (production state) for check / capacity")
        parser.add_argument("--out")
        parser.add_argument("--report")
        parser.add_argument("--dry-run", action="store_true")

    def handle(self, *args, **o):
        action = o["action"]
        if action in ("export", "check", "capacity") and not o["game"]:
            raise CommandError(f"{action} needs --game")
        if action in ("check", "apply") and not o["file"]:
            raise CommandError(f"{action} needs --file")
        return {"export": self.do_export, "check": self.do_check, "capacity": self.do_capacity,
                "apply": self.do_apply}[action](o) or None

    def _write(self, path, data):
        os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
        with open(path, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=1, default=str)
        self.stdout.write(f"wrote {path}")

    # --- export -------------------------------------------------------------------------------

    def do_export(self, o):
        slug = o["game"]
        rows = Question.objects.filter(game=slug).select_related("label").order_by("id")
        questions = [{"qid": r.qid, "status": r.status, "created_by": r.created_by, "definition": r.definition,
                      "content_hash": r.content_hash, "label": _label(r)} for r in rows]
        corrections = [{"id": c.pk, "person_id": c.person_id, "field_path": c.field_path, "new_value": c.new_value}
                       for c in DataCorrection.objects.filter(status=DataCorrection.STATUS_ACTIVE).order_by("id")]
        self._write(o["out"] or os.path.join("ops", "out", f"{slug}.json"),
                    {"game": slug, "exported_at": timezone.now().isoformat(), "corrections": corrections,
                     "questions": questions})
        by_status, by_label = {}, {}
        for q in questions:
            by_status[q["status"]] = by_status.get(q["status"], 0) + 1
            if q["status"] == Question.STATUS_ACTIVE:
                key = (q["label"] or {}).get("difficulty", "no label")
                by_label[key] = by_label.get(key, 0) + 1
        self.stdout.write(f"{slug}: {len(questions)} rows {by_status}; active by label {by_label}; "
                          f"{len(corrections)} active corrections")

    # --- check --------------------------------------------------------------------------------

    def do_check(self, o):
        slug = o["game"]
        mod = GAME_MODULES[slug]
        proposals = _load(o["file"])
        if proposals.get("game") not in (None, slug):
            raise CommandError(f"{o['file']} is for {proposals.get('game')}, not {slug}")
        existing = _load(o["existing"]) if o["existing"] else None
        dataset = _dataset(existing)
        lookup = NameLookup(dataset.playable)
        spec = specs.load(slug) if hasattr(mod, "features") else None
        prod = existing["questions"] if existing else [
            {"qid": r.qid, "status": r.status, "definition": r.definition, "content_hash": r.content_hash}
            for r in Question.objects.filter(game=slug)]
        if not existing:
            self.stdout.write("note: no --existing export; duplicates are checked against this DB only")
        hashes = {q["content_hash"]: q for q in prod}
        keys = {}
        for q in prod:
            if q["status"] in LIVE:
                try:
                    keys.setdefault(definition_key(slug, q["definition"]), q)
                except Exception:  # an old definition the key cannot read: it cannot collide either
                    pass
        seen, results, failed = {}, [], 0
        for n, p in enumerate(proposals.get("questions") or [], 1):
            res = self._check_one(slug, mod, p, dataset, lookup, spec, hashes, keys, prod, seen)
            results.append(res)
            failed += not res["ok"]
            self._print_check(n, res)
        self.stdout.write(f"\n{len(results) - failed} of {len(results)} proposal(s) pass every check")
        if o["report"]:
            self._write(o["report"], {"game": slug, "results": results})
        if failed:
            raise CommandError(f"{failed} proposal(s) failed a check")

    def _check_one(self, slug, mod, p, dataset, lookup, spec, hashes, keys, prod, seen):
        d = p.get("definition") or {}
        res = {"definition": d, "ok": True, "problems": [], "answers": [], "rejected_spellings": [], "info": []}

        def fail(msg):
            res["ok"] = False
            res["problems"].append(msg)

        m, problems = runner._materialize(mod, d, dataset)
        for msg in problems:
            fail(f"does not hold: {msg}")
        h = content_hash(d)
        if h in hashes:
            fail(f"duplicate: same definition as {hashes[h]['qid']} ({hashes[h]['status']})")
        try:
            key = definition_key(slug, d)
        except Exception as e:
            key = None
            fail(f"definition unreadable: {e}")
        if slug == "contexto" and key is not None:
            self._contexto_dupes(d, prod, fail)
        elif key is not None and key in keys:
            fail(f"duplicate: same question as {keys[key]['qid']} ({keys[key]['status']}), key {key!r}")
        if key is not None and key in seen:
            fail(f"duplicate: same question as proposal {seen[key]} in this file")
        if key is not None:
            seen.setdefault(key, len(seen) + 1)
        if p.get("difficulty") not in (None, *DIFFICULTIES):
            fail(f"difficulty must be easy, medium, hard or null, got {p.get('difficulty')!r}")
        if m is None:
            return res
        if slug == "tictactoe" and p.get("difficulty"):
            from trivia.questions.games import tictactoe_difficulty as rules
            band, reason = rules.classify(d, dataset)
            res["info"].append(f"difficulty rules say {band or 'none'} ({reason})")
            if band != p["difficulty"]:
                fail(f"asked for {p['difficulty']}, but the owner's Tic-Tac-Toe rules make it {band or 'no band'}")
        if spec is not None:
            s = quality.score(mod, m, dataset, spec, d)
            res["info"].append(f"interest {s['interest']} (game minimum {spec['interest']['min']})")
            if s["interest"] < spec["interest"]["min"]:
                fail(f"interest {s['interest']} is below the game's minimum {spec['interest']['min']}")
        typed = p.get("typed_forms") or {}
        self._answers(slug, m, d, dataset, lookup, typed, res, fail)
        return res

    def _contexto_dupes(self, d, prod, fail):
        day = d.get("day", "")
        try:
            when = datetime.date.fromisoformat(day)
        except ValueError:
            fail(f"day {day!r} is not YYYY-MM-DD")
            return
        for q in prod:
            other = q["definition"]
            if q["status"] in LIVE and other.get("day") == day:
                fail(f"day {day} is already taken by {q['qid']}")
            try:
                gap = abs((datetime.date.fromisoformat(other.get("day", "")) - when).days)
            except ValueError:
                continue
            if other.get("secret_person_id") == d.get("secret_person_id") and gap < GAME_MODULES["contexto"].NO_REPEAT_DAYS:
                fail(f"secret repeats {q['qid']} ({other.get('day')}), inside the "
                     f"{GAME_MODULES['contexto'].NO_REPEAT_DAYS}-day no-repeat window")

    def _answers(self, slug, m, d, dataset, lookup, typed, res, fail):
        by_id = dataset.by_id
        reported = set()

        def reject(answer, form, why, got):
            if (answer, form) in reported:
                return
            reported.add((answer, form))
            res["rejected_spellings"].append({"answer": answer, "typed": form, "why": why, "got": got})
            fail(f"{answer}: typing {form!r} ({why}) is not accepted ({got})")

        if slug == "tictactoe":
            for i, ids in enumerate(m["valid"]):
                r, c = m["rows"][i // 3], m["cols"][i % 3]
                names = [by_id[pid]["full_name"] for pid in ids if pid in by_id]
                res["answers"].append({"cell": f"{r['label']} x {c['label']}", "count": len(ids), "names": names})
                for pid in ids:
                    row = by_id.get(pid)
                    if row is None:
                        continue
                    for form, why in player_forms(row["full_name"], row.get("aliases") or [],
                                                  typed.get(row["full_name"], [])).items():
                        got = lookup.to_ids(form)
                        if not set(got) & set(ids):
                            reject(row["full_name"], form, why, "no player in this cell" if got else "unknown name")
        elif slug in ("career-path", "who-are-ya", "contexto"):
            row = m["secret"] if slug == "contexto" else m["player"]
            res["answers"].append({"answer": row["full_name"], "aliases": row.get("aliases") or []})
            namesakes = [pid for pid in lookup.to_ids(row["full_name"]) if pid != row["person_id"]]
            if namesakes:
                res["info"].append(f"namesake(s) {namesakes} share the name {row['full_name']!r} (accepted either way)")
            # Since 2026-10-30 all three games accept a guess whose resolved ids include the player
            # (resolveIds + pickGuessId; Career Path also keeps its exact matchAnswer check), so a namesake
            # is no miss. A suffix-less spelling that is another player's own name (the father) is
            # rightly refused, so it is not a rejection.
            for form, why in player_forms(row["full_name"], row.get("aliases") or [],
                                          typed.get(row["full_name"], [])).items():
                got = lookup.resolve_ids(form)
                exact = slug == "career-path" and match_answer(
                    form, [{"answer": row["full_name"], "aliases": row.get("aliases") or []}]) == 0
                if why == "without its suffix" and row["person_id"] not in got and lookup.is_name(form):
                    res["info"].append(f"{form!r} is another player's name, so it rightly does not count")
                    continue
                if row["person_id"] not in got and not exact:
                    reject(row["full_name"], form, why,
                           f"resolves to {by_id.get(got[0], {}).get('full_name', got[0])}" if got else "unknown name")
        elif slug == "fan-favorites":
            answers = m["answers"]
            team = m["category"] == "team"
            for i, a in enumerate(answers):
                res["answers"].append({"answer": a["answer"], "aliases": a["aliases"]})
                pid = (m.get("person_ids") or [None] * len(answers))[i]
                row = by_id.get(pid) if pid is not None else None
                if team:
                    forms = team_forms(a["answer"], typed.get(a["answer"], []))
                else:
                    forms = player_forms(a["answer"], (row or {}).get("aliases") or [], typed.get(a["answer"], []))
                for form, why in forms.items():
                    got = match_answer(form, answers)
                    if got != i:
                        reject(a["answer"], form, why, f"credited to {answers[got]['answer']}" if got >= 0 else "no match")
        else:
            res["info"].append("no typed answers in this game (a vote / a tile pick)")
            if slug == "connections":
                res["answers"] = [{"group": g["label"], "members": g["members"]} for g in m.get("groups", [])]

    def _print_check(self, n, res):
        head = "PASS" if res["ok"] else "FAIL"
        self.stdout.write(f"\n[{n}] {head} {json.dumps(res['definition'], ensure_ascii=False)[:160]}")
        for line in res["info"]:
            self.stdout.write(f"    info: {line}")
        for a in res["answers"]:
            if "cell" in a:
                shown = ", ".join(a["names"][:12]) + (" ..." if len(a["names"]) > 12 else "")
                self.stdout.write(f"    {a['cell']}: {a['count']} accepted - {shown}")
            elif "group" in a:
                self.stdout.write(f"    {a['group']}: {', '.join(a['members'])}")
            else:
                self.stdout.write(f"    accepts {a['answer']} (aliases: {', '.join(a['aliases']) or '-'})")
        for p in res["problems"]:
            self.stdout.write(f"    problem: {p}")

    # --- capacity -----------------------------------------------------------------------------

    def do_capacity(self, o):
        slug = o["game"]
        mod = GAME_MODULES[slug]
        existing = _load(o["existing"]) if o["existing"] else None
        dataset = _dataset(existing)
        prod = existing["questions"] if existing else [
            {"qid": r.qid, "status": r.status, "definition": r.definition} for r in Question.objects.filter(game=slug)]
        active = [q for q in prod if q["status"] == Question.STATUS_ACTIVE]
        self.stdout.write(f"{slug}: {len(active)} active, {len(prod)} rows in any status, minimum {mod.MINIMUM}")
        if slug in ("career-path", "who-are-ya"):
            used = {q["definition"].get("person_id") for q in prod}
            eligible = [r for r in dataset.playable if mod._eligible(r)]
            left = sorted((r for r in eligible if r["person_id"] not in used), key=fame.fame_score, reverse=True)
            self.stdout.write(f"eligible players {len(eligible)}; never used {len(left)} (any status counts as used)")
            for r in left[:30]:
                self.stdout.write(f"  {r['person_id']} {r['full_name']} ({fame.fame_band(r)})")
        elif slug == "contexto":
            today = timezone.now().date()
            cutoff = (today - datetime.timedelta(days=mod.NO_REPEAT_DAYS)).isoformat()
            days = sorted(q["definition"]["day"] for q in active if q["definition"].get("day", "") >= today.isoformat())
            run, day = 0, today
            while day.isoformat() in set(days):
                run += 1
                day += datetime.timedelta(days=1)
            recent = {q["definition"].get("secret_person_id") for q in prod if q["definition"].get("day", "") >= cutoff}
            free = [r for r in dataset.playable if fame.at_least(r, mod.MIN_SECRET_BAND) and r["person_id"] not in recent]
            self.stdout.write(f"days scheduled from today: {len(days)} (last {days[-1] if days else '-'}); "
                              f"unbroken run from today: {run} day(s), first free day {day.isoformat()}")
            self.stdout.write(f"secrets usable now (fame band {mod.MIN_SECRET_BAND} or better, not used in "
                              f"{mod.NO_REPEAT_DAYS} days): {len(free)} (each still has to pass the ranking gate)")
            for r in sorted(free, key=fame.fame_score, reverse=True)[:30]:
                self.stdout.write(f"  {r['person_id']} {r['full_name']} ({fame.fame_band(r)})")
        elif slug == "tictactoe":
            by = {}
            for q in active:
                key = (q.get("label") or {}).get("difficulty", "hard (no label)")
                by[key] = by.get(key, 0) + 1
            self.stdout.write(f"active by difficulty: {by}. Distinct boards are combinations of 3 current teams x "
                              f"3 columns, far more than will ever be written; a theme narrows it (count a theme "
                              f"with a script over tictactoe_difficulty.classify, see the game guide).")
        elif slug == "who-would-win":
            keys = {definition_key(slug, q["definition"]) for q in prod if q["status"] in LIVE}
            self.stdout.write(f"{len(keys)} matchups taken; any two real playoff team-seasons (or decades) can meet, "
                              f"with interest (pedigree) >= the spec minimum")
        else:
            self.stdout.write("no fixed maximum: a board is new when its duplicate key (prompt / members) is new")

    # --- apply --------------------------------------------------------------------------------

    def do_apply(self, o):
        payload = _load(o["file"])
        slug = payload.get("game")
        if slug not in WRITER_GAMES:
            raise CommandError(f"payload game must be one of {', '.join(WRITER_GAMES)}, got {slug!r}")
        mod = GAME_MODULES[slug]
        now = timezone.now()
        report = {"game": slug, "dry_run": o["dry_run"], "aliases": [], "add": [], "labels": []}
        with transaction.atomic():
            self._apply_aliases(payload.get("aliases") or [], report, now)
            from trivia.data_pipeline import publish_v3

            dataset = publish_v3.curated_dataset()
            self._apply_add(slug, mod, payload.get("add") or [], dataset, report, now)
            self._apply_labels(slug, mod, payload.get("labels") or [], report)
            if o["dry_run"]:
                transaction.set_rollback(True)
        for part in ("aliases", "add", "labels"):
            for item in report[part]:
                self.stdout.write(f"{part}: {item['outcome']:<10} {item['what']}")
        counts = {part: {} for part in ("aliases", "add", "labels")}
        for part in counts:
            for item in report[part]:
                counts[part][item["outcome"]] = counts[part].get(item["outcome"], 0) + 1
        self.stdout.write(f"{'DRY RUN, nothing kept: ' if o['dry_run'] else ''}{slug} {counts}")
        self._write(o["report"] or os.path.join("ops", "out", "apply-report.json"), report)

    def _apply_aliases(self, items, report, now):
        if not items:
            return
        from trivia.data_pipeline import publish_v3

        by_id = publish_v3.curated_dataset().by_id
        for it in items:
            pid, add = it.get("person_id"), [a for a in it.get("add") or [] if isinstance(a, str) and a.strip()]
            row = by_id.get(pid)
            if row is None or not add:
                report["aliases"].append({"outcome": "skipped", "what": f"{pid}: unknown player or nothing to add"})
                continue
            current = list(row.get("aliases") or [])
            new = list(dict.fromkeys(current + add))
            if new == current:
                report["aliases"].append({"outcome": "unchanged", "what": f"{row['full_name']}: {add} already there"})
                continue
            DataCorrection.objects.create(person_id=pid, field_path="aliases", old_value=current, new_value=new,
                                          reason=it.get("reason") or "spellings fans type (question writer)",
                                          status=DataCorrection.STATUS_ACTIVE, created_by="writer", decided_at=now)
            report["aliases"].append({"outcome": "added", "what": f"{row['full_name']}: {current} -> {new}"})

    def _apply_add(self, slug, mod, items, dataset, report, now):
        spec = specs.load(slug) if hasattr(mod, "features") else None
        journal = Journal("writer")
        hashes = set(Question.objects.filter(game=slug).values_list("content_hash", flat=True))
        prod = [{"qid": q.qid, "status": q.status, "definition": q.definition}
                for q in Question.objects.filter(game=slug)]
        keys = {}
        for q in prod:
            if q["status"] in LIVE:
                try:
                    keys.setdefault(definition_key(slug, q["definition"]), q["qid"])
                except Exception:
                    pass
        seq = runner._next_seq(slug)
        for it in items:
            d = it.get("definition") or {}
            what = json.dumps(d, ensure_ascii=False)[:140]
            problems = []
            m, invalid = runner._materialize(mod, d, dataset)
            problems += invalid
            h = content_hash(d)
            key = definition_key(slug, d) if not invalid else None
            if h in hashes:
                problems.append("duplicate definition")
            if slug == "contexto" and key is not None:
                self._contexto_dupes(d, prod, problems.append)
            elif key is not None and key in keys:
                problems.append(f"duplicate of {keys[key]}")
            if it.get("difficulty") not in (None, *DIFFICULTIES):
                problems.append(f"bad difficulty {it.get('difficulty')!r}")
            if problems:
                report["add"].append({"outcome": "skipped", "what": f"{what} :: {'; '.join(problems)}"})
                continue
            qid = mod.qid_for(d, seq)
            if Question.objects.filter(game=slug, qid=qid).exists():
                qid = f"{qid}-r{seq}"
            seq += 1
            row = Question.objects.create(game=slug, qid=qid, definition=d, content_hash=h, created_by="writer",
                                          status=Question.STATUS_ACTIVE)
            if runner._materialize_row(mod, row, dataset, now, journal, False, spec) is None:
                report["add"].append({"outcome": "skipped", "what": f"{what} :: does not hold"})
                continue
            row.quality = {**row.quality, "checked": {"verdict": "writer", "at": now.isoformat(),
                                                      "payload_sha": row.quality.get("payload_sha")}}
            row.save(update_fields=["quality", "updated_at"])
            hashes.add(h)
            keys[key] = qid
            prod.append({"qid": qid, "status": row.status, "definition": d})
            if it.get("difficulty"):
                QuestionLabel.objects.create(question=row, difficulty=it["difficulty"], source=QuestionLabel.RULE,
                                             reason=(it.get("reason") or "question writer")[:500])
            report["add"].append({"outcome": "added", "what": f"{qid} {it.get('difficulty') or ''} {what}"})

    def _apply_labels(self, slug, mod, items, report):
        served = hasattr(mod, "index_label")
        for it in items:
            qid, difficulty = it.get("qid"), it.get("difficulty")
            row = Question.objects.filter(game=slug, qid=qid).select_related("label").first()
            if row is None or difficulty not in DIFFICULTIES:
                report["labels"].append({"outcome": "skipped", "what": f"{qid}: unknown question or bad difficulty"})
                continue
            lab = _label(row)
            if lab and lab["source"] == QuestionLabel.OWNER:
                report["labels"].append({"outcome": "kept", "what": f"{qid}: owner label {lab['difficulty']} kept"})
                continue
            QuestionLabel.objects.update_or_create(question=row, defaults={
                "difficulty": difficulty, "source": QuestionLabel.RULE,
                "reason": (it.get("reason") or "question writer")[:500], "labeled_by": None})
            note = "" if served else " (stored; players see it once the game serves difficulty)"
            report["labels"].append({"outcome": "labeled", "what": f"{qid}: {difficulty}{note}"})
