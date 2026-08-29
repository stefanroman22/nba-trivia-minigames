from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand, CommandError

User = get_user_model()


class Command(BaseCommand):
    help = (
        "Grant (or revoke, with --revoke) admin rights for an existing account, "
        "looked up by email. Sets is_staff + is_superuser."
    )

    def add_arguments(self, parser):
        parser.add_argument("email", help="Email of the account to promote")
        parser.add_argument(
            "--revoke",
            action="store_true",
            help="Remove admin rights instead of granting them",
        )

    def handle(self, *args, **options):
        email = options["email"].strip()
        try:
            user = User.objects.get(email__iexact=email)
        except User.DoesNotExist:
            raise CommandError(f"No account with email {email!r}")

        grant = not options["revoke"]
        user.is_staff = grant
        user.is_superuser = grant
        user.save(update_fields=["is_staff", "is_superuser"])

        verb = "promoted to admin" if grant else "demoted from admin"
        self.stdout.write(self.style.SUCCESS(f"{user} ({user.email}) {verb}."))
