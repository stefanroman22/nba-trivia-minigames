// The feedback-triage agent's answer, checked against the batch it was given. Pure functions.
//
//   batch  (manage.py feedback_triage export): { run, kinds, items: [{ id, rating, message, page, game, day, signed_in }] }
//   triage (the agent):                        { items: [{ id, kind, summary, cluster }], tickets: [ticket + evidence[]] }
//   applied (this script → manage.py … apply): { run, items: [{ id, kind, summary, cluster, ticket }] }
//
// Every exported item gets exactly one verdict; a ticket must point at the feedback that justifies it.
import { validateTickets } from '../../team/lib/ticket.mjs';

export const KINDS = ['bug', 'idea', 'content', 'praise', 'complaint', 'other'];
// Kinds that can justify a ticket. Praise and unactionable complaints are recorded, never filed.
export const ACTIONABLE = ['bug', 'idea', 'content'];

export function validateTriage(batch, triage) {
  const problems = [];
  const ids = new Set((batch?.items || []).map((i) => i.id));
  const items = Array.isArray(triage?.items) ? triage.items : null;
  if (!items) return { ok: false, problems: ['The answer must be { "items": [ … ], "tickets": [ … ] }.'], tickets: [], items: [] };
  const seen = new Set();
  for (const it of items) {
    if (!ids.has(it?.id)) { problems.push(`items: id ${JSON.stringify(it?.id)} is not in the batch.`); continue; }
    if (seen.has(it.id)) problems.push(`items: id ${it.id} has two verdicts.`);
    seen.add(it.id);
    if (!KINDS.includes(it.kind)) problems.push(`items: id ${it.id} has kind "${it.kind}"; use one of ${KINDS.join(', ')}.`);
    if (typeof it.summary !== 'string' || !it.summary.trim()) problems.push(`items: id ${it.id} needs a one-line summary.`);
  }
  for (const id of ids) if (!seen.has(id)) problems.push(`items: feedback ${id} has no verdict.`);

  const rawTickets = Array.isArray(triage.tickets) ? triage.tickets : [];
  const v = rawTickets.length ? validateTickets({ tickets: rawTickets }) : { ok: true, problems: [], tickets: [] };
  problems.push(...v.problems);
  const kindOf = new Map(items.map((i) => [i.id, i.kind]));
  const claimed = new Map();
  v.tickets.forEach((t, i) => {
    if (!t.evidence.length) problems.push(`tickets[${i}]: "evidence" must list the feedback ids it comes from.`);
    for (const id of t.evidence) {
      if (!ids.has(id)) problems.push(`tickets[${i}]: evidence ${id} is not in the batch.`);
      else if (!ACTIONABLE.includes(kindOf.get(id))) problems.push(`tickets[${i}]: evidence ${id} is "${kindOf.get(id)}", which never becomes a ticket.`);
      if (claimed.has(id)) problems.push(`tickets[${i}]: evidence ${id} is already used by tickets[${claimed.get(id)}].`);
      claimed.set(id, i);
    }
  });
  return { ok: !problems.length, problems, tickets: v.tickets, items };
}

/** The verdict rows for `manage.py feedback_triage apply`, each with the id of the card its ticket became. */
export function appliedDoc(batch, items, tickets, results) {
  const cardOf = new Map();
  tickets.forEach((t, i) => { for (const id of t.evidence) cardOf.set(id, results[i]?.id || ''); });
  return {
    run: batch.run,
    items: items.map((i) => ({ id: i.id, kind: i.kind, summary: String(i.summary).trim(), cluster: String(i.cluster || '').trim(), ticket: cardOf.get(i.id) || '' })),
  };
}

/** The closing line of a feedback card: where it came from, in numbers only (the messages stay in the database). */
export const evidenceNote = (t, batch) => {
  const rows = (batch.items || []).filter((i) => t.evidence.includes(i.id));
  const avg = rows.length ? (rows.reduce((n, r) => n + r.rating, 0) / rows.length).toFixed(1) : '-';
  return `Filed by the feedback-triage agent from ${rows.length} player report(s) (feedback ids ${t.evidence.join(', ')}; average rating ${avg}/5), run ${batch.run}. Review before moving to To Do.`;
};
