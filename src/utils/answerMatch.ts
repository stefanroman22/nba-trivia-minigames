// Shared free-text answer matching for survey-style games (Fan Favorites).
// Guesses are compared against a canonical answer plus its aliases, so
// "kareem", "abdul-jabbar" and "Kareem Abdul Jabbar" all hit the same slot.

/** Lowercase, strip accents (NFD), drop punctuation ('.,-) and collapse whitespace. */
export function normalizeAnswer(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/['\u2019.,-]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Return the index of the answer whose normalized canonical text or any
 * normalized alias equals the normalized guess, else -1.
 */
export function matchAnswer(
  guess: string,
  answers: { answer: string; aliases?: string[] }[],
): number {
  const normalized = normalizeAnswer(guess);
  if (!normalized) return -1;
  return answers.findIndex(
    (a) =>
      normalizeAnswer(a.answer) === normalized ||
      (a.aliases ?? []).some((alias) => normalizeAnswer(alias) === normalized),
  );
}
