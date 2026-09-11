"""Per-game question modules (spec §8). Module attribute contract:
SLUG, TARGET, MINIMUM, generate, materialize, validate, index_item,
players_referenced, qid_for."""
from trivia.questions.games import career_path, contexto, imposter, superdraft, tictactoe, who_are_ya

GAME_MODULES = {m.SLUG: m for m in (career_path, who_are_ya, tictactoe, superdraft, contexto, imposter)}
