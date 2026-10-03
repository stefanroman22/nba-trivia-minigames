// Shrinks command output to what an agent needs to act on (design §5: failures only, ≤100 lines).
const FAIL_RE = /error|fail|✖|×|Traceback|AssertionError|ERROR|FAILED|Type error|TS\d{4}|not ok/i;
const CONTEXT_AFTER = 2;

/**
 * @param {string} text raw stdout+stderr
 * @param {number} max hard cap on returned lines (the trailer counts as one)
 * @param {{ fallbackTail?: boolean }} opts when the command failed but nothing matched, keep the last 40 lines
 */
export function failuresOnly(text, max = 100, { fallbackTail = false } = {}) {
  const lines = String(text || "").replace(/\r/g, "").split("\n");
  const keep = [];
  const seen = new Set();
  let carry = 0;
  for (const line of lines) {
    const hit = FAIL_RE.test(line);
    if (hit) carry = CONTEXT_AFTER + 1;
    if (carry > 0) {
      carry -= 1;
      const key = line.trim();
      if (!key) continue;
      if (hit && seen.has(key)) { carry = 0; continue; }
      if (hit) seen.add(key);
      keep.push(line);
    }
  }
  if (!keep.length) {
    if (!fallbackTail) return "";
    const tail = lines.filter((l) => l.trim()).slice(-40);
    return tail.join("\n");
  }
  if (keep.length <= max) return keep.join("\n");
  const shown = keep.slice(0, max - 1);
  shown.push(`… (+${keep.length - shown.length} more lines)`);
  return shown.join("\n");
}
