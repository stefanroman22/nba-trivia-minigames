"""The maintenance job: re-materialize, retire, top up, gate, publish (spec §9).

maintain() is the maintenance alone; publish_game_data_v3 runs it and publishes
the public question games to the manifest-v3 data host. run() (maintain_questions)
still publishes the Supabase Storage snapshot, kept for the hidden games."""
import datetime
import re
import tempfile

from django.db import transaction
from django.utils import timezone

from trivia.data_pipeline.publish import upload_plan
from trivia.models import Question
from trivia.questions import checker, demand, specs
from trivia.questions import quality as scoring
from trivia.questions.base import Invalid
from trivia.questions.games import GAME_MODULES
from trivia.questions.hashing import content_hash
from trivia.questions.journal import Journal
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


def _materialize(mod, definition, dataset):
    """(materialized, problems) for one definition; no DB access."""
    try:
        m = mod.materialize(definition, dataset)
        problems = mod.validate(m)
    except Invalid as e:
        problems = [str(e)]
        m = None
    return m, problems


def _kept(mod, row, m):
    m["qid"] = row.qid
    item = mod.index_item(row.definition, m)
    item[0] = row.qid
    labeled = getattr(mod, "index_label", None)  # Tic-Tac-Toe: [qid, difficulty] for the player's choice
    if labeled is not None:
        item = labeled(row, item)
    return (row.qid, item, m)


def _materialize_row(mod, row, dataset, now, journal, stage=False, spec=None):
    m, problems = _materialize(mod, row.definition, dataset)
    if problems:
        row.status = Question.STATUS_RETIRED
        row.retired_at = now
        row.retired_reason = "; ".join(problems)[:2000]
        row.save(update_fields=["status", "retired_at", "retired_reason", "updated_at"])
        journal.log("retired", "no_longer_valid", game=row.game, qid=row.qid, problems=problems[:5])
        return None
    m["qid"] = row.qid
    quality = {**(row.quality or {}), "materialized": True}
    if spec is not None:  # difficulty, band, interest, coverage, dup_key (spec §4.3)
        quality.update(scoring.score(mod, m, dataset, spec, row.definition))
        if quality.get("band_override") in scoring.LEVELS:  # the doctor's reband (spec §4.9) outlives re-scoring
            quality["band"] = quality["band_override"]
    view = getattr(mod, "checker_view", None)
    if view is not None:
        # What the Checker checks is what is hashed: a different view is different content.
        sha = checker.payload_sha(view(m, dataset))
        if quality.get("payload_sha") not in (None, sha):
            quality.pop("checked", None)
            quality.pop("unsure_count", None)  # new content starts a fresh check
            if stage and row.status == Question.STATUS_ACTIVE:
                row.status = Question.STATUS_PENDING
                journal.log("staged_for_recheck", "view_changed", game=row.game, qid=row.qid)
        quality["payload_sha"] = sha
    row.quality = quality
    row.players_referenced = mod.players_referenced(row.definition, m, dataset)
    row.dataset_version = dataset.version
    row.save(update_fields=["status", "quality", "players_referenced", "dataset_version", "updated_at"])
    return _kept(mod, row, m)


def _active_count(slug, kept, today):
    if slug == "imposter":
        return len(kept[0][2]["names"]) if kept else 0
    if slug == "contexto":
        return sum(1 for _, _, m in kept if m.get("day", "") >= today)
    return len(kept)


def _add(mod, slug, d, h, seq, dataset, now, journal, staged, spec=None, created_by="generator", reason="top_up",
         **detail):
    """Save one new question (pending when staged) and materialize it; result None if it does not hold."""
    qid = mod.qid_for(d, seq)
    if Question.objects.filter(game=slug, qid=qid).exists():  # e.g. a refilled Contexto day
        qid = f"{qid}-r{seq}"
    row = Question(game=slug, qid=qid, definition=d, content_hash=h, created_by=created_by,
                   status=Question.STATUS_PENDING if staged else Question.STATUS_ACTIVE)
    row.save()
    result = _materialize_row(mod, row, dataset, now, journal, staged, spec)
    if result is not None:
        journal.log("generated", reason, game=slug, qid=row.qid, definition=d,
                    **({"status": row.status} if staged else {}), **detail)
    return result


