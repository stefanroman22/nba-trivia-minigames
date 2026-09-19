from django.conf import settings
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

    def normalize_login_email(self, email):
        """The canonical stored form of a login email — same rule as signup_view."""
        return str(email or "").strip().lower()

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


class FriendRequest(models.Model):
    """A pending request from `sender` to `receiver`.

    Only ever holds PENDING requests — accepting one deletes this row and
    creates a `Friendship`; declining or cancelling just deletes it. There is
    deliberately no status field or history: nothing downstream needs to know
    a request once existed after it's resolved.
    """

    sender = models.ForeignKey(
        settings.AUTH_USER_MODEL, related_name="sent_friend_requests", on_delete=models.CASCADE
    )
    receiver = models.ForeignKey(
        settings.AUTH_USER_MODEL, related_name="received_friend_requests", on_delete=models.CASCADE
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["sender", "receiver"], name="uniq_pending_friend_request"),
        ]
        indexes = [models.Index(fields=["receiver"]), models.Index(fields=["sender"])]

    def __str__(self):
        return f"{self.sender_id} -> {self.receiver_id}"


class Friendship(models.Model):
    """An established mutual friendship, stored once per pair.

    `user_low`/`user_high` are ordered by pk (see `ordered_pair`) so (A, B)
    and (B, A) can never both exist as separate rows — every query and write
    goes through that same canonical ordering.
    """

    user_low = models.ForeignKey(
        settings.AUTH_USER_MODEL, related_name="friendships_low", on_delete=models.CASCADE
    )
    user_high = models.ForeignKey(
        settings.AUTH_USER_MODEL, related_name="friendships_high", on_delete=models.CASCADE
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["user_low", "user_high"], name="uniq_friendship_pair"),
        ]
        indexes = [models.Index(fields=["user_low"]), models.Index(fields=["user_high"])]

    @staticmethod
    def ordered_pair(a, b):
        """Return (a, b) sorted so the same pair always maps to the same row."""
        return (a, b) if a.pk < b.pk else (b, a)

    def __str__(self):
        return f"{self.user_low_id} <-> {self.user_high_id}"


class BlockedUser(models.Model):
    """`blocker` has blocked `blocked`. While this exists in either direction
    between two users, neither can send the other a friend request, and
    search hides them from each other."""

    blocker = models.ForeignKey(
        settings.AUTH_USER_MODEL, related_name="blocking", on_delete=models.CASCADE
    )
    blocked = models.ForeignKey(
        settings.AUTH_USER_MODEL, related_name="blocked_by", on_delete=models.CASCADE
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["blocker", "blocked"], name="uniq_block_pair"),
        ]
        indexes = [models.Index(fields=["blocker"]), models.Index(fields=["blocked"])]

    def __str__(self):
        return f"{self.blocker_id} blocked {self.blocked_id}"
