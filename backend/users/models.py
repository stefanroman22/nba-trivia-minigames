from django.db import models
from django.contrib.auth.models import AbstractUser
# Create your models here.

RANK_CHOICES = [
    ("Bronze", "Bronze"),
    ("Silver", "Silver"),
    ("Gold", "Gold"),
]

class CustomUser(AbstractUser):
    points = models.IntegerField(default=0)
    profile_photo = models.ImageField(upload_to='profiles/', default='profiles/default.png')
    rank = models.CharField(max_length=10, choices=RANK_CHOICES, default='Bronze')

    def update_rank(self):
        if self.points > 100:
            self.rank = "Gold"
        elif self.points > 25:
            self.rank = "Silver"
