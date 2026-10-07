from django.conf import settings
from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand

from users.moderation_text import check_username
from users.photo_moderation import ALLOW, ModerationUnavailable, classify_photo, decide

User = get_user_model()


class Command(BaseCommand):
    help = (
        "REPORT existing display names the username moderation would block today "
        "(--photos: existing profile photos the photo moderation would block or flag instead). "
        "Read-only: never strikes, bans, renames, deletes a photo or logs a ModerationEvent."
    )

    def add_arguments(self, parser):
        parser.add_argument(
            "--photos",
            action="store_true",
            help="Scan stored profile photos with the moderation service instead of display names.",
        )

    def handle(self, *args, **opts):
        if opts["photos"]:
            return self.scan_photos()
        flagged = 0
        for public_id, username in User.objects.order_by("pk").values_list("public_id", "username"):
            verdict = check_username(username)
            if verdict.tier == "ok":
                continue
            flagged += 1
            # The id and tier only — the name itself may be the offensive text.
            self.stdout.write(f"{public_id}  {verdict.tier}  {verdict.reason}")
        self.stdout.write(f"{flagged} account(s) would be blocked.")

    def scan_photos(self):
        if not settings.IMAGE_MODERATION_URL:
            self.stdout.write("IMAGE_MODERATION_URL is unset: photo scan skipped.")
            return
        flagged = unchecked = 0
        users = User.objects.exclude(profile_photo_data__isnull=True).order_by("pk")
        # One photo in memory at a time; the bytes are only sent to the service, never printed.
        for pk in users.values_list("pk", flat=True):
            public_id, data = User.objects.filter(pk=pk).values_list("public_id", "profile_photo_data").get()
            if not data:
                continue
            try:
                decision = decide(classify_photo(bytes(data)))
            except ModerationUnavailable:
                unchecked += 1
                self.stdout.write(f"{public_id}  photo  unchecked")
                continue
            if decision == ALLOW:
                continue
            flagged += 1
            self.stdout.write(f"{public_id}  photo  {decision}")
        self.stdout.write(f"{flagged} photo(s) flagged, {unchecked} could not be checked.")
