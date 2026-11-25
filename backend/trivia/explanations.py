"""The short "why" a player can open on a missed answer: GET /trivia/explain/<game>/?qid=<question id>.

Written once per question and then served from the database (AnswerExplanation). Three things keep it honest and
keep it from becoming an open, billed text generator:

  - The caller sends only a game and a question id. The question, the answer and every fact the model is given
    come from this app's own published data (facts()); nothing a visitor types reaches the prompt.
  - The model is told to use the supplied facts only, and grounded() then rejects any answer that states a number
    the facts do not contain or leaves out the answer itself. A rejected answer is neither stored nor shown.
  - Off unless EXPLAIN_ENABLED=1 and a key are set; EXPLAIN_DAILY_LIMIT caps new explanations per day, on top of
    the per-caller throttle.

Supported today: series-winner (qid = the series' match_id) and guess-mvps (qid = "<season>" or "<season>:MVP").
"""
import json
import re

from django.conf import settings
from django.db import IntegrityError
from django.utils import timezone
from rest_framework.decorators import api_view, permission_classes, throttle_classes
from rest_framework.permissions import AllowAny
from rest_framework.response import Response

from backend.throttles import ExplainRateThrottle
from trivia import llm
from trivia.game_builder.sources import load_rows
from trivia.models import AnswerExplanation

MAX_CHARS = 600
MAX_TOKENS = 4000  # thinking included; the answer itself is a few dozen tokens
ROUND_ORDER = ("First Round", "Conference Semifinals", "Conference Finals", "NBA Finals")

SYSTEM = """You write the short explanation a player sees after missing a question on Swish Quest, an NBA \
trivia site. You are given the question, the correct answer and a few facts from the site's own data as JSON.

Write two or three plain sentences, at most 60 words, that tell the player the answer and the most interesting \
thing the facts say about it. Use only what is in the JSON: do not add a statistic, a date, a name or an event \
from memory, even one you are sure of, because everything shown on the site has to match its data. If the facts \
are thin, write less. Plain text only, no preamble, no markdown."""


def _series_facts(qid):
    rows = load_rows("playoff_series")
    row = next((r for r in rows if r.get("match_id") == qid), None)
    if not row:
        return None
    winner = row["winner"]
    same_run = [r for r in rows if r["season"] == row["season"] and winner in (r["team_a"], r["team_b"])]
    same_run.sort(key=lambda r: ROUND_ORDER.index(r["round"]) if r["round"] in ROUND_ORDER else -1)
    return {
        "question": f"Who won the {row['season']} {row['round']} series, {row['team_a']} or {row['team_b']}?",
        "answer": winner,
        "facts": {
            "season": row["season"],
            "round": row["round"],
            "series_score": row["result"],
            "games_played": row["total_games"],
            "loser": row["loser"],
            "winner_playoff_run_that_season": [
                {"round": r["round"], "opponent": r["loser"] if r["winner"] == winner else r["winner"],
                 "result": "won" if r["winner"] == winner else "lost", "score": r["result"]}
                for r in same_run
            ],
        },
    }


def _mvp_facts(qid):
    season, _, award = qid.partition(":")
    if award and award.upper() != "MVP":
        return None  # other awards are not in the server's own data
    row = next((r for r in load_rows("mvps") if r.get("season") == season), None)
    if not row:
        return None
    facts = {"season": row["season"], "team_that_season": row["team"]}
    player = next((p for p in load_rows("players") if p.get("full_name") == row["mvp"]), None)
    if player:
        mvp_years = (player.get("awards") or {}).get("mvp") or []
        facts.update({
            "position": player.get("position"),
            "drafted": player.get("draft"),
            "career_points_per_game": (player.get("career") or {}).get("ppg"),
            "mvp_awards_in_career": len(mvp_years) or None,
            "mvp_award_years": mvp_years or None,
            "all_star_selections": (player.get("awards") or {}).get("allstar_count"),
            "championships": player.get("rings_count"),
        })
    return {
        "question": f"Who was the NBA's Most Valuable Player in {row['season']}?",
        "answer": row["mvp"],
        "facts": {k: v for k, v in facts.items() if v not in (None, "", [], {})},
    }


RESOLVERS = {"series-winner": _series_facts, "guess-mvps": _mvp_facts}


def facts(game, qid):
    """{question, answer, facts} from this app's own data, or None when the game or the question is unknown."""
    resolver = RESOLVERS.get(game)
    return resolver(qid) if resolver and qid else None


def grounded(text, payload):
    """True when the text names the answer and every number in it appears in the facts it was written from."""
    if not text or payload["answer"].casefold() not in text.casefold():
        return False
    source = json.dumps(payload, ensure_ascii=False)
    known = set(re.findall(r"\d+(?:\.\d+)?", source))
    return all(n in known for n in re.findall(r"\d+(?:\.\d+)?", text))


def write(payload, client=None):
    """One model call -> the explanation text. Raises llm.LLMError, also when the text is not grounded."""
    api = client or llm.client(settings.EXPLAIN_TIMEOUT)
    response = llm.create(
        api,
        model=settings.EXPLAIN_MODEL,
        max_tokens=MAX_TOKENS,
        system=SYSTEM,
        messages=[{"role": "user", "content": json.dumps(payload, ensure_ascii=False, indent=1)}],
        output_config={"effort": settings.EXPLAIN_EFFORT},
    )
    text = " ".join(llm.text_of(response).split())
    if len(text) > MAX_CHARS or not grounded(text, payload):
        raise llm.LLMError("The explanation did not match the data.")
    return text, getattr(response, "model", None) or settings.EXPLAIN_MODEL


def _written_today():
    start = timezone.now().replace(hour=0, minute=0, second=0, microsecond=0)
    return AnswerExplanation.objects.filter(created_at__gte=start).count()


@api_view(["GET"])
@permission_classes([AllowAny])
@throttle_classes([ExplainRateThrottle])
def explain(request, game):
    if not settings.EXPLAIN_ENABLED:
        return Response({"error": "Explanations are off."}, status=503)
    qid = (request.query_params.get("qid") or "")[:96]
    if game not in RESOLVERS or not qid:
        return Response({"error": "No explanation for this question."}, status=404)
    cached = AnswerExplanation.objects.filter(game=game, question_id=qid).first()
    if cached:
        return Response({"text": cached.text})
    payload = facts(game, qid)
    if not payload:
        return Response({"error": "No explanation for this question."}, status=404)
    if _written_today() >= settings.EXPLAIN_DAILY_LIMIT:
        return Response({"error": "No new explanations today."}, status=503)
    try:
        text, model = write(payload)
    except llm.LLMError:
        return Response({"error": "No explanation right now."}, status=503)
    try:
        AnswerExplanation.objects.create(game=game, question_id=qid, text=text, model=model)
    except IntegrityError:  # two players missed the same question at once: keep the first one written
        text = AnswerExplanation.objects.get(game=game, question_id=qid).text
    return Response({"text": text})
