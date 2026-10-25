// The points rules of backend/trivia/awarding.py, parsed from the app under test, and the check of one award receipt
// (log-session's answer, the relay's pointsAwarded) against them: LC-GAMEDATA-02 and LC-ROOMS-10 share it so neither
// accepts a receipt that merely adds up.
const num = (s) => Number(String(s).replace(/_/g, ''));

/** awarding.py source → { max, perGame: { id: cap }, firstBonus, milestones: { days: bonus } } or null. */
export function awardRules(src) {
  const max = /^DEFAULT_MAX_POINTS\s*=\s*([\d_]+)/m.exec(src);
  const per = /^GAME_MAX_POINTS\s*=\s*\{([^}]*)\}/m.exec(src);
  const first = /^FIRST_GAME_BONUS\s*=\s*([\d_]+)/m.exec(src);
  const miles = /^STREAK_MILESTONES\s*=\s*\{([^}]*)\}/m.exec(src);
  if (!max || !per || !first || !miles) return null;
  return {
    max: num(max[1]),
    perGame: Object.fromEntries([...per[1].matchAll(/"([^"]+)"\s*:\s*([\d_]+)/g)].map((m) => [m[1], num(m[2])])),
    firstBonus: num(first[1]),
    milestones: Object.fromEntries([...miles[1].matchAll(/([\d_]+)\s*:\s*([\d_]+)/g)].map((m) => [num(m[1]), num(m[2])])),
  };
}

/**
 * One receipt { awarded, base, first_game_bonus, streak_bonus } against the rules, given /me/ before and after it
 * ({ active_days, streak_days }). award() counts a Paris day once, on its first scoring game: active_days +1 ⇔ that
 * game pays exactly FIRST_GAME_BONUS and the milestone of the new streak length (or 0); a later scoring game the same
 * day pays neither; a play that scores nothing pays nothing and counts no day. → [{ part, measured, expected }]
 */
export function receiptProblems(r, before, after, rules) {
  const out = [];
  const bad = (part, measured, expected) => out.push({ part, measured: String(measured), expected });
  const { base, first_game_bonus: first, streak_bonus: streak, awarded } = r;
  if (awarded !== base + first + streak) bad('awarded', `${awarded} (base ${base} + first ${first} + streak ${streak})`, 'base + first_game_bonus + streak_bonus');
  const dDays = after.active_days - before.active_days;
  if (base === 0) {
    if (first !== 0 || streak !== 0 || dDays !== 0) bad('nothing scored', `first ${first}, streak ${streak}, active_days +${dDays}`, 'no bonus and no day counted');
  } else if (dDays === 1) {
    const milestone = rules.milestones[after.streak_days] ?? 0;
    if (first !== rules.firstBonus) bad('first_game_bonus', first, `${rules.firstBonus} (the day's first scoring game: active_days went up)`);
    if (streak !== milestone) bad('streak_bonus', streak, `${milestone} (STREAK_MILESTONES at a ${after.streak_days}-day streak)`);
  } else if (dDays === 0) {
    if (first !== 0 || streak !== 0) bad('bonuses', `first ${first}, streak ${streak}`, '0 and 0 (the day was already counted: not its first scoring game)');
  } else bad('active_days', `${before.active_days} → ${after.active_days}`, '+0 or +1 per game');
  return out;
}
