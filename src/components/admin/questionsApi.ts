/**
 * Types + fetchers for the admin question labeling (Games → Tic-Tac-Toe → View questions).
 * Mirrors backend/trivia/admin_questions.py: a question without a label is not reviewed yet and counts as hard.
 */
import { apiFetch } from "../../utils/Api";
import { BACKEND_URL } from "../../configurations/backend";

export type Difficulty = "easy" | "medium" | "hard";
export type QuestionFilter = "all" | "unreviewed" | Difficulty;
export type QuestionSort = "qid" | "factory" | "accuracy" | "updated";

export const DIFFICULTIES: readonly Difficulty[] = ["easy", "medium", "hard"];
export const DIFFICULTY_LABEL: Record<Difficulty, string> = { easy: "Easy", medium: "Medium", hard: "Hard" };

export type QuestionCounts = {
  total: number;
  reviewed: number;
  unreviewed: number;
  easy: number;
  medium: number;
  /** Includes the unreviewed questions (hard is the default). */
  hard: number;
};

export type QuestionLabel = { difficulty: Difficulty; reviewed: boolean; updated_at: string | null };

export type BoardCell = { count: number; top: string[]; attempts: number; accuracy: number | null };

export type AdminQuestion = {
  id: number;
  qid: string;
  label: QuestionLabel;
  /** The question factory's own score (0 = easiest) and band, from its quality features. */
  factory: { band: Difficulty | null; difficulty: number | null };
  plays: { attempts: number; correct: number; accuracy: number | null };
  board: { rows: string[]; cols: string[]; cells: BoardCell[] | null; error: string | null };
};

export type QuestionPage = { game: string; counts: QuestionCounts; total: number; offset: number; rows: AdminQuestion[] };

export async function fetchQuestions(
  p: { game: string; filter: QuestionFilter; sort: QuestionSort; q: string; offset: number; limit: number },
  signal?: AbortSignal,
): Promise<QuestionPage> {
  const params = new URLSearchParams({ game: p.game, filter: p.filter, sort: p.sort, offset: String(p.offset), limit: String(p.limit) });
  if (p.q.trim()) params.set("q", p.q.trim());
  const res = await apiFetch(`${BACKEND_URL}/admin/questions/?${params}`, signal ? { signal } : {});
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || data.detail || "Could not load the questions");
  return data as QuestionPage;
}

export async function setQuestionLabel(id: number, difficulty: Difficulty): Promise<{ label: QuestionLabel; counts: QuestionCounts }> {
  const res = await apiFetch(`${BACKEND_URL}/admin/questions/${id}/label/`, { method: "POST", body: JSON.stringify({ difficulty }) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || data.detail || "Could not save the label");
  return data as { label: QuestionLabel; counts: QuestionCounts };
}
