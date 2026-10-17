"""Difficulty calibration for the review loop (spec §4.8, KPI "solve rate monotonic easy -> hard").

band_solve_rates() measures each band's solve rate over a game's active questions from the
anonymous roll-ups (QuestionStats) in a window: correct / players summed per band, per player
and never per guess (the multi-guess games log every guess as an attempt), as the doctor does.
answers = attempts summed.

propose_band_edges() proposes new difficulty.bands for a game only when it has >= MIN_ANSWERS
answers in the window and its solve rates do not fall strictly from easy to medium to hard: the
active questions' difficulty values (quality.difficulty) are split again into three quantile
bands (the 33rd and 66th percentiles), edges clamped to [0, 1] and strictly increasing. The
review agent copies the proposal into the spec file; spec_edit_problems() is the code-side gate
on that edit (only difficulty.bands may change, only to the digest's proposal, and the file must
stay a valid spec).
"""
import copy
import datetime
import json
from collections import defaultdict
from statistics import quantiles

from django.db.models import Sum
from django.utils import timezone

from trivia.models import Question, QuestionStats
from trivia.questions import demand, doctor, specs

MIN_ANSWERS = 300
WINDOW_DAYS = demand.WINDOW_DAYS
LEVELS = specs.LEVELS


def band_solve_rates(game, days=WINDOW_DAYS, now=None):
    """{"answers", "rates": {band: rate | None}, "players": {band: n}} for `game`'s active
    questions over the last `days` full days (today's partial roll-up left out, as in demand)."""
    today = (now or timezone.now()).date()
    totals = (QuestionStats.objects.filter(game=game, day__gte=today - datetime.timedelta(days=days), day__lt=today)
              .values("question_id")
              .annotate(attempts=Sum("attempts"), correct=Sum("correct"), players=Sum("players"))
              .order_by("question_id"))
    indexes = {}
    answers, correct, players = 0, defaultdict(int), defaultdict(int)
    for t in totals:
        row = doctor.question_for(game, t["question_id"], indexes)
        band = (row.quality or {}).get("band") if row is not None else None
        if row is None or row.status != Question.STATUS_ACTIVE or band not in LEVELS:
            continue
        answers += t["attempts"] or 0
        correct[band] += t["correct"] or 0
        players[band] += t["players"] or 0
    rates = {b: (correct[b] / players[b] if players[b] else None) for b in LEVELS}
    return {"answers": answers, "rates": rates, "players": {b: players[b] for b in LEVELS}}


def monotonic(rates):
    """True when the measured bands' solve rates fall strictly from easy to hard, False when
    not, None when fewer than two bands have a rate."""
    measured = [rates[b] for b in LEVELS if rates.get(b) is not None]
    if len(measured) < 2:
        return None
    return all(a > b for a, b in zip(measured, measured[1:]))


def current_bands(game):
    try:
        return specs.load(game)["difficulty"]["bands"]
    except specs.SpecError:
        return None


def propose_band_edges(game, days=WINDOW_DAYS, now=None, measured=None):
    """New {"easy": [0, e1], "medium": [e1, e2], "hard": [e2, 1]} for `game`, or None when the
    game has fewer than MIN_ANSWERS answers in the window, its solve rates are monotonic (or
    cannot be compared), or no valid re-split differs from the current bands. `measured` is a
    band_solve_rates() result the caller already has."""
    current = current_bands(game)
    if current is None:
        return None
    measured = measured or band_solve_rates(game, days, now)
    if measured["answers"] < MIN_ANSWERS or monotonic(measured["rates"]) is not False:
        return None
    values = sorted(
        float(d) for d in Question.objects.filter(game=game, status=Question.STATUS_ACTIVE)
        .values_list("quality__difficulty", flat=True)
        if isinstance(d, (int, float)) and not isinstance(d, bool))
    if len(values) < 3:
        return None
    e1, e2 = (min(1.0, max(0.0, round(e, 4))) for e in quantiles(values, n=3, method="inclusive"))
    if not 0 < e1 < e2 < 1:
        return None
    bands = {"easy": [0, e1], "medium": [e1, e2], "hard": [e2, 1]}
    return None if bands == current else bands


def spec_edit_problems(slug, before, after, proposal):
    """[problem, ...] for a review agent's edit of a spec file (empty = acceptable): `after` must
    be a valid spec, equal `before` everywhere outside difficulty.bands, and carry exactly the
    bands the digest proposed for `slug` (`proposal`; None = no proposal, so no edit allowed)."""
    if proposal is None:
        return [f"{slug}: the digest proposed no calibration for this game"]
    try:
        specs.validate(slug, after)
    except specs.SpecError as e:
        return [str(e)]
    if after["difficulty"]["bands"] != proposal:
        return [f"{slug}: difficulty.bands differ from the digest's proposal"]

    def rest(data):
        data = copy.deepcopy(data)
        if isinstance(data.get("difficulty"), dict):
            data["difficulty"].pop("bands", None)
        return json.dumps(data, sort_keys=True)

    if not isinstance(before, dict) or rest(before) != rest(after):
        return [f"{slug}: the edit changes more than difficulty.bands"]
    return []
