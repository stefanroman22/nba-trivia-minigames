"""Shared pieces every game module and the runner use."""
from trivia.data_pipeline.curated_players import playable_rows

SCHEMA = 1


class Invalid(Exception):
    """A definition cannot be materialized against the current dataset."""


class Dataset:
    def __init__(self, rows, version):
        self.rows = rows
        self.playable = playable_rows(rows)
        self.by_id = {r["person_id"]: r for r in self.playable}
        self.version = version


def load_dataset_from_rows(rows, version):
    return Dataset([r for r in rows if isinstance(r, dict)], version)


def envelope(slug, qid, payload):
    return {"schema": SCHEMA, "game": slug, "qid": qid, **payload}
