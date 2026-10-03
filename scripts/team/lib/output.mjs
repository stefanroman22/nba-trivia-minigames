// Shrinks command output to what an agent needs to act on (design §5: failures only, ≤100 lines).
const FAIL_RE = /error|fail|✖|×|Traceback|AssertionError|ERROR|FAILED|Type error|TS\d{4}|not ok/i;
const CONTEXT_BEFORE = 1; // eslint and `next build` put the file path on the line BEFORE the error
const CONTEXT_AFTER = 2;

/**
 * @param {string} text raw stdout+stderr
 * @param {number} max hard cap on returned lines (the trailer counts as one)
 * @param {{ fallbackTail?: boolean }} opts when the command failed but nothing matched, keep the last 40 lines
 */
export function failuresOnly(text, max = 100, { fallbackTail = false } = {}) {
  const lines = String(text || "").replace(/\r/g, "").split("\n");
  const keepIdx = new Set();
  const seen = new Set();
  for (let i = 0; i < lines.length; i++) {
    if (!FAIL_RE.test(lines[i])) continue;
    const key = lines[i].trim();
    if (seen.has(key)) continue;
    seen.add(key);
    for (let j = Math.max(0, i - CONTEXT_BEFORE); j <= Math.min(lines.length - 1, i + CONTEXT_AFTER); j++) {
      if (lines[j].trim()) keepIdx.add(j);
    }
  }
  const keep = [...keepIdx].sort((a, b) => a - b).map((i) => lines[i]);
  if (!keep.length) {
    if (!fallbackTail) return "";
    return lines.filter((l) => l.trim()).slice(-40).join("\n");
  }
  if (keep.length <= max) return keep.join("\n");
  const shown = keep.slice(0, max - 1);
  shown.push(`… (+${keep.length - shown.length} more lines)`);
  return shown.join("\n");
}
