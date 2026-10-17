"""Per-game question modules (spec §8). Module attribute contract:
SLUG, TARGET, MINIMUM, generate, materialize, validate, index_item,
players_referenced, qid_for; optional capacity(dataset) (trivia.questions.demand).
The editorial pool games (fan-favorites, who-would-win, connections; spec §4.6) add
pool_row(materialized): the row their pool file publishes (runner.pool_rows)."""
from trivia.questions.games import (
    career_path, connections, contexto, fan_favorites, imposter, superdraft, tictactoe, who_are_ya, who_would_win,
)

GAME_MODULES = {m.SLUG: m for m in (career_path, who_are_ya, tictactoe, superdraft, contexto, imposter,
                                    fan_favorites, who_would_win, connections)}