def _select_and_add(mod, slug, spec, dataset, rng, now, journal, staged, scored, existing, seq,
                    supply, target, added_to, detail):
    """Over-generate and select (spec §4.1 step 4, §4.3) up to `target` (None = unbounded).

    Each round generates 3 x the shortfall as candidates and scores them in memory. Gates:
    interest below spec min (low_interest), a dup_key already active, pending or in this
    batch (duplicate), a featured player over max_player_share (consistency). Rejected
    candidates are journaled, never saved, and their hashes stay out of `existing`, so they
    can be proposed again next run. quality.select picks the rest band and coverage first;
    at most refill.max_new_per_run are added per run. Logs one gap_report. Returns (added, seq).
    """
    cap = spec["refill"]["max_new_per_run"]
    if slug == "contexto":  # no repeat inside the window; an older secret may come back
        cutoff = (now.date() - datetime.timedelta(days=mod.NO_REPEAT_DAYS)).isoformat()
        scored = [s for s in scored if s[0].get("day", "") >= cutoff]
    state = scoring.new_state()
    for definition, m, q in scored:
        scoring.add(state, q, scoring.featured(mod, definition, m, dataset))
    taken = {q["dup_key"] for _, _, q in scored}
    universe = {c for _, _, q in scored for c in scoring.cells(q)}
    proposed, pool, added = set(), [], 0
    while (target is None or supply() < target) and added < cap:
        want = min(GENERATE_BATCH, cap - added, target - supply() if target is not None else GENERATE_BATCH)
        if 3 * want > len(pool):
            for d in mod.generate(dataset, existing | proposed, rng, 3 * want - len(pool)):
                h = content_hash(d)
                if h in existing or h in proposed:
                    continue
                proposed.add(h)
                m, problems = _materialize(mod, d, dataset)
                if problems:
                    continue
                s = scoring.score(mod, m, dataset, spec, d)
                universe.update(scoring.cells(s))
                if s["interest"] < spec["interest"]["min"]:
                    journal.log("rejected", "low_interest", game=slug, dup_key=s["dup_key"],
                                interest=s["interest"], definition=d)
                elif s["dup_key"] in taken:
                    journal.log("rejected", "duplicate", game=slug, dup_key=s["dup_key"], definition=d)
                else:
                    taken.add(s["dup_key"])
                    pool.append({"definition": d, "scores": s, "featured": scoring.featured(mod, d, m, dataset)})
        picked, refused = scoring.select(pool, want, state, spec)
        for c in refused:
            journal.log("rejected", "consistency", game=slug, dup_key=c["scores"]["dup_key"],
                        players=c["over"], definition=c["definition"])
        if not picked:
            break
        defs = [c["definition"] for c in picked]
        place = getattr(mod, "place", None)  # Contexto: the kept secrets take the first free days
        if place is not None:
            defs = place(defs, dataset)
        saved = []
        for d in defs:
            h = content_hash(d)
            if h in existing:
                continue
            existing.add(h)
            result = _add(mod, slug, d, h, seq, dataset, now, journal, staged, spec)
            seq += 1
            if result is not None:
                added_to.append(result)
                added += 1
                saved.append(d)
        if slug == "contexto":
            dataset.extra["contexto_existing"] += saved
            dataset.extra["contexto_taken"] += saved
    journal.log("gap_report", "coverage", game=slug, **scoring.gap_report(state, universe, spec),
                **({"capacity_bound": True} if detail.get("capacity_bound") else {}))
    return added, seq


