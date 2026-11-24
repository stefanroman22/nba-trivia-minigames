"""AI game builder: an admin describes a trivia game in plain text and a Claude agent turns it into a GameSpec, a
small declarative recipe (dataset + filters + question template + mode) that the engine plays from the published
datasets. The agent never writes code and never invents questions: every round is rendered from real rows.

sources.py   the datasets a spec may draw on, with a whitelisted, typed field list each
spec.py      GameSpec validation (the only door a model-written spec comes through)
engine.py    spec -> rounds, deterministic for a seed; preview() is the agent's own test run
agent.py     the Claude tool loop (describe_source, preview_game, submit_game)
api.py       the staff-only endpoints behind Admin -> Game Builder

Off unless ANTHROPIC_API_KEY is set (settings.GAME_BUILDER_ENABLED): each build or refine is a billed API call.
"""
