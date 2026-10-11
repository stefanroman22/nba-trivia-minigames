import re

from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand

from users.moderation_text import strip_accents
from users.views import generated_username

User = get_user_model()


def _email_derived_names(email):
    """Every display name an earlier sign-up rule could have built from this email: the old rule
    (local part, then local part + "nba") and the 2026-10-11 one (local part before any "+tag",
    accents stripped, optionally cut to 16 + 4 digits). Lowercase, for comparison."""
    local = str(email or "").split("@")[0]
    old = re.sub(r"[^A-Za-z0-9_]", "", local)[:20]
    names = {old.lower(), f"{old}nba"[:20].lower()} if old else set()
    base = re.sub(r"[^A-Za-z0-9_]", "", strip_accents(local.split("+")[0]))[:20]
    if base:
        names.add(base.lower())
    return names, base[:16].lower()


def is_email_derived(user):
    names, stem = _email_derived_names(user.email)
    name = user.username.lower()
    return name in names or bool(stem and re.fullmatch(re.escape(stem) + r"\d{4}", name))


class Command(BaseCommand):
    help = (
        "Rename Google-created accounts whose public display name was derived from their email address "
        "(earlier sign-up rules) to a generated neutral name (users.views.generated_username). Dry run "
        "unless --yes. Players can choose their own name again in the profile."
    )

    def add_arguments(self, parser):
        parser.add_argument("--yes", action="store_true", help="Apply the renames (default is a dry run)")

    def handle(self, *args, **options):
        affected = [user for user in User.objects.filter(google_sub__isnull=False) if is_email_derived(user)]
        self.stdout.write(f"{len(affected)} account(s) have a name derived from their email")
        for user in affected:
            new = generated_username()
            self.stdout.write(f"  {user.public_id}: -> {new}" if options["yes"] else f"  {user.public_id}: would become {new}")
            if options["yes"]:
                user.username = new
                user.save(update_fields=["username"])
        if not options["yes"] and affected:
            self.stdout.write("Dry run. Re-run with --yes to apply.")
