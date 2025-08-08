from django.db import models

class PlayoffSeries(models.Model):
    season = models.CharField(max_length=20)
    round = models.CharField(max_length=50)
    team_a = models.CharField(max_length=50)
    team_b = models.CharField(max_length=50)
    team_a_wins = models.IntegerField()
    team_b_wins = models.IntegerField()
    winner = models.CharField(max_length=50)

    def __str__(self):
        return f"{self.season}, {self.round}: {self.team_a} vs {self.team_b} (Winner: {self.winner})"
