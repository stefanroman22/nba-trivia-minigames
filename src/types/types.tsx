// Shared application types.

export interface User {
  username: string;
  email: string;
  profile_photo: string | null;
  points: number;
  rank: string;
}

/** Lightweight player info exchanged over the multiplayer socket. */
export interface PlayerInfo {
  /** Permanent public player id (#K7F3QD) — usernames may repeat. */
  id?: string | null;
  username?: string;
  profile_photo?: string | null;
  rank?: string | number;
  points?: string | number;
}

/* ---- Per-game data shapes (as served by the Django /trivia endpoints) ---- */

export interface PlayoffSeries {
  season: string;
  round: string;
  team_a: string;
  team_b: string;
  team_a_logo: string;
  team_b_logo: string;
  team_a_wins: number;
  team_b_wins: number;
  winner: string;
}

export interface NbaTeamLogo {
  full_name: string;
  logo: string;
}

export interface MvpSeason {
  season: string;
  mvp: string;
}

export interface StartingFivePlayer {
  name: string;
  position: string;
}

export interface StartingFiveGame {
  team_a: string;
  team_b: string;
  team_a_logo: string;
  team_b_logo: string;
  winning_team: string;
  final_score: string;
  game_date: string;
  starting_5: StartingFivePlayer[];
}

export interface FanFavoritesAnswer {
  answer: string;
  count: number;
  aliases?: string[];
}

export interface FanFavoritesQuestion {
  qid: string;
  prompt: string;
  survey_date?: string;
  answers: FanFavoritesAnswer[];
}

/* ---- Curated player index (frozen contract #1: players-index pool) ---- */

export interface PlayerTeamStint {
  abbr: string;
  name: string;
  start_year: number;
  end_year: number | null;
  gp: number | null;
  ppg: number | null;
}

export interface PlayerAwards {
  /** Award years (e.g. [2009, 2010]); empty array = never won. */
  mvp: number[];
  fmvp: number[];
  dpoy: number[];
  roty: number | null;
  smoy: number[];
  allstar_count: number;
  allnba_count: number;
  rings: number[];
}

export interface PlayerCareerTotals {
  pts: number;
  reb: number;
  ast: number;
  ppg: number;
  rpg: number;
  apg: number;
  seasons: number;
}

/** One row of the curated players-index pool (mirrors players_curated.json). */
export interface PlayerIndexEntry {
  person_id: number;
  full_name: string;
  aliases: string[];
  fame_tier: 1 | 2 | 3 | 4;
  position: "G" | "F" | "C" | "G-F" | "F-C";
  height_in: number | null;
  weight_lb: number | null;
  birth_year: number | null;
  country: string;
  college: string | null;
  draft: { year: number; round: number; pick: number; team_abbr: string } | null;
  jersey: number | null;
  is_active: boolean;
  teams: PlayerTeamStint[];
  awards: PlayerAwards;
  career: PlayerCareerTotals;
}

/** A player-matching rule (semantics implemented in utils/criteria.ts). */
export interface Criterion {
  type: "team" | "award" | "country" | "draft" | "college" | "stat" | "era";
  value: string;
  label: string;
}

/* ---- Per-game round payloads for the criteria/board games ---- */

export interface HeatmapBoard {
  qid: string;
  hexes: { id: number; criterion: Criterion; neighbors: number[] }[];
}

export interface ConnectionsBoard {
  qid: string;
  tiles: string[];
  groups: { label: string; difficulty: number; members: string[] }[];
}

export interface GridConfig {
  qid: string;
  rows: Criterion[];
  cols: Criterion[];
}

export interface BingoCard {
  qid: string;
  cells: Criterion[];
}

export interface WwwMatchup {
  qid: string;
  a: { label: string; sub?: string };
  b: { label: string; sub?: string };
}

/** A game's payload is an array of one of these shapes (Wordle = string[]). */
export type GameData =
  | PlayoffSeries
  | NbaTeamLogo
  | MvpSeason
  | StartingFiveGame
  | FanFavoritesQuestion
  | HeatmapBoard
  | ConnectionsBoard
  | GridConfig
  | BingoCard
  | WwwMatchup
  | PlayerIndexEntry
  | string;

export interface GameError {
  title: string;
  message: string;
}

export interface FetchResult {
  success: boolean;
  data?: GameData[];
  error?: GameError;
}

export interface Game {
  id: string;
  name: string;
  description: string;
  /** Short uppercase category label shown on the card pill and game chip. */
  tag: string;
  instruction: string;
  /** Short lead-in shown at the top of the "How to play" modal. */
  intro: string;
  /** Numbered rules shown in the "How to play" modal. */
  rules: { n: string; t: string }[];
  loadingMessage: string;
  backgroundImage: string;
  urlPath: string;
  pointsPerCorrect: number;
  maxPoints: number;
  fetchData: () => Promise<FetchResult>;
  handleError: (error: GameError) => void;
}

/** Called by a renderer when a game finishes, with the final score. */
export type OnGameEnd = (finalScore: number) => void;

export interface RoomState {
  status: "idle" | "loading" | "ready" | "active" | "complete" | "playing" | "matched";
  code: number | null;
  game: Game | null;
  opponent: PlayerInfo | null;
  gameData: GameData[] | null;
  selfSocketId: string | null;
  role: "host" | "guest" | null;
}
