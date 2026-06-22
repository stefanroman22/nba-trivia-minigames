"""Central "big data" store for all trivia games.

One normalized set of tables that every current and future game queries. The
data is gathered from the NBA API by `manage.py sync_nba_data` (which must run
from a residential IP — the NBA blocks datacenter IPs) and upserted here. The
game views/pool builders read from these tables; no game owns its own storage.
"""

from django.db import models


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
    loser_wins = models.IntegerField()  # winner always has 4
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
