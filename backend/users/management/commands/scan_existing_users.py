from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand

from users.moderation_text import check_username

User = get_user_model()


class Command(BaseCommand):
    help = (
        "REPORT existing display names the username moderation would block today. "
        "Read-only: never strikes, bans, renames or logs a ModerationEvent."
    )

    def handle(self, *args, **opts):
        flagged = 0
        for public_id, username in User.objects.order_by("pk").values_list("public_id", "username"):
            verdict = check_username(username)
            if verdict.tier == "ok":
                continue
            flagged += 1
            # The id and tier only — the name itself may be the offensive text.
            self.stdout.write(f"{public_id}  {verdict.tier}  {verdict.reason}")
        self.stdout.write(f"{flagged} account(s) would be blocked.")
