"""Fan Favorites helpers: seed loading + the automatic seed -> live transition.

The bundled seed (fan_favorites_seed.json) carries editorial answer counts.
Once a question has enough real correct guesses in GuessLog, its board is
re-ranked from those live counts automatically — no manual step.
"""

import json
import os

from django.conf import settings

LIVE_STANDINGS_MIN_GUESSES = 500
SEED_PATH = os.path.join(settings.BASE_DIR, "trivia", "utils", "fan_favorites_seed.json")


def load_seed():
    """Return the bundled questions normalized to the serving shape
    ({qid, prompt, survey_date, answers}). Empty list if the file is missing."""
    if not os.path.exists(SEED_PATH):
        return []
    with open(SEED_PATH, encoding="utf-8") as f:
        data = json.load(f)
    raw = data.get("questions", data) if isinstance(data, dict) else data
    return [
        {
            "qid": q.get("qid") or q.get("id"),
            "prompt": q.get("prompt", ""),
            "survey_date": q.get("survey_date", ""),
            # Self-healing: the board contract is rank 1 = most popular, so the
            # seed is always served in descending-count order regardless of how
            # it was authored.
            "answers": sorted(
                q.get("answers", []), key=lambda a: a.get("count", 0), reverse=True
            ),
        }
        for q in raw
        if (q.get("qid") or q.get("id")) and q.get("prompt")
    ]


def refresh_live_standings():
    """Re-rank each question's answers from real correct guesses once it has
    >= LIVE_STANDINGS_MIN_GUESSES samples. Returns how many questions updated."""
    from trivia.models import FanFavoritesQuestion, GuessLog

    updated = 0
    for q in FanFavoritesQuestion.objects.filter(live=True):
        logs = GuessLog.objects.filter(
            game="fan-favorites", question_id=q.qid, correct=True
        )
        total = logs.count()
        if total < LIVE_STANDINGS_MIN_GUESSES:
            continue
        counts = {}
        for ans in logs.values_list("answer", flat=True):
            counts[ans] = counts.get(ans, 0) + 1
        # Correct guesses are logged with the canonical answer string, so a
        # straight value-count re-ranks the board; counts rescale to /100.
        # Any answer that was actually guessed keeps at least 1 (a revealed
        # slot must never read "0 fans said it").
        answers = sorted(
            q.answers, key=lambda a: counts.get(a.get("answer"), 0), reverse=True
        )
        for a in answers:
            n = counts.get(a.get("answer"), 0)
            a["count"] = max(1, round(100 * n / total)) if n else 0
        q.answers = answers
        q.save(update_fields=["answers"])
        updated += 1
    return updated
