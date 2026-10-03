// Pulls the numbered rules out of a constraint doc so a brief can quote only the ones that
// apply, instead of every agent re-reading the whole document (design §6).
//
// A rule heading looks like one of:
//   ## RULE 0 — Your root is `<GameFrame>`
//   ### RULE 4.2a — Never render an empty slot
//   ## Rule UI-4: One CSS file per page/feature
// "### RULE 4.2 acceptance test" is NOT a rule (it belongs to 4.2's body in spirit, but we keep
// the body of a rule to its own text so the quote stays short).
const HEADING_RE = /^(#{2,3})\s+(.*)$/;
// The id must be followed by a separator (— : -) or the end of the heading; "RULE 4.2 acceptance
// test" therefore never matches (neither "4.2" nor a backtracked "4" is followed by a separator).
const RULE_RE = /^(?:RULE|Rule)\s+([A-Z]+-\d+|\d+(?:\.\d+)?[a-z]?)(?=\s*(?:[—:\-–]|$))\s*(?:[—:\-–]\s*)?(.*)$/;

/** @returns {Array<{ id: string, heading: string, body: string, level: number }>} */
export function extractRules(docText) {
  const lines = String(docText || "").split(/\r?\n/);
  const rules = [];
  let current = null;
  for (const line of lines) {
    const h = line.match(HEADING_RE);
    if (h) {
      const level = h[1].length;
      if (current && level <= current.level) current = null; // a heading at the same or a higher level closes the body
      const r = h[2].match(RULE_RE);
      if (r) {
        current = { id: r[1], heading: r[2].trim(), body: "", level };
        rules.push(current);
      }
      continue;
    }
    if (current) current.body += (current.body ? "\n" : "") + line;
  }
  for (const r of rules) r.body = r.body.trim();
  return rules;
}

/** Rules whose heading or body mention any keyword, ranked by hit count, ties by doc order. */
export function selectRules(rules, keywords, { max = 8 } = {}) {
  const kws = [...new Set((keywords || []).map((k) => String(k).toLowerCase()).filter((k) => k.length >= 3))];
  if (!kws.length) return [];
  const scored = rules.map((r, i) => {
    const hay = (r.heading + "\n" + r.body).toLowerCase();
    let hits = 0;
    for (const k of kws) if (hay.includes(k)) hits += 1;
    return { r, i, hits };
  });
  return scored
    .filter((s) => s.hits > 0)
    .sort((a, b) => b.hits - a.hits || a.i - b.i)
    .slice(0, max)
    .map((s) => s.r);
}

/** One line per rule — the cheap "rules at a glance" index a brief always carries. */
export function ruleIndex(rules) {
  return rules.map((r) => `- RULE ${r.id} — ${r.heading}`).join("\n");
}
