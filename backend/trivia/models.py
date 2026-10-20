"""Central "big data" store for all trivia games.

One normalized set of tables that every current and future game queries. The
data is gathered from the NBA API by `manage.py sync_nba_data` (which must run
from a residential IP — the NBA blocks datacenter IPs) and upserted here. The
game views/pool builders read from these tables; no game owns its own storage.
"""

from django.conf import settings
from django.core.validators import MaxValueValidator, MinValueValidator
from django.db import models
from django.utils import timezone


class Team(models.Model):
    """An NBA franchise. Feeds the Name->Logo game and team lookups."""

    team_id = models.BigIntegerField(primary_key=True)  # nba_api team id
    full_name = models.CharField(max_length=100)
    abbreviation = models.CharField(max_length=10)
    logo = models.URLField(max_length=300, blank=True)

    def __str__(self):
        return self.full_name


class Player(models.Model):
    """Every NBA player, historical + active. Feeds Wordle and All-Players."""

    person_id = models.BigIntegerField(primary_key=True)  # nba_api person id
    full_name = models.CharField(max_length=120)
    first_name = models.CharField(max_length=60, blank=True)
    last_name = models.CharField(max_length=60, blank=True)
    from_year = models.IntegerField(null=True, blank=True)
    to_year = models.IntegerField(null=True, blank=True)
    is_active = models.BooleanField(default=False)

    class Meta:
        indexes = [
            models.Index(fields=["is_active"]),
            models.Index(fields=["last_name"]),
        ]

    def __str__(self):
        return self.full_name


class PlayoffSeries(models.Model):
    """One completed playoff series, stored canonically (winner/loser).

    The serving layer randomizes which side is shown as team_a/team_b so the
    answer isn't always in the same slot.
    """

    season = models.CharField(max_length=7)  # e.g. "1996-97"
    series_id = models.CharField(max_length=40)  # "<season>-<loId>-<hiId>"
    round = models.CharField(max_length=40)  # "First Round" ... "NBA Finals"
    winner_team_id = models.BigIntegerField()
    winner_name = models.CharField(max_length=100)
    winner_abbreviation = models.CharField(max_length=10, blank=True)
    loser_team_id = models.BigIntegerField()
    loser_name = models.CharField(max_length=100)
    loser_abbreviation = models.CharField(max_length=10, blank=True)
    loser_wins = models.IntegerField()  # winner's wins = total_games - loser_wins (best-of-3/5/7 by era)
    total_games = models.IntegerField()

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["season", "series_id"], name="uniq_playoff_series"
            )
        ]
        indexes = [models.Index(fields=["season"])]
        verbose_name_plural = "playoff series"

    def __str__(self):
        return f"{self.season} {self.round}: {self.winner_name} def. {self.loser_name}"


class Mvp(models.Model):
    """Regular-season MVP by season. Feeds Guess-the-MVP."""

    season = models.CharField(max_length=7, unique=True)  # "2024-25"
    mvp = models.CharField(max_length=100)
    team = models.CharField(max_length=100)
    team_logo_url = models.URLField(max_length=300, blank=True)

    class Meta:
        indexes = [models.Index(fields=["season"])]

    def __str__(self):
        return f"{self.season}: {self.mvp}"


class StartingFiveGame(models.Model):
    """A single game with the winning team's starting five. Feeds Starting-Five."""

    game_id = models.CharField(max_length=20, primary_key=True)
    game_date = models.CharField(max_length=20, blank=True)
    season = models.CharField(max_length=7, blank=True)
    team_a = models.CharField(max_length=100)
    team_b = models.CharField(max_length=100)
    team_a_logo = models.URLField(max_length=300, blank=True)
    team_b_logo = models.URLField(max_length=300, blank=True)
    final_score = models.CharField(max_length=20, blank=True)
    winning_team = models.CharField(max_length=100)
    starting_5 = models.JSONField(default=list)  # [{"name", "position"}, ...]

    class Meta:
        indexes = [models.Index(fields=["season"])]

    def __str__(self):
        return f"{self.game_date} {self.team_a} vs {self.team_b}"


