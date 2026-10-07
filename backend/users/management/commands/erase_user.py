from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand, CommandError

from users.account_data import delete_account

User = get_user_model()


class Command(BaseCommand):
    help = (
        "Erase a player's account and data on their request (GDPR Art 17), for the cases the "
        "self-service button can't serve: a banned player (the API refuses their sign-in) or a "
        "player who emailed instead. Looked up by public id or email. A banned account is "
        "anonymised, not removed, so the ban can't simply be dodged (see users.account_data)."
    )

    def add_arguments(self, parser):
        parser.add_argument("who", help="Public id (e.g. K7F3QD) or email of the account")
        parser.add_argument("--yes", action="store_true", help="Skip the confirmation prompt's dry run")

    def handle(self, *args, **options):
        who = options["who"].strip()
        user = (
            User.objects.filter(email__iexact=who).first()
            if "@" in who
            else User.objects.filter(public_id__iexact=who).first()
        )
        if not user:
            raise CommandError(f"No account matches {who!r}")
        label = f"{user.username}#{user.public_id}" + (" (banned)" if user.banned_at else "")
        if not options["yes"]:
            self.stdout.write(f"Would erase {label}. Re-run with --yes to do it.")
            return
        outcome = delete_account(user)
        self.stdout.write(self.style.SUCCESS(f"{label}: {outcome}"))
