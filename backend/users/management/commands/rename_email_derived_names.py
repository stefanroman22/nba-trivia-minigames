import re

from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand

User = get_user_model()


class Command(BaseCommand):
    help = (
        "Rename Google-created accounts whose public display name was derived from their email address "
        "(the old sign-up behaviour) to a neutral Player#### name. Dry run unless --yes. Players can "
        "choose their own name again in the profile."
    )

    def add_arguments(self, parser):
        parser.add_argument("--yes", action="store_true", help="Apply the renames (default is a dry run)")

    def handle(self, *args, **options):
        import secrets

        affected = []
        for user in User.objects.filter(google_sub__isnull=False):
            local = re.sub(r"[^A-Za-z0-9_]", "", user.email.split("@")[0])[:20]
            if local and user.username.lower() in {local.lower(), f"{local}nba"[:20].lower()}:
                affected.append(user)
        self.stdout.write(f"{len(affected)} account(s) have a name derived from their email")
        for user in affected:
            new = f"Player{secrets.randbelow(9000) + 1000}"
            self.stdout.write(f"  {user.public_id}: -> {new}" if options["yes"] else f"  {user.public_id}: would become {new}")
            if options["yes"]:
                user.username = new
                user.save(update_fields=["username"])
        if not options["yes"] and affected:
            self.stdout.write("Dry run. Re-run with --yes to apply.")
