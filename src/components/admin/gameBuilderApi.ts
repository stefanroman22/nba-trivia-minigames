/**
 * Types + fetchers for the admin Game Builder tab. Mirrors the backend's /admin/game-builder/ endpoints
 * (staff-only): an AI agent turns a plain-text description into a data-driven game spec, which the admin can
 * refine with follow-up prompts and play as a draft. Errors arrive as `{error}` (or `{detail}` on a rate limit).
 */
import { apiFetch } from "../../utils/Api";
import { BACKEND_URL } from "../../configurations/backend";
import { MODE_LABEL, type BuilderMode, type CustomPlay, type Round, type RoundSide } from "../customGame/types";

// The player and the public page share these with the admin code; re-exported so existing imports keep working.
export { MODE_LABEL };
export type { BuilderMode, Round, RoundSide };

export interface BuilderField {
  name: string;
  type: "string" | "number" | "boolean" | "list";
  description: string;
}

export interface BuilderSource {
  id: string;
  title: string;
  description: string;
  rows: number;
  fields: BuilderField[];
}

export interface BuilderFilter {
  field: string;
  op: "eq" | "ne" | "gt" | "gte" | "lt" | "lte" | "in" | "contains" | "exists";
  value: unknown;
}

export interface GameSpec {
  version: 1;
  title: string;
  description: string;
  source: string;
  mode: BuilderMode;
  rounds: number;
  points_per_correct: number;
  filters: BuilderFilter[];
  /** Template, e.g. "Which team drafted {full_name}?" */
  prompt: string;
  /** multiple_choice + type_answer */
  answer_field?: string;
  /** multiple_choice */
  options?: number;
  /** higher_lower */
  compare_field?: string;
  /** higher_lower */
  label_field?: string;
  /** Optional template shown after answering. */
  reveal?: string;
}

export interface BuilderPreview {
  pool_size: number;
  answer_values: number;
  rounds: Round[];
  warnings: string[];
}

export interface TranscriptEntry {
  role: "admin" | "agent";
  text: string;
  /** ISO time */
  at: string;
}

export interface GameSummary {
  id: number;
  slug: string;
  title: string;
  description: string;
  mode: BuilderMode;
  source: string;
  /** An approval covers one exact spec: a refine puts a published game back to draft. */
  status: "draft" | "published";
  published_at: string | null;
  /** e.g. "/custom/draft-day"; always present, only reachable while published. */
  public_path: string;
  updated_at: string;
}

export interface GameDetail extends GameSummary {
  spec: GameSpec;
  transcript: TranscriptEntry[];
  preview: BuilderPreview;
  model: string;
  usage: { input_tokens: number; output_tokens: number; turns: number };
}

export interface BuilderOverview {
  enabled: boolean;
  model: string;
  sources: BuilderSource[];
  games: GameSummary[];
}

export type BuilderPlay = CustomPlay;

/** The list row of a game: what the overview returns for it. */
export function toSummary(g: GameDetail): GameSummary {
  return {
    id: g.id,
    slug: g.slug,
    title: g.title,
    description: g.description,
    mode: g.mode,
    source: g.source,
    status: g.status,
    published_at: g.published_at,
    public_path: g.public_path,
    updated_at: g.updated_at,
  };
}

const BASE = `${BACKEND_URL}/admin/game-builder/`;

async function failure(res: Response, fallback: string): Promise<Error> {
  const data = await res.json().catch(() => ({}));
  return new Error(data.error || data.detail || fallback);
}

export async function fetchOverview(): Promise<BuilderOverview> {
  const res = await apiFetch(BASE);
  if (!res.ok) throw await failure(res, "Could not load the game builder");
  return (await res.json()) as BuilderOverview;
}

export async function buildGame(prompt: string): Promise<GameDetail> {
  const res = await apiFetch(BASE, { method: "POST", body: JSON.stringify({ prompt }) });
  if (!res.ok) throw await failure(res, "The agent could not build this game");
  const data = (await res.json()) as { game: GameDetail };
  return data.game;
}

export async function fetchGame(id: number): Promise<GameDetail> {
  const res = await apiFetch(`${BASE}${id}/`);
  if (!res.ok) throw await failure(res, "Could not load this game");
  const data = (await res.json()) as { game: GameDetail };
  return data.game;
}

export async function refineGame(id: number, prompt: string): Promise<GameDetail> {
  const res = await apiFetch(`${BASE}${id}/refine/`, { method: "POST", body: JSON.stringify({ prompt }) });
  if (!res.ok) throw await failure(res, "The agent could not refine this game");
  const data = (await res.json()) as { game: GameDetail };
  return data.game;
}

export async function fetchPlay(id: number): Promise<BuilderPlay> {
  const res = await apiFetch(`${BASE}${id}/play/`);
  if (!res.ok) throw await failure(res, "Could not load the rounds");
  return (await res.json()) as BuilderPlay;
}

export async function deleteGame(id: number): Promise<void> {
  const res = await apiFetch(`${BASE}${id}/`, { method: "DELETE" });
  if (!res.ok) throw await failure(res, "Could not delete this game");
}

/** Approve a draft (it gets its public page) or take a published game down again. 400 `{error}` when it cannot be published. */
export async function publishGame(id: number, action: "publish" | "unpublish"): Promise<GameDetail> {
  const res = await apiFetch(`${BASE}${id}/publish/`, { method: "POST", body: JSON.stringify({ action }) });
  if (!res.ok) throw await failure(res, action === "publish" ? "Could not publish this game" : "Could not unpublish this game");
  const data = (await res.json()) as { game: GameDetail };
  return data.game;
}
