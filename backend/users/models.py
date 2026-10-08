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
    # Google's stable account id (the id_token `sub`). Accounts link by this, not by email,
    # because a Google account's email can change. Null for accounts that never used Google.
    google_sub = models.CharField(max_length=64, unique=True, null=True, blank=True, editable=False)
    points = models.IntegerField(default=0)
    # Legacy/unused: dev and prod share one Supabase DB, and the old backend stays live for a
    # window after this deploys, so the column must survive until it's retired. Drop in a follow-up.
    profile_photo = models.ImageField(upload_to='profiles/', default='profiles/default.png')
    # Normalized 256x256 JPEG bytes (users.photos). Stored in the DB because the API's disk is
    # read-only on Vercel; served inline as a data URL by users.views.user_payload.
    profile_photo_data = models.BinaryField(null=True, blank=True, editable=False)
    # Bumped by every upload; 0 = no photo. It is the cache key of the public photo endpoint
    # (users.photos.profile_photo_view: /api/users/<public_id>/photo/?v=N) and what list rows
    # carry instead of the bytes (users.friends._brief). Backfilled to 1 for pre-0006 photos.
    profile_photo_version = models.PositiveIntegerField(default=0, editable=False)
    rank = models.CharField(max_length=20, choices=RANK_CHOICES, default='Rookie')
    # Moderation (users.strikes). Strikes never expire; the third one bans. `banned_at` is THE
    # ban switch: users.authentication.BanAwareJWTAuthentication refuses every request with a
    # 403 {"code": "account_banned"} while it is set, and banned accounts are hidden (leaderboard,
    # search, public photo, relay) but never deleted, so an unban restores everything.
    strike_count = models.PositiveSmallIntegerField(default=0)
    banned_at = models.DateTimeField(null=True, blank=True)
    # A reason CODE ("name_severe", "photo", "admin"), never the offending text.
    ban_reason = models.CharField(max_length=40, blank=True, default="")
    # Filled only when the account is banned (users.strikes.canonical_email); signup and Google
    # sign-up refuse a new account whose canonical email matches. Weak by design (see docs).
    canonical_email = models.CharField(max_length=254, blank=True, default="", db_index=True)
    # Consent record (users.consent): when the player accepted the Terms/Privacy Policy, which
    # version, and when they confirmed being old enough. No birth date is kept (data minimisation:
    # only the fact that the age check passed). Null on accounts created before this existed.
    terms_accepted_at = models.DateTimeField(null=True, blank=True, editable=False)
    terms_version = models.CharField(max_length=20, blank=True, default="", editable=False)
    age_confirmed_at = models.DateTimeField(null=True, blank=True, editable=False)
    # "teen" (13-15) or "adult" (16+), set at sign-up from the age check; "" on older accounts. Teens
    # cannot upload a public profile photo. The birth date itself is never stored.
    age_group = models.CharField(max_length=5, blank=True, default="", editable=False)

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

    def __str__(self):
        return f"{self.blocker_id} blocked {self.blocked_id}"


class ModerationEvent(models.Model):
    """One moderation decision: a blocked name, a strike, a ban/unban, a signup IP lock.

    Feeds the Django admin inline on CustomUser and the owner's review; never the UI and
    never an API response. Deliberately stores no matched text and no raw IP (owner
    decision 6): only the tier, a reason code and a salted SHA-256 of the IP.
    """

    KIND_CHOICES = [
        ("name_signup", "Name at signup"),
        ("name_change", "Name change"),
        ("photo", "Profile photo"),
    ]
    TIER_CHOICES = [
        ("severe", "Severe"),
        ("mild", "Mild"),
        ("reserved", "Reserved"),
        ("none", "None"),
    ]

    # Null for signup attempts (no account exists) and kept (SET_NULL) if the account is deleted.
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="moderation_events",
        # The composite (user, -created_at) index below already serves user lookups; a second
        # FK-only index is the duplicate migration 0007 removed elsewhere.
        db_index=False,
    )
    # Snapshot of the player's public id, like trivia.Feedback, so the row stays readable.
    public_id = models.CharField(max_length=12, blank=True)
    kind = models.CharField(max_length=20, choices=KIND_CHOICES)
    tier = models.CharField(max_length=10, choices=TIER_CHOICES)
    # Code: "blocked", "strike", "ban", "unban", "signup_ip_locked", "signup_blocked".
    reason = models.CharField(max_length=40)
    ip_hash = models.CharField(max_length=64, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        # The admin inline lists one user's events newest first.
        indexes = [models.Index(fields=["user", "-created_at"], name="modevent_user_created_idx")]

    def __str__(self):
        return f"{self.public_id or '-'} {self.kind} {self.tier} {self.reason}"
