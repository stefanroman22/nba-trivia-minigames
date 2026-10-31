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

/** A name's lookup key: normalized, then without spaces, so a space typed for an apostrophe, hyphen or initials'
 * dot still matches ("Shaquille O Neal", "Karl Anthony Towns", "A C Green"). */
export const nameKey = (s: string) => normalizeAnswer(s).replace(/\s+/g, "");

const NAME_SUFFIX = /\s+(jr|sr|ii|iii|iv|v)$/;
/** The normalized name without its trailing Jr / Sr / II-V, or null when it has none. */
const bareOf = (normalized: string) => (NAME_SUFFIX.test(normalized) ? normalized.replace(NAME_SUFFIX, "") : null);

/**
 * True when a typed name means `answer`: the same nameKey (every pair matchAnswer accepts, plus spaces typed for
 * hyphens or dots). Failing that, a suffix on one side only is forgiven ("Mike Conley Jr" for "Mike Conley",
 * "Bobby Portis" for "Bobby Portis Jr."), but only when `knownKeys` (nameKeys of every player name) shows the
 * typed name is not another real player: "Gary Payton" never means Gary Payton II, "Tim Hardaway Jr." never a
 * "Tim Hardaway". Two different suffixes never match ("Marvin Bagley II" is not "Marvin Bagley III"). Without
 * `knownKeys` only the same key counts.
 */
export function sameName(typed: string, answer: string, knownKeys?: ReadonlySet<string> | null): boolean {
  const t = normalizeAnswer(typed);
  const a = normalizeAnswer(answer);
  if (!t || !a) return false;
  const key = (s: string) => s.replace(/\s+/g, "");
  if (key(t) === key(a)) return true;
  if (!knownKeys || knownKeys.has(key(t))) return false;
  const bareT = bareOf(t);
  const bareA = bareOf(a);
  if (bareT !== null && bareA === null) return key(bareT) === key(a);
  if (bareT === null && bareA !== null) return key(t) === key(bareA);
  return false;
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
