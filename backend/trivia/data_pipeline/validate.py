def validate_pool(key, data):
    """Return a list of human-readable problems for a pool. Empty list means valid."""
    if not isinstance(data, list):
        return [f"{key}: expected a list, got {type(data).__name__}"]
    problems = []
    if len(data) == 0:
        problems.append(f"{key}: empty pool")
    if key == "starting-five":
        for i, g in enumerate(data):
            if not isinstance(g, dict) or "game_id" not in g or "starting_5" not in g:
                problems.append(f"{key}[{i}]: missing game_id/starting_5")
                break
    if key == "playoff":
        for i, s in enumerate(data):
            if not isinstance(s, dict) or "season" not in s or "winner" not in s:
                problems.append(f"{key}[{i}]: missing season/winner")
                break
    return problems
