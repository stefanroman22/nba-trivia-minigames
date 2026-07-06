"""Modular per-game backends — one module per minigame (frozen contract #4).

Each module may expose:
  get_round(request) -> JsonResponse({'series': [...]})   (games only)
  build_pool() -> list                                    (optional)
  validate_rows(rows) -> list[str]                        (optional)
  EXTRA_URLS: list of django path() entries               (optional)

This package aggregates them into POOL_BUILDERS / VALIDATORS / urlpatterns.
Per-module try/except import guards keep one broken module from ever killing
the app: the other games keep working and the broken slug simply 404s.
"""
from importlib import import_module

from django.urls import path

# module name -> public slug (URL segment + static pool key). players_index is
# data-only: it publishes the curated dataset as the "players-index" pool that
# the criteria games (heatmap/grid/tictactoe/bingo/...) validate against.
_GAME_MODULES = {
    "heatmap": "heatmap",
    "connections": "connections",
    "career_path": "career-path",
    "nba_grid": "nba-grid",
    "who_are_ya": "who-are-ya",
    "tictactoe": "tictactoe",
    "bingo": "bingo",
    "contexto": "contexto",
    "who_would_win": "who-would-win",
    "pack_five": "pack-five",
    "superdraft": "superdraft",
    "imposter": "imposter",
    "players_index": "players-index",
}

POOL_BUILDERS = {}
VALIDATORS = {}
urlpatterns = []

for _mod_name, _slug in _GAME_MODULES.items():
    try:
        _mod = import_module(f"trivia.games.{_mod_name}")
    except Exception:  # ImportError/SyntaxError/... — skip just this module
        continue
    if hasattr(_mod, "build_pool"):
        POOL_BUILDERS[_slug] = _mod.build_pool
    if hasattr(_mod, "validate_rows"):
        VALIDATORS[_slug] = _mod.validate_rows
    if hasattr(_mod, "get_round"):
        urlpatterns.append(path(f"{_slug}/", _mod.get_round, name=_slug))
    urlpatterns.extend(getattr(_mod, "EXTRA_URLS", []))