def _process_game(slug, dataset, rng, now, out, journal, stage=False):
    mod = GAME_MODULES[slug]
    spec = specs.load(slug) if hasattr(mod, "features") else None  # scored games (spec §4.3)
    today = now.date().isoformat()
    # Staged games (phase 4): new and changed questions wait for the Checker as pending.
    staged = stage and slug in checker.STAGED_GAMES
    statuses = [Question.STATUS_ACTIVE, Question.STATUS_PENDING] if staged else [Question.STATUS_ACTIVE]
    if slug == "contexto":
        # Every secret ever scheduled counts for the no-repeat rule; only live or pending
        # days are taken, so a retired or quarantined day is scheduled again.
        dataset.extra["contexto_existing"] = list(
            Question.objects.filter(game=slug).values_list("definition", flat=True)
        )
        dataset.extra["contexto_taken"] = list(
            Question.objects.filter(game=slug, status__in=statuses).values_list("definition", flat=True)
        )
    kept, pending, retired = [], [], 0
    scored = []  # (definition, materialized, quality) of each live or pending question
    for row in Question.objects.filter(game=slug, status__in=statuses).select_related("label").order_by("id"):
        result = _materialize_row(mod, row, dataset, now, journal, staged, spec)
        if result is not None and spec is not None:
            scored.append((row.definition, result[2], row.quality))
        if result is None:
            retired += 1
        elif row.status == Question.STATUS_PENDING:
            pending.append(result)
        else:
            kept.append(result)
    chosen, detail = demand.target_for(slug, mod, now, dataset)  # None = unbounded
    target = chosen if chosen is not None else 10 ** 9

    def supply():  # pending questions count toward the target, so none is generated twice
        return _active_count(slug, kept, today) + _active_count(slug, pending, today)

    active_before = _active_count(slug, kept, today)
    journal.log("refill_decision", "below_target" if supply() < target else "enough", game=slug,
                active=active_before, target=chosen, retired=retired,
                **({"pending": _active_count(slug, pending, today)} if staged else {}), **detail)
    if detail.get("capacity_bound"):
        journal.log("capacity_bound", "capacity_below_demand", game=slug, target=chosen,
                    capacity=detail.get("capacity"), demand=detail.get("demand"), want=detail.get("want"))
    if detail.get("saturated"):
        journal.log("saturation", "pool_seen", game=slug, share=detail.get("saturation"), target=chosen)
    existing = set(Question.objects.filter(game=slug).values_list("content_hash", flat=True))
    added, seq = 0, _next_seq(slug)
    if spec is not None:
        added, seq = _select_and_add(mod, slug, spec, dataset, rng, now, journal, staged, scored, existing, seq,
                                     supply, chosen, pending if staged else kept, detail)
    while spec is None and supply() < target:
        want = min(GENERATE_BATCH, target - supply()) if chosen is not None else GENERATE_BATCH
        defs = mod.generate(dataset, existing, rng, want)
        if not defs:
            break
        for d in defs:
            h = content_hash(d)
            if h in existing:
                continue
            existing.add(h)
            result = _add(mod, slug, d, h, seq, dataset, now, journal, staged)
            seq += 1
            if result is not None:
                (pending if staged else kept).append(result)
                added += 1
    active = _active_count(slug, kept, today)
    stats = {"active": len(kept), "retired": retired, "added": added, "materialized": len(kept)}
    if staged:
        stats["pending"] = len(pending)
    if active < mod.MINIMUM:
        if not staged:
            raise BelowMinimum(slug, active, mod.MINIMUM)
        # Staged: keep the pending work (re-checks, new questions) so the Checker can bring
        # the game back above its minimum; maintain() holds back only the publish.
        stats["below_minimum"] = str(BelowMinimum(slug, active, mod.MINIMUM))
    out(f"  {slug}: active {len(kept)}, retired {retired}, added {added}"
        + (f", pending {len(pending)}" if staged else ""))
    return kept, stats