class FanFavoritesQuestion(models.Model):
    """A Fan Favorites survey board: prompt + ranked answers. Feeds Fan-Favorites.

    Answers are seeded editorially; once a question has enough real guesses in
    GuessLog the board auto-switches to the live player-derived counts.
    """

    qid = models.CharField(max_length=20, primary_key=True)  # "ff-001"
    prompt = models.CharField(max_length=200)
    survey_date = models.CharField(max_length=10, blank=True)  # "2026-07-01"
    # Answer entity type — drives the client's autocomplete source (players /
    # teams / seasons / coaches). Unknown values fall back to free-text input.
    category = models.CharField(max_length=12, default="player")  # player|team|season|coach
    answers = models.JSONField(default=list)  # [{"answer", "count", "aliases": [...]}]
    live = models.BooleanField(default=True)

    class Meta:
        indexes = [models.Index(fields=["live"])]

    def __str__(self):
        return f"{self.qid}: {self.prompt}"


class GameSession(models.Model):
    """One finished play of any game (who, what, score, how long).

    Powers the always-visible session timer stats, profile history and
    score+time tiebreaks. Guests log with user=None.
    """

    user = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL
    )
    game = models.CharField(max_length=40)
    mode = models.CharField(max_length=10, default="single")  # single | match | friend
    score = models.IntegerField(default=0)
    # What actually landed on the account for this play (score after the daily soft cap, plus any
    # first-game / streak bonus) — trivia.awarding writes it; the weekly board sums it. 0 for guests,
    # friend rooms and before 2026-10.
    awarded = models.IntegerField(default=0, db_default=0)
    duration_ms = models.BigIntegerField(default=0)
    finished_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        indexes = [models.Index(fields=["game", "-finished_at"])]

    def __str__(self):
        return f"{self.game} {self.score}pts ({self.duration_ms}ms)"


class GuessLog(models.Model):
    """Every answer submitted in guess games — the data flywheel.

    Feeds survey-question standings (Fan Favorites auto-transition), future
    rarity scores and difficulty tuning. Guests log with user=None.
    """

    user = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL
    )
    game = models.CharField(max_length=40)
    question_id = models.CharField(max_length=60, blank=True)
    answer = models.CharField(max_length=120)
    correct = models.BooleanField(default=False)
    elapsed_ms = models.IntegerField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        indexes = [
            models.Index(fields=["game", "question_id"]),
            models.Index(fields=["-created_at"]),
        ]

    def __str__(self):
        return f"{self.game}/{self.question_id}: {self.answer}"


class SeenQuestion(models.Model):
    """One question a signed-in player has been shown, so single-player pickers deal no repeats
    (spec §4.4). No answer text. Deleted with the account and when the question is retired
    (trivia.questions.cleanup)."""

    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE)
    game = models.CharField(max_length=40)
    qid = models.CharField(max_length=60)
    seen_at = models.DateTimeField(default=timezone.now)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["user", "game", "qid"], name="uniq_seen_user_game_qid"),
        ]
        indexes = [models.Index(fields=["user", "game"])]

    def __str__(self):
        return f"{self.user_id} saw {self.game}/{self.qid}"


class QuestionReport(models.Model):
    """A player's "Report a problem" on one question they were dealt (POST /trivia/report-question/).
    `question_id` is the id the game logs (GuessLog, the roll-ups). Guests report with user=None.
    Deleted with the account, once handled, and after 12 months at most (users.retention)."""

    NEW, HANDLED = "new", "handled"
    STATUS_CHOICES = [(NEW, "New"), (HANDLED, "Handled")]

    user = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL)
    game = models.CharField(max_length=40)
    question_id = models.CharField(max_length=60)
    note = models.CharField(max_length=500, blank=True)
    status = models.CharField(max_length=10, choices=STATUS_CHOICES, default=NEW)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        indexes = [models.Index(fields=["game", "question_id"]), models.Index(fields=["status"])]

    def __str__(self):
        return f"{self.game}/{self.question_id} reported [{self.status}]"


