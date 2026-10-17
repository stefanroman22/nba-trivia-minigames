"""Nightly roll-ups: raw GuessLog / GameSession rows folded into the anonymous
QuestionStats, WrongAnswerStats and GameDailyStats tables (spec §4.7, phase 3).

Rows are read in id order above a per-source RollupWatermark, in batches. Each batch
is one transaction that also advances the watermark, so a row is counted exactly once
and cleanup may delete raw rows below the watermark. Running twice adds nothing.
Only rows older than CUTOFF are rolled, and a batch stops before the first younger
row, so the watermark never passes a row whose insert may not have committed yet.

Days are UTC. `players` is distinct signed-in users plus guests counted as one
anonymous player per day. The roll-ups store no user ids (spec: not personal data),
so `players` is recounted from the raw rows still present (id <= the batch's last id)
and kept as max(stored, recount): exact while the raw rows of the key are retained,
never double counting a player seen in an earlier batch. For WrongAnswerStats, which
spans all days, players who only answered before the raw-retention window are kept
through the max but cannot be told apart from new ones, so it is a lower bound there.

`skips` counts wrong answers that normalize to nothing (the log endpoint already drops
empty answers; no game logs an explicit skip yet).
"""
import datetime

from django.db import transaction
from django.db.models import Count, Q
from django.db.models.functions import TruncDate
from django.utils import timezone

from trivia.models import GameDailyStats, GameSession, GuessLog, QuestionStats, RollupWatermark, WrongAnswerStats
from trivia.utils.text_utils import normalize_answer

BATCH = 5000
SAMPLE_CAP = 200
CUTOFF = datetime.timedelta(minutes=10)  # rows younger than this may still be in flight
GUESS_LOG, GAME_SESSION = "guess_log", "game_session"
UTC = datetime.timezone.utc
ANSWER_NORM_MAX = WrongAnswerStats._meta.get_field("answer_norm").max_length


def run(journal, batch=BATCH, now=None):
    """Fold everything above the watermarks and older than the cutoff; one `counted`
    journal event per batch."""
    cutoff = (now or timezone.now()) - CUTOFF
    totals = {"answers": 0, "plays": 0}
    while n := _roll_batch(journal, GUESS_LOG, batch, cutoff):
        totals["answers"] += n
    while n := _roll_batch(journal, GAME_SESSION, batch, cutoff):
        totals["plays"] += n
    return totals


def _roll_batch(journal, name, batch, cutoff):
    with transaction.atomic():
        RollupWatermark.objects.get_or_create(name=name)
        mark = RollupWatermark.objects.select_for_update().get(name=name)
        if name == GUESS_LOG:
            rows = _rows(GuessLog, "created_at", mark.last_id, batch, cutoff,
                         "game", "question_id", "answer", "correct", "elapsed_ms", "created_at")
        else:
            rows = _rows(GameSession, "finished_at", mark.last_id, batch, cutoff, "game", "mode")
        if not rows:
            return 0
        hi = rows[-1]["id"]
        if name == GUESS_LOG:
            counts = {"questions": _fold_question_stats(rows, hi), "wrong_answers": _fold_wrong_answers(rows, hi)}
        else:
            counts = {"game_days": _fold_game_daily(rows, hi)}
        mark.last_id = hi
        mark.save(update_fields=["last_id", "updated_at"])
    journal.log("counted", name, rows=len(rows), first_id=rows[0]["id"], last_id=hi, **counts)
    return len(rows)


def _rows(model, when, last_id, batch, cutoff, *fields):
    """The next batch above the watermark, stopping before the first row newer than the
    cutoff: ids are allocated at insert but visible only at commit, so a row still in
    flight must not be passed by the watermark (cleanup would delete it uncounted)."""
    above = model.objects.filter(id__gt=last_id)
    fence = above.filter(**{f"{when}__gte": cutoff}).order_by("id").values_list("id", flat=True).first()
    if fence is not None:
        above = above.filter(id__lt=fence)
    return list(above.filter(**{f"{when}__lt": cutoff}).order_by("id")
                .annotate(day=TruncDate(when, tzinfo=UTC)).values("id", "user_id", "day", *fields)[:batch])


def _day_range(days):
    start = datetime.datetime.combine(min(days), datetime.time.min, tzinfo=UTC)
    end = datetime.datetime.combine(max(days) + datetime.timedelta(days=1), datetime.time.min, tzinfo=UTC)
    return start, end


def _players_per_key(qs, fields, keys):
    """Distinct players per key over `qs`: each signed-in user once, all guests as one."""
    out = {}
    grouped = qs.values(*fields).annotate(users=Count("user", distinct=True),
                                          guests=Count("id", filter=Q(user__isnull=True)))
    for r in grouped:
        key = tuple(r[f] for f in fields)
        if key in keys:
            out[key] = r["users"] + (1 if r["guests"] else 0)
    return out


