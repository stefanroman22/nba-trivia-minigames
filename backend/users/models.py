from django.contrib.auth.models import AbstractUser, UserManager
from django.contrib.auth.validators import UnicodeUsernameValidator
from django.db import IntegrityError, models

from .identity import PUBLIC_ID_LENGTH, generate_public_id

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


class CustomUserManager(UserManager):
    """Case-insensitive email is the login identity (usernames aren't unique)."""

    def get_by_natural_key(self, email):
        return self.get(**{f"{self.model.USERNAME_FIELD}__iexact": email})


class CustomUser(AbstractUser):
    # Display name — deliberately NOT unique: players are told apart by their
    # public ID, so any number of accounts can be called "Baller23".
    username = models.CharField(
        max_length=150,
        help_text="Display name shown to other players (does not need to be unique).",
        validators=[UnicodeUsernameValidator()],
    )
    # Permanent public identity, e.g. "K7F3QD", rendered as #K7F3QD everywhere.
    public_id = models.CharField(max_length=PUBLIC_ID_LENGTH, unique=True, editable=False)
    # The unique login identifier.
    email = models.EmailField(unique=True)
    points = models.IntegerField(default=0)
    profile_photo = models.ImageField(upload_to='profiles/', default='profiles/default.png')
    rank = models.CharField(max_length=20, choices=RANK_CHOICES, default='Rookie')

    USERNAME_FIELD = "email"
    REQUIRED_FIELDS = ["username"]

    objects = CustomUserManager()

    def __str__(self):
        return f"{self.username}#{self.public_id}"

    def save(self, *args, **kwargs):
        if self.public_id:
            return super().save(*args, **kwargs)
        # Fresh account: pick an ID, retrying on the (astronomically rare)
        # collision — the DB unique constraint is the arbiter under concurrency.
        for _ in range(8):
            self.public_id = generate_public_id()
            try:
                return super().save(*args, **kwargs)
            except IntegrityError:
                exists = type(self).objects.filter(public_id=self.public_id).exists()
                if not exists:
                    raise  # a different integrity problem (e.g. duplicate email)
        raise IntegrityError("Could not allocate a unique public id")

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