class WordleDailyWord(models.Model):
    """The word of the day for single-player Wordle. One row per calendar day
    (Europe/Paris / CET-CEST), kept forever as the admin-visible history.
    """

    date = models.DateField(unique=True)
    word = models.CharField(max_length=16)
    picked_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-date"]

    def __str__(self):
        return f"{self.date}: {self.word}"


class WordlePlay(models.Model):
    """One identity's play of a daily solo game for one day — the once-per-day gate.

    Despite the name it serves every daily game (`game`: "wordle", "contexto");
    rows from before the field existed are Wordle plays. Only ever holds today's
    rows: the daily word-picker job deletes anything not the current day right
    after picking the new word, so this never grows with historical players.
    `user` and `device_id` are independent signals — a logged-in play stamps
    both, so a logged-out replay from the same browser is still caught by
    `device_id` even though `user` is absent that time.
    """

    user = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.CASCADE
    )
    device_id = models.CharField(max_length=64, null=True, blank=True)
    # db_default too: a backend still on the old code (same database, deploy window) inserts
    # without the column and must keep getting Wordle rows.
    game = models.CharField(max_length=20, default="wordle", db_default="wordle")
    play_date = models.DateField()
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["user", "game", "play_date"],
                condition=models.Q(user__isnull=False),
                name="uniq_dailyplay_user_game_day",
            ),
            models.UniqueConstraint(
                fields=["device_id", "game", "play_date"],
                condition=models.Q(device_id__isnull=False),
                name="uniq_dailyplay_device_game_day",
            ),
        ]
        indexes = [models.Index(fields=["play_date"])]

    def __str__(self):
        who = self.user_id or self.device_id or "?"
        return f"{self.play_date} {self.game} played by {who}"


class SyncRun(models.Model):
    """Audit log of each data-sync attempt (observability + freshness check)."""

    dataset = models.CharField(max_length=40)  # "playoff", "players", ...
    status = models.CharField(max_length=20)  # "success" | "failed" | "skipped"
    rows = models.IntegerField(default=0)
    detail = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        indexes = [models.Index(fields=["dataset", "-created_at"])]

    def __str__(self):
        return f"{self.dataset} {self.status} ({self.rows}) @ {self.created_at:%Y-%m-%d %H:%M}"


class Question(models.Model):
    """One pre-generated round for a player-pool game (spec §6).

    `definition` is the small dataset-independent description; the snapshot
    publisher materializes it against the current player dataset.
    """

    STATUS_ACTIVE = "active"
    STATUS_RETIRED = "retired"
    STATUS_PENDING = "pending"  # built, waiting for the Checker (never published)
    STATUS_QUARANTINED = "quarantined"  # pulled from play, waiting for the doctor

    game = models.CharField(max_length=32, db_index=True)
    qid = models.CharField(max_length=48)
    definition = models.JSONField()
    status = models.CharField(max_length=16, default=STATUS_ACTIVE)
    quality = models.JSONField(default=dict, blank=True)
    players_referenced = models.JSONField(default=list, blank=True)
    content_hash = models.CharField(max_length=64)
    dataset_version = models.CharField(max_length=32, blank=True)
    created_by = models.CharField(max_length=32, default="generator")
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    retired_at = models.DateTimeField(null=True, blank=True)
    retired_reason = models.TextField(blank=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["game", "qid"], name="uniq_question_game_qid"),
            models.UniqueConstraint(fields=["game", "content_hash"], name="uniq_question_game_hash"),
        ]
        indexes = [models.Index(fields=["game", "status"])]

    def __str__(self):
        return f"{self.game}/{self.qid} [{self.status}]"


