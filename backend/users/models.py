from django.db import models
from django.contrib.auth.models import AbstractUser
# Create your models here.

RANK_CHOICES = [
    ("Rookie", "Rookie"),
    ("Role Player", "Role Player"),
    ("Sixth Man", "Sixth Man"),
    ("Starter", "Starter"),
    ("All-Star", "All-Star"),
    ("All-NBA", "All-NBA"),
    ("MVP", "MVP"),
    ("Hall of Famer", "Hall of Famer"),
    ("GOAT", "GOAT"),
]

class CustomUser(AbstractUser):
    points = models.IntegerField(default=0)
    profile_photo = models.ImageField(upload_to='profiles/', default='profiles/default.png')
    rank = models.CharField(max_length=20, choices=RANK_CHOICES, default='Rookie')

    def update_rank(self):
        if self.points >= 5000:
            self.rank = "GOAT"
        elif self.points >= 3000:
            self.rank = "Hall of Famer"
        elif self.points >= 2000:
            self.rank = "MVP"
        elif self.points >= 1200:
            self.rank = "All-NBA"
        elif self.points >= 700:
            self.rank = "All-Star"
        elif self.points >= 400:
            self.rank = "Starter"
        elif self.points >= 200:
            self.rank = "Sixth Man"
        elif self.points >= 100:
            self.rank = "Role Player"
        else:
            self.rank = "Rookie"
