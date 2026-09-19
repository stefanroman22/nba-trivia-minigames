// Pure Slack message builders for the team pipeline. No I/O.
//
// qaCardText   ({title, category, priority, model, effort, planModel, fixCycles, did, check, devUrl, commit, half?})
// failCardText ({title, category, attempts, maxAttempts, model, effort, planModel, stage, reason, fixCycles, replanned, lastError, cardUrl, needsHuman, half?})
// runSummaryText ({start, end, shipped:[{title,category}], failed:[{title,category,stage,attempts,maxAttempts,channel}], leftTodo, pr:{number,count}|null, prSkipped:string|null})
// sessionReportText ({label, start, end, shipped:[{title,category,sha}], qaWaiting, doneCount}) → {head, text}
import { CATEGORIES } from "./team-config.mjs";

export const sha7 = (sha) => String(sha || "").slice(0, 7);

const designRound = (planModel) => (planModel ? `yes (${planModel})` : "no");
const halfSuffix = (half) => (half ? ` (${half} half)` : "");

export function qaCardText(t) {
  return [
    `✅ ${t.title}${halfSuffix(t.half)}   ·   ${t.category} · ${t.priority || "P2"}`,
    `Model: ${t.model} · effort ${t.effort}  ·  design round: ${designRound(t.planModel)}  ·  fix cycles: ${t.fixCycles ?? 0}`,
    `Did: ${t.did || "see commit"}`,
    `Check: ${t.check || "verify the change"}`,
    `Dev: ${t.devUrl}   ·   commit ${sha7(t.commit)}`,
    `✅ approve   ·   🔄 needs work — reply to say what`,
  ].join("\n");
}

export function failCardText(t) {
  const cycles = `${t.fixCycles ?? 0} fix cycle${t.fixCycles === 1 ? "" : "s"}`;
  const tried = t.replanned ? `${cycles}, 1 replan` : cycles;
  const footer = t.needsHuman
    ? "Needs human ✔ — pipeline will skip it until you uncheck."
    : "Back in To Do — retries next run.";
  return [
    `❌ ${t.title}${halfSuffix(t.half)}   ·   ${t.category} · attempt ${t.attempts}/${t.maxAttempts}`,
    `Model: ${t.model} · effort ${t.effort} · design round: ${designRound(t.planModel)}`,
    `Failed at: ${t.stage} — ${t.reason}`,
    `Tried: ${tried}. Last error: ${t.lastError || "n/a"}`,
    `Post-mortem: ${t.cardUrl}`,
    footer,
  ].join("\n");
}

export function countByCategory(items) {
  const n = {};
  for (const it of items) n[it.category] = (n[it.category] || 0) + 1;
  return CATEGORIES.filter((c) => n[c]).map((c) => `${c} ${n[c]}`).join(" · ");
}

export function runSummaryText(r) {
  const lines = [
    `🟢 Run done · ${r.start}–${r.end} · ${r.shipped.length} shipped to dev, ${r.failed.length} failed, ${r.leftTodo} left in To Do`,
  ];
  const counts = countByCategory(r.shipped);
  if (counts) lines.push(counts);
  for (const s of r.shipped) lines.push(`• ${s.title}`);
  for (const f of r.failed) lines.push(`Failed: ${f.title} (${f.stage}, attempt ${f.attempts}/${f.maxAttempts} → details in #agent-${f.channel})`);
  if (r.pr) lines.push(`dev → main PR: #${r.pr.number} (${r.pr.count} tasks waiting for your merge)`);
  else lines.push(`dev → main PR: not opened — ${r.prSkipped || "dev not ahead of main"}`);
  return lines.join("\n");
}

export function sessionReportText(s) {
  const head = `📋 *${s.label}* — dev ${s.start}–${s.end}`;
  const tail = `QA: ${s.qaWaiting} waiting · Done: ${s.doneCount} reached main this window`;
  if (!s.shipped.length) return { head, text: `${head}: no work this session.\n${tail}` };
  const lines = [`${head}: ${s.shipped.length} task(s) shipped`];
  const counts = countByCategory(s.shipped);
  if (counts) lines.push(counts);
  for (const t of s.shipped) lines.push(`• ${t.title} (${sha7(t.sha)})`);
  lines.push(tail);
  return { head, text: lines.join("\n") };
}

// Returns [{agent, did, assumed}] from a "## Agent notes" block (commit body or PR body), or [].
export function parseAgentNotes(body) {
  const out = [];
  const m = String(body || "").match(/## Agent notes([\s\S]*?)(?:\n## |\n*$)/);
  if (!m) return out;
  const re = /- agent:\s*(\S+)[\s\S]*?did:\s*(.*?)\s*(?:\n\s*assumed:\s*(.*?))?(?=\n\s*- agent:|\n*$)/g;
  let x;
  while ((x = re.exec(m[1]))) out.push({ agent: x[1].trim(), did: (x[2] || "").trim(), assumed: (x[3] || "none").trim() });
  return out;
}
