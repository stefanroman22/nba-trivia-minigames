/**
 * Public, unauthenticated reads of a published custom game (`/trivia/custom-games/<slug>/`). Plain `fetch`: there is no
 * session to attach, and the same data is served to everyone with the link. A 404 means the slug is unknown or the game
 * is not published (a draft is invisible here), which the page shows as "not available".
 */
import { BACKEND_ORIGIN } from "../../configurations/backend";
import type { BuilderMode, CustomPlay } from "./types";

export interface PublicGame {
  slug: string;
  title: string;
  description: string;
  mode: BuilderMode;
  rounds: number;
  points_per_correct: number;
}

/** Thrown for a 404: the game does not exist or is not published. */
export class GameNotAvailableError extends Error {
  constructor() {
    super("This game is not available.");
    this.name = "GameNotAvailableError";
  }
}

const url = (slug: string, tail = "") => `${BACKEND_ORIGIN}/trivia/custom-games/${encodeURIComponent(slug)}/${tail}`;

async function getJson<T>(endpoint: string, fallback: string, signal?: AbortSignal): Promise<T> {
  const res = await fetch(endpoint, signal ? { signal } : {});
  if (res.status === 404) throw new GameNotAvailableError();
  if (!res.ok) throw new Error(fallback);
  return (await res.json()) as T;
}

export async function fetchPublicGame(slug: string, signal?: AbortSignal): Promise<PublicGame> {
  const data = await getJson<{ game: PublicGame }>(url(slug), "Could not load this game.", signal);
  return data.game;
}

export function fetchPublicPlay(slug: string, signal?: AbortSignal): Promise<CustomPlay> {
  return getJson<CustomPlay>(url(slug, "play/"), "Could not load the rounds.", signal);
}
