/* eslint-disable @typescript-eslint/no-explicit-any */
export  interface User {
  username: string;
  email: string;
  profile_photo: string;
  points: number;
  rank: string;
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
  fetchData: () => Promise<{ success: boolean; data?: any; error?: any }>;
  handleError: (error: { title: string; message: string }) => void;
}


export interface GameRender {
  gameInfo: any[];              
  pointsPerCorrect: number;
  onGameEnd: (finalScore: number) => void;
}

export interface RoomState {
  status: "idle" | "loading" | "ready" | "active" | "complete" | "playing" | "matched";
  code: number | null;
  game: string | null; // if it's an object, replace `string` with the correct type
  opponent: string | null; // or replace `string` with a Player type if needed
  gameData: any | null; // ideally replace `any` with a proper type later
  selfSocketId: string | null;
  role: "host" | "guest" | null; // use a union type for clarity
}
