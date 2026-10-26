// The players the photo map must cover: the live pool, i.e. the rows of players_curated.json with at least one team
// stint (backend/trivia/data_pipeline/curated_players.py playable_rows). That file is what the data refresh commits
// (data-refresh.yml); backend/trivia/data/players-index.json is not refreshed, so a gate on it would miss new players.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const PLAYERS_SOURCE = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "backend", "trivia", "data_static", "players_curated.json");

/** Rows the games may draw from: the ones with a team stint. */
export const playablePlayers = (rows) => rows.filter((p) => p.teams?.length);

export const loadPlayablePlayers = () => playablePlayers(JSON.parse(readFileSync(PLAYERS_SOURCE, "utf8")));
