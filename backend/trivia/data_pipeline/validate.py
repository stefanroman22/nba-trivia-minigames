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
    if key == "fan-favorites":
        for i, q in enumerate(data):
            if not isinstance(q, dict) or not q.get("qid") or not q.get("prompt"):
                problems.append(f"{key}[{i}]: missing qid/prompt")
                break
            if not isinstance(q.get("answers"), list) or len(q["answers"]) < 6:
                problems.append(f"{key}[{i}]: needs >= 6 answers")
                break
            counts = [a.get("count", 0) for a in q["answers"]]
            if counts != sorted(counts, reverse=True):
                problems.append(f"{key}[{i}]: answers not in descending count order")
                break
    # Per-game validators from the modular games package (lazy import so this
    # module stays usable outside a fully-wired Django app).
    try:
        from trivia.games import VALIDATORS
    except Exception:
        VALIDATORS = {}
    extra = VALIDATORS.get(key)
    if extra:
        problems.extend(extra(data))
    return problems
