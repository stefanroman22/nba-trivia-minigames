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

/** A game's payload is an array of one of these shapes (Wordle = string[]). */
export type GameData =
  | PlayoffSeries
  | NbaTeamLogo
  | MvpSeason
  | StartingFiveGame
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
  instruction: string;
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
