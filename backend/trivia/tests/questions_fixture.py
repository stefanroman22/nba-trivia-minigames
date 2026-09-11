import json
import os

from trivia.questions.base import load_dataset_from_rows

FIXTURE = os.path.join(os.path.dirname(__file__), "fixtures", "players_fixture.json")


def fixture_rows():
    with open(FIXTURE, encoding="utf-8") as f:
        return json.load(f)


def fixture_dataset(version="fixture-1"):
    return load_dataset_from_rows(fixture_rows(), version)