def maintain(games, dataset, rng, now=None, out=print, isolate=False, journal=None, stage=False):
    """Re-materialize, retire, top up and gate each game; no publishing.

    Returns ({slug: [(qid, index_item, materialized), ...]}, {slug: stats}).
    Writes to the questions table, so call it inside transaction.atomic(): a
    BelowMinimum (or any later failure in the caller's block) rolls every game's
    writes back. Used by run() (Supabase snapshot) and publish_game_data_v3.

    isolate=True (publish_game_data_v3): each game runs in its own savepoint. A
    game below its minimum is rolled back alone, left out of the result and
    reported as stats[slug] = {"held_back": reason}; the other games go on.

    journal (trivia.questions.journal.Journal) receives every decision; events of a
    held-back game are marked rolled_back. Without one, decisions are discarded.

    stage=True (publish_game_data_v3's default): for the Checker's games
    (checker.STAGED_GAMES) new questions, and live ones whose checker view changed,
    become pending; only active questions are returned for publishing.
    """
    now = now or timezone.now()
    journal = journal or Journal("supply")
    per_game, stats = {}, {}
    for slug in games:
        if not isolate:
            per_game[slug], stats[slug] = _process_game(slug, dataset, rng, now, out, journal, stage)
            if "below_minimum" in stats[slug]:
                active = stats[slug]["active"]
                raise BelowMinimum(slug, active, GAME_MODULES[slug].MINIMUM)
            continue
        mark = len(journal.events)
        try:
            with transaction.atomic():
                kept, game_stats = _process_game(slug, dataset, rng, now, out, journal, stage)
            if "below_minimum" in game_stats:  # staged: writes kept, publish held back
                journal.log("held_back", "below_minimum", game=slug, active=game_stats["active"],
                            minimum=GAME_MODULES[slug].MINIMUM, pending=game_stats.get("pending", 0))
                stats[slug] = {"held_back": game_stats["below_minimum"],
                               **{k: v for k, v in game_stats.items() if k != "below_minimum"}}
                out(f"  {slug}: held back, {game_stats['below_minimum']}")
                continue
            per_game[slug], stats[slug] = kept, game_stats
        except BelowMinimum as e:
            journal.mark_rolled_back(since=mark)
            journal.log("held_back", "below_minimum", game=slug, active=e.count, minimum=e.minimum)
            stats[slug] = {"held_back": str(e)}
            out(f"  {slug}: held back, {e}")
    return per_game, stats


def materialize_active(games, dataset, now=None, out=None):
    """Read-only twin of maintain(): materialize each game's current active rows
    without retiring, topping up or saving anything (no DB writes).

    A row that no longer materializes is left out (maintenance would retire it);
    the minimum gate still applies and raises BelowMinimum. So is a Checker game's
    row whose checker view no longer matches the payload_sha it was published with
    (the dataset changed since): that content was never checked, so it waits for
    the next maintenance run to stage it for the Checker instead of shipping.
    """
    today = (now or timezone.now()).date().isoformat()
    per_game = {}
    for slug in games:
        mod = GAME_MODULES[slug]
        view = getattr(mod, "checker_view", None) if slug in checker.STAGED_GAMES else None
        kept, skipped = [], 0
        for row in Question.objects.filter(game=slug, status=Question.STATUS_ACTIVE).select_related("label").order_by("id"):
            m, problems = _materialize(mod, row.definition, dataset)
            if problems:
                skipped += 1
                continue
            stored = (row.quality or {}).get("payload_sha")
            if view is not None and stored is not None and checker.payload_sha(view(m, dataset)) != stored:
                skipped += 1
                continue
            kept.append(_kept(mod, row, m))
        active = _active_count(slug, kept, today)
        if active < mod.MINIMUM:
            raise BelowMinimum(slug, active, mod.MINIMUM)
        if out:
            out(f"  {slug}: {len(kept)} current questions ({skipped} no longer materialize; left out)")
        per_game[slug] = kept
    return per_game


def pool_rows(slug, dataset=None, out=None):
    """The published rows of an editorial pool game (fan-favorites, who-would-win,
    connections: mod.pool_row of each active question, in id order), read-only through
    materialize_active (BelowMinimum still raises). None while the game has no active
    question yet (the seed import has not run): the caller falls back to its seed.
    The dataset is the committed curated one unless given. `out` gets one line per active
    question left out (it no longer materializes, or its checker view changed since it
    was checked: the next maintenance stages it for the Checker)."""
    active = list(Question.objects.filter(game=slug, status=Question.STATUS_ACTIVE)
                  .order_by("id").values_list("qid", flat=True))
    if not active:
        return None
    if dataset is None:
        from trivia.data_pipeline.publish_v3 import curated_dataset

        dataset = curated_dataset()
    mod = GAME_MODULES[slug]
    kept = materialize_active([slug], dataset)[slug]
    if out:
        published = {qid for qid, _, _ in kept}
        for qid in active:
            if qid not in published:
                out(f"  {slug}/{qid}: left out of the pool (no longer materializes or its view changed)")
    return [mod.pool_row(m) for _, _, m in kept]


def run(games, publish, dry_run, rng, dataset, s3=None, cfg=None, out=print):
    games = games or list(GAME_MODULES)
    now = timezone.now()
    summary = {"version": None}
    with transaction.atomic():
        # stage=True: this legacy path must not put unchecked questions live either.
        per_game, stats = maintain(games, dataset, rng, now, out, stage=True)
        summary.update(stats)
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