class Feedback(models.Model):
    """One player rating (1–5 stars) plus an optional written message.

    Written by the in-app feedback modal (POST /trivia/feedback/) and read by the
    admin panel's Feedback tab. Guests submit with user=None.

    `email`/`display_name`/`public_id` are a deliberate SNAPSHOT of the sender
    taken at submission time, not something to be joined from `user`. Two
    reasons: `user` is SET_NULL, so a closed account would otherwise take the
    only means of replying down with it; and a guest can leave an address
    without having an account to join to at all.
    """

    NEW, READ, RESOLVED = "new", "read", "resolved"
    STATUS_CHOICES = [(NEW, "New"), (READ, "Read"), (RESOLVED, "Resolved")]

    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="feedback",
    )
    email = models.EmailField(blank=True)
    display_name = models.CharField(max_length=150, blank=True)
    public_id = models.CharField(max_length=12, blank=True)

    rating = models.PositiveSmallIntegerField(
        validators=[MinValueValidator(1), MaxValueValidator(5)]
    )
    message = models.TextField(blank=True)

    # Where the modal was opened from, so a rating can be tied to a screen.
    page = models.CharField(max_length=120, blank=True)
    game = models.CharField(max_length=40, blank=True)

    # Triage state, driven from the panel — also what the "needs attention"
    # badge counts.
    status = models.CharField(max_length=10, choices=STATUS_CHOICES, default=NEW)
    admin_note = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        indexes = [
            models.Index(fields=["-created_at"]),
            models.Index(fields=["rating"]),
            models.Index(fields=["status"]),
            models.Index(fields=["game"]),
        ]
        verbose_name_plural = "feedback"

    def __str__(self):
        return f"{self.rating}★ from {self.display_name or self.email or 'guest'}"


class FactoryRun(models.Model):
    """One run of the question factory: what it did and why (spec §4.8 of
    docs/superpowers/specs/2026-10-12-question-factory-design.md).

    Written after the run's own transaction, so rolled-back (dry-run) and failed
    runs are on record too. The review loop reads these through factory_digest.
    """

    STATUS_OK, STATUS_DEGRADED, STATUS_FAILED = "ok", "degraded", "failed"

    kind = models.CharField(max_length=16)  # supply | doctor | editorial | rollup | cleanup
    trigger = models.CharField(max_length=16, blank=True)  # manual | schedule | dry-run | data-refresh
    status = models.CharField(max_length=10)
    started_at = models.DateTimeField()
    finished_at = models.DateTimeField()
    versions = models.JSONField(default=dict, blank=True)  # {"dataset": ..., "fame": 1, ...}
    summary = models.JSONField(default=dict, blank=True)  # {game: {action: count}}
    report_md = models.TextField(blank=True)

    class Meta:
        indexes = [models.Index(fields=["kind", "-started_at"])]

    def __str__(self):
        return f"{self.kind} {self.status} @ {self.started_at:%Y-%m-%d %H:%M}"


class FactoryEvent(models.Model):
    """One decision inside a FactoryRun: action, machine reason, and the numbers
    (or, for model steps, the rationale and sources) behind it."""

    run = models.ForeignKey(FactoryRun, on_delete=models.CASCADE, related_name="events")
    game = models.CharField(max_length=32, blank=True)
    qid = models.CharField(max_length=48, blank=True)
    action = models.CharField(max_length=24)  # refill_decision | generated | retired | held_back | ...
    reason = models.CharField(max_length=64, blank=True)
    detail = models.JSONField(default=dict, blank=True)
    created_at = models.DateTimeField()

    class Meta:
        indexes = [
            models.Index(fields=["run", "game"]),
            models.Index(fields=["action", "-created_at"]),
        ]

    def __str__(self):
        return f"{self.game}/{self.qid} {self.action} ({self.reason})"


