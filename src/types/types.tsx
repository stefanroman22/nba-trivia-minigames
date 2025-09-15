export  interface User {
  username: string;
  email: string;
  profile_photo: string;
  points: number;
  rank: string;
}


export interface GameRender {
  gameInfo: any[];              // array of any type, or define a proper type
  pointsPerCorrect: number;
  onGameEnd: (finalScore: number) => void;
}

export interface RoomState {
  status: "idle" | "loading" | "ready" | "active" | "complete";
  code: number | null;
  isHost: boolean;
  
}
