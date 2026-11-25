/**
 * Shapes shared by everything that plays an AI-built custom game: the admin preview (components/admin) and the
 * public page (views/CustomGame). They mirror the backend's round payload, so neither side needs the other's API file.
 */
export type BuilderMode = "multiple_choice" | "type_answer" | "higher_lower";

export const MODE_LABEL: Record<BuilderMode, string> = {
  multiple_choice: "Multiple choice",
  type_answer: "Type the answer",
  higher_lower: "Higher or lower",
};

export interface RoundSide {
  label: string;
  value: number;
}

export interface Round {
  id: string;
  kind: BuilderMode;
  prompt: string;
  /** multiple_choice */
  options?: string[];
  /** multiple_choice: the correct option text; type_answer: canonical answer; higher_lower: "left" | "right". */
  answer: string;
  /** type_answer: every accepted answer (canonical + aliases). */
  accepted?: string[];
  /** higher_lower */
  left?: RoundSide;
  /** higher_lower */
  right?: RoundSide;
  /** Already rendered text. */
  reveal?: string;
}

/** What `/play/` returns (admin and public): one dealt set of rounds. */
export interface CustomPlay {
  rounds: Round[];
  points_per_correct: number;
  max_points: number;
}