class DataCorrection(models.Model):
    """One sourced fix to a curated player row (spec §4.9). players_curated.json
    is never hand-edited; active corrections are overlaid on it whenever the
    factory loads it (trivia.questions.corrections, publish_v3.curated_dataset).

    `field_path` points inside the row's existing structure: "awards.smoy",
    "teams[2].end_year", "draft.team_abbr", "jersey".
    """

    STATUS_PROPOSED, STATUS_CHECKING, STATUS_ACTIVE = "proposed", "checking", "active"
    STATUS_REJECTED, STATUS_REDUNDANT = "rejected", "redundant"
    STATUS_CHOICES = [
        (STATUS_PROPOSED, "Proposed"), (STATUS_CHECKING, "Checking"), (STATUS_ACTIVE, "Active"),
        (STATUS_REJECTED, "Rejected"), (STATUS_REDUNDANT, "Redundant"),
    ]

    person_id = models.IntegerField()
    field_path = models.CharField(max_length=120)
    old_value = models.JSONField(null=True, blank=True)
    new_value = models.JSONField(null=True, blank=True)
    sources = models.JSONField(default=list, blank=True)  # source URLs
    reason = models.TextField(blank=True)
    status = models.CharField(max_length=10, choices=STATUS_CHOICES, default=STATUS_PROPOSED)
    created_by = models.CharField(max_length=32, blank=True)  # doctor | owner | ...
    run = models.ForeignKey(FactoryRun, null=True, blank=True, on_delete=models.SET_NULL,
                            related_name="corrections")
    created_at = models.DateTimeField(auto_now_add=True)
    decided_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        indexes = [models.Index(fields=["status"]), models.Index(fields=["person_id"])]

    def __str__(self):
        return f"{self.person_id} {self.field_path} -> {self.new_value!r} [{self.status}]"


class QuestionStats(models.Model):
    """Answers to one question on one UTC day, folded nightly from GuessLog by
    trivia.questions.rollup (spec §4.7). Anonymous: no user ids, so it is kept
    for as long as the question exists."""

    game = models.CharField(max_length=40)
    question_id = models.CharField(max_length=60)
    day = models.DateField()
    attempts = models.IntegerField(default=0)
    correct = models.IntegerField(default=0)
    skips = models.IntegerField(default=0)  # answers that normalize to nothing
    time_ms_sum = models.BigIntegerField(default=0)  # exact sum over the rows that carry a time
    time_ms_p50 = models.IntegerField(null=True, blank=True)  # median of time_sample
    time_sample = models.JSONField(default=list, blank=True)  # sorted, at most rollup.SAMPLE_CAP values
    players = models.IntegerField(default=0)  # distinct users, guests counted as one per day

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["game", "question_id", "day"], name="uniq_qstats_game_qid_day"),
        ]

    def __str__(self):
        return f"{self.game}/{self.question_id} {self.day}: {self.correct}/{self.attempts}"


class WrongAnswerStats(models.Model):
    """One normalized wrong answer to one question, all days together (spec §4.7)."""

    game = models.CharField(max_length=40)
    question_id = models.CharField(max_length=60)
    answer_norm = models.CharField(max_length=120)
    count = models.IntegerField(default=0)
    players = models.IntegerField(default=0)  # distinct users, guests counted as one per day
    first_seen = models.DateTimeField()
    last_seen = models.DateTimeField()

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["game", "question_id", "answer_norm"], name="uniq_wrong_game_qid_answer"),
        ]

    def __str__(self):
        return f"{self.game}/{self.question_id}: {self.answer_norm} x{self.count}"


class GameDailyStats(models.Model):
    """Plays of one game in one mode on one UTC day, folded nightly from GameSession (spec §4.7)."""

    game = models.CharField(max_length=40)
    day = models.DateField()
    mode = models.CharField(max_length=10)
    plays = models.IntegerField(default=0)
    players = models.IntegerField(default=0)  # distinct users, guests counted as one per day

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["game", "day", "mode"], name="uniq_gdaily_game_day_mode"),
        ]

    def __str__(self):
        return f"{self.game} {self.mode} {self.day}: {self.plays} plays"


class RollupWatermark(models.Model):
    """Highest raw row id already folded into the roll-ups, per source ("guess_log",
    "game_session"). Advanced in the same transaction as the batch it counts, so
    cleanup may delete raw rows at or below it without losing anything."""

    name = models.CharField(max_length=32, unique=True)
    last_id = models.BigIntegerField(default=0)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return f"{self.name} <= {self.last_id}"
