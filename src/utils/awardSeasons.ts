// Guess the MVP's award seasons (backend trivia/data_pipeline/award_seasons.py): one row per
// season and award (MVP, Finals MVP, Defensive Player of the Year, Rookie of the Year, Sixth
// Man of the Year). Rows published before the award seasons carry only { season, mvp }, so every
// helper falls back to the MVP question.
// Type imports only: scripts/check-award-seasons.mjs loads this file on its own.
import type { MvpSeason } from "../types/types";

/** The title the game showed before the award seasons. */
export const LEGACY_PROMPT = "Who won MVP?";

/** The question on screen: "Who was the {award} in {season}?". */
export function awardPrompt(row: MvpSeason): string {
  return row.prompt || LEGACY_PROMPT;
}

/** The longest question a round can show, reserved so the title keeps one size across rounds (UI-23). */
export function promptReserve(row: MvpSeason): string {
  return row.prompt ? `Who was the Defensive Player of the Year in ${row.season}?` : LEGACY_PROMPT;
}

/** Every right answer for matchAnswer: each co-winner's name, else the row's mvp. */
export function acceptedAnswers(row: MvpSeason): { answer: string }[] {
  const names = (row.winners ?? []).map((w) => w?.name).filter((n): n is string => !!n);
  return names.length ? names.map((answer) => ({ answer })) : [{ answer: row.mvp || "" }];
}

/** The id the game logs and the seen set keeps: "{season}:{award}", or the season on an old row. */
export function awardQuestionId(row: MvpSeason): string {
  return row.award ? `${row.season}:${row.award}` : String(row.season);
}

/** The answer as revealed: every co-winner joined with " & ". */
export function winnersText(row: MvpSeason): string {
  return acceptedAnswers(row).map((a) => a.answer).join(" & ");
}