def _spread(values, k):
    """k evenly spaced order statistics of the sorted `values`."""
    n = len(values)
    if k <= 0 or not n:
        return []
    if k == 1:
        return [values[(n - 1) // 2]]
    return [values[round(i * (n - 1) / (k - 1))] for i in range(k)]


def _merge_sample(sample, new, n_old):
    """Sorted merge capped at SAMPLE_CAP values. Above the cap the slots are split by
    weight: the stored sample stands for `n_old` rows, the new batch for its own size."""
    new = sorted(new)
    if len(sample) + len(new) <= SAMPLE_CAP:
        return sorted(list(sample) + new)
    k_old = min(round(SAMPLE_CAP * n_old / (n_old + len(new))), len(sample))
    k_new = min(SAMPLE_CAP - k_old, len(new))
    k_old = min(SAMPLE_CAP - k_new, len(sample))  # slots one side cannot fill go to the other
    return sorted(_spread(list(sample), k_old) + _spread(new, k_new))


def _p50(sample):
    return sample[(len(sample) - 1) // 2] if sample else None


def _save(model, objs, fields):
    model.objects.bulk_create([o for o in objs if o.pk is None], batch_size=500)
    model.objects.bulk_update([o for o in objs if o.pk is not None], fields, batch_size=500)


def _fold_question_stats(rows, hi):
    groups = {}
    for r in rows:
        g = groups.setdefault((r["game"], r["question_id"], r["day"]),
                              {"attempts": 0, "correct": 0, "skips": 0, "time_ms_sum": 0, "times": []})
        g["attempts"] += 1
        g["correct"] += int(r["correct"])
        if not r["correct"] and not normalize_answer(r["answer"]):
            g["skips"] += 1
        if r["elapsed_ms"] is not None:
            g["time_ms_sum"] += r["elapsed_ms"]
            g["times"].append(r["elapsed_ms"])
    games, qids, days = (sorted({k[i] for k in groups}) for i in range(3))
    start, end = _day_range(days)
    players = _players_per_key(
        GuessLog.objects.filter(id__lte=hi, game__in=games, question_id__in=qids,
                                created_at__gte=start, created_at__lt=end)
        .annotate(day=TruncDate("created_at", tzinfo=UTC)),
        ("game", "question_id", "day"), groups)
    existing = {(s.game, s.question_id, s.day): s for s in
                QuestionStats.objects.filter(game__in=games, question_id__in=qids, day__in=days)}
    out = []
    for key, g in groups.items():
        s = existing.get(key) or QuestionStats(game=key[0], question_id=key[1], day=key[2])
        s.time_sample = _merge_sample(s.time_sample, g["times"], s.attempts)  # attempts before this batch
        s.attempts += g["attempts"]
        s.correct += g["correct"]
        s.skips += g["skips"]
        s.time_ms_sum += g["time_ms_sum"]
        s.time_ms_p50 = _p50(s.time_sample)
        s.players = max(s.players, players.get(key, 0))
        out.append(s)
    _save(QuestionStats, out, ["attempts", "correct", "skips", "time_ms_sum", "time_sample", "time_ms_p50", "players"])
    return len(out)


def _fold_wrong_answers(rows, hi):
    groups = {}
    for r in rows:
        norm = "" if r["correct"] else normalize_answer(r["answer"])[:ANSWER_NORM_MAX]
        if not norm:
            continue
        g = groups.setdefault((r["game"], r["question_id"], norm),
                              {"count": 0, "first": r["created_at"], "last": r["created_at"]})
        g["count"] += 1
        g["first"] = min(g["first"], r["created_at"])
        g["last"] = max(g["last"], r["created_at"])
    if not groups:
        return 0
    games, qids, norms = (sorted({k[i] for k in groups}) for i in range(3))
    # Recount distinct players per wrong answer from the raw wrong rows still retained;
    # normalization is Python-side, so this groups in memory (ids never leave the batch).
    seen = {}
    raw = (GuessLog.objects.filter(id__lte=hi, correct=False, game__in=games, question_id__in=qids)
           .annotate(day=TruncDate("created_at", tzinfo=UTC))
           .values_list("game", "question_id", "answer", "user_id", "day"))
    for game, qid, answer, user_id, day in raw.iterator():
        key = (game, qid, normalize_answer(answer)[:ANSWER_NORM_MAX])
        if key in groups:
            seen.setdefault(key, set()).add(user_id if user_id is not None else ("guest", day))
    existing = {(w.game, w.question_id, w.answer_norm): w for w in
                WrongAnswerStats.objects.filter(game__in=games, question_id__in=qids, answer_norm__in=norms)}
    out = []
    for key, g in groups.items():
        w = existing.get(key) or WrongAnswerStats(game=key[0], question_id=key[1], answer_norm=key[2],
                                                  first_seen=g["first"], last_seen=g["last"])
        w.count += g["count"]
        w.first_seen = min(w.first_seen, g["first"])
        w.last_seen = max(w.last_seen, g["last"])
        w.players = max(w.players, len(seen.get(key, ())))
        out.append(w)
    _save(WrongAnswerStats, out, ["count", "players", "first_seen", "last_seen"])
    return len(out)


def _fold_game_daily(rows, hi):
    groups = {}
    for r in rows:
        key = (r["game"], r["day"], r["mode"])
        groups[key] = groups.get(key, 0) + 1
    games, days, modes = (sorted({k[i] for k in groups}) for i in range(3))
    start, end = _day_range(days)
    players = _players_per_key(
        GameSession.objects.filter(id__lte=hi, game__in=games, mode__in=modes,
                                   finished_at__gte=start, finished_at__lt=end)
        .annotate(day=TruncDate("finished_at", tzinfo=UTC)),
        ("game", "day", "mode"), groups)
    existing = {(d.game, d.day, d.mode): d for d in
                GameDailyStats.objects.filter(game__in=games, day__in=days, mode__in=modes)}
    out = []
    for key, plays in groups.items():
        d = existing.get(key) or GameDailyStats(game=key[0], day=key[1], mode=key[2])
        d.plays += plays
        d.players = max(d.players, players.get(key, 0))
        out.append(d)
    _save(GameDailyStats, out, ["plays", "players"])
    return len(out)
