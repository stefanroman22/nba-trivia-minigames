// Detects whether a card's spec already IS an implementation plan: numbered steps that name
// files. When it is, the brief copies the steps and no planner is spawned (design §8).
const STEP_RE = /^\s*(\d+)[.)]\s+(.*)$/;
const BACKTICK_PATH_RE = /`([^`\s]+\/[^`\s]+)`/g;
const BARE_PATH_RE = /\b((?:src|backend|scripts|docs|multiplayer_server|infra)\/[\w./\-\[\]]+)/g;

// `src/x.tsx:57-63` → `src/x.tsx` (specs cite line ranges; the file is what matters)
const clean = (p) => p.replace(/:\d+(?:-\d+)?$/, "").replace(/[.:,;]+$/, "");

function filesIn(text) {
  const out = new Set();
  for (const m of text.matchAll(BACKTICK_PATH_RE)) out.add(clean(m[1]));
  for (const m of text.matchAll(BARE_PATH_RE)) out.add(clean(m[1]));
  return [...out];
}

/**
 * @param {string} specText
 * @returns {{ hasPlan: boolean, steps: Array<{ n: number, text: string, files: string[] }> }}
 */
export function detectSteps(specText) {
  const steps = [];
  for (const raw of String(specText || "").split(/\r?\n/)) {
    const m = raw.match(STEP_RE);
    if (m) {
      steps.push({ n: Number(m[1]), text: m[2].trim(), files: [] });
    } else if (steps.length && /^\s{2,}\S/.test(raw)) {
      // indented continuation of the previous step
      steps[steps.length - 1].text += " " + raw.trim();
    }
  }
  for (const s of steps) s.files = filesIn(s.text);
  const withFiles = steps.filter((s) => s.files.length).length;
  const hasPlan = steps.length >= 3 && withFiles * 2 >= steps.length;
  return { hasPlan, steps };
}
