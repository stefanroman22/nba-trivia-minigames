"""The maintenance job: re-materialize, retire, top up, gate, publish (spec §9)."""
import re
import tempfile

from django.db import transaction
from django.utils import timezone

from trivia.data_pipeline.publish import upload_plan
from trivia.models import Question
from trivia.questions.base import Invalid
from trivia.questions.games import GAME_MODULES
from trivia.questions.hashing import content_hash
from trivia.questions.snapshot import apply_retention, build_names, build_questions_publish_plan, write_snapshot
from trivia.questions.storage import StorageUnavailable, fetch_json, next_version, public_url

GENERATE_BATCH = 50


class BelowMinimum(Exception):
    def __init__(self, slug, count, minimum):
        super().__init__(f"{slug}: {count} active < minimum {minimum}")
        self.slug, self.count, self.minimum = slug, count, minimum


class RunAborted(Exception):
    pass


def current_published_version(cfg):
    try:
        return (fetch_json(public_url(cfg, "questions/manifest.json")) or {}).get("version")
    except StorageUnavailable:
        return None


def _next_seq(slug):
    seqs = [0]
    for qid in Question.objects.filter(game=slug).values_list("qid", flat=True):
        m = re.search(r"(\d+)$", qid)
        if m:
            seqs.append(int(m.group(1)))
    return max(seqs) + 1


def _materialize_row(mod, row, dataset, now):
    try:
        m = mod.materialize(row.definition, dataset)
        problems = mod.validate(m)
    except Invalid as e:
        problems = [str(e)]
        m = None
    if problems:
        row.status = Question.STATUS_RETIRED
        row.retired_at = now
        row.retired_reason = "; ".join(problems)[:2000]
        row.save(update_fields=["status", "retired_at", "retired_reason", "updated_at"])
        return None
    m["qid"] = row.qid
    row.quality = {"materialized": True}
    row.players_referenced = mod.players_referenced(row.definition, m, dataset)
    row.dataset_version = dataset.version
    row.save(update_fields=["quality", "players_referenced", "dataset_version", "updated_at"])
    item = mod.index_item(row.definition, m)
    item[0] = row.qid
    return (row.qid, item, m)


def _active_count(slug, kept, today):
    if slug == "imposter":
        return len(kept[0][2]["names"]) if kept else 0
    if slug == "contexto":
        return sum(1 for _, _, m in kept if m.get("day", "") >= today)
    return len(kept)


def _process_game(slug, dataset, rng, now, out):
    mod = GAME_MODULES[slug]
    today = now.date().isoformat()
    if slug == "contexto":
        dataset.extra["contexto_existing"] = list(
            Question.objects.filter(game=slug).values_list("definition", flat=True)
        )
    kept, retired = [], 0
    for row in Question.objects.filter(game=slug, status=Question.STATUS_ACTIVE).order_by("id"):
        result = _materialize_row(mod, row, dataset, now)
        if result is None:
            retired += 1
        else:
            kept.append(result)
    target = mod.TARGET if mod.TARGET is not None else 10 ** 9
    existing = set(Question.objects.filter(game=slug).values_list("content_hash", flat=True))
    added, seq = 0, _next_seq(slug)
    while _active_count(slug, kept, today) < target:
        want = min(GENERATE_BATCH, target - _active_count(slug, kept, today)) if mod.TARGET is not None else GENERATE_BATCH
        defs = mod.generate(dataset, existing, rng, want)
        if not defs:
            break
        for d in defs:
            h = content_hash(d)
            if h in existing:
                continue
            existing.add(h)
            row = Question(game=slug, qid=mod.qid_for(d, seq), definition=d, content_hash=h, created_by="generator")
            seq += 1
            row.save()
            result = _materialize_row(mod, row, dataset, now)
            if result is not None:
                kept.append(result)
                added += 1
        if slug == "contexto":
            dataset.extra["contexto_existing"] += defs
    active = _active_count(slug, kept, today)
    if active < mod.MINIMUM:
        raise BelowMinimum(slug, active, mod.MINIMUM)
    out(f"  {slug}: active {len(kept)}, retired {retired}, added {added}")
    return kept, {"active": len(kept), "retired": retired, "added": added, "materialized": len(kept)}


def run(games, publish, dry_run, rng, dataset, s3=None, cfg=None, out=print):
    games = games or list(GAME_MODULES)
    now = timezone.now()
    summary = {"version": None}
    with transaction.atomic():
        per_game = {}
        for slug in games:
            kept, stats = _process_game(slug, dataset, rng, now, out)
            per_game[slug] = kept
            summary[slug] = stats
        if publish:
            version = next_version(current_published_version(cfg))
            names = build_names(dataset.playable)
            try:
                with tempfile.TemporaryDirectory() as tmp:
                    counts = write_snapshot(tmp, version, dataset.version, per_game, names)
                    plan = build_questions_publish_plan(tmp, version, dataset.version, cfg.public_base, counts)
                    if not dry_run:
                        upload_plan(plan, s3, cfg.bucket)
            except Exception as e:
                raise RunAborted(f"publish failed: {e}") from e
            if dry_run:
                out(f"  dry run: snapshot built and validated ({sum(counts.values())} questions across {len(counts)} games), nothing uploaded")
            else:
                summary["version"] = version
                out(f"  published version {version}")
                try:
                    apply_retention(s3, cfg.bucket, keep=3)
                except Exception as e:
                    out(f"  retention cleanup failed (non-fatal): {e}")
        if dry_run:
            transaction.set_rollback(True)
            out("  dry run: rolled back")
    return summary
