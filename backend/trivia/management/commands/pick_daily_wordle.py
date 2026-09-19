"""Pick today's single-player Wordle word and prune stale play-gate rows.

Not load-bearing for correctness — trivia.wordle_daily.get_or_create_daily_word
is called lazily by the play/status endpoints too, so a missed or late run of
this command (GitHub Actions cron can run hours late) never breaks the game.
Running it on a schedule just gets the word queued up in advance and keeps the
WordlePlay table from accumulating past days' rows.
"""
from django.core.management.base import BaseCommand

from trivia.models import SyncRun, WordleDailyWord
from trivia import wordle_daily


class Command(BaseCommand):
    help = "Pick today's Wordle word (Europe/Paris day) if not already picked, and prune stale plays."

    def handle(self, *args, **opts):
        day = wordle_daily.cet_today()
        already_picked = WordleDailyWord.objects.filter(date=day).exists()
        try:
            daily_word = wordle_daily.get_or_create_daily_word(day)
        except ValueError as e:
            SyncRun.objects.create(dataset="wordle-daily", status="failed", rows=0, detail=str(e))
            self.stderr.write(self.style.ERROR(str(e)))
            return

        pruned = wordle_daily.prune_stale_plays(day)

        detail = f"{day}: {daily_word.word}" + (" (already picked)" if already_picked else " (picked now)")
        SyncRun.objects.create(dataset="wordle-daily", status="success", rows=1, detail=detail)
        self.stdout.write(self.style.SUCCESS(f"{detail}; pruned {pruned} stale play row(s)"))
