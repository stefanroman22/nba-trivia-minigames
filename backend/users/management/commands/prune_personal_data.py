from django.core.management.base import BaseCommand

from users import retention


class Command(BaseCommand):
    help = (
        "Delete personal data past its retention period (guess logs, game history, moderation "
        "events, resolved feedback, expired token rows). Run weekly by .github/workflows/"
        "prune-personal-data.yml. The periods live in users/retention.py."
    )

    def handle(self, *args, **options):
        for name, count in retention.prune_personal_data().items():
            self.stdout.write(f"{name}: {count} deleted")
        retention.flush_expired_tokens()
        self.stdout.write(self.style.SUCCESS("done"))
